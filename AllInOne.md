# Bao cao All-in-One: Thuat toan tim kiem so nguyen to trong PrimeLab

## 1. Muc tieu

PrimeLab la ung dung web phuc vu hoc tap va thuc nghiem mat ma hoc. Mot trong cac chuc nang chinh cua he thong la tim kiem so nguyen to lon de dung trong cac bai toan RSA va kiem tra tinh nguyen to.

Tai phien ban hien tai, phan tim kiem so nguyen to duoc cai dat truc tiep trong project bang JavaScript BigInt, `crypto.randomBytes`, Miller-Rabin, Pocklington va Worker Thread. He thong khong chi tra ve mot so nguyen to, ma con tra ve cac thong tin ky thuat de giai thich qua trinh tim kiem:

- do dai bit cua so tim duoc;
- thuat toan da dung;
- so vong kiem tra;
- so lan thu ung vien;
- thoi gian chay;
- loai ket qua: `probable` hoac `proven`;
- chung chi Miller-Rabin hoac Pocklington neu co;
- thong tin worker song song khi tim bang Miller-Rabin.

Phan cai dat chinh nam trong cac file:

- `src/prime.js`: cai dat sinh so, loc nhanh, Miller-Rabin, Pocklington va cac ham tien ich thuat toan.
- `src/utils.js`: cai dat BigInt helper, sinh ngau nhien, gcd, modPow.
- `src/worker.js`: chay tac vu nang ngoai main thread.
- `server.js`: nhan request, validate input, dieu phoi worker, luu ket qua.
- `public/js/prime-search.js`: giao dien goi API va hien thi ket qua.

## 2. Cau hinh chinh cua bai toan

Trong `src/prime.js`, cac gia tri mac dinh dang dung:

```text
DEFAULT_BIT_LENGTH = 4096
DEFAULT_MILLER_RABIN_ROUNDS = 50
DEFAULT_PRIME_SEARCH_METHOD = "auto"
DEFAULT_MAX_ATTEMPTS = 100000
MAX_SEARCH_BIT_LENGTH = 8192
AUTO_POCKLINGTON_MAX_BITS = 512
SMALL_PRIME_LIMIT = 10000
```

Y nghia:

- Mac dinh sinh so 4096 bit.
- Miller-Rabin mac dinh chay 50 vong.
- Tim kiem cho phep toi da 8192 bit.
- Neu chon `auto`, cac so tu 512 bit tro xuong dung Pocklington de co chung minh `proven`.
- Neu chon `auto` voi so lon hon 512 bit, he thong dung Miller-Rabin de tim nhanh so nguyen to xac suat `probable`.
- Moi vong tim co gioi han so lan thu ung vien bang `maxAttempts`.

Trong `server.js`, he thong co them cau hinh:

```text
PRIME_SEARCH_WORKERS = 8
```

Gia tri nay quy dinh so worker song song khi tim so nguyen to bang Miller-Rabin. Mac dinh la 8 worker.

## 3. Luong tong quat khi nguoi dung tim prime

Nguoi dung thao tac tren trang tim kiem so nguyen to. Frontend gui request:

```text
POST /api/prime/search
```

Payload gom cac truong chinh:

```json
{
  "bits": 8192,
  "method": "auto",
  "rounds": 64,
  "maxAttempts": 100000
}
```

Backend thuc hien cac buoc:

1. Kiem tra nguoi dung da dang nhap bang JWT.
2. Doc va validate `bits`, `method`, `rounds`, `maxAttempts`.
3. Chuan hoa method ve mot trong ba gia tri:

```text
auto
pocklington
miller-rabin
```

4. Neu method thuc te la Miller-Rabin, backend chay tim kiem bang worker pool song song.
5. Neu method thuc te la Pocklington, backend chay tac vu trong worker rieng.
6. Nhan ket qua tu worker.
7. Luu ket qua vao `data/primes.json`.
8. Luu lich su vao `data/history.json`.
9. Tra ket qua ve frontend de hien thi.

## 4. Buoc 1: Sinh so ngau nhien co dung do dai bit

Nen tang cua tim prime la sinh cac ung vien ngau nhien. PrimeLab dung `crypto.randomBytes` cua Node.js de lay byte ngau nhien, sau do chuyen thanh BigInt.

Ham lien quan trong `src/utils.js`:

```text
randomBigInt(bits)
randomOddBigInt(bits)
```

### 4.1. Sinh BigInt ngau nhien

