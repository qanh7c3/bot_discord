import 'dotenv/config';
import { setGlobalDispatcher, Agent } from 'undici';
try {
  setGlobalDispatcher(new Agent({ maxHeaderSize: 131072 }));
} catch {}
import { Client, GatewayIntentBits, Events, Options } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import play from 'play-dl';
import { Ytdl } from '@distube/ytdl-core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

if (global.gc) {
  setInterval(() => {
    try { global.gc(); } catch {}
  }, 30000).unref();
}

const ytdl = new Ytdl();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
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

const guildPlayers = new Map();

function getOrCreatePlayer(guildId) {
  let player = guildPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    player.on('error', (error) => {
      console.error(`Lỗi AudioPlayer tại Guild ${guildId}:`, error.message);
    });
    guildPlayers.set(guildId, player);
  }
  return player;
}

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
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ask') return;

  await interaction.deferReply();

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
      const candidateModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
      let answer = '';
      let usedModel = 'gemini-3.8-flash';
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

      let songTitle = '';
      let songUrl = '';

      if (source === 'youtube') {
        const isYtUrl = play.yt_validate(question) === 'video';
        if (isYtUrl) {
          songUrl = question;
          songTitle = 'YouTube Track';
          try {
            const info = await play.video_basic_info(question);
            songTitle = info.video_details.title || songTitle;
          } catch {}
        } else {
          const results = await play.search(question, { source: { youtube: 'video' }, limit: 1 });
          if (!results || results.length === 0 || !results[0].url) {
            await interaction.editReply(`❌ Không tìm thấy bài hát nào trên YouTube cho: *${question}*`);
            return;
          }
          songTitle = results[0].title || 'YouTube Track';
          songUrl = results[0].url;
        }
      } else if (source === 'spotify') {
        let query = question;
        if (question.includes('open.spotify.com')) {
          try {
            const res = await fetch(question);
            const html = await res.text();
            const match = html.match(/property="og:title" content="([^"]+)"/);
            if (match && match[1]) query = match[1];
          } catch {}
        }
        const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
        if (!results || results.length === 0 || !results[0].url) {
          await interaction.editReply(`❌ Không tìm thấy bài hát nào trên Spotify/YouTube cho: *${question}*`);
          return;
        }
        songTitle = results[0].title || query;
        songUrl = results[0].url;
      } else if (source === 'soundcloud') {
        if (question.startsWith('https://') && question.includes('soundcloud.com')) {
          songUrl = question;
          songTitle = 'SoundCloud Track';
          try {
            const info = await play.soundcloud(question);
            songTitle = info.name || songTitle;
          } catch {}
        } else {
          const results = await play.search(question, { source: { youtube: 'video' }, limit: 1 });
          if (!results || results.length === 0 || !results[0].url) {
            await interaction.editReply(`❌ Không tìm thấy bài hát nào trên SoundCloud/YouTube cho: *${question}*`);
            return;
          }
          songTitle = results[0].title || question;
          songUrl = results[0].url;
        }
      }

      if (!songUrl) {
        await interaction.editReply(`❌ Không tìm thấy URL hợp lệ cho bài hát: *${question}*`);
        return;
      }

      const player = getOrCreatePlayer(interaction.guildId);
      const connection = joinVoiceChannel({
        channelId: memberVoiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);

      try {
        let resource;
        if (songUrl.includes('soundcloud.com')) {
          try {
            const scStream = await play.stream(songUrl);
            resource = createAudioResource(scStream.stream, { inputType: scStream.type });
          } catch {
            const ytResults = await play.search(songTitle, { source: { youtube: 'video' }, limit: 1 });
            if (ytResults && ytResults[0]?.url) {
              const stream = ytdl.download(ytResults[0].url, {
                filter: (f) => f.container === 'webm' && f.hasAudio && !f.hasVideo,
                highWaterMark: 1 << 20,
              });
              const probe = await demuxProbe(stream);
              resource = createAudioResource(probe.stream, { inputType: probe.type });
            } else {
              throw new Error('SoundCloud stream failed and no YouTube fallback found');
            }
          }
        } else {
          const stream = ytdl.download(songUrl, {
            filter: (f) => f.container === 'webm' && f.hasAudio && !f.hasVideo,
            highWaterMark: 1 << 20,
          });
          const probe = await demuxProbe(stream);
          resource = createAudioResource(probe.stream, { inputType: probe.type });
        }

        player.play(resource);

        await interaction.editReply(
          `▶️ **Đang phát:** [${songTitle}](${songUrl})\n🔊 Kênh thoại: **${memberVoiceChannel.name}**\n📡 Nguồn: **${source.toUpperCase()}**`
        );
      } catch (streamErr) {
        console.error('Lỗi khi phát stream audio:', streamErr);
        await interaction.editReply(
          `⚠️ Không thể phát nguồn âm thanh này: ${streamErr.message}\n💡 *Có thể do nền tảng (${source.toUpperCase()}) hạn chế bản quyền hoặc yêu cầu xác thực.*`
        );
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
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN.trim());
