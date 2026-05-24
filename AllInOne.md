# Báo cáo tổng hợp dự án PrimeLab

## 1. Giới thiệu

PrimeLab là ứng dụng web phục vụ mục đích học tập và mô phỏng các bài toán cơ bản trong mật mã học. Hệ thống tập trung vào hai nhóm chức năng chính:

- Kiểm tra và tìm kiếm số nguyên tố lớn.
- Sinh khóa, mã hóa, giải mã và ký/xác minh chữ ký bằng hệ mật RSA.

Dự án được xây dựng bằng Node.js, Express và JavaScript BigInt. Các phép toán số lớn như lũy thừa modulo, nghịch đảo modulo, kiểm tra Miller-Rabin và tạo tham số RSA được xử lý trực tiếp trong mã nguồn của project.

## 2. Công nghệ sử dụng

- Backend: Node.js, Express.
- Frontend: HTML, CSS, JavaScript thuần.
- Xử lý số lớn: JavaScript BigInt.
- Tác vụ nặng: Worker Thread.
- Lưu dữ liệu: các file JSON trong thư mục `data`.
- Xác thực: tài khoản demo, bcrypt và JSON Web Token.

Các file chính:

- `server.js`: định nghĩa API, xác thực, kiểm tra input, gọi worker và lưu kết quả.
- `src/prime.js`: cài đặt thuật toán số nguyên tố.
- `src/rsa.js`: cài đặt các phép toán RSA.
- `src/worker.js`: chạy các tác vụ nặng để tránh khóa server chính.
- `src/history.js`: lưu và xuất lịch sử thao tác.
- `views/`: giao diện HTML.
- `public/js/`: xử lý tương tác phía trình duyệt.

## 3. Chức năng kiểm tra số nguyên tố

Người dùng nhập một số cần kiểm tra, chọn độ dài bit yêu cầu và số vòng kiểm tra. Frontend gửi dữ liệu đến API:

```text
POST /api/prime/check
```

Backend kiểm tra input, sau đó đưa tác vụ sang worker. Worker gọi hàm `checkPrime(...)` trong `src/prime.js`.

Nếu số nhập vào có đúng độ dài bit yêu cầu, hệ thống chạy thuật toán kiểm tra nguyên tố. Nếu không đúng độ dài bit yêu cầu, kết quả được đánh dấu là không hợp lệ về độ dài bit.

Phần kết quả trên giao diện được rút gọn thành câu kết luận:

```text
Số trên là số nguyên tố theo chuẩn kiểm tra <tên thuật toán kiểm tra>.
```

hoặc:

```text
Số trên không phải là số nguyên tố theo chuẩn kiểm tra <tên thuật toán kiểm tra>.
```

Điều này giúp người dùng đọc kết quả trực tiếp, không cần xem JSON kỹ thuật.

## 4. Thuật toán Miller-Rabin

Miller-Rabin là thuật toán kiểm tra nguyên tố xác suất, phù hợp với số lớn.

Với số lẻ `n > 2`, ta phân tích:

```text
n - 1 = 2^s * d
```

trong đó `d` là số lẻ.

Chọn một cơ sở kiểm tra `a`, tính:

```text
x = a^d mod n
```

Nếu:

```text
x = 1
```

hoặc:

```text
x = n - 1
```

thì cơ sở `a` tạm thời chấp nhận `n`.

Nếu chưa đạt, tiếp tục bình phương:

```text
x = x^2 mod n
```

Nếu trong quá trình bình phương có lúc `x = n - 1`, cơ sở `a` chấp nhận `n`. Nếu không, `n` là hợp số.

PrimeLab chạy nhiều vòng Miller-Rabin. Số vòng càng nhiều thì xác suất kết luận sai càng nhỏ.

Các hàm liên quan trong `src/prime.js`:

- `powMod(...)`: lũy thừa modulo nhanh.
- `splitPowerOfTwoFactor(...)`: tách `n - 1 = 2^s * d`.
- `witnessAcceptsNumber(...)`: kiểm tra một witness.
- `verifyMillerRabin(...)`: chạy nhiều vòng kiểm tra.
- `checkPrime(...)`: kiểm tra một số do người dùng nhập.

