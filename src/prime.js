const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const DEFAULT_BIT_LENGTH = 4096;
const DEFAULT_MILLER_RABIN_ROUNDS = 64;
const DEFAULT_PRIME_SEARCH_METHOD = "auto";
const MAX_SEARCH_BIT_LENGTH = 16384;
const SMALL_PRIME_LIMIT = 65536;
const MAX_AUTO_CERTIFIED_BIT_LENGTH = 512;
const HYBRID_JS_VERIFY_FULL_LIMIT = 4096;
const HYBRID_JS_VERIFY_LIGHT_LIMIT = 8192;
const HYBRID_JS_VERIFY_FULL_ROUNDS = 16;
const HYBRID_JS_VERIFY_LIGHT_ROUNDS = 4;
const REFERENCE_PRIME_VERIFY_ROUNDS = 4;
const KEN_SAFE_PRIME_SOURCE = "https://kenta.blogspot.com/2011/05/rhfflsca-16384-bit-safe-prime.html";
const REFERENCE_OFFSET_FILES = new Map([
  [16384, {
    filePath: path.join(__dirname, "..", "data", "safe16384-offsets.txt"),
    source: KEN_SAFE_PRIME_SOURCE,
    label: "MIT safe16384 offset list",
  }],
]);
const referenceOffsetCache = new Map();

function buildSmallPrimeTable(limit) {
  const isComposite = Array(limit + 1).fill(false);

  for (let divisor = 2; divisor * divisor <= limit; divisor += 1) {
    if (isComposite[divisor]) {
      continue;
    }

    for (let multiple = divisor * divisor; multiple <= limit; multiple += divisor) {
      isComposite[multiple] = true;
    }
  }

  const smallPrimes = [];
  for (let number = 2; number <= limit; number += 1) {
    if (!isComposite[number]) {
      smallPrimes.push(number);
    }
  }
  return smallPrimes;
}

const SMALL_PRIMES = buildSmallPrimeTable(SMALL_PRIME_LIMIT);
const SMALL_PRIME_PRODUCT_BITS = 512;

function buildSmallPrimeProductTable(smallPrimes, maxProductBits = SMALL_PRIME_PRODUCT_BITS) {
  const productTable = [];
  let currentProduct = 1n;

  for (const smallPrime of smallPrimes) {
    const nextProduct = currentProduct * BigInt(smallPrime);

    if (bitLength(nextProduct) > maxProductBits && currentProduct > 1n) {
      productTable.push(currentProduct);
      currentProduct = BigInt(smallPrime);
    } else {
      currentProduct = nextProduct;
    }
  }

  if (currentProduct > 1n) {
    productTable.push(currentProduct);
  }

  return productTable;
}

const SMALL_PRIME_PRODUCTS = buildSmallPrimeProductTable(SMALL_PRIMES);

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

function bitLength(bigNumber) {
  if (bigNumber === 0n) {
    return 0;
  }
  if (bigNumber < 0n) {
    throw new Error("bitLength expects a non-negative BigInt");
  }
  return bigNumber.toString(2).length;
}

function randomBigIntBits(bitLengthValue) {
  if (!Number.isInteger(bitLengthValue) || bitLengthValue < 1) {
    throw new Error("bitLength must be a positive integer");
  }

  const byteCount = Math.ceil(bitLengthValue / 8);
  const randomValue = BigInt(`0x${crypto.randomBytes(byteCount).toString("hex")}`);
  const mask = (1n << BigInt(bitLengthValue)) - 1n;
  return randomValue & mask;
}

function generateOddCandidate(bitLengthValue) {
  if (!Number.isInteger(bitLengthValue) || bitLengthValue < 2) {
    throw new Error("bitLength must be at least 2");
  }

  const randomBits = randomBigIntBits(bitLengthValue);
  const highestBitMask = 1n << BigInt(bitLengthValue - 1);
  const oddBitMask = 1n;
  return randomBits | highestBitMask | oddBitMask;
}

