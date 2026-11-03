import http from 'http';
import dns from 'dns';
import fs from 'fs';
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

const CONFIG_PATH = './config.json';
let botConfig = {
  readVoice: false,
  allowedUsers: [],
  allowedRoles: [],
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    botConfig = { ...botConfig, ...JSON.parse(raw) };
  } else {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(botConfig, null, 2));
  }
} catch {}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(botConfig, null, 2));
  } catch {}
}

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

function getTTSChunks(text, maxChunks = 2, maxLen = 180) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    const candidate = cur ? `${cur} ${s.trim()}` : s.trim();
    if (candidate.length <= maxLen) {
      cur = candidate;
    } else {
      if (cur) chunks.push(cur);
      cur = s.trim();
      while (cur.length > maxLen) {
        chunks.push(cur.slice(0, maxLen));
        cur = cur.slice(maxLen).trim();
      }
    }
    if (chunks.length >= maxChunks) break;
  }
  if (cur && chunks.length < maxChunks) chunks.push(cur);
  return chunks.slice(0, maxChunks);
}

async function playTTS(guildId, voiceChannelId, textChannelId, text) {
  const chunks = getTTSChunks(text, 2, 180);
  if (!chunks.length) return;
  try {
    let player = kazagumo.players.get(guildId);
    if (!player) {
      player = await kazagumo.createPlayer({
        guildId,
        textId: textChannelId,
        voiceId: voiceChannelId,
        deaf: true,
      });
    }
    player.queue.clear();
    for (const chunk of chunks) {
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const res = await kazagumo.search(ttsUrl);
      if (res?.tracks?.length) {
        player.queue.add(res.tracks[0]);
      }
    }
    if (player.playing) {
      player.skip();
    } else if (!player.paused) {
      player.play();
    }
  } catch (err) {
    console.error('Lỗi khi phát voice TTS:', err.message);
  }
}

