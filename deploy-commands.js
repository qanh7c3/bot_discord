import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Truy vấn thông tin AI, tìm kiếm Web hoặc phát nhạc đa nguồn')
    .addStringOption((option) =>
      option
        .setName('source')
        .setDescription('Nguồn truy vấn thông tin hoặc âm nhạc')
        .setRequired(true)
        .addChoices(
          { name: 'Google Gemini', value: 'gemini' },
          { name: 'Groq (Llama 3.1)', value: 'groq' },
          { name: 'Tra cứu Web (DuckDuckGo)', value: 'web' },
          { name: 'YouTube Music', value: 'youtube' },
          { name: 'Spotify Music', value: 'spotify' },
          { name: 'SoundCloud Music', value: 'soundcloud' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('Câu hỏi cần giải đáp hoặc tên bài hát cần phát')
        .setRequired(true)
    ),
];

export async function deployCommands(clientId, token) {
  if (!clientId || !token) {
    console.error('Thiếu CLIENT_ID hoặc DISCORD_TOKEN để đăng ký Slash Command');
    return;
  }
  const rest = new REST().setToken(token);
  try {
    console.log('Bắt đầu làm mới các lệnh Slash Command toàn cục...');
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log('Đã đăng ký thành công Slash Command /ask toàn cục!');
  } catch (error) {
    console.error('Lỗi khi đăng ký Slash Command:', error);
  }
}

if (process.argv[1] && process.argv[1].endsWith('deploy-commands.js')) {
  import('dotenv/config').then(() => {
    deployCommands(process.env.CLIENT_ID, process.env.DISCORD_TOKEN);
  });
}