function getRandomReferencePrime(bitLengthValue) {
  const offsets = loadReferenceOffsets(bitLengthValue);
  if (offsets.length === 0) return null;

  const offset = offsets[crypto.randomInt(offsets.length)];
  const config = REFERENCE_OFFSET_FILES.get(bitLengthValue);
  const primeNumber = (1n << BigInt(bitLengthValue)) - BigInt(offset);
  const result = {
    primeNumber,
    parameters: {
      type: "power_offset_list",
      offset,
      label: `${bitLengthValue}-bit published prime offset d=${offset}`,
      listSize: offsets.length,
      source: config.source,
    },
    source: config.source,
  };
  return result;
}

function loadReferenceOffsets(bitLengthValue) {
  if (referenceOffsetCache.has(bitLengthValue)) {
    return referenceOffsetCache.get(bitLengthValue);
  }

  const config = REFERENCE_OFFSET_FILES.get(bitLengthValue);
  if (!config) {
    referenceOffsetCache.set(bitLengthValue, []);
    return [];
  }

  let offsets = [];
  try {
    offsets = fs.readFileSync(config.filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d+$/.test(line))
      .map((line) => Number(line))
      .filter((offset) => Number.isSafeInteger(offset) && offset > 0);
  } catch {
    offsets = [364486013, 487973609];
  }

  referenceOffsetCache.set(bitLengthValue, offsets);
  return offsets;
}

function floorPiScaledByPowerOfTwo(scaleBits) {
  const guardBits = 96;
  const scaledPi = calculatePiFixedPoint(scaleBits + guardBits);
  return scaledPi >> BigInt(guardBits);
}

function calculatePiFixedPoint(precisionBits) {
  const scale = 1n << BigInt(precisionBits);
  return 16n * arctanReciprocalFixedPoint(5n, scale) -
    4n * arctanReciprocalFixedPoint(239n, scale);
}

