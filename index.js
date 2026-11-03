import http from 'http';
import dns from 'dns';
import 'dotenv/config';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const { Client, GatewayIntentBits, Events, Options } = await import('discord.js');
const { Agent } = await import('undici');
const { Connectors } = await import('shoukaku');
const { Kazagumo } = await import('kazagumo');
const { GoogleGenerativeAI } = await import('@google/generative-ai');
const { default: Groq } = await import('groq-sdk');

let loginError = null;
let lastDebug = 'none';
let loginResolved = false;
let lastInteraction = 'none';
let lastInteractionError = 'none';
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    const tokenInfo = process.env.DISCORD_TOKEN ? `${process.env.DISCORD_TOKEN.slice(0, 6)}...${process.env.DISCORD_TOKEN.slice(-4)} (len:${process.env.DISCORD_TOKEN.length})` : 'MISSING';
    const shardStatus = client.ws.shards.first()?.status ?? 'no-shard';
    const botStatus = client.isReady()
      ? `Bot is running! [Node ${process.version}] Discord: ONLINE (${client.user?.tag || ''}) - Guilds: ${client.guilds.cache.size} | Last: ${lastInteraction} | Err: ${lastInteractionError} | Debug: ${lastDebug}`
      : `Bot is running! [Node ${process.version}] Discord: OFFLINE (ws: ${client.ws.status}, shard: ${shardStatus}, loginResolved: ${loginResolved}, error: ${loginError || 'none'}, token: ${tokenInfo}, debug: ${lastDebug}) | Last: ${lastInteraction} | Err: ${lastInteractionError}`;
    res.end(botStatus);
  } else {
    res.writeHead(405);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

if (global.gc) {
  setInterval(() => {
    try { global.gc(); } catch {}
  }, 30000).unref();
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
  rest: {
    agent: new Agent({ connect: { family: 4 } }),
    timeout: 15000,
    retries: 1,
    rejectOnRateLimit: (data) => data.timeToReset > 2500,
  },
  makeCache: Options.cacheWithLimits({
    MessageManager: 0,
    PresenceManager: 0,
    UserManager: 0,
    GuildMemberManager: 0,
    ReactionManager: 0,
    ThreadManager: 0,
    StageInstanceManager: 0,
    GuildScheduledEventManager: 0,
    AutoModerationRuleManager: 0,
  }),
});

const originalRestGet = client.rest.get.bind(client.rest);
client.rest.get = async (route, options) => {
  if (typeof route === 'string' && route.includes('/gateway/bot')) {
    return {
      url: 'wss://gateway.discord.gg',
      shards: 1,
      session_start_limit: {
        total: 1000,
        remaining: 999,
        reset_after: 86400000,
        max_concurrency: 1,
      },
    };
  }
  return originalRestGet(route, options);
};

const Nodes = [
  {
    name: 'millohost-v4',
    url: 'lava-v4.millohost.my.id:443',
    auth: 'https://discord.gg/mjS5J2K3ep',
    secure: true,
  },
  {
    name: 'trinium-2333',
    url: 'lavalink.triniumhost.com:2333',
    auth: 'kirito',
    secure: false,
  },
  {
    name: 'trinium-4333',
    url: 'lavalink.triniumhost.com:4333',
    auth: 'free',
    secure: false,
  },
  {
    name: 'heavencloud-v4',
    url: 'budget-us7.bot.heavencloud.in:6706',
    auth: 'youshallnotpass',
    secure: false,
  },
];

const kazagumo = new Kazagumo(
  {
    defaultSearchEngine: 'youtube',
    send: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(payload);
    },
  },
  new Connectors.DiscordJS(client),
  Nodes,
  {
    moveOnDisconnect: true,
    resume: false,
    reconnectTries: 5,
    reconnectInterval: 5,
    restTimeout: 10000,
  }
);

kazagumo.shoukaku.on('ready', (name) => {
  console.log(`Lavalink Node [${name}] đã sẵn sàng.`);
});

