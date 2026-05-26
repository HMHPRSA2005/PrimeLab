const {
  bitLength,
  elapsedSeconds,
  gcd,
  modPow,
  nowMs,
  randomBigInt,
  randomBigIntBetween,
  randomOddBigInt,
  sqrtFloor,
  toHex,
} = require("./utils");

const DEFAULT_BIT_LENGTH = 4096;
const DEFAULT_MILLER_RABIN_ROUNDS = 50;
const DEFAULT_PRIME_SEARCH_METHOD = "auto";
const DEFAULT_MAX_ATTEMPTS = 100000;
const MAX_SEARCH_BIT_LENGTH = 8192;
const AUTO_POCKLINGTON_MAX_BITS = 512;
const MAX_AUTO_CERTIFIED_BIT_LENGTH = AUTO_POCKLINGTON_MAX_BITS;
const POCKLINGTON_MAX_BIT_LENGTH = MAX_SEARCH_BIT_LENGTH;
const SMALL_PRIME_LIMIT = 10000;
const POCKLINGTON_RANDOM_WITNESS_ATTEMPTS = 30;
const SMALL_PRIME_PRODUCT_BITS = 512;
const DETERMINISTIC_64_LIMIT = 1n << 64n;
const DETERMINISTIC_64_BASES = [
  2n,
  325n,
  9375n,
  28178n,
  450775n,
  9780504n,
  1795265022n,
];
const POCKLINGTON_SMALL_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n];
const POCKLINGTON_LIMIT_MESSAGE = "Pocklington hỗ trợ trong phạm vi bit của ứng dụng.";

function sieve(limit) {
  if (!Number.isInteger(limit) || limit < 2) {
    return [];
  }

  const isComposite = new Uint8Array(limit + 1);
  for (let divisor = 2; divisor * divisor <= limit; divisor += 1) {
    if (isComposite[divisor]) {
      continue;
    }
    for (let multiple = divisor * divisor; multiple <= limit; multiple += divisor) {
      isComposite[multiple] = 1;
    }
  }

  const primes = [];
  for (let number = 2; number <= limit; number += 1) {
    if (!isComposite[number]) {
      primes.push(number);
    }
  }
  return primes;
}

const SMALL_PRIMES = sieve(SMALL_PRIME_LIMIT);
const SMALL_PRIME_BIGINTS = SMALL_PRIMES.map((prime) => BigInt(prime));
const SMALL_PRIME_PRODUCTS = buildSmallPrimeProducts(SMALL_PRIME_BIGINTS, SMALL_PRIME_PRODUCT_BITS);

function buildSmallPrimeProducts(primes, maxProductBits) {
  const products = [];
  let currentProduct = 1n;

  for (const prime of primes) {
    const nextProduct = currentProduct * prime;

    if (bitLength(nextProduct) > maxProductBits && currentProduct > 1n) {
      products.push(currentProduct);
      currentProduct = prime;
    } else {
      currentProduct = nextProduct;
    }
  }

  if (currentProduct > 1n) {
    products.push(currentProduct);
  }

  return products;
}

function extractNumberText(rawText) {
  const text = String(rawText ?? "");

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (!line.includes("=")) {
      return line;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "number" || key === "n" || key === "prime_dec") {
      return value;
    }

    if (key === "prime_hex") {
      return value.toLowerCase().startsWith("0x") ? value : `0x${value}`;
    }
  }

  return text.trim();
}

function parseBigInt(numberText) {
  const text = String(numberText ?? "");
  if (text.length > 10000) {
    throw new Error("input is too long");
  }

  const normalizedText = extractNumberText(text)
    .replace(/_/g, "")
    .replace(/\s+/g, "");

  if (!normalizedText) {
    throw new Error("missing number");
  }
  if (normalizedText.startsWith("-")) {
    throw new Error("number must be non-negative");
  }
  if (/^0x[0-9a-f]+$/i.test(normalizedText)) {
    return BigInt(normalizedText);
  }
  if (/^[0-9]+$/.test(normalizedText)) {
    return BigInt(normalizedText);
  }

  throw new Error("expected decimal integer or hexadecimal integer starting with 0x");
}