function isOwner(user) {
  const ownerId = '902067412516610099';
  return user.id === ownerId || user.id === client.application?.owner?.id;
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot đã kết nối thành công: ${readyClient.user.tag}`);
  try {
    await client.application.fetch();
  } catch {}
  readyClient.user.setPresence({
    status: 'online',
    activities: [{ name: '/ask | /stop | /config', type: 0 }],
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  if (!['ask', 'stop', 'config'].includes(commandName)) return;

  const t0 = Date.now();
  try {
    await interaction.deferReply({ ephemeral: commandName === 'config' });
    lastInteraction = `${new Date().toLocaleTimeString('vi-VN')} - deferReply OK in ${Date.now() - t0}ms (${commandName})`;
    console.log(lastInteraction);
  } catch (err) {
    const timeRemaining = err.timeToReset ? `${(err.timeToReset / 1000).toFixed(0)}s (${(err.timeToReset / 60000).toFixed(1)}p)` : (err.message || err.name || 'Unknown');
    lastInteractionError = `${new Date().toLocaleTimeString('vi-VN')} - deferReply ERR in ${Date.now() - t0}ms: ${timeRemaining}`;
    console.error(lastInteractionError);
    return;
  }

  if (commandName === 'config') {
    if (!isOwner(interaction.user)) {
      await interaction.editReply('❌ Bạn không có quyền truy cập mục cấu hình này. Chỉ chủ bot mới có thể chỉnh sửa.');
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const voiceStatus = botConfig.readVoice ? '🟢 BẬT' : '🔴 TẮT';
      const usersList = botConfig.allowedUsers.length ? botConfig.allowedUsers.map((id) => `<@${id}>`).join(', ') : 'Tất cả mọi người';
      const rolesList = botConfig.allowedRoles.length ? botConfig.allowedRoles.map((id) => `<@&${id}>`).join(', ') : 'Tất cả vai trò';
      await interaction.editReply(
        `⚙️ **Cài đặt hệ thống Bot:**\n\n🔊 **Đọc Voice khi tra cứu:** ${voiceStatus}\n👥 **Người dùng được phép dùng bot:** ${usersList}\n🛡️ **Vai trò được phép dùng bot:** ${rolesList}`
      );
      return;
    }

    if (sub === 'voice') {
      const enabled = interaction.options.getBoolean('enabled');
      botConfig.readVoice = enabled;
      saveConfig();
      await interaction.editReply(`✅ Đã cập nhật chế độ tự động đọc voice khi tra cứu: **${enabled ? 'BẬT' : 'TẮT'}**`);
      return;
    }

    if (sub === 'whitelist') {
      const action = interaction.options.getString('action');
      const targetUser = interaction.options.getUser('user');
      const targetRole = interaction.options.getRole('role');

      if (action === 'add_user') {
        if (!targetUser) {
          await interaction.editReply('⚠️ Vui lòng chọn người dùng cần thêm vào danh sách.');
          return;
        }
        if (!botConfig.allowedUsers.includes(targetUser.id)) {
          botConfig.allowedUsers.push(targetUser.id);
          saveConfig();
        }
        await interaction.editReply(`✅ Đã thêm người dùng <@${targetUser.id}> vào danh sách được phép dùng bot.`);
        return;
      }

      if (action === 'remove_user') {
        if (!targetUser) {
          await interaction.editReply('⚠️ Vui lòng chọn người dùng cần xóa khỏi danh sách.');
          return;
        }
        botConfig.allowedUsers = botConfig.allowedUsers.filter((id) => id !== targetUser.id);
        saveConfig();
        await interaction.editReply(`✅ Đã xóa người dùng <@${targetUser.id}> khỏi danh sách.`);
        return;
      }

      if (action === 'add_role') {
        if (!targetRole) {
          await interaction.editReply('⚠️ Vui lòng chọn vai trò cần thêm vào danh sách.');
          return;
        }
        if (!botConfig.allowedRoles.includes(targetRole.id)) {
          botConfig.allowedRoles.push(targetRole.id);
          saveConfig();
        }
        await interaction.editReply(`✅ Đã thêm vai trò <@&${targetRole.id}> vào danh sách được phép dùng bot.`);
        return;
      }

      if (action === 'remove_role') {
        if (!targetRole) {
          await interaction.editReply('⚠️ Vui lòng chọn vai trò cần xóa khỏi danh sách.');
          return;
        }
        botConfig.allowedRoles = botConfig.allowedRoles.filter((id) => id !== targetRole.id);
        saveConfig();
        await interaction.editReply(`✅ Đã xóa vai trò <@&${targetRole.id}> khỏi danh sách.`);
        return;
      }

      if (action === 'reset') {
        botConfig.allowedUsers = [];
        botConfig.allowedRoles = [];
        saveConfig();
        await interaction.editReply('✅ Đã đặt lại quyền: Cho phép tất cả mọi người sử dụng bot.');
        return;
      }
    }
    return;
  }

  if (commandName === 'stop') {
    const player = kazagumo.players.get(interaction.guildId);
    if (!player) {
      await interaction.editReply('❌ Hiện tại bot không phát nhạc hoặc đọc voice trong server này.');
      return;
    }
    player.destroy();
    await interaction.editReply('⏹️ Đã dừng phát và rời khỏi kênh thoại.');
    return;
  }

  if (commandName === 'ask') {
    const hasRestrictions = botConfig.allowedUsers.length > 0 || botConfig.allowedRoles.length > 0;
    if (hasRestrictions && !isOwner(interaction.user)) {
      const userAllowed = botConfig.allowedUsers.includes(interaction.user.id);
      const roleAllowed = interaction.member?.roles?.cache?.some((r) => botConfig.allowedRoles.includes(r.id));
      if (!userAllowed && !roleAllowed) {
        await interaction.editReply('❌ Bạn không có quyền sử dụng bot này. Vui lòng liên hệ chủ bot.');
        return;
      }
    }

    const source = interaction.options.getString('source');
    const question = interaction.options.getString('question');
    const optVoice = interaction.options.getBoolean('voice');
    const shouldVoice = optVoice !== null ? optVoice : botConfig.readVoice;
    const memberVoiceChannel = interaction.member?.voice?.channel;

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
        if (shouldVoice && memberVoiceChannel) {
          await playTTS(interaction.guildId, memberVoiceChannel.id, interaction.channelId, answer);
        }
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
        if (shouldVoice && memberVoiceChannel) {
          await playTTS(interaction.guildId, memberVoiceChannel.id, interaction.channelId, answer);
        }
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
        if (shouldVoice && memberVoiceChannel) {
          const ttsSummary = top3.map((item, idx) => `${idx + 1}. ${item.title}: ${(item.snippet || '').replace(/<[^>]*>/g, '')}`).join('. ');
          await playTTS(interaction.guildId, memberVoiceChannel.id, interaction.channelId, ttsSummary);
        }
        return;
      }

      if (source === 'youtube' || source === 'spotify' || source === 'soundcloud') {
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
          let res = await kazagumo.search(searchQuery, {
            requester: interaction.user,
            ...(searchEngine ? { engine: searchEngine } : {}),
          });

          if ((!res || !res.tracks.length) && source === 'soundcloud') {
            res = await kazagumo.search(searchQuery, {
              requester: interaction.user,
              engine: 'youtube',
            });
          }

          if (!res || !res.tracks.length) {
            const cleanQuery = searchQuery.replace(/[()–—\-]/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanQuery && cleanQuery !== searchQuery) {
              res = await kazagumo.search(cleanQuery, {
                requester: interaction.user,
                engine: 'youtube',
              });
            }
          }

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