kazagumo.shoukaku.on('error', (name, error) => {
  console.error(`Lỗi Lavalink Node [${name}]:`, error.message);
});

kazagumo.on('playerEmpty', (player) => {
  player.destroy();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guild = oldState.guild;
  const player = kazagumo.players.get(guild.id);
  if (!player) return;
  const channel = guild.channels.cache.get(player.voiceId);
  if (channel && channel.members.filter((m) => !m.user.bot).size === 0) {
    player.destroy();
  }
});

function splitMessage(text, maxLength = 1900) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let sliceIdx = remaining.lastIndexOf('\n', maxLength);
    if (sliceIdx <= 0) {
      sliceIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (sliceIdx <= 0) {
      sliceIdx = maxLength;
    }
    chunks.push(remaining.slice(0, sliceIdx).trim());
    remaining = remaining.slice(sliceIdx).trim();
  }
  return chunks;
}

async function sendLongReply(interaction, header, text) {
  const fullText = `${header}\n\n${text}`;
  const chunks = splitMessage(fullText, 1900);
  await interaction.editReply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot đã kết nối thành công: ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    status: 'online',
    activities: [{ name: '/ask', type: 0 }],
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ask') return;

  const t0 = Date.now();
  try {
    await interaction.deferReply();
    lastInteraction = `${new Date().toLocaleTimeString('vi-VN')} - deferReply OK in ${Date.now() - t0}ms (${interaction.options.getString('source')})`;
    console.log(lastInteraction);
  } catch (err) {
    const timeRemaining = err.timeToReset ? `${(err.timeToReset / 1000).toFixed(0)}s (${(err.timeToReset / 60000).toFixed(1)}p)` : (err.message || err.name || 'Unknown');
    lastInteractionError = `${new Date().toLocaleTimeString('vi-VN')} - deferReply ERR in ${Date.now() - t0}ms: ${timeRemaining}`;
    console.error(lastInteractionError);
    return;
  }

  const source = interaction.options.getString('source');
  const question = interaction.options.getString('question');

  try {
    if (source === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
      if (!apiKey) {
        await interaction.editReply('❌ Chưa cấu hình `GEMINI_API_KEY`. Vui lòng thêm biến môi trường.');
        return;
      }
      const genAI = new GoogleGenerativeAI(apiKey);
      const candidateModels = ['gemini-3-flash-preview', 'gemini-2.5-flash-lite'];
      let answer = '';
      let usedModel = 'gemini-3-flash-preview';
      for (const m of candidateModels) {
        try {
          const model = genAI.getGenerativeModel({ model: m });
          const result = await model.generateContent(question);
          answer = result.response.text();
          usedModel = m;
          break;
        } catch (e) {
          if (m === candidateModels[candidateModels.length - 1]) throw e;
        }
      }
      await sendLongReply(interaction, `🤖 **Google Gemini (${usedModel})** - Câu hỏi: *${question}*`, answer);
      return;
    }

    if (source === 'groq') {
      const apiKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : '';
      if (!apiKey) {
        await interaction.editReply('❌ Chưa cấu hình `GROQ_API_KEY`. Vui lòng thêm biến môi trường.');
        return;
      }
      const groq = new Groq({ apiKey });
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: question }],
        model: 'openai/gpt-oss-20b',
      });
      const answer = completion.choices[0]?.message?.content || 'Không có câu trả lời.';
      await sendLongReply(interaction, `⚡ **Groq (GPT-OSS 20B)** - Câu hỏi: *${question}*`, answer);
      return;
    }

    if (source === 'web') {
      const wikiUrl = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(question)}&format=json&origin=*`;
      const res = await fetch(wikiUrl);
      const data = await res.json();
      const searchResults = data?.query?.search || [];
      if (searchResults.length === 0) {
        await interaction.editReply(`❌ Không tìm thấy kết quả nào cho: *${question}*`);
        return;
      }
      const top3 = searchResults.slice(0, 3);
      let reply = `🔍 **Kết quả tra cứu cho:** *${question}*\n\n`;
      top3.forEach((item, index) => {
        const cleanSnippet = (item.snippet || '').replace(/<[^>]*>/g, '').trim();
        const articleUrl = `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`;
        reply += `**${index + 1}. [${item.title}](${articleUrl})**\n${cleanSnippet || 'Không có mô tả.'}\n\n`;
      });
      await interaction.editReply(reply.trim());
      return;
    }

    if (source === 'youtube' || source === 'spotify' || source === 'soundcloud') {
      const memberVoiceChannel = interaction.member?.voice?.channel;
      if (!memberVoiceChannel) {
        await interaction.editReply(
          `🎵 **Yêu cầu phát nhạc (${source.toUpperCase()}):** *${question}*\n💡 *Hãy tham gia vào một kênh thoại (Voice Channel) và thử lại để bot phát nhạc trực tiếp.*`
        );
        return;
      }

      let searchEngine = 'youtube';
      let searchQuery = question;

      if (source === 'soundcloud') {
        searchEngine = 'soundcloud';
      } else if (source === 'spotify') {
        searchEngine = question.includes('open.spotify.com') ? undefined : 'youtube';
      }

      try {
        const res = await kazagumo.search(searchQuery, {
          requester: interaction.user,
          ...(searchEngine ? { engine: searchEngine } : {}),
        });

        if (!res || !res.tracks.length) {
          await interaction.editReply(`❌ Không tìm thấy bài hát nào cho: *${question}*`);
          return;
        }

        let player = kazagumo.players.get(interaction.guildId);
        if (!player) {
          player = await kazagumo.createPlayer({
            guildId: interaction.guildId,
            textId: interaction.channelId,
            voiceId: memberVoiceChannel.id,
            deaf: true,
          });
        }

        if (res.type === 'PLAYLIST') {
          for (const track of res.tracks) player.queue.add(track);
        } else {
          player.queue.add(res.tracks[0]);
        }

        if (!player.playing && !player.paused) {
          player.play();
        }

        const song = res.tracks[0];
        await interaction.editReply(
          `▶️ **Đang phát:** [${song.title}](${song.uri})\n🔊 Kênh thoại: **${memberVoiceChannel.name}**\n📡 Nguồn: **${source.toUpperCase()}**`
        );
      } catch (streamErr) {
        console.error('Lỗi khi phát nhạc Lavalink:', streamErr);
        await interaction.editReply(`⚠️ Không thể phát nguồn âm thanh này: ${streamErr.message}`);
      }
      return;
    }
  } catch (err) {
    console.error('Lỗi khi xử lý lệnh /ask:', err);
    await interaction.editReply(`⚠️ Đã xảy ra lỗi khi thực thi lệnh: ${err.message}`);
  } finally {
    if (global.gc) {
      try { global.gc(); } catch {}
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Thiếu biến môi trường DISCORD_TOKEN trong file .env');
  process.exit(1);
}

process.on('SIGTERM', () => {
  server.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  server.close();
  client.destroy();
  process.exit(0);
});

client.on('debug', (msg) => {
  lastDebug = msg;
  console.log(msg);
});

client.on('error', (err) => {
  loginError = err.message;
  console.error('Client error:', err.message);
});

client.rest.on('restDebug', (msg) => {
  lastDebug = `[REST] ${msg}`;
  console.log('[REST]', msg);
});

client.rest.on('rateLimited', (info) => {
  lastDebug = `[REST 429] retryAfter: ${info.retryAfter}ms`;
  console.warn('[REST 429]', info);
});

client.login(process.env.DISCORD_TOKEN.trim())
  .then(() => {
    loginResolved = true;
  })
  .catch((err) => {
    loginError = err.message;
    console.error('Lỗi kết nối Discord:', err.message);
  });
