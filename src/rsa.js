const crypto = require("crypto");
const {
  DEFAULT_MILLER_RABIN_ROUNDS,
  bitLength,
  findProbablePrime,
  parseBigInt,
  powMod,
  verifyMillerRabin,
} = require("./prime");

const RSA_HASH_ALGORITHMS = ["sha256", "sha384", "sha512", "sha3-256", "sha3-512"];
const FERMAT_MAX_ITERATIONS = 1_000_000;
const POLLARD_RHO_MAX_ITERATIONS = 100_000;

function absBigInt(value) {
  return value < 0n ? -value : value;
}

function gcd(a, b) {
  let left = absBigInt(a);
  let right = absBigInt(b);

  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left;
}

function lcm(a, b) {
  if (a === 0n || b === 0n) {
    return 0n;
  }
  return absBigInt((a / gcd(a, b)) * b);
}

function extendedGcd(a, b) {
  let oldRemainder = a;
  let remainder = b;
  let oldCoefficientS = 1n;
  let coefficientS = 0n;
  let oldCoefficientT = 0n;
  let coefficientT = 1n;

  while (remainder !== 0n) {
    const quotient = oldRemainder / remainder;

    [oldRemainder, remainder] = [
      remainder,
      oldRemainder - quotient * remainder,
    ];
    [oldCoefficientS, coefficientS] = [
      coefficientS,
      oldCoefficientS - quotient * coefficientS,
    ];
    [oldCoefficientT, coefficientT] = [
      coefficientT,
      oldCoefficientT - quotient * coefficientT,
    ];
  }

  return {
    gcd: oldRemainder,
    x: oldCoefficientS,
    y: oldCoefficientT,
  };
}

function modInverse(a, modulus) {
  if (modulus <= 0n) {
    throw new Error("modulus must be positive");
  }
  const normalizedA = ((a % modulus) + modulus) % modulus;
  const result = extendedGcd(normalizedA, modulus);

  if (result.gcd !== 1n) {
    throw new Error("modular inverse does not exist");
  }

  return ((result.x % modulus) + modulus) % modulus;
}

function generateRsaPrime(primeBits, rounds, publicExponent) {
  const shouldUseNativePrime = primeBits >= 512 && typeof crypto.generatePrimeSync === "function";

  while (true) {
    const prime = shouldUseNativePrime
      ? crypto.generatePrimeSync(primeBits, { bigint: true })
      : findProbablePrime(primeBits, rounds, 0).primeNumber;

    if (gcd(publicExponent, prime - 1n) !== 1n) {
      continue;
    }

    if (shouldUseNativePrime) {
      const verificationRounds = Math.min(rounds, 8);
      if (!verifyMillerRabin(prime, verificationRounds).isPrime) {
        continue;
      }
    }

    return prime;
  }
}

function sqrtBigInt(n) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = n / 2n + 1n;
  let y = (x + n / x) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function isPerfectSquare(n) {
  if (n < 0n) return false;
  const s = sqrtBigInt(n);
  return s * s === n;
}

function factorizeFermat(n, maxIterations = FERMAT_MAX_ITERATIONS) {
  let a = sqrtBigInt(n);
  if (a * a < n) a++;
  let b2 = a * a - n;
  
  for (let i = 0; i < maxIterations; i++) {
    if (isPerfectSquare(b2)) {
      let b = sqrtBigInt(b2);
      return [a - b, a + b];
    }
    a++;
    b2 = a * a - n;
  }
  return null;
}

function factorizeRSA(n) {
  if (n <= 1n) throw new Error("n must be greater than 1");
  if (n % 2n === 0n) return [2n, n / 2n];

  // 1. Thử phương pháp Fermat (cực nhanh nếu p và q gần nhau)
  const fermatResult = factorizeFermat(n);
  if (fermatResult) return fermatResult;

  // 2. Thử Pollard's rho (phổ thông cho số vừa)
  let x = 2n;
  let y = 2n;
  let d = 1n;
  let c = 1n;
  const f = (val) => (val * val + c) % n;

  for (let i = 0; i < POLLARD_RHO_MAX_ITERATIONS; i++) {
    x = f(x);
    y = f(f(y));
    d = gcd(absBigInt(x - y), n);
    
    if (d > 1n && d < n) return [d, n / d];
    if (d === n) {
      x = 2n + BigInt(i % 100);
      y = x;
      c++;
    }
  }
  
  throw new Error(`n quá lớn hoặc quá an toàn để phân tích bằng CPU thông thường (đã giới hạn ${POLLARD_RHO_MAX_ITERATIONS.toLocaleString("en-US")} vòng lặp để bảo vệ máy chủ). Trong thực tế, n > 512-bit (RSA an toàn) không thể bẻ khóa bằng cách này.`);
}