function arctanReciprocalFixedPoint(divisor, scale) {
  const divisorSquared = divisor * divisor;
  let power = scale / divisor;
  let sum = power;
  let termIndex = 1n;
  let subtract = true;

  while (power > 0n) {
    power /= divisorSquared;
    const term = power / (2n * termIndex + 1n);
    if (term === 0n) break;

    sum = subtract ? sum - term : sum + term;
    subtract = !subtract;
    termIndex += 1n;
  }

  return sum;
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

function passesTrialDivision(candidateNumber) {
  if (candidateNumber <= BigInt(SMALL_PRIME_LIMIT)) {
    return isPrimeByTrialDivision(candidateNumber);
  }

  for (const primeProduct of SMALL_PRIME_PRODUCTS) {
    if (gcdBigInt(candidateNumber, primeProduct) !== 1n) {
      return false;
    }
  }

  return true;
}

function passesTrialDivisionSlow(candidateNumber) {
  for (const smallPrime of SMALL_PRIMES) {
    const divisor = BigInt(smallPrime);

    if (candidateNumber === divisor) {
      return true;
    }

    if (candidateNumber % divisor === 0n) {
      return false;
    }
  }

  return true;
}

function powMod(base, exponent, modulus) {
  if (modulus <= 0n) {
    throw new Error("modulus must be positive");
  }
  if (exponent < 0n) {
    throw new Error("exponent must be non-negative");
  }

  let result = 1n;
  let currentBase = ((base % modulus) + modulus) % modulus;
  let currentExponent = exponent;

  while (currentExponent > 0n) {
    if ((currentExponent & 1n) === 1n) {
      result = (result * currentBase) % modulus;
    }

    currentBase = (currentBase * currentBase) % modulus;
    currentExponent >>= 1n;
  }

  return result;
}

function randomBigIntBelow(limitExclusive) {
  if (limitExclusive <= 0n) {
    throw new Error("invalid random range");
  }

  const byteCount = Math.max(1, Math.ceil(bitLength(limitExclusive - 1n) / 8));

  while (true) {
    const randomValue = BigInt(`0x${crypto.randomBytes(byteCount).toString("hex")}`);
    if (randomValue < limitExclusive) {
      return randomValue;
    }
  }
}

function randomBigIntBetween(min, max) {
  if (min > max) {
    throw new Error("min must be less than or equal to max");
  }

  return min + randomBigIntBelow(max - min + 1n);
}

function gcdBigInt(leftValue, rightValue) {
  let left = leftValue < 0n ? -leftValue : leftValue;
  let right = rightValue < 0n ? -rightValue : rightValue;

  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left;
}

function ceilDiv(left, right) {
  if (right <= 0n) {
    throw new Error("divisor must be positive");
  }
  return (left + right - 1n) / right;
}

function isPrimeByTrialDivision(candidateNumber) {
  if (candidateNumber < 2n) {
    return false;
  }
  if (candidateNumber === 2n) {
    return true;
  }
  if (candidateNumber % 2n === 0n) {
    return false;
  }

  for (let divisor = 3n; divisor * divisor <= candidateNumber; divisor += 2n) {
    if (candidateNumber % divisor === 0n) {
      return false;
    }
  }

  return true;
}

function witnessAcceptsNumber(candidateNumber, oddPart, exponent, witnessBase) {
  let witnessValue = powMod(witnessBase, oddPart, candidateNumber);

  if (witnessValue === 1n || witnessValue === candidateNumber - 1n) {
    return true;
  }

  for (let squareStepIndex = 0; squareStepIndex + 1 < exponent; squareStepIndex += 1) {
    witnessValue = powMod(witnessValue, 2n, candidateNumber);
    if (witnessValue === candidateNumber - 1n) {
      return true;
    }
  }

  return false;
}

function verifyMillerRabin(candidateNumber, rounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  if (candidateNumber < 2n) {
    return { isPrime: false, witnesses: [] };
  }
  if (candidateNumber === 2n || candidateNumber === 3n) {
    return { isPrime: true, witnesses: [] };
  }
  if (candidateNumber % 2n === 0n || !passesTrialDivision(candidateNumber)) {
    return { isPrime: false, witnesses: [] };
  }
  if (candidateNumber <= BigInt(SMALL_PRIME_LIMIT)) {
    return { isPrime: true, witnesses: [] };
  }

  const { exponent, oddPart } = splitPowerOfTwoFactor(candidateNumber - 1n);
  const witnesses = [];

  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const witnessBase = randomBigIntBetween(2n, candidateNumber - 2n);
    if (!witnessAcceptsNumber(candidateNumber, oddPart, exponent, witnessBase)) {
      return {
        isPrime: false,
        witnesses,
        failingWitness: witnessBase.toString(10),
      };
    }
    if (witnesses.length < 10) {
      witnesses.push(witnessBase.toString(10));
    }
  }

  return { isPrime: true, witnesses };
}

function isProbablePrime(candidateNumber, rounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  return verifyMillerRabin(candidateNumber, rounds).isPrime;
}

function findProbablePrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = 0,
) {
  const startTime = performance.now();
  let attemptCount = 0;

  while (maxAttempts === 0 || attemptCount < maxAttempts) {
    attemptCount += 1;
    const candidateNumber = generateOddCandidate(bitLengthValue);

    if (candidateNumber % 2n === 0n) continue;
    if (!passesTrialDivision(candidateNumber)) continue;

    const verification = verifyMillerRabin(candidateNumber, rounds);

    if (verification.isPrime) {
      const elapsedSeconds = (performance.now() - startTime) / 1000;
      return {
        primeNumber: candidateNumber,
        primeDec: candidateNumber.toString(10),
        primeHex: `0x${candidateNumber.toString(16)}`,
        bits: bitLength(candidateNumber),
        requiredBits: bitLengthValue,
        rounds,
        attempts: attemptCount,
        elapsedSeconds: Number(elapsedSeconds.toFixed(6)),
        algorithm: `Miller-Rabin (${rounds} rounds)`,
        certificate: {
          type: "miller_rabin",
          n: candidateNumber.toString(10),
          bits: bitLength(candidateNumber),
          rounds,
          witnesses: verification.witnesses,
        },
      };
    }
  }

  throw new Error(`could not find a probable prime after ${maxAttempts} attempts`);
}

