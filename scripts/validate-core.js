const assert = require("assert");

const { checkPrime, findPrime, parseBigInt } = require("../src/prime");
const {
  factorizeRSA,
  gcd,
  generateRsaKeyPair,
  modInverse,
  rsaDecrypt,
  rsaEncrypt,
  rsaSignMessage,
  rsaVerifyMessageSignature,
} = require("../src/rsa");

function validatePrimeSearch() {
  const result = findPrime(64, 8, 10000, "auto");
  assert.strictEqual(result.bits, 64);
  assert.ok(result.primeNumber > 0n);

  const check = checkPrime(result.primeNumber, 8, "auto");
  assert.strictEqual(check.isPrime, true);
}

function validateRsaRoundTrip() {
  const keyPair = generateRsaKeyPair(64, 8, 65537n);
  assert.notStrictEqual(keyPair.p, keyPair.q);
  assert.strictEqual(gcd(keyPair.e, keyPair.lambdaN), 1n);
  assert.strictEqual((keyPair.e * keyPair.d) % keyPair.phiN, 1n);

  const message = 42n;
  const cipher = rsaEncrypt(message, keyPair.n, keyPair.e);
  const decrypted = rsaDecrypt(cipher, keyPair.n, keyPair.d);
  assert.strictEqual(decrypted, message);

  const signature = rsaSignMessage("PrimeLab", keyPair.n, keyPair.d, "sha256");
  const verified = rsaVerifyMessageSignature(
    "PrimeLab",
    signature.signatureNumber,
    keyPair.n,
    keyPair.e,
    "sha256",
  );
  assert.strictEqual(verified.valid, true);

  const rejected = rsaVerifyMessageSignature(
    "PrimeLab tampered",
    signature.signatureNumber,
    keyPair.n,
    keyPair.e,
    "sha256",
  );
  assert.strictEqual(rejected.valid, false);
}

function validateParsingAndNumberTheory() {
  assert.strictEqual(parseBigInt("number = 0x2a"), 42n);
  assert.strictEqual(parseBigInt("1_000"), 1000n);
  assert.throws(() => parseBigInt("-1"), /non-negative/);

  assert.strictEqual(modInverse(-3n, 11n), 7n);

  const factors = factorizeRSA(61n * 53n).sort((left, right) => Number(left - right));
  assert.deepStrictEqual(factors, [53n, 61n]);
}

validatePrimeSearch();
validateRsaRoundTrip();
validateParsingAndNumberTheory();

console.log("core validation passed");