function trialDivision(n) {
  if (n < 2n) {
    return { status: "composite", divisor: null };
  }

  for (const prime of SMALL_PRIME_BIGINTS) {
    if (n === prime) {
      return { status: "prime", divisor: prime };
    }
    if (n % prime === 0n) {
      return { status: "composite", divisor: prime };
    }
    if (prime * prime > n) {
      return { status: "prime", divisor: null };
    }
  }

  return { status: "unknown", divisor: null };
}

function hasSmallPrimeFactor(n) {
  if (n <= BigInt(SMALL_PRIME_LIMIT)) {
    return trialDivision(n).status === "composite";
  }

  // Loc nhanh bang gcd voi tich nhieu prime nho, nhanh hon chia tung prime.
  for (const product of SMALL_PRIME_PRODUCTS) {
    if (gcd(n, product) !== 1n) {
      return true;
    }
  }

  return false;
}

function isPrimeByFullTrialDivision(n) {
  if (n < 2n) {
    return false;
  }
  if (n === 2n || n === 3n) {
    return true;
  }
  if (n % 2n === 0n) {
    return false;
  }

  for (let divisor = 3n; divisor * divisor <= n; divisor += 2n) {
    if (n % divisor === 0n) {
      return false;
    }
  }

  return true;
}

function splitPowerOfTwoFactor(number) {
  if (number < 1n) {
    throw new Error("number must be positive");
  }

  let exponent = 0;
  let oddPart = number;

  while (oddPart % 2n === 0n) {
    exponent += 1;
    oddPart /= 2n;
  }

  return { exponent, oddPart };
}

function witnessAcceptsNumber(candidateNumber, oddPart, exponent, witnessBase) {
  let witnessValue = modPow(witnessBase, oddPart, candidateNumber);

  if (witnessValue === 1n || witnessValue === candidateNumber - 1n) {
    return true;
  }

  for (let index = 1; index < exponent; index += 1) {
    witnessValue = (witnessValue * witnessValue) % candidateNumber;
    if (witnessValue === candidateNumber - 1n) {
      return true;
    }
  }

  return false;
}

function runMillerRabinWithBases(candidateNumber, bases, deterministic) {
  const { exponent, oddPart } = splitPowerOfTwoFactor(candidateNumber - 1n);
  const witnesses = [];

  for (const base of bases) {
    const witnessBase = base % candidateNumber;
    if (witnessBase < 2n) {
      continue;
    }

    witnesses.push(witnessBase.toString(10));
    if (!witnessAcceptsNumber(candidateNumber, oddPart, exponent, witnessBase)) {
      return {
        isPrime: false,
        witnesses,
        rounds: witnesses.length,
        deterministic,
        s: exponent,
        d: oddPart,
        failingWitness: witnessBase.toString(10),
      };
    }
  }

  return {
    isPrime: true,
    witnesses,
    rounds: witnesses.length,
    deterministic,
    s: exponent,
    d: oddPart,
  };
}

function deterministicMillerRabin64(n) {
  if (n >= DETERMINISTIC_64_LIMIT) {
    throw new Error("deterministicMillerRabin64 expects n < 2^64");
  }
  if (n < 2n) {
    return { isPrime: false, witnesses: [], rounds: 0, deterministic: true };
  }
  if (n === 2n || n === 3n) {
    return { isPrime: true, witnesses: [], rounds: 0, deterministic: true };
  }
  if (n % 2n === 0n) {
    return { isPrime: false, witnesses: [], rounds: 0, deterministic: true, failingWitness: "2" };
  }

  const trialResult = trialDivision(n);
  if (trialResult.status === "composite") {
    return {
      isPrime: false,
      witnesses: [],
      rounds: 0,
      deterministic: true,
      smallDivisor: trialResult.divisor?.toString(10),
    };
  }
  if (trialResult.status === "prime") {
    return { isPrime: true, witnesses: [], rounds: 0, deterministic: true };
  }

  return runMillerRabinWithBases(n, DETERMINISTIC_64_BASES, true);
}