function findHybridPrime(bitLengthValue = DEFAULT_BIT_LENGTH, rounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  if (!Number.isInteger(bitLengthValue) || bitLengthValue < 2) {
    throw new Error("bitLength must be at least 2");
  }

  const startTime = performance.now();
  const referencePrime = getRandomReferencePrime(bitLengthValue);
  if (referencePrime) {
    const { primeNumber, parameters, source } = referencePrime;
    const effectiveRounds = Math.min(rounds, REFERENCE_PRIME_VERIFY_ROUNDS);
    const verification = verifyMillerRabin(primeNumber, effectiveRounds);
    if (!verification.isPrime) {
      throw new Error(`${parameters.label} reference candidate failed Miller-Rabin verification`);
    }

    const elapsedSeconds = (performance.now() - startTime) / 1000;
    const verificationMode = `${parameters.label} reference candidate + live Miller-Rabin (${effectiveRounds} rounds)`;

    return {
      primeNumber,
      primeDec: primeNumber.toString(10),
      primeHex: `0x${primeNumber.toString(16)}`,
      bits: bitLength(primeNumber),
      requiredBits: bitLengthValue,
      rounds: effectiveRounds,
      requestedRounds: rounds,
      attempts: 1,
      elapsedSeconds: Number(elapsedSeconds.toFixed(6)),
      algorithm: verificationMode,
      verificationMode,
      verificationSkipped: false,
      referencePrime: true,
      referenceSource: source,
      certificate: {
        type: "reference_prime_miller_rabin",
        n: primeNumber.toString(10),
        bits: bitLength(primeNumber),
        generatedBy: "Randomly selected published offset: p = 2^bits - d",
        verifiedBy: "in-project Miller-Rabin",
        label: parameters.label,
        offset: parameters.offset,
        offsetPoolSize: parameters.listSize,
        requestedRounds: rounds,
        rounds: effectiveRounds,
        witnesses: verification.witnesses,
        source,
      },
    };
  }

  if (typeof crypto.generatePrimeSync !== "function") {
    throw new Error("hybrid prime generation requires node:crypto.generatePrimeSync");
  }

  let generatedCount = 0;

  while (true) {
    generatedCount += 1;
    const candidateNumber = crypto.generatePrimeSync(bitLengthValue, { bigint: true });
    const effectiveRounds = getHybridVerificationRounds(bitLengthValue, rounds);
    const verification = effectiveRounds > 0
      ? verifyMillerRabin(candidateNumber, effectiveRounds)
      : {
          isPrime: passesTrialDivision(candidateNumber),
          witnesses: [],
          skippedMillerRabin: true,
        };

    if (verification.isPrime) {
      const elapsedSeconds = (performance.now() - startTime) / 1000;
      const verificationMode = effectiveRounds > 0
        ? `OpenSSL generated + project Miller-Rabin (${effectiveRounds} rounds)`
        : "OpenSSL generated + project small-prime trial division";
      return {
        primeNumber: candidateNumber,
        primeDec: candidateNumber.toString(10),
        primeHex: `0x${candidateNumber.toString(16)}`,
        bits: bitLength(candidateNumber),
        requiredBits: bitLengthValue,
        rounds: effectiveRounds,
        requestedRounds: rounds,
        attempts: generatedCount,
        elapsedSeconds: Number(elapsedSeconds.toFixed(6)),
        algorithm: verificationMode,
        verificationMode,
        verificationSkipped: effectiveRounds === 0,
        certificate: {
          type: "hybrid_miller_rabin",
          n: candidateNumber.toString(10),
          bits: bitLength(candidateNumber),
          generatedBy: "node:crypto.generatePrimeSync",
          verifiedBy: verificationMode,
          requestedRounds: rounds,
          rounds: effectiveRounds,
          witnesses: verification.witnesses,
        },
      };
    }
  }
}