## 5. Chức năng tìm kiếm số nguyên tố

Người dùng chọn độ dài bit, phương pháp tìm kiếm, số vòng kiểm tra và số lần thử tối đa. Frontend gửi request đến:

```text
POST /api/prime/search
```

Hệ thống hỗ trợ các chế độ:

| Chế độ | Mục đích | Kết quả |
|---|---|---|
| Auto | Tự chọn phương pháp phù hợp | `proven` hoặc `probable` |
| Pocklington | Chứng minh prime với số nhỏ | `proven` |
| Hybrid | Tìm prime lớn nhanh hơn | `probable` |
| Miller-Rabin thuần | Tự sinh ứng viên và tự kiểm tra | `probable` |

Với số nhỏ hơn hoặc bằng 512 bit, chế độ Auto ưu tiên Pocklington để có chứng chỉ chứng minh. Với số lớn hơn 512 bit, Auto ưu tiên Hybrid để thời gian chạy hợp lý.

## 6. Sinh ứng viên prime

Với Miller-Rabin thuần và Pocklington, project tự sinh ứng viên bằng `crypto.randomBytes`.

Cách tạo ứng viên:

```text
candidate = randomBits | highestBitMask | 1
```

Trong đó:

- `highestBitMask` đảm bảo số có đúng độ dài bit.
- `| 1` đảm bảo số là số lẻ.
- `crypto.randomBytes` chỉ dùng để sinh dữ liệu ngẫu nhiên, không phải hàm kiểm tra nguyên tố.

Trước khi chạy thuật toán nặng, project lọc nhanh hợp số bằng danh sách prime nhỏ và phép `gcd`.

## 7. Thuật toán Pocklington

Pocklington dùng để chứng minh một số là nguyên tố khi biết một thừa số đủ lớn của `n - 1`.

PrimeLab tạo ứng viên theo dạng:

```text
n = 2 * R * q + 1
```

Suy ra:

```text
n - 1 = 2 * R * q
```

Trong đó:

- `q` là số nguyên tố nhỏ hơn đã được chứng minh.
- `R` là số ngẫu nhiên.
- `n` là ứng viên cần chứng minh.

Sau đó tìm witness `a` sao cho:

```text
a^(n-1) = 1 mod n
gcd(a^((n-1)/q) - 1, n) = 1
```

Nếu điều kiện đúng, có thể chứng minh `n` là số nguyên tố. Trong PrimeLab, Pocklington được giới hạn ở mức tối đa 512 bit để tránh thời gian chạy quá lâu.

## 8. Chế độ Hybrid

Hybrid được dùng khi cần tìm prime lớn trong thời gian hợp lý.

Quy trình:

1. Node/OpenSSL sinh nhanh một số prime nền.
2. Project không trả kết quả ngay.
3. Project tự chạy Miller-Rabin để xác minh lại.
4. Nếu qua kiểm tra, hệ thống mới trả kết quả.

Ý nghĩa:

- OpenSSL chỉ hỗ trợ tăng tốc bước sinh số.
- Miller-Rabin trong project vẫn là bước xác minh cuối.
- Nếu cần chứng minh project tự sinh và tự kiểm tra hoàn toàn, chọn chế độ Miller-Rabin thuần.

## 9. Chức năng tạo khóa RSA

Chức năng tạo khóa RSA sinh đầy đủ các tham số:

```text
p, q, n, phi(n), e, d
```

Các bước:

1. Sinh hai số nguyên tố khác nhau `p` và `q`.
2. Tính:

```text
n = p * q
```

3. Tính hàm Euler:

```text
phi(n) = (p - 1) * (q - 1)
```

4. Chọn số mũ công khai `e`, mặc định là:

```text
e = 65537
```

Điều kiện:

```text
gcd(e, phi(n)) = 1
```

5. Tính số mũ bí mật `d`:

```text
d = e^-1 mod phi(n)
```