function isProbablePrimeMillerRabin(n, rounds = DEFAULT_MILLER_RABIN_ROUNDS, options = {}) {
  if (n < 2n) {
    return { isPrime: false, witnesses: [], rounds: 0, deterministic: true };
  }
  if (n === 2n || n === 3n) {
    return { isPrime: true, witnesses: [], rounds: 0, deterministic: true };
  }
  if (n % 2n === 0n) {
    return { isPrime: false, witnesses: [], rounds: 0, deterministic: true, failingWitness: "2" };
  }

  if (!options.skipSmallPrimeCheck) {
    const trialResult = trialDivision(n);
    if (trialResult.status === "composite") {
      return {
        isPrime: false,
        witnesses: [],
        rounds: 0,
        deterministic: true,
        smallDivisor: trialResult.divisor?.toString(10),
      };
    }
    if (trialResult.status === "prime") {
      return { isPrime: true, witnesses: [], rounds: 0, deterministic: true };
    }
  }

  if (n < DETERMINISTIC_64_LIMIT) {
    return deterministicMillerRabin64(n);
  }

  const effectiveRounds = normalizeRounds(rounds);
  const bases = [];
  for (let index = 0; index < effectiveRounds; index += 1) {
    bases.push(randomBigIntBetween(2n, n - 2n));
  }

  return runMillerRabinWithBases(n, bases, false);
}

function pocklingtonTest(n, knownFactors) {
  if (n < 3n || n % 2n === 0n) {
    return { isPrime: false, reason: "n must be an odd integer greater than 2" };
  }
  if (!Array.isArray(knownFactors) || knownFactors.length === 0) {
    return { isPrime: false, reason: "knownFactors is required" };
  }

  let F = 1n;
  for (const factor of knownFactors) {
    if (typeof factor !== "bigint" || factor < 2n) {
      return { isPrime: false, reason: "known factors must be BigInt values >= 2" };
    }
    if ((n - 1n) % factor !== 0n) {
      return { isPrime: false, reason: "known factor does not divide n - 1" };
    }
    F *= factor;
  }

  if (F <= sqrtFloor(n)) {
    return { isPrime: false, F, reason: "F must be greater than sqrt(n)" };
  }

  const bases = POCKLINGTON_SMALL_BASES.filter((base) => base < n - 1n);
  for (let index = 0; index < POCKLINGTON_RANDOM_WITNESS_ATTEMPTS; index += 1) {
    bases.push(randomBigIntBetween(2n, n - 2n));
  }

  for (const witness of bases) {
    if (gcd(witness, n) !== 1n) {
      continue;
    }
    if (modPow(witness, n - 1n, n) !== 1n) {
      continue;
    }

    const factorChecks = [];
    let passedAllFactors = true;
    for (const factor of knownFactors) {
      const factorGcd = gcd(modPow(witness, (n - 1n) / factor, n) - 1n, n);
      factorChecks.push({
        factor: factor.toString(10),
        gcd: factorGcd.toString(10),
      });
      if (factorGcd !== 1n) {
        passedAllFactors = false;
        break;
      }
    }

    if (passedAllFactors) {
      return {
        isPrime: true,
        witness,
        knownFactors,
        F,
        factorChecks,
      };
    }
  }

  return { isPrime: false, F, reason: "no Pocklington witness found" };
}

function generatePrimeMillerRabin(
  bits,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) {
  const bitLengthValue = normalizeInteger(bits, DEFAULT_BIT_LENGTH, 2, MAX_SEARCH_BIT_LENGTH, "bits");

  const requestedRounds = normalizeRounds(rounds);
  const attemptLimit = normalizeMaxAttempts(maxAttempts);
  const startMs = nowMs();
  let attempts = 0;

  while (!isAttemptLimitReached(attempts, attemptLimit)) {
    attempts += 1;

    const candidate = randomOddBigInt(bitLengthValue);
    if (hasSmallPrimeFactor(candidate)) {
      continue;
    }

    const verification = isProbablePrimeMillerRabin(candidate, requestedRounds, {
      skipSmallPrimeCheck: true,
    });
    if (!verification.isPrime) {
      continue;
    }

    return {
      primeNumber: candidate,
      primeDec: candidate.toString(10),
      primeHex: toHex(candidate),
      primality: "probable",
      algorithm: "Miller-Rabin",
      proofMethod: "probabilistic primality test",
      certificateType: "miller_rabin_witnesses",
      bits: bitLength(candidate),
      requestedRounds,
      rounds: verification.deterministic ? verification.rounds : requestedRounds,
      attempts,
      certificateDepth: 0,
      elapsedSeconds: elapsedSeconds(startMs),
      method: "miller-rabin",
      selectedMethod: "miller-rabin",
      certificate: {
        rounds: verification.deterministic ? verification.rounds : requestedRounds,
        witnesses: verification.witnesses,
        decomposition: {
          equation: "n - 1 = 2^s * d",
          s: verification.s,
          d: verification.d?.toString(10),
        },
        errorBoundNote: "Miller-Rabin là kiểm tra xác suất; với 50 vòng xác suất sai rất nhỏ nhưng không phải chứng minh 100%.",
      },
    };
  }

  throw new Error(`could not find a probable prime after ${attemptLimit} attempts`);
}

