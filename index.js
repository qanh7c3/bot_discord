import 'dotenv/config';
import { setGlobalDispatcher, Agent } from 'undici';
try {
  setGlobalDispatcher(new Agent({ maxHeaderSize: 131072 }));
} catch {}
import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import play from 'play-dl';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { search as ddgSearch, SafeSearchType } from 'duck-duck-scrape';
import { deployCommands } from './deploy-commands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
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

play.getFreeClientID().then((id) => {
  if (id) {
    play.setToken({ soundcloud: { client_id: id } });
  }
}).catch(() => {});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot đã kết nối thành công: ${readyClient.user.tag}`);
  if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
    await deployCommands(process.env.CLIENT_ID, process.env.DISCORD_TOKEN);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ask') return;

  await interaction.deferReply();

  const source = interaction.options.getString('source');
  const question = interaction.options.getString('question');

  try {
    if (source === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        await interaction.editReply('❌ Chưa cấu hình `GEMINI_API_KEY`. Vui lòng thêm biến môi trường.');
        return;
      }
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(question);
      const answer = result.response.text();
      await sendLongReply(interaction, `🤖 **Google Gemini (1.5 Flash)** - Câu hỏi: *${question}*`, answer);
      return;
    }

    if (source === 'groq') {
      if (!process.env.GROQ_API_KEY) {
        await interaction.editReply('❌ Chưa cấu hình `GROQ_API_KEY`. Vui lòng thêm biến môi trường.');
        return;
      }
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: question }],
        model: 'llama-3.3-70b-versatile',
      });
      const answer = completion.choices[0]?.message?.content || 'Không có câu trả lời.';
      await sendLongReply(interaction, `⚡ **Groq (Llama 3.3 70B)** - Câu hỏi: *${question}*`, answer);
      return;
    }

    if (source === 'web') {
      const searchRes = await ddgSearch(question, { safeSearch: SafeSearchType.MODERATE });
      if (!searchRes || !searchRes.results || searchRes.results.length === 0) {
        await interaction.editReply(`❌ Không tìm thấy kết quả nào cho: *${question}*`);
        return;
      }
      const top3 = searchRes.results.slice(0, 3);
      let reply = `🔍 **Kết quả tìm kiếm Web cho:** *${question}*\n\n`;
      top3.forEach((item, index) => {
        reply += `**${index + 1}. [${item.title}](${item.url})**\n${item.snippet || 'Không có mô tả.'}\n\n`;
      });
      await interaction.editReply(reply.trim());
      return;
    }

    if (source === 'youtube' || source === 'spotify' || source === 'soundcloud') {
      let songTitle = '';
      let songUrl = '';

      if (source === 'soundcloud') {
        const isUrl = play.so_validate(question);
        if (isUrl) {
          songUrl = question;
          const info = await play.soundcloud(question);
          songTitle = info.name || 'SoundCloud Track';
        } else {
          const scSearch = await play.search(question, { source: { soundcloud: 'tracks' }, limit: 1 });
          if (!scSearch || scSearch.length === 0) {
            await interaction.editReply(`❌ Không tìm thấy bài hát nào trên SoundCloud cho: *${question}*`);
            return;
          }
          songTitle = scSearch[0].name || scSearch[0].title || 'SoundCloud Track';
          songUrl = scSearch[0].url;
        }
      } else if (source === 'spotify') {
        const isSpUrl = play.sp_validate(question);
        if (isSpUrl) {
          if (play.is_expired()) {
            await play.refreshToken();
          }
          const spData = await play.spotify(question);
          songTitle = `${spData.name} - ${spData.artists?.map((a) => a.name).join(', ') || ''}`;
          songUrl = question;
        } else {
          const spSearch = await play.search(question, { source: { spotify: 'track' }, limit: 1 });
          if (!spSearch || spSearch.length === 0) {
            await interaction.editReply(`❌ Không tìm thấy bài hát nào trên Spotify cho: *${question}*`);
            return;
          }
          songTitle = `${spSearch[0].name} - ${spSearch[0].artists?.map((a) => a.name).join(', ') || ''}`;
          songUrl = spSearch[0].url;
        }
      } else {
        const isYtUrl = play.yt_validate(question);
        if (isYtUrl) {
          songUrl = question;
          const info = await play.video_basic_info(question);
          songTitle = info.video_details.title || 'YouTube Track';
        } else {
          const ytSearch = await play.search(question, { limit: 1 });
          if (!ytSearch || ytSearch.length === 0) {
            await interaction.editReply(`❌ Không tìm thấy bài hát nào trên YouTube cho: *${question}*`);
            return;
          }
          songTitle = ytSearch[0].title || 'YouTube Track';
          songUrl = ytSearch[0].url;
        }
      }

      const memberVoiceChannel = interaction.member?.voice?.channel;
      if (!memberVoiceChannel) {
        await interaction.editReply(
          `🎵 **Đã tìm thấy bài hát (${source.toUpperCase()}):**\n📌 **${songTitle}**\n🔗 ${songUrl}\n💡 *Hãy tham gia vào một kênh thoại (Voice Channel) và thử lại để bot phát nhạc trực tiếp.*`
        );
        return;
      }

      const player = getOrCreatePlayer(interaction.guildId);
      const connection = joinVoiceChannel({
        channelId: memberVoiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      connection.subscribe(player);

      const stream = await play.stream(songUrl);
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
      });

      player.play(resource);

      await interaction.editReply(
        `▶️ **Đang phát:** [${songTitle}](${songUrl})\n🔊 Kênh thoại: **${memberVoiceChannel.name}**\n📡 Nguồn: **${source.toUpperCase()}**`
      );
      return;
    }
  } catch (err) {
    console.error('Lỗi khi xử lý lệnh /ask:', err);
    await interaction.editReply(`⚠️ Đã xảy ra lỗi khi thực thi lệnh: ${err.message}`);
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Thiếu biến môi trường DISCORD_TOKEN trong file .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