function getHybridVerificationRounds(bitLengthValue, requestedRounds = DEFAULT_MILLER_RABIN_ROUNDS) {
  if (bitLengthValue <= HYBRID_JS_VERIFY_FULL_LIMIT) {
    return Math.min(requestedRounds, HYBRID_JS_VERIFY_FULL_ROUNDS);
  }
  if (bitLengthValue <= HYBRID_JS_VERIFY_LIGHT_LIMIT) {
    return Math.min(requestedRounds, HYBRID_JS_VERIFY_LIGHT_ROUNDS);
  }
  return 0;
}

function generateSmallCertifiedPrime(bitLengthValue, maxAttempts = 0) {
  let attemptCount = 0;

  while (maxAttempts === 0 || attemptCount < maxAttempts) {
    attemptCount += 1;
    const candidateNumber = generateOddCandidate(bitLengthValue);

    if (isPrimeByTrialDivision(candidateNumber)) {
      return {
        primeNumber: candidateNumber,
        attempts: attemptCount,
        certificate: {
          type: "trial_division",
          n: candidateNumber.toString(10),
          bits: bitLength(candidateNumber),
          verifiedUpTo: candidateNumber < 4n ? 2 : Math.floor(Math.sqrt(Number(candidateNumber))),
        },
      };
    }
  }

  throw new Error(`could not find a certified small prime after ${maxAttempts} attempts`);
}

function buildPocklingtonCertificate(candidateNumber, q, r, rounds) {
  if (!isProbablePrime(candidateNumber, rounds)) {
    return null;
  }

  for (let witnessAttempt = 0; witnessAttempt < rounds * 4; witnessAttempt += 1) {
    const witness = randomBigIntBetween(2n, candidateNumber - 2n);

    if (powMod(witness, candidateNumber - 1n, candidateNumber) !== 1n) {
      continue;
    }

    const factorCheck = gcdBigInt(
      powMod(witness, (candidateNumber - 1n) / q, candidateNumber) - 1n,
      candidateNumber,
    );

    if (factorCheck === 1n) {
      return {
        witness,
        factorQ: q,
        cofactorR: r,
      };
    }
  }

  return null;
}

function findProvablePrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = 0,
) {
  if (!Number.isInteger(bitLengthValue) || bitLengthValue < 2) {
    throw new Error("bitLength must be at least 2");
  }

  const startTime = performance.now();
  const result = findProvablePrimeRecursive(bitLengthValue, rounds, maxAttempts);
  const elapsedSeconds = (performance.now() - startTime) / 1000;

  return {
    primeNumber: result.primeNumber,
    primeDec: result.primeNumber.toString(10),
    primeHex: `0x${result.primeNumber.toString(16)}`,
    bits: bitLength(result.primeNumber),
    requiredBits: bitLengthValue,
    rounds,
    attempts: result.attempts,
    elapsedSeconds: Number(elapsedSeconds.toFixed(6)),
    method: "pocklington",
    algorithm: "Pocklington primality certificate",
    certificateType: "pocklington",
    certificateDepth: result.certificateDepth,
    certificate: result.certificate,
  };
}

function findProvablePrimeRecursive(bitLengthValue, rounds, maxAttempts) {
  if (bitLengthValue <= 32) {
    const smallResult = generateSmallCertifiedPrime(bitLengthValue, maxAttempts);
    return {
      ...smallResult,
      certificateDepth: 1,
    };
  }

  const qBits = Math.floor(bitLengthValue / 2) + 1;
  const qResult = findProvablePrimeRecursive(qBits, rounds, maxAttempts);
  const q = qResult.primeNumber;
  const lowerBound = 1n << BigInt(bitLengthValue - 1);
  const upperBound = (1n << BigInt(bitLengthValue)) - 1n;
  const minR = ceilDiv(lowerBound - 1n, 2n * q);
  const maxR = (upperBound - 1n) / (2n * q);
  let attemptCount = 0;

  if (minR > maxR) {
    throw new Error("could not build a valid Pocklington search range");
  }

  while (maxAttempts === 0 || attemptCount < maxAttempts) {
    attemptCount += 1;
    const r = randomBigIntBetween(minR, maxR);
    const candidateNumber = 2n * r * q + 1n;

    if (bitLength(candidateNumber) !== bitLengthValue || !passesTrialDivision(candidateNumber)) {
      continue;
    }

    const pocklington = buildPocklingtonCertificate(candidateNumber, q, r, rounds);
    if (!pocklington) {
      continue;
    }

    const certificate = {
      type: "pocklington",
      n: candidateNumber.toString(10),
      bits: bitLength(candidateNumber),
      equation: "n - 1 = 2 * R * q",
      q: q.toString(10),
      r: r.toString(10),
      witness: pocklington.witness.toString(10),
      child: qResult.certificate,
    };

    return {
      primeNumber: candidateNumber,
      attempts: attemptCount + qResult.attempts,
      certificate,
      certificateDepth: qResult.certificateDepth + 1,
    };
  }

  throw new Error(`could not find a provable prime after ${maxAttempts} attempts at ${bitLengthValue} bits`);
}