function generatePrimePocklington(bits, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  const bitLengthValue = normalizeInteger(bits, AUTO_POCKLINGTON_MAX_BITS, 16, POCKLINGTON_MAX_BIT_LENGTH, "bits");

  const startMs = nowMs();
  const stats = {
    attempts: 0,
    maxAttempts: normalizeMaxAttempts(maxAttempts),
  };
  const result = generatePocklingtonNumber(bitLengthValue, stats, false);
  const prime = result.primeNumber;

  return {
    primeNumber: prime,
    primeDec: prime.toString(10),
    primeHex: toHex(prime),
    primality: "proven",
    algorithm: "Pocklington",
    proofMethod: "Pocklington theorem",
    certificateType: "pocklington_certificate",
    bits: bitLength(prime),
    requestedRounds: null,
    rounds: 0,
    attempts: stats.attempts,
    certificateDepth: result.certificateDepth,
    elapsedSeconds: elapsedSeconds(startMs),
    method: "pocklington",
    selectedMethod: "pocklington",
    certificate: result.certificate,
  };
}

function generatePocklingtonNumber(bits, stats, allowTrialBase) {
  if (allowTrialBase && bits <= 32) {
    return generateTrialDivisionPrime(bits, stats);
  }

  const qBits = Math.max(2, Math.ceil(bits * 0.60));
  const qResult = generatePocklingtonNumber(qBits, stats, true);
  const q = qResult.primeNumber;
  const F = 2n * q;
  const lowerBound = 1n << BigInt(bits - 1);
  const upperBound = (1n << BigInt(bits)) - 1n;
  const minR = maxBigInt(1n, ceilDiv(lowerBound - 1n, F));
  const maxR = (upperBound - 1n) / F;

  if (minR > maxR) {
    throw new Error("could not build a valid Pocklington search range");
  }

  while (!isAttemptLimitReached(stats.attempts, stats.maxAttempts)) {
    stats.attempts += 1;

    const R = randomBigIntBetween(minR, maxR);
    const candidate = F * R + 1n;
    if (bitLength(candidate) !== bits) {
      continue;
    }
    if (F <= sqrtFloor(candidate)) {
      continue;
    }

    if (hasSmallPrimeFactor(candidate)) {
      continue;
    }

    const knownFactors = [2n, q];
    const pocklington = pocklingtonTest(candidate, knownFactors);
    if (!pocklington.isPrime) {
      continue;
    }

    return {
      primeNumber: candidate,
      certificateDepth: qResult.certificateDepth + 1,
      certificate: {
        n: candidate.toString(10),
        witness: pocklington.witness.toString(10),
        knownFactors: knownFactors.map((factor) => factor.toString(10)),
        F: pocklington.F.toString(10),
        R: R.toString(10),
        equation: "n = F * R + 1",
        factorizationOfF: "F = 2 * q",
        q: q.toString(10),
        condition: "F > sqrt(n), a^(n-1) ≡ 1 mod n, gcd(a^((n-1)/q_i)-1,n)=1 for all known prime factors q_i of F",
        note: "Kết luận nguyên tố 100% theo định lý Pocklington.",
        cofactorR: R.toString(10),
        childCertificate: qResult.certificate,
      },
    };
  }

  throw new Error(`could not find a Pocklington prime after ${stats.maxAttempts} attempts`);
}

