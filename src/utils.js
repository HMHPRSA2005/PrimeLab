const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { performance } = require("perf_hooks");

const projectRoot = path.join(__dirname, "..");
const dataDirectory = path.join(projectRoot, "data");
const outputsDirectory = path.join(projectRoot, "outputs");
const historyFilePath = path.join(dataDirectory, "history.json");
const primesFilePath = path.join(dataDirectory, "primes.json");
const rsaKeysFilePath = path.join(dataDirectory, "rsa-keys.json");
const accountsFilePath = path.join(dataDirectory, "accounts.json");

const locks = new Map();
async function withLock(key, task) {
  if (!locks.has(key)) {
    locks.set(key, Promise.resolve());
  }
  const currentLock = locks.get(key);
  const taskPromise = currentLock.then(() => task());
  locks.set(key, taskPromise.catch(() => {}));
  return taskPromise;
}

function ensureDirectory(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

async function ensureDirectoryAsync(directoryPath) {
  try {
    await fsPromises.access(directoryPath);
  } catch {
    await fsPromises.mkdir(directoryPath, { recursive: true });
  }
}

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
  }
}

function ensureDataFiles() {
  ensureDirectory(dataDirectory);
  ensureDirectory(outputsDirectory);
  ensureJsonFile(historyFilePath, []);
  ensureJsonFile(primesFilePath, []);
  ensureJsonFile(rsaKeysFilePath, []);
  ensureJsonFile(accountsFilePath, []);
}

function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    const rawText = fs.readFileSync(filePath, "utf8");
    if (!rawText.trim()) {
      return defaultValue;
    }

    return JSON.parse(rawText);
  } catch {
    return defaultValue;
  }
}

async function readJsonFileAsync(filePath, defaultValue) {
  try {
    const rawText = await fsPromises.readFile(filePath, "utf8");
    if (!rawText.trim()) {
      return defaultValue;
    }
    return JSON.parse(rawText);
  } catch {
    return defaultValue;
  }
}

function saveJsonFile(filePath, data) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(toJsonBigInt(data), null, 2), "utf8");
}

async function saveJsonFileAsync(filePath, data) {
  await ensureDirectoryAsync(path.dirname(filePath));
  await fsPromises.writeFile(filePath, JSON.stringify(toJsonBigInt(data), null, 2), "utf8");
}

function toJsonBigInt(value) {
  if (typeof value === "bigint") {
    return value.toString(10);
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonBigInt(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonBigInt(item)]),
    );
  }

  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function bitLength(n) {
  if (typeof n !== "bigint") {
    throw new Error("bitLength expects a BigInt");
  }
  if (n < 0n) {
    throw new Error("bitLength expects a non-negative BigInt");
  }
  return n === 0n ? 0 : n.toString(2).length;
}

function randomBigInt(bits) {
  if (!Number.isInteger(bits) || bits < 1) {
    throw new Error("bits must be a positive integer");
  }

  const byteCount = Math.ceil(bits / 8);
  const randomHex = crypto.randomBytes(byteCount).toString("hex");
  const randomValue = BigInt(`0x${randomHex}`);
  const mask = (1n << BigInt(bits)) - 1n;
  return randomValue & mask;
}

function randomOddBigInt(bits) {
  if (!Number.isInteger(bits) || bits < 2) {
    throw new Error("bits must be at least 2");
  }

  // Dat bit cao nhat va bit thap nhat de dung do dai bit va la so le.
  return randomBigInt(bits) | (1n << BigInt(bits - 1)) | 1n;
}

function randomBigIntBetween(min, max) {
  if (typeof min !== "bigint" || typeof max !== "bigint") {
    throw new Error("randomBigIntBetween expects BigInt bounds");
  }
  if (min > max) {
    throw new Error("min must be less than or equal to max");
  }

  const range = max - min + 1n;
  const bits = Math.max(1, bitLength(range - 1n));

  while (true) {
    const value = randomBigInt(bits);
    if (value < range) {
      return min + value;
    }
  }
}

function gcd(a, b) {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;

  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left;
}

function modPow(base, exp, mod) {
  if (mod <= 0n) {
    throw new Error("modulus must be positive");
  }
  if (exp < 0n) {
    throw new Error("exponent must be non-negative");
  }

  let result = 1n;
  let currentBase = ((base % mod) + mod) % mod;
  let currentExp = exp;

  // Square-and-multiply tren BigInt, khong dung base ** exp truc tiep.
  while (currentExp > 0n) {
    if ((currentExp & 1n) === 1n) {
      result = (result * currentBase) % mod;
    }
    currentBase = (currentBase * currentBase) % mod;
    currentExp >>= 1n;
  }

  return result;
}

function sqrtFloor(n) {
  if (typeof n !== "bigint") {
    throw new Error("sqrtFloor expects a BigInt");
  }
  if (n < 0n) {
    throw new Error("sqrtFloor expects a non-negative BigInt");
  }
  if (n < 2n) {
    return n;
  }

  // Newton method cho can bac hai nguyen.
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  let y = (x + n / x) >> 1n;

  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }

  return x;
}

function toHex(n) {
  if (typeof n !== "bigint") {
    throw new Error("toHex expects a BigInt");
  }
  return `0x${n.toString(16)}`;
}

function fromHex(hex) {
  const text = String(hex ?? "").trim();
  if (!/^0x[0-9a-f]+$/i.test(text)) {
    throw new Error("expected hexadecimal integer starting with 0x");
  }
  return BigInt(text);
}

function nowMs() {
  return performance.now();
}

function elapsedSeconds(startMs) {
  return Number(((nowMs() - startMs) / 1000).toFixed(6));
}

module.exports = {
  dataDirectory,
  historyFilePath,
  accountsFilePath,
  bitLength,
  elapsedSeconds,
  fromHex,
  gcd,
  modPow,
  nowIso,
  nowMs,
  outputsDirectory,
  primesFilePath,
  randomBigInt,
  randomBigIntBetween,
  randomOddBigInt,
  readJsonFile,
  readJsonFileAsync,
  rsaKeysFilePath,
  saveJsonFile,
  saveJsonFileAsync,
  ensureDataFiles,
  sqrtFloor,
  toHex,
  toJsonBigInt,
  withLock,
};