function generateRsaKeyPair(
  primeBits,
  rounds = DEFAULT_MILLER_RABIN_ROUNDS,
  publicExponent = 65537n,
) {
  if (!Number.isInteger(primeBits) || primeBits < 3) {
    throw new Error("primeBits must be an integer greater than or equal to 3");
  }

  const e = typeof publicExponent === "bigint"
    ? publicExponent
    : parseBigInt(String(publicExponent));

  if (e < 3n || e % 2n === 0n) {
    throw new Error("publicExponent must be an odd integer greater than or equal to 3");
  }

  let p;
  let q;
  let phiN;
  let lambdaN;
  let attempts = 0;

  while (true) {
    attempts += 1;
    p = generateRsaPrime(primeBits, rounds, e);

    do {
      q = generateRsaPrime(primeBits, rounds, e);
    } while (q === p);

    phiN = (p - 1n) * (q - 1n);
    lambdaN = lcm(p - 1n, q - 1n);
    if (gcd(e, lambdaN) === 1n) {
      break;
    }
  }

  const n = p * q;
  const d = modInverse(e, phiN);

  return {
    attempts,
    primeBits,
    modulusBits: bitLength(n),
    p,
    q,
    n,
    phiN,
    lambdaN,
    e,
    d,
    publicKey: { n, e },
    privateKey: { n, d },
  };
}

function rsaEncrypt(messageNumber, n, e) {
  const message = typeof messageNumber === "bigint"
    ? messageNumber
    : parseBigInt(String(messageNumber));

  if (message < 0n) {
    throw new Error("message must be non-negative");
  }
  if (message >= n) {
    throw new Error("message must be smaller than n");
  }

  return powMod(message, e, n);
}

function rsaDecrypt(cipherNumber, n, d) {
  const cipher = typeof cipherNumber === "bigint"
    ? cipherNumber
    : parseBigInt(String(cipherNumber));

  if (cipher < 0n) {
    throw new Error("cipherNumber must be non-negative");
  }
  if (cipher >= n) {
    throw new Error("cipherNumber must be smaller than n");
  }

  return powMod(cipher, d, n);
}

function hashMessageForRsa(message, n, algorithm = "sha256") {
  if (!RSA_HASH_ALGORITHMS.includes(algorithm)) {
    throw new Error("hash algorithm is not supported for RSA signing");
  }

  const text = String(message ?? "");
  if (!text) {
    throw new Error("message is required");
  }

  const digestHex = crypto.createHash(algorithm).update(text, "utf8").digest("hex");
  const digestNumber = BigInt(`0x${digestHex}`);
  const representative = digestNumber % n;

  return {
    algorithm,
    digestHex,
    digestNumber,
    representative,
    messageLength: Buffer.byteLength(text, "utf8"),
  };
}

function rsaSignMessage(message, n, d, algorithm = "sha256") {
  if (n <= 1n) {
    throw new Error("n must be greater than 1");
  }
  const hash = hashMessageForRsa(message, n, algorithm);
  const signatureNumber = powMod(hash.representative, d, n);

  return {
    operation: "rsa.sign",
    hashAlgorithm: hash.algorithm,
    messageLength: hash.messageLength,
    digestHex: hash.digestHex,
    digestRepresentative: hash.representative,
    n,
    d,
    signatureNumber,
    signatureHex: `0x${signatureNumber.toString(16)}`,
  };
}

function rsaVerifyMessageSignature(message, signatureNumber, n, e, algorithm = "sha256") {
  if (n <= 1n) {
    throw new Error("n must be greater than 1");
  }

  const signature = typeof signatureNumber === "bigint"
    ? signatureNumber
    : parseBigInt(String(signatureNumber));

  if (signature < 0n || signature >= n) {
    throw new Error("signatureNumber must be non-negative and smaller than n");
  }

  const hash = hashMessageForRsa(message, n, algorithm);
  const recoveredRepresentative = powMod(signature, e, n);
  const valid = recoveredRepresentative === hash.representative;

  return {
    operation: "rsa.verify",
    hashAlgorithm: hash.algorithm,
    messageLength: hash.messageLength,
    digestHex: hash.digestHex,
    digestRepresentative: hash.representative,
    recoveredRepresentative,
    n,
    e,
    signatureNumber: signature,
    valid,
  };
}

module.exports = {
  RSA_HASH_ALGORITHMS,
  extendedGcd,
  factorizeRSA,
  gcd,
  generateRsaKeyPair,
  lcm,
  modInverse,
  rsaDecrypt,
  rsaEncrypt,
  rsaSignMessage,
  rsaVerifyMessageSignature,
};