function generateTrialDivisionPrime(bits, stats) {
  while (!isAttemptLimitReached(stats.attempts, stats.maxAttempts)) {
    stats.attempts += 1;

    const candidate = randomOddBigInt(bits);
    if (!isPrimeByFullTrialDivision(candidate)) {
      continue;
    }

    return {
      primeNumber: candidate,
      certificateDepth: 1,
      certificate: {
        type: "trial_division_certificate",
        n: candidate.toString(10),
        bits: bitLength(candidate),
        verifiedBy: "trial division up to sqrt(n)",
      },
    };
  }

  throw new Error(`could not find a small certified prime after ${stats.maxAttempts} attempts`);
}

function generatePrime(options = {}) {
  const bits = normalizeInteger(options.bits, DEFAULT_BIT_LENGTH, 2, MAX_SEARCH_BIT_LENGTH, "bits");
  const method = normalizeSearchMethod(options.method);
  const rounds = normalizeRounds(options.rounds ?? DEFAULT_MILLER_RABIN_ROUNDS);
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);

  if (method === "auto") {
    return bits <= AUTO_POCKLINGTON_MAX_BITS
      ? generatePrimePocklington(bits, maxAttempts)
      : generatePrimeMillerRabin(bits, rounds, maxAttempts);
  }

  if (method === "pocklington") {
    return generatePrimePocklington(bits, maxAttempts);
  }

  return generatePrimeMillerRabin(bits, rounds, maxAttempts);
}

function findPrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  method = DEFAULT_PRIME_SEARCH_METHOD,
) {
  return generatePrime({
    bits: bitLengthValue,
    method,
    rounds,
    maxAttempts,
  });
}

function findProbablePrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) {
  return generatePrimeMillerRabin(bitLengthValue, rounds, maxAttempts);
}

function findProvablePrime(
  bitLengthValue = MAX_AUTO_CERTIFIED_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) {
  void rounds;
  return generatePrimePocklington(bitLengthValue, maxAttempts);
}

function findHybridPrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
) {
  return generatePrimeMillerRabin(bitLengthValue, rounds, DEFAULT_MAX_ATTEMPTS);
}

function checkPrime(
  candidateNumber,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  method = DEFAULT_PRIME_SEARCH_METHOD,
) {
  const selectedMethod = normalizeSearchMethod(method);
  const startMs = nowMs();
  const verification = isProbablePrimeMillerRabin(candidateNumber, rounds);
  const deterministic = verification.deterministic && candidateNumber < DETERMINISTIC_64_LIMIT;
  const algorithm = deterministic ? "Deterministic Miller-Rabin 64-bit" : "Miller-Rabin";

  return {
    result: verification.isPrime ? "prime_or_probable_prime" : "composite",
    isPrime: verification.isPrime,
    isProbablePrime: verification.isPrime,
    primality: deterministic && verification.isPrime ? "proven" : "probable",
    bits: bitLength(candidateNumber),
    rounds: verification.rounds || normalizeRounds(rounds),
    requestedRounds: normalizeRounds(rounds),
    method: selectedMethod,
    algorithm,
    proofMethod: deterministic ? "deterministic Miller-Rabin bases for n < 2^64" : "probabilistic primality test",
    certificateType: "miller_rabin_witnesses",
    elapsedSeconds: elapsedSeconds(startMs),
    certificate: {
      rounds: verification.rounds || normalizeRounds(rounds),
      witnesses: verification.witnesses,
      decomposition: {
        equation: "n - 1 = 2^s * d",
        s: verification.s,
        d: verification.d?.toString(10),
      },
      failingWitness: verification.failingWitness,
      smallDivisor: verification.smallDivisor,
    },
  };
}

function isProbablePrime(candidateNumber, rounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  return isProbablePrimeMillerRabin(candidateNumber, rounds).isPrime;
}

function verifyMillerRabin(candidateNumber, rounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  return isProbablePrimeMillerRabin(candidateNumber, rounds);
}

function passesTrialDivision(candidateNumber) {
  return trialDivision(candidateNumber).status !== "composite";
}

function randomBigIntBits(bitLengthValue) {
  return randomBigInt(bitLengthValue);
}

function generateOddCandidate(bitLengthValue) {
  return randomOddBigInt(bitLengthValue);
}

