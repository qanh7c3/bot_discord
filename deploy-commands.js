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
          { name: 'Groq (GPT-OSS 20B)', value: 'groq' },
          { name: 'Tra cứu Web (Wikipedia)', value: 'web' },
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
    )
    .addBooleanOption((option) =>
      option
        .setName('voice')
        .setDescription('Đọc to kết quả vào kênh thoại nếu là AI/Web (Tùy chọn)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Dừng phát nhạc hoặc dừng đọc tra cứu và rời khỏi kênh thoại'),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Cấu hình bot (Chỉ dành cho chủ sở hữu bot)')
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Xem trạng thái cài đặt hiện tại của bot')
    )
    .addSubcommand((sub) =>
      sub
        .setName('voice')
        .setDescription('Bật hoặc tắt tự động đọc kết quả tra cứu vào kênh thoại')
        .addBooleanOption((opt) =>
          opt.setName('enabled').setDescription('Bật (True) hoặc Tắt (False)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('whitelist')
        .setDescription('Quản lý người dùng được phép sử dụng bot')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Hành động quản lý quyền')
            .setRequired(true)
            .addChoices(
              { name: 'Thêm người dùng', value: 'add' },
              { name: 'Xóa người dùng', value: 'remove' },
              { name: 'Cho phép tất cả (Reset)', value: 'reset' }
            )
        )
        .addUserOption((opt) =>
          opt.setName('user').setDescription('Chọn @tên người dùng').setRequired(false)
        )
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
    console.log('Đã đăng ký thành công các Slash Command toàn cục!');
  } catch (error) {
    console.error('Lỗi khi đăng ký Slash Command:', error);
  }
}

if (process.argv[1] && process.argv[1].endsWith('deploy-commands.js')) {
  import('dotenv/config').then(() => {
    deployCommands(process.env.CLIENT_ID, process.env.DISCORD_TOKEN);
  });
}