Voi so can sinh co `bits` bit:

```text
byteCount = ceil(bits / 8)
randomHex = crypto.randomBytes(byteCount).toString("hex")
randomValue = BigInt("0x" + randomHex)
mask = (1 << bits) - 1
result = randomValue & mask
```

Muc dich cua `mask` la cat bot cac bit thua neu so byte sinh ra lon hon dung so bit can thiet.

### 4.2. Dam bao ung vien la so le va dung do dai bit

Neu sinh ngau nhien hoan toan, so co the bi thieu bit cao nhat hoac la so chan. Vi vay PrimeLab dung:

```text
candidate = randomBigInt(bits) | (1 << (bits - 1)) | 1
```

Trong do:

- `(1 << (bits - 1))` bat bit cao nhat, dam bao so co dung do dai bit.
- `| 1` bat bit thap nhat, dam bao so la so le.
- So chan lon hon 2 chac chan khong phai so nguyen to, nen khong can thu.

Vi du voi 8 bit:

```text
randomBits = 00110110
bat bit cao nhat -> 10110110
bat bit thap nhat -> 10110111
```

Ket qua la mot ung vien 8 bit va la so le.

## 5. Buoc 2: Loc nhanh bang cac prime nho

Truoc khi chay Miller-Rabin, he thong loai nhanh nhung ung vien chac chan la hop so.

PrimeLab tao danh sach so nguyen to nho den 10000 bang sang Eratosthenes:

```text
SMALL_PRIME_LIMIT = 10000
SMALL_PRIMES = sieve(10000)
```

Neu kiem tra tung phep chia `candidate % p`, voi nhieu prime nho se ton thoi gian. Vi vay project gom nhieu prime nho thanh cac tich co kich thuoc toi da khoang 512 bit:

```text
SMALL_PRIME_PRODUCTS = buildSmallPrimeProducts(SMALL_PRIMES, 512)
```

Sau do dung gcd:

```text
if gcd(candidate, productOfSmallPrimes) != 1
    candidate co uoc nho
    loai candidate
```

Cach nay nhanh hon viec chia tung prime nho, vi moi phep `gcd` voi mot tich lon co the phat hien nhieu uoc nho cung luc.

Ham lien quan:

```text
sieve(limit)
buildSmallPrimeProducts(...)
hasSmallPrimeFactor(n)
trialDivision(n)
```

## 6. Buoc 3: Kiem tra Miller-Rabin

Miller-Rabin la thuat toan kiem tra nguyen to xac suat. No khong chung minh tuyet doi voi so lon, nhung voi nhieu vong kiem tra thi xac suat sai rat nho.

Trong PrimeLab, Miller-Rabin duoc dung cho:

- kiem tra so nguoi dung nhap;
- tim prime lon hon 512 bit;
- xac minh ung vien sinh ngau nhien;
- sinh prime cho RSA.

Ham chinh:

```text
isProbablePrimeMillerRabin(n, rounds, options)
runMillerRabinWithBases(candidateNumber, bases, deterministic)
witnessAcceptsNumber(candidateNumber, oddPart, exponent, witnessBase)
```

### 6.1. Xu ly cac truong hop dac biet

Truoc khi vao Miller-Rabin day du:

```text
if n < 2 -> composite
if n == 2 or n == 3 -> prime
if n chan -> composite
```

Neu khong bo qua buoc loc nho, he thong chay `trialDivision(n)` de phat hien cac uoc nho.

Voi `n < 2^64`, PrimeLab dung bo witness co tinh tat dinh:

```text
2, 325, 9375, 28178, 450775, 9780504, 1795265022
```

Bo co so nay giup Miller-Rabin cho ket qua tat dinh trong mien nho hon `2^64`.

Voi so lon hon, he thong chon ngau nhien `rounds` witness trong khoang:

```text
2 <= a <= n - 2
```

### 6.2. Phan tich n - 1

Voi so le `n > 2`, ta viet:

```text
n - 1 = 2^s * d
```

Trong do `d` la so le.

Ham lien quan:

```text
splitPowerOfTwoFactor(n - 1)
```

Vi du:

```text
n = 41
n - 1 = 40 = 2^3 * 5
s = 3
d = 5
```

### 6.3. Kiem tra mot witness

Voi moi witness `a`, tinh:

```text
x = a^d mod n
```

PrimeLab tinh luy thua modulo bang square-and-multiply trong ham `modPow`.