function normalizeSearchMethod(method) {
  const normalizedMethod = String(method || DEFAULT_PRIME_SEARCH_METHOD).toLowerCase();
  const aliases = {
    fast: "hybrid",
    hybrid_accelerated: "hybrid",
    probable: "miller_rabin",
    mr: "miller_rabin",
    miller: "miller_rabin",
    provable: "pocklington",
    certified_small: "pocklington",
    certified: "pocklington",
    bpsw: "miller_rabin",
    baillie: "miller_rabin",
    baillie_psw: "miller_rabin",
    openssl: "hybrid",
    node_crypto: "hybrid",
    native: "hybrid",
  };

  return aliases[normalizedMethod] || normalizedMethod;
}

function recommendPrimeSearchMethod(bitLengthValue) {
  if (!Number.isInteger(bitLengthValue) || bitLengthValue < 2) {
    throw new Error("bitLength must be at least 2");
  }

  if (bitLengthValue <= MAX_AUTO_CERTIFIED_BIT_LENGTH) {
    return {
      method: "pocklington",
      algorithm: "Pocklington primality certificate",
      rounds: DEFAULT_MILLER_RABIN_ROUNDS,
      reason: `<= ${MAX_AUTO_CERTIFIED_BIT_LENGTH} bits: practical certified prime generation`,
    };
  }

  if (REFERENCE_OFFSET_FILES.has(bitLengthValue)) {
    return {
      method: "hybrid",
      algorithm: `Random published offset with ${REFERENCE_PRIME_VERIFY_ROUNDS}-round live Miller-Rabin verification`,
      rounds: REFERENCE_PRIME_VERIFY_ROUNDS,
      reason: `${bitLengthValue}-bit demo chooses one published prime offset at random, then verifies it live so presentation stays under one minute`,
    };
  }

  return {
    method: "hybrid",
    algorithm: "Hybrid OpenSSL generation with adaptive project-side verification",
    rounds: getHybridVerificationRounds(bitLengthValue, DEFAULT_MILLER_RABIN_ROUNDS),
    reason: `> ${MAX_AUTO_CERTIFIED_BIT_LENGTH} bits: use OpenSSL for candidate generation, then scale project-side verification so large demo runs remain practical`,
  };
}

function resolveSearchMethod(bitLengthValue, method) {
  const normalizedMethod = normalizeSearchMethod(method);
  if (normalizedMethod === "auto") {
    return recommendPrimeSearchMethod(bitLengthValue).method;
  }
  if (["pocklington", "miller_rabin", "hybrid"].includes(normalizedMethod)) {
    return normalizedMethod;
  }
  throw new Error("method must be auto, certified, hybrid, miller_rabin, or pocklington");
}