function normalizeSearchMethod(method) {
  const normalizedMethod = String(method || DEFAULT_PRIME_SEARCH_METHOD)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

  const aliases = {
    auto: "auto",
    mr: "miller-rabin",
    miller: "miller-rabin",
    probable: "miller-rabin",
    "miller-rabin": "miller-rabin",
    baillie: "miller-rabin",
    "baillie-psw": "miller-rabin",
    bpsw: "miller-rabin",
    "lucas-lehmer": "miller-rabin",
    pocklington: "pocklington",
    certified: "pocklington",
    "certified-small": "pocklington",
    provable: "pocklington",
    fast: "miller-rabin",
    hybrid: "miller-rabin",
    "hybrid-accelerated": "miller-rabin",
    native: "miller-rabin",
    openssl: "miller-rabin",
    "node-crypto": "miller-rabin",
  };

  const result = aliases[normalizedMethod];
  if (!result) {
    throw new Error("method must be auto, pocklington, or miller-rabin");
  }
  return result;
}

function resolveSearchMethod(bitLengthValue, method) {
  const normalizedMethod = normalizeSearchMethod(method);
  if (normalizedMethod === "auto") {
    return bitLengthValue <= AUTO_POCKLINGTON_MAX_BITS ? "pocklington" : "miller-rabin";
  }
  return normalizedMethod;
}

function recommendPrimeSearchMethod(bitLengthValue) {
  validateBitLength(bitLengthValue, 2, MAX_SEARCH_BIT_LENGTH);

  if (bitLengthValue <= AUTO_POCKLINGTON_MAX_BITS) {
    return {
      method: "pocklington",
      algorithm: "Pocklington",
      rounds: 0,
      reason: "<= 512 bits: sinh prime co chung chi Pocklington",
    };
  }

  return {
    method: "miller-rabin",
    algorithm: "Miller-Rabin",
    rounds: DEFAULT_MILLER_RABIN_ROUNDS,
    reason: "> 512 bits: dung Miller-Rabin 50 vong de toi uu thoi gian",
  };
}

function normalizeRounds(value) {
  return normalizeInteger(value, DEFAULT_MILLER_RABIN_ROUNDS, 1, 256, "rounds");
}

function normalizeMaxAttempts(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return normalizeInteger(value, DEFAULT_MAX_ATTEMPTS, 0, Number.MAX_SAFE_INTEGER, "maxAttempts");
}

function normalizeInteger(value, fallback, min, max, fieldName) {
  const number = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${fieldName} must be an integer from ${min} to ${max}`);
  }

  return number;
}

function validateBitLength(bits, min, max) {
  normalizeInteger(bits, bits, min, max, "bits");
}

function isAttemptLimitReached(attempts, maxAttempts) {
  return maxAttempts > 0 && attempts >= maxAttempts;
}

function ceilDiv(left, right) {
  if (right <= 0n) {
    throw new Error("divisor must be positive");
  }
  return (left + right - 1n) / right;
}

function maxBigInt(left, right) {
  return left > right ? left : right;
}

module.exports = {
  DEFAULT_BIT_LENGTH,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MILLER_RABIN_ROUNDS,
  DEFAULT_PRIME_SEARCH_METHOD,
  AUTO_POCKLINGTON_MAX_BITS,
  MAX_AUTO_CERTIFIED_BIT_LENGTH,
  MAX_SEARCH_BIT_LENGTH,
  POCKLINGTON_MAX_BIT_LENGTH,
  POCKLINGTON_LIMIT_MESSAGE,
  SMALL_PRIME_LIMIT,
  SMALL_PRIMES,
  bitLength,
  checkPrime,
  deterministicMillerRabin64,
  findHybridPrime,
  findPrime,
  findProbablePrime,
  findProvablePrime,
  generateOddCandidate,
  generatePrime,
  generatePrimeMillerRabin,
  generatePrimePocklington,
  gcdBigInt: gcd,
  isProbablePrime,
  isProbablePrimeMillerRabin,
  normalizeSearchMethod,
  parseBigInt,
  passesTrialDivision,
  pocklingtonTest,
  powMod: modPow,
  randomBigIntBetween,
  randomBigIntBits,
  recommendPrimeSearchMethod,
  resolveSearchMethod,
  sieve,
  splitPowerOfTwoFactor,
  trialDivision,
  verifyMillerRabin,
  witnessAcceptsNumber,
};