Neu:

```text
x == 1
```

hoac:

```text
x == n - 1
```

thi witness nay chap nhan `n`.

Neu chua chap nhan, tiep tuc binh phuong toi da `s - 1` lan:

```text
x = x^2 mod n
```

Neu trong qua trinh do co luc:

```text
x == n - 1
```

thi witness chap nhan `n`.

Neu khong bao gio dat `n - 1`, witness nay chung minh `n` la hop so.

### 6.4. Kiem tra nhieu vong

Miller-Rabin chay nhieu witness:

```text
for each witness a:
    if witness khong chap nhan n:
        return composite

return probable prime
```

Neu tat ca witness deu chap nhan, PrimeLab ket luan:

```text
primality = "probable"
algorithm = "Miller-Rabin"
certificateType = "miller_rabin_witnesses"
```

Ket qua Miller-Rabin luu lai:

- danh sach witness;
- phan tich `n - 1 = 2^s * d`;
- so vong kiem tra;
- ghi chu ve sai so xac suat.

## 7. Buoc 4: Vong lap tim prime bang Miller-Rabin

Ham chinh:

```text
generatePrimeMillerRabin(bits, rounds, maxAttempts)
```

Quy trinh:

```text
attempts = 0

while attempts chua vuot maxAttempts:
    attempts += 1

    candidate = randomOddBigInt(bits)

    if hasSmallPrimeFactor(candidate):
        continue

    verification = isProbablePrimeMillerRabin(candidate, rounds, skipSmallPrimeCheck = true)

    if verification.isPrime:
        return candidate va metadata

throw "could not find a probable prime"
```

Ly do dung `skipSmallPrimeCheck = true`: ung vien da duoc loc bang `hasSmallPrimeFactor(candidate)` ngay truoc do, nen khong can lap lai buoc chia thu/loc nho trong Miller-Rabin.

Ket qua tra ve gom:

```text
primeNumber
primeDec
primeHex
primality = "probable"
algorithm = "Miller-Rabin"
proofMethod = "probabilistic primality test"
certificateType = "miller_rabin_witnesses"
bits
requestedRounds
rounds
attempts
elapsedSeconds
method = "miller-rabin"
selectedMethod = "miller-rabin"
certificate
```

## 8. Buoc 5: Pocklington cho so nho co chung minh

Pocklington duoc dung khi can ket qua `proven`, tuc la co chung minh nguyen to. Trong che do `auto`, PrimeLab dung Pocklington cho so tu 512 bit tro xuong.

Ham chinh:

```text
generatePrimePocklington(bits, maxAttempts)
generatePocklingtonNumber(bits, stats, allowTrialBase)
pocklingtonTest(n, knownFactors)
```

### 8.1. Y tuong

Pocklington chung minh `n` la prime neu biet mot phan phan tich cua `n - 1` du lon.

PrimeLab sinh ung vien theo dang:

```text
n = F * R + 1
F = 2 * q
```

Trong do:

- `q` la mot so nguyen to nho hon da duoc chung minh;
- `R` la so ngau nhien;
- `F` la phan thua so da biet cua `n - 1`;
- can dam bao `F > sqrt(n)`.

### 8.2. Sinh de quy q

De chung minh `n`, can co `q` da duoc chung minh. Vi vay he thong sinh `q` de quy:

```text
qBits = ceil(bits * 0.60)
q = generatePocklingtonNumber(qBits)
F = 2 * q
```

Neu xuong den so nho, he thong dung trial division lam lop chung minh co so.

### 8.3. Chon R va tao ung vien

He thong tinh khoang gia tri cua `R` sao cho `n = F * R + 1` co dung do dai bit:

```text
lowerBound = 2^(bits - 1)
upperBound = 2^bits - 1
minR = ceil((lowerBound - 1) / F)
maxR = floor((upperBound - 1) / F)
```

Sau do chon:

```text
R = randomBigIntBetween(minR, maxR)
n = F * R + 1
```

Neu `n` khong dung do dai bit hoac `F <= sqrt(n)`, ung vien bi loai.

### 8.4. Kiem tra Pocklington

Can tim witness `a` sao cho:

```text
a^(n - 1) = 1 mod n
```

va voi moi thua so da biet `q_i` cua `F`:

```text
gcd(a^((n - 1) / q_i) - 1, n) = 1
```

Trong project, danh sach thua so da biet la:

```text
knownFactors = [2, q]
```

