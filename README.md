# Sky-Line Virtual Library — bản mẫu có tích hợp AI

## Có gì trong bản này?
- Giao diện thư viện ảo tiếng Việt.
- Chat với nhân vật văn học: khi máy chủ có API key, trò chuyện gọi OpenAI Responses API; nếu chưa có máy chủ/API, giao diện tự chuyển sang câu trả lời mẫu.
- Thử thách đọc hiểu, điểm và huy hiệu (dữ liệu điểm hiện là minh họa phía trình duyệt).
- Góc đề xuất sách mới: tên sách, tác giả, cấp học, thể loại và lý do muốn đọc.
- Khi chạy qua máy chủ, đề xuất được lưu trong `data/book-requests.json` và có thể xem chung từ các trình duyệt truy cập cùng máy chủ.
- Nếu chỉ mở file HTML trực tiếp, đề xuất được lưu trong localStorage của thiết bị hiện tại, không gửi cho thủ thư.

## Yêu cầu
- Node.js 20 trở lên (khuyến nghị bản LTS hiện hành).
- Kết nối internet khi cài thư viện và gọi AI.
- Một API key của OpenAI Platform nếu muốn bật AI thật. API usage có thể tính phí riêng; ChatGPT subscription không tự động bao gồm API usage.

## Chạy thử trên Windows
1. Giải nén thư mục ZIP.
2. Cài Node.js nếu máy chưa có.
3. Mở Command Prompt hoặc PowerShell trong thư mục dự án.
4. Chạy:
   ```powershell
   npm install
   ```
5. Thiết lập API key cho phiên PowerShell hiện tại:
   ```powershell
   $env:OPENAI_API_KEY="API_KEY_CUA_BAN"
   $env:OPENAI_MODEL="gpt-5.5"
   npm start
   ```
6. Mở trình duyệt tại `http://localhost:3000`.

Không dán API key vào file HTML, không gửi key cho học sinh và không tải key lên kho mã nguồn công khai. Nếu không có API key, website vẫn chạy được các phần bản mẫu, nhưng chat AI thật sẽ chưa hoạt động.

## Lưu ý dữ liệu
- Dữ liệu đề xuất sách hiện được lưu thành file JSON trên máy chủ, phù hợp để thử nghiệm nội bộ; chưa phải hệ thống cơ sở dữ liệu đa người dùng có sao lưu.
- Trước khi dùng cho toàn trường, nên triển khai trên máy chủ/hosting có HTTPS, giới hạn tần suất gọi AI, bổ sung xác thực/quyền quản trị, sao lưu dữ liệu và quy trình duyệt nội dung.
- Tránh thu thập thông tin cá nhân không cần thiết của học sinh. Bảng xếp hạng và hồ sơ điểm trong bản mẫu chưa đồng bộ giữa các thiết bị.
- Đề xuất sách chỉ là đề nghị để thư viện xem xét, không phải cam kết mua sách.

## Tệp chính
- `public/index.html`: giao diện.
- `server.js`: máy chủ API, kết nối AI và lưu đề xuất.
- `data/book-requests.json`: danh sách đề xuất sách.