Nghĩa là:

```text
e * d ≡ 1 mod phi(n)
```

Kết quả khóa:

```text
Khóa công khai = (n, e)
Khóa mật = d
```

Trong giao diện PrimeLab, phần tạo khóa RSA hiển thị rõ:

- `p`
- `q`
- `n`
- `phi(n)`
- `e`
- `d`
- khóa công khai `(n, e)`
- khóa mật `d`

## 10. Mã hóa và giải mã RSA

Với khóa công khai `(n, e)`, mã hóa thông điệp số `m`:

```text
c = m^e mod n
```

Trong đó:

- `m` là thông điệp dạng số.
- `c` là bản mã.
- Điều kiện: `0 <= m < n`.

Giải mã dùng khóa mật `d`:

```text
m = c^d mod n
```

Trong đó:

- `c` là bản mã.
- `m` là thông điệp ban đầu.
- Điều kiện: `0 <= c < n`.

## 11. Ký và xác minh chữ ký RSA

Khi ký thông điệp, hệ thống băm thông điệp trước, sau đó ký đại diện số của hash:

```text
s = Hash(message)^d mod n
```

Khi xác minh:

```text
Hash(message) == s^e mod n
```

Nếu hai giá trị bằng nhau, chữ ký hợp lệ. Nếu không bằng nhau, chữ ký không hợp lệ.

## 12. Tính d từ n và e

PrimeLab có chức năng phân tích `n` nhỏ để tìm lại `p` và `q`, sau đó tính `phi(n)` và tìm `d`.

Quy trình:

```text
n -> p, q -> phi(n) -> d = e^-1 mod phi(n)
```

Chức năng này chỉ áp dụng cho `n` nhỏ trong mục đích học tập. Với RSA an toàn trong thực tế, việc phân tích `n` lớn là không khả thi bằng CPU thông thường.

## 13. Lưu lịch sử và tải xuống

Sau mỗi thao tác, hệ thống lưu lịch sử gồm:

- loại thao tác;
- thời gian;
- trạng thái;
- tóm tắt kết quả;
- payload kỹ thuật.

Người dùng có thể xem lịch sử trong giao diện và tải xuống:

- kết quả tìm prime;
- danh sách khóa RSA;
- nhật ký thao tác.

## 14. Lưu ý bảo mật

PrimeLab phục vụ học tập, mô phỏng và trình bày thuật toán. Các khóa RSA sinh ra từ hệ thống không nên dùng cho môi trường production.

Lý do:

- giao diện có thể hiển thị trực tiếp `p`, `q`, `phi(n)` và `d`;
- dữ liệu được lưu trong file JSON local;
- mục tiêu chính là minh họa thuật toán, không phải triển khai hệ thống bảo mật thực tế.

## 15. Kịch bản demo đề xuất

1. Đăng nhập vào hệ thống.
2. Vào kiểm tra số nguyên tố, nhập một số và xem câu kết luận theo thuật toán kiểm tra.
3. Vào tìm số nguyên tố, chọn Auto hoặc Miller-Rabin thuần để tạo prime.
4. Vào tạo khóa RSA, sinh bộ tham số `p, q, n, phi(n), e, d`.
5. Chỉ ra:

```text
Khóa công khai = (n, e)
Khóa mật = d
```

6. Vào hệ mật RSA để mã hóa:

```text
c = m^e mod n
```

7. Giải mã:

```text
m = c^d mod n
```

8. Mở lịch sử để xem các thao tác đã lưu.

## 16. Kết luận

PrimeLab mô phỏng đầy đủ các bước cơ bản của kiểm tra số nguyên tố và hệ mật RSA. Project không chỉ gọi thư viện để trả kết quả, mà có phần cài đặt thuật toán Miller-Rabin, Pocklington, lũy thừa modulo, nghịch đảo modulo và sinh tham số RSA bằng BigInt.

Hệ thống phù hợp để trình bày trong bài lab vì có đủ giao diện nhập liệu, kết quả trực quan, lịch sử thao tác và báo cáo tham số RSA rõ ràng.
