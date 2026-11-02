# HƯỚNG DẪN TRIỂN KHAI DISCORD BOT LÊN RENDER (WEB SERVICE)

Tài liệu này hướng dẫn chi tiết cách cấu hình và triển khai bot Discord từ nền tảng Discloud sang **Render Web Service** (miễn phí), kết hợp **UptimeRobot** để giữ bot hoạt động liên tục 24/7 không bị ngủ đông.

---

## 1. Danh Sách Biến Môi Trường (Environment Variables)

Khi tạo Web Service trên Render, bạn cần cấu hình các biến môi trường trong mục **Environment** (hoặc tab **Environment Variables**):

| Tên biến (Key) | Bắt buộc | Mô tả |
| :--- | :--- | :--- |
| `DISCORD_TOKEN` | **Có** | Token bí mật của Discord Bot lấy từ Discord Developer Portal. |
| `CLIENT_ID` | **Có** | Application ID của Discord Bot (dùng để đăng ký Slash Command `/ask`). |
| `GEMINI_API_KEY` | **Có** | API Key từ Google AI Studio để gọi Gemini AI (`gemini-3.8-flash`, `gemini-3.5-flash-lite`). |
| `GROQ_API_KEY` | **Có** | API Key từ Groq Cloud để gọi mô hình `openai/gpt-oss-20b`. |
| `PORT` | *Tự động* | Cổng HTTP Server. Render sẽ tự động gán biến này; khi chạy cục bộ mặc định là `3000`. |

> [!NOTE]
> Để lấy nhanh các giá trị này, bạn có thể sao chép trực tiếp từ file `.env` hiện tại trên máy của bạn.

---

## 2. Hướng Dẫn Kiểm Tra Cục Bộ (Test Local)

Trước khi đẩy lên Render, bạn có thể kiểm tra trực tiếp trên máy tính:

### Bước 2.1: Chạy Server Bot
Mở terminal tại thư mục chứa mã nguồn của bot và chạy:
```bash
npm start
```
Khi chạy thành công, console sẽ hiển thị:
```text
Server is running on port 3000
Bot đã kết nối thành công: <Tên Bot>#<Tag>
```

### Bước 2.2: Kiểm tra HTTP Server
Mở trình duyệt web hoặc terminal khác và kiểm tra:
- **Trình duyệt**: Truy cập địa chỉ [http://localhost:3000](http://localhost:3000).
- **Hoặc dùng Curl**:
  ```bash
  curl http://localhost:3000
  ```
- **Kết quả trả về**: Mã trạng thái `200 OK` và chuỗi văn bản:
  ```text
  Bot is running
  ```

---

## 3. Các Bước Thiết Lập Web Service Trên Render

Render Web Service yêu cầu một cổng HTTP mở để lắng nghe health check. Mã nguồn đã được tích hợp sẵn HTTP server siêu nhẹ qua module `http` gốc của Node.js.

### Bước 3.1: Kết nối GitHub Repository
1. Đảm bảo mã nguồn mới nhất đã được đẩy (push) lên GitHub repository của bạn (ví dụ: `https://github.com/qanh7c3/bot_discord.git`).
2. Đăng nhập vào [Render Dashboard](https://dashboard.render.com).
3. Nhấn nút **New +** ở góc trên bên phải và chọn **Web Service**.
4. Chọn kết nối với kho lưu trữ GitHub của bạn.

### Bước 3.2: Cấu hình Web Service
Điền các thông số cơ bản:
- **Name**: `discord-multisource-bot` (hoặc tên bạn muốn đặt).
- **Region**: `Singapore` (hoặc khu vực gần bạn nhất để tối ưu độ trễ).
- **Branch**: `main`.
- **Root Directory**: Để trống (nếu repository chứa file mã nguồn ngay thư mục gốc).
- **Runtime**: `Node`.
- **Build Command**: `npm install`.
- **Start Command**: `npm start` (hoặc `node index.js`).
- **Instance Type**: Chọn gói **Free** (512 MB RAM, 0.1 CPU).

### Bước 3.3: Thêm Biến Môi Trường (Environment Variables)
Cuộn xuống phần **Environment Variables**, bấm **Add Environment Variable** và thêm lần lượt 4 biến:
- `DISCORD_TOKEN` = `<Token Discord Bot của bạn>`
- `CLIENT_ID` = `<Client ID của bạn>`
- `GEMINI_API_KEY` = `<Gemini API Key của bạn>`
- `GROQ_API_KEY` = `<Groq API Key của bạn>`

### Bước 3.4: Triển khai (Deploy)
1. Bấm **Create Web Service**.
2. Render sẽ tự động kéo mã nguồn từ GitHub, chạy `npm install` và thực thi `npm start`.
3. Khi thấy log báo `Server is running on port ...` và `Bot đã kết nối thành công`, dịch vụ của bạn đã Live!
4. Render sẽ cung cấp cho bạn một đường dẫn URL công khai có dạng:
   ```text
   https://<ten-dich-vu>.onrender.com
   ```
   Bấm vào link này, bạn sẽ thấy dòng chữ `Bot is running`.

---

## 4. Cấu Hình UptimeRobot Để Chống Ngủ Đông (Keep-Alive 24/7)

> [!WARNING]
> Trên gói Free của Render, nếu không nhận được request truy cập HTTP trong vòng **15 phút**, Web Service sẽ tự động chuyển sang chế độ ngủ đông (spin down) khiến bot Discord bị mất kết nối. Dùng UptimeRobot gửi ping định kỳ sẽ giữ bot luôn hoạt động.

### Bước 4.1: Đăng ký tài khoản UptimeRobot
Truy cập [uptimerobot.com](https://uptimerobot.com) và tạo tài khoản miễn phí.

### Bước 4.2: Tạo Monitor mới
1. Tại Dashboard của UptimeRobot, bấm **Add New Monitor**.
2. Cấu hình các mục như sau:
   - **Monitor Type**: Chọn `HTTP(s)`.
   - **Friendly Name**: `Discord Bot Ping` (hoặc tên tùy thích).
   - **URL (or IP)**: Dán URL Render của bạn, ví dụ: `https://ten-dich-vu.onrender.com`.
   - **Monitoring Interval**: Chọn `5 minutes` (mỗi 5 phút một lần để đảm bảo không chạm mốc 15 phút ngủ đông).
   - **Monitor Timeout**: Giữ mặc định `30 seconds`.
3. Bấm **Create Monitor**.

Từ thời điểm này, UptimeRobot sẽ đều đặn gửi request GET đến bot mỗi 5 phút, bot phản hồi `200 Bot is running`, đảm bảo dịch vụ Render luôn duy trì trạng thái thức và Discord Bot online 24/7!
