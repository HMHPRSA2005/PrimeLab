const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");

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

module.exports = {
  dataDirectory,
  historyFilePath,
  accountsFilePath,
  nowIso,
  outputsDirectory,
  primesFilePath,
  readJsonFile,
  readJsonFileAsync,
  rsaKeysFilePath,
  saveJsonFile,
  saveJsonFileAsync,
  ensureDataFiles,
  toJsonBigInt,
  withLock,
};