Neu thoa dieu kien, Pocklington cho phep ket luan `n` la so nguyen to.

Ket qua tra ve:

```text
primality = "proven"
algorithm = "Pocklington"
proofMethod = "Pocklington theorem"
certificateType = "pocklington_certificate"
certificateDepth = so lop chung minh de quy
```

## 9. Chon thuat toan theo method

Ham chon method:

```text
normalizeSearchMethod(method)
resolveSearchMethod(bits, method)
generatePrime(options)
```

PrimeLab chap nhan nhieu alias de tien cho UI va du lieu cu:

```text
probable -> miller-rabin
mr -> miller-rabin
hybrid -> miller-rabin
openssl -> miller-rabin
certified -> pocklington
provable -> pocklington
```

Sau khi chuan hoa, he thong chi con ba nhom:

```text
auto
miller-rabin
pocklington
```

Quy tac:

```text
if method == auto and bits <= 512:
    use Pocklington

if method == auto and bits > 512:
    use Miller-Rabin

if method == pocklington:
    use Pocklington

if method == miller-rabin:
    use Miller-Rabin
```

## 10. Worker Thread va 8 core song song

Tim prime lon, dac biet 4096 bit va 8192 bit, la tac vu nang. Neu chay truc tiep trong main thread, server Express co the bi khoa va khong phan hoi request khac. Vi vay PrimeLab dung Worker Thread.

File:

```text
src/worker.js
```

Worker nhan task:

```text
prime.search
prime.check
rsa.keygen
rsa.factorize
```

Voi `prime.search`, worker goi:

```text
generatePrime({
  bits,
  method,
  rounds,
  maxAttempts
})
```

### 10.1. Mot worker ban dau

Truoc do, moi request tim prime chi chay mot worker:

```text
runTaskInWorker("prime.search", payload)
```

Cach nay giup server khong bi block, nhung toc do tim prime van chu yeu phu thuoc vao mot CPU core.

### 10.2. Pool 8 worker cho Miller-Rabin

Hien tai PrimeLab da them pool song song trong `server.js`:

```text
PRIME_SEARCH_WORKERS = 8
runPrimeSearchInParallel(payload)
```

Cach chay:

1. Backend kiem tra method thuc te co phai Miller-Rabin khong.
2. Neu la Miller-Rabin va `PRIME_SEARCH_WORKERS > 1`, tao 8 worker.
3. Moi worker tu sinh candidate rieng va chay Miller-Rabin chuan.
4. Worker nao tim thay prime truoc thi tra ket qua.
5. Backend huy cac worker con lai.
6. Ket qua tra ve them cac truong:

```text
parallelWorkers
winnerAttempts
completedWorkerAttempts
maxAttemptsPerWorker
searchMode = "parallel-worker-pool"
```

Thuat toan Miller-Rabin khong thay doi. He thong chi song song hoa viec thu nhieu ung vien doc lap.

### 10.3. Chia maxAttempts

Neu nguoi dung dat `maxAttempts`, he thong chia gan deu cho cac worker:

```text
maxAttemptsPerWorker = ceil(maxAttempts / workerCount)
```

Vi du:

```text
maxAttempts = 100000
workerCount = 8
maxAttemptsPerWorker = 12500
```

Moi worker co toi da 12500 lan thu. Neu mot worker tim thay prime truoc, ket qua duoc tra ngay.

### 10.4. Vi sao song song hoa ung vien thay vi song song hoa rounds

Miller-Rabin co the song song theo witness, nhung trong PrimeLab cach tot hon la song song theo candidate:

- Moi candidate doc lap hoan toan.
- Nhieu candidate bi loai nhanh o buoc loc prime nho.
- Neu song song witness, overhead gui BigInt va dong bo ket qua lon hon.
- Khi mot worker tim thay prime, co the dung ngay toan bo pool.

Do do pool 8 worker giu nguyen thuat toan chuan nhung giam thoi gian cho tren may nhieu core.

## 11. Vi sao 8192 bit co luc nhanh, co luc cham

Tim prime la bai toan xac suat. Khong phai lan nao cung can cung mot so attempts.

Xac suat mot so le 8192 bit la prime xap xi:

```text
2 / ln(2^8192)
```

Nghia la trung binh can khoang:

```text
8192 * ln(2) / 2 ~= 2839
```

ung vien le de gap mot prime.

Nhung day chi la trung binh. Thuc te co the:

