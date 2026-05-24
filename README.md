# PrimeLab

PrimeLab là web app học tập và thực nghiệm mật mã, tập trung vào số nguyên tố lớn và RSA. Dự án dùng Node.js, Express và JavaScript BigInt, có giao diện web, API backend, lưu dữ liệu cục bộ bằng JSON và xử lý tác vụ nặng qua worker thread.

## Đã làm được

- Đăng ký, đăng nhập, xác thực JWT và phân tách dữ liệu theo người dùng.
- Kiểm tra số nguyên tố bằng chia thử, Miller-Rabin và các chế độ kiểm tra/cấp chứng chỉ phù hợp theo kích thước bit.
- Tìm số nguyên tố từ 2 đến 16384 bit, hỗ trợ chế độ auto, hybrid/native, Miller-Rabin và Pocklington cho số nhỏ.
- Sinh khóa RSA từ cặp số nguyên tố `p`, `q`; xuất `n`, `phiN`, `lambdaN`, `e`, `d`.
- Mã hóa, giải mã, ký số và xác minh chữ ký RSA.
- Tính khóa bí mật `d` từ `e` và `n` bằng phân tích thừa số cho các modulus nhỏ/phù hợp demo.
- Lưu lịch sử thao tác, xóa từng bản ghi và tải kết quả prime/RSA/log dạng `.txt`.
- Chatbot học liệu RSA/ATTT, dùng Gemini có `GEMINI_API_KEY` đã được huấn luyện để trả lời những câu hỏi cơ bản về app.

## Cài đặt

Yêu cầu Node.js 18 trở lên.

```powershell
npm install
```

Tạo file `.env` từ `.env.example` nếu cần dùng chatbot hoặc đổi cấu hình:

```env
PORT=3000
JWT_SECRET=your_secret_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_CHAT_MODEL=gemini-2.5-flash
CHAT_MAX_OUTPUT_TOKENS=2048
```

`JWT_SECRET` nên được đặt khi chạy thật. Nếu không có, server dùng secret mặc định chỉ phù hợp demo.

## Chạy ứng dụng

```powershell
npm start
```

Mở trình duyệt tại:

```text
http://localhost:3000
```

Luồng sử dụng chính:

1. Vào `/register` tạo tài khoản hoặc `/login` để đăng nhập.
2. Vào dashboard để chọn công cụ.
3. Dùng `/prime-check` để kiểm tra số, `/prime-search` để tìm số nguyên tố.
4. Dùng `/rsa-keygen` để sinh khóa RSA.
5. Dùng `/rsa-crypto` để mã hóa, giải mã, ký và xác minh.
6. Xem lịch sử tại `/history`, tải kết quả tại `/downloads`.

## Kiểm tra nhanh

```powershell
npm test
```

Lệnh này kiểm tra cú pháp các file chính và chạy script validate lõi cho prime search, RSA round-trip, chữ ký RSA, modular inverse và phân tích RSA nhỏ.

## Dữ liệu và thư mục chính

- `server.js`: Express server, route giao diện và API.
- `src/prime.js`: thuật toán số nguyên tố, Miller-Rabin, Pocklington, tìm prime.
- `src/rsa.js`: RSA keygen, encrypt/decrypt, sign/verify, factorize, modular inverse.
- `src/history.js`: ghi/xuất lịch sử.
- `src/worker.js`: chạy tác vụ nặng ngoài main thread.
- `views/`: các trang HTML.
- `public/`: CSS, JS frontend và asset.
- `data/`: dữ liệu tài khoản, prime, RSA key, history.
- `outputs/`: file xuất tải xuống.
- `AI data training/`: tài liệu dùng làm ngữ cảnh chatbot.

## Lưu ý

PrimeLab phục vụ học tập, demo và nghiên cứu thuật toán. Khóa RSA sinh bởi dự án không nên dùng cho hệ thống production. Các số 8192/16384 bit lớn và có thể mất thời gian tùy máy và chế độ tìm kiếm.