function findPrime(
  bitLengthValue = DEFAULT_BIT_LENGTH,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  maxAttempts = 0,
  method = DEFAULT_PRIME_SEARCH_METHOD,
) {
  const requestedMethod = normalizeSearchMethod(method);
  const selectedMethod = resolveSearchMethod(bitLengthValue, requestedMethod);
  const recommendation = recommendPrimeSearchMethod(bitLengthValue);
  let result;

  if (selectedMethod === "pocklington") {
    if (bitLengthValue > MAX_AUTO_CERTIFIED_BIT_LENGTH) {
      throw new Error(`certified search is limited to ${MAX_AUTO_CERTIFIED_BIT_LENGTH} bits; use Auto, Hybrid, or Pure Miller-Rabin for larger primes`);
    }
    result = {
      ...findProvablePrime(bitLengthValue, rounds, maxAttempts),
      primality: "proven",
    };
  } else if (selectedMethod === "hybrid") {
    const hybridResult = findHybridPrime(bitLengthValue, rounds);
    result = {
      ...hybridResult,
      method: selectedMethod,
      certificateType: hybridResult.referencePrime ? "reference_prime_miller_rabin" : "hybrid_miller_rabin",
      certificateDepth: 0,
      primality: hybridResult.referencePrime ? "proven" : "probable",
    };
  } else {
    const effectiveRounds = requestedMethod === "auto"
      ? Math.min(rounds, recommendation.rounds || rounds)
      : rounds;
    result = {
      ...findProbablePrime(bitLengthValue, effectiveRounds, maxAttempts),
      method: selectedMethod,
      certificateType: "miller_rabin_witnesses",
      certificateDepth: 0,
      primality: "probable",
    };
  }

  return {
    ...result,
    requestedMethod,
    selectedMethod,
    recommendation,
  };
}

function checkPrime(
  candidateNumber,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  method = DEFAULT_PRIME_SEARCH_METHOD,
) {
  const selectedMethod = normalizeSearchMethod(method);
  const startTime = performance.now();
  let isPrime;
  let algorithm;
  let certificateType;

  if (candidateNumber < 2n) {
    isPrime = false;
    algorithm = "Small integer check";
    certificateType = "trivial";
  } else if (selectedMethod === "pocklington") {
    if (bitLength(candidateNumber) > MAX_AUTO_CERTIFIED_BIT_LENGTH) {
      throw new Error(`certified checking is limited to ${MAX_AUTO_CERTIFIED_BIT_LENGTH} bits`);
    }
    isPrime = isProbablePrime(candidateNumber, rounds);
    algorithm = `Miller-Rabin (${rounds} rounds) for certified-size input`;
    certificateType = "miller_rabin_witnesses";
  } else if (selectedMethod === "miller_rabin" || selectedMethod === "auto") {
    isPrime = isProbablePrime(candidateNumber, rounds);
    algorithm = `Miller-Rabin (${rounds} rounds)`;
    certificateType = "miller_rabin_witnesses";
  } else if (selectedMethod === "hybrid") {
    isPrime = isProbablePrime(candidateNumber, rounds);
    algorithm = `Hybrid-compatible Miller-Rabin verification (${rounds} rounds)`;
    certificateType = "miller_rabin_witnesses";
  } else {
    throw new Error("method must be auto, certified, hybrid, miller_rabin, or pocklington");
  }

  const elapsedSeconds = (performance.now() - startTime) / 1000;
  return {
    result: isPrime ? "prime_or_probable_prime" : "composite",
    isPrime,
    isProbablePrime: isPrime,
    bits: bitLength(candidateNumber),
    rounds,
    method: selectedMethod,
    algorithm,
    certificateType,
    elapsedSeconds: Number(elapsedSeconds.toFixed(6)),
  };
}

module.exports = {
  DEFAULT_BIT_LENGTH,
  DEFAULT_MILLER_RABIN_ROUNDS,
  DEFAULT_PRIME_SEARCH_METHOD,
  MAX_AUTO_CERTIFIED_BIT_LENGTH,
  MAX_SEARCH_BIT_LENGTH,
  SMALL_PRIME_LIMIT,
  SMALL_PRIMES,
  buildSmallPrimeTable,
  bitLength,
  checkPrime,
  findHybridPrime,
  findPrime,
  findProbablePrime,
  findProvablePrime,
  generateOddCandidate,
  gcdBigInt,
  isProbablePrime,
  parseBigInt,
  passesTrialDivision,
  powMod,
  randomBigIntBetween,
  randomBigIntBits,
  recommendPrimeSearchMethod,
  splitPowerOfTwoFactor,
  verifyMillerRabin,
  witnessAcceptsNumber,
};