- gap prime sau vai tram attempts;
- gap prime sau hon 3000 attempts;
- gap prime sau hon 5000 attempts.

Vi vay co lan 8192 bit, 64 rounds mat khoang 90 giay, nhung co lan khac mat vai phut. Pool 8 worker giup giam thoi gian cho, nhung van khong lam mat di tinh ngau nhien cua bai toan.

## 12. Ket qua hien thi tren giao dien

Sau khi tim duoc prime, frontend hien thi:

- ket qua `proven` hoac `probable`;
- thuat toan;
- phuong phap;
- chung chi;
- do dai bit;
- so vong yeu cau;
- so vong thuc chay;
- so lan thu;
- worker song song neu co;
- attempts cua worker thang neu co;
- do sau chung chi;
- thoi gian;
- prime dang decimal;
- prime dang hexadecimal;
- certificate JSON neu co.

Voi Miller-Rabin, `certificateDepth = 0` vi khong co chung chi chung minh de quy.

Voi Pocklington, `certificateDepth` la so lop chung minh long nhau. Vi du:

```text
n duoc chung minh bang q
q duoc chung minh bang r
r duoc chung minh bang trial division
```

Khi do do sau chung chi la so cap trong chuoi chung minh nay.

## 13. Luu ket qua va lich su

Khi API tim prime thanh cong, server luu:

```text
data/primes.json
data/history.json
```

Ban ghi prime gom:

- `id`;
- `createdAt`;
- `user`;
- `primeNumber`;
- `primeDec`;
- `primeHex`;
- `primality`;
- `algorithm`;
- `proofMethod`;
- `certificateType`;
- `bits`;
- `rounds`;
- `attempts`;
- `elapsedSeconds`;
- `method`;
- `selectedMethod`;
- `certificate`;
- thong tin worker neu chay song song.

Lich su giup nguoi dung xem lai cac lan tim va tai xuong ket qua.

## 14. Tom tat quy trinh tim prime Miller-Rabin

Quy trinh ngan gon:

```text
input: bits, rounds, maxAttempts

for attempt from 1 to maxAttempts:
    candidate = randomOddBigInt(bits)

    if candidate co uoc prime nho:
        bo qua

    tach candidate - 1 = 2^s * d

    for moi witness a:
        x = a^d mod candidate

        if x == 1 hoac x == candidate - 1:
            witness pass
        else:
            lap s - 1 lan:
                x = x^2 mod candidate
                if x == candidate - 1:
                    witness pass
                    break

        if witness fail:
            candidate la hop so
            thu candidate khac

    neu tat ca witness pass:
        return candidate la probable prime
```

Neu chay 8 worker:

```text
tao 8 worker
moi worker chay quy trinh tren doc lap
worker nao tim thay truoc thi tra ket qua
huy cac worker con lai
```

## 15. Tom tat quy trinh tim prime Pocklington

Quy trinh ngan gon:

```text
input: bits

neu bits nho:
    tim prime bang trial division

nguoc lai:
    q = generatePocklingtonNumber(ceil(bits * 0.60))
    F = 2 * q

    lap toi maxAttempts:
        chon R ngau nhien sao cho n = F * R + 1 co dung bits
        neu F <= sqrt(n): bo qua
        neu n co uoc prime nho: bo qua

        tim witness a:
            a^(n-1) = 1 mod n
            gcd(a^((n-1)/2) - 1, n) = 1
            gcd(a^((n-1)/q) - 1, n) = 1

        neu co witness hop le:
            return n la proven prime
```

## 16. Ket luan

Phan tim kiem so nguyen to cua PrimeLab da duoc xay dung theo cac buoc co ban va minh bach:

1. Sinh so ngau nhien bang `crypto.randomBytes`.
2. Ep so co dung do dai bit va la so le.
3. Loc nhanh hop so bang prime nho va gcd.
4. Kiem tra bang Miller-Rabin chuan voi nhieu witness.
5. Lap lai den khi tim duoc probable prime.
6. Dung Pocklington cho so nho khi can chung minh `proven`.
7. Dua tac vu nang vao Worker Thread.
8. Song song hoa Miller-Rabin bang 8 worker de tan dung nhieu core.
9. Luu day du ket qua, lich su va metadata de nguoi dung kiem tra lai.

Cach cai dat nay giu nguyen ban chat cua Miller-Rabin va Pocklington, dong thoi cai thien trai nghiem khi tim cac so lon nhu 4096 bit hoac 8192 bit.
