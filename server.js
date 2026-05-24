const express = require("express");
const fsPromises = require("fs").promises;
const path = require("path");
const { Worker } = require("worker_threads");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

loadEnvFile();

const {
  DEFAULT_BIT_LENGTH,
  DEFAULT_MILLER_RABIN_ROUNDS,
  DEFAULT_PRIME_SEARCH_METHOD,
  MAX_SEARCH_BIT_LENGTH,
  bitLength,
  parseBigInt,
} = require("./src/prime");
const {
  lcm,
  modInverse,
  rsaDecrypt,
  rsaEncrypt,
  rsaSignMessage,
  rsaVerifyMessageSignature,
} = require("./src/rsa");
const {
  addHistoryRecord,
  deleteHistoryRecord,
  exportHistory,
  getHistoryRecords,
} = require("./src/history");
const { buildChatSystemPrompt } = require("./src/chatKnowledge");
const {
  ensureDataFiles,
  nowIso,
  outputsDirectory,
  primesFilePath,
  readJsonFileAsync,
  rsaKeysFilePath,
  accountsFilePath,
  saveJsonFileAsync,
  toJsonBigInt,
  withLock,
} = require("./src/utils");

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, "public");
const viewsDirectory = path.join(__dirname, "views");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_primelab_2026_do_not_use_in_prod";
const TOKEN_EXPIRES_IN = "24h";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
const GEMINI_API_URL = process.env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5.5";
const OPENAI_RESPONSES_URL = process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const CHAT_MAX_OUTPUT_TOKENS = readPositiveIntegerEnv("CHAT_MAX_OUTPUT_TOKENS", 2048, 256, 8192);
const SEARCH_METHODS = new Set([
  "auto",
  "fast",
  "hybrid",
  "hybrid_accelerated",
  "native",
  "openssl",
  "node_crypto",
  "miller_rabin",
  "mr",
  "probable",
  "certified",
  "certified_small",
  "provable",
  "pocklington",
]);

ensureDataFiles();

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!require("fs").existsSync(envPath)) {
    return;
  }

  const lines = require("fs").readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readPositiveIntegerEnv(key, fallback, min, max) {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }

  return value;
}

app.use(express.json({ limit: "2mb" }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per `window` (here, per minute)
  message: { ok: false, error: "Quá nhiều yêu cầu, vui lòng thử lại sau." },
  standardHeaders: true,
  legacyHeaders: false,
});

const heavyTaskLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit heavy tasks
  message: { ok: false, error: "Quá nhiều tác vụ nặng, vui lòng thử lại sau." },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  message: { ok: false, error: "Quá nhiều tin nhắn, vui lòng thử lại sau." },
  standardHeaders: true,
  legacyHeaders: false,
});

function runTaskInWorker(type, payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "src/worker.js"), {
      workerData: { type, payload },
    });
    worker.on("message", (message) => {
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

function sendView(response, fileName) {
  response.sendFile(path.join(viewsDirectory, fileName));
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function badRequest(message) {
  return new HttpError(400, message);
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) {
    throw badRequest("email is required");
  }
  return email;
}

function readRequiredString(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw badRequest(`${fieldName} is required`);
  }
  return text;
}

function readRequiredSecret(value, fieldName) {
  const text = String(value ?? "");
  if (!text) {
    throw badRequest(`${fieldName} is required`);
  }
  return text;
}

function createSessionToken(account) {
  return jwt.sign(
    { email: account.email, fullName: account.fullName },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN },
  );
}

function publicAccountPayload(account) {
  return {
    email: account.email,
    fullName: account.fullName,
    token: createSessionToken(account),
  };
}

function getBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Unauthorized: No token provided");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new HttpError(401, "Unauthorized: No token provided");
  }
  return token;
}

app.get("/", (request, response) => {
  response.sendFile(path.join(publicDirectory, "index.html"));
});

app.get("/login", (request, response) => sendView(response, "login.html"));
app.get("/register", (request, response) => sendView(response, "register.html"));

app.post("/api/auth/register", apiLimiter, wrapRoute(async (request, response) => {
  const fullName = readRequiredString(request.body.fullName, "fullName");
  const email = normalizeEmail(request.body.email);
  const password = readRequiredSecret(request.body.password, "password");

  await withLock(accountsFilePath, async () => {
    const accounts = await readJsonFileAsync(accountsFilePath, []);
    if (accounts.some((account) => account.email === email)) {
      throw new HttpError(409, "Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAccount = { fullName, email, password: hashedPassword, createdAt: nowIso() };
    accounts.push(newAccount);
    await saveJsonFileAsync(accountsFilePath, accounts);

    sendOk(response, publicAccountPayload(newAccount));
  });
}));

app.post("/api/auth/login", apiLimiter, wrapRoute(async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const password = readRequiredSecret(request.body.password, "password");
  const accounts = await readJsonFileAsync(accountsFilePath, []);
  const account = accounts.find((candidate) => candidate.email === email);

  if (!account || !(await bcrypt.compare(password, account.password))) {
    return sendError(response, 401, "Invalid email or password");
  }

  sendOk(response, publicAccountPayload(account));
}));

// Authentication Middleware
function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req.headers.authorization);
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof HttpError) {
      return sendError(res, err.statusCode, err);
    }
    return sendError(res, 401, "Unauthorized: Invalid token");
  }
}

app.get("/dashboard", (request, response) => sendView(response, "dashboard.html"));
app.get("/prime-check", (request, response) => sendView(response, "prime-check.html"));
app.get("/prime-search", (request, response) => sendView(response, "prime-search.html"));
app.get("/rsa-keygen", (request, response) => sendView(response, "rsa-keygen.html"));
app.get("/rsa-crypto", (request, response) => sendView(response, "rsa-crypto.html"));
app.get("/history", (request, response) => sendView(response, "history.html"));
app.get("/downloads", (request, response) => sendView(response, "downloads.html"));

app.use(express.static(publicDirectory));

function sendOk(response, payload) {
  response.json({ ok: true, ...toJsonBigInt(payload) });
}

function sendError(response, statusCode, error) {
  response.status(statusCode).json({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function readIntegerInput(value, fallback, min, max, fieldName) {
  const number = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(`${fieldName} must be an integer from ${min} to ${max}`);
  }

  return number;
}

function readBigIntInput(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw badRequest(`${fieldName} is required`);
  }

  return parseBigInt(String(value));
}

function readSearchMethod(value) {
  const method = String(value || DEFAULT_PRIME_SEARCH_METHOD).trim().toLowerCase();
  if (!SEARCH_METHODS.has(method)) {
    throw badRequest("method must be auto, certified, hybrid, miller_rabin, or pocklington");
  }
  return method;
}

function readChatMessages(body) {
  const rawMessages = Array.isArray(body.messages)
    ? body.messages
    : [{ role: "user", content: body.message }];

  const messages = rawMessages
    .slice(-12)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? "").trim().slice(0, 2_000),
    }))
    .filter((message) => message.content);

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw badRequest("message is required");
  }

  return messages;
}

function normalizeOpenAIErrorMessage(statusCode, payload) {
  const rawMessage = String(payload?.error?.message || `OpenAI API error ${statusCode}`);
  const normalizedMessage = rawMessage.toLowerCase();

  if (normalizedMessage.includes("quota") || normalizedMessage.includes("billing")) {
    return "PET chưa thể trả lời vì OPENAI_API_KEY đã hết quota hoặc chưa bật billing. Vui lòng kiểm tra Billing/Usage trên OpenAI hoặc thay bằng API key còn quota.";
  }

  if (normalizedMessage.includes("model") && normalizedMessage.includes("not")) {
    return `Model OpenAI chưa dùng được: ${OPENAI_CHAT_MODEL}. Vui lòng kiểm tra OPENAI_CHAT_MODEL trong file .env.`;
  }

  return rawMessage;
}

function normalizeGeminiErrorMessage(statusCode, payload) {
  const rawMessage = String(payload?.error?.message || `Gemini API error ${statusCode}`);
  const normalizedMessage = rawMessage.toLowerCase();

  if (normalizedMessage.includes("api key not valid") || normalizedMessage.includes("invalid api key")) {
    return "PET chưa thể trả lời vì GEMINI_API_KEY không hợp lệ. Vui lòng kiểm tra lại key trong file .env.";
  }

  if (normalizedMessage.includes("quota") || normalizedMessage.includes("billing")) {
    return "PET chưa thể trả lời vì GEMINI_API_KEY đã hết quota hoặc chưa bật billing. Vui lòng kiểm tra Google AI Studio/Billing hoặc thay bằng API key còn quota.";
  }

  if (normalizedMessage.includes("not found") || normalizedMessage.includes("not supported")) {
    return `Model Gemini chưa dùng được: ${GEMINI_CHAT_MODEL}. Vui lòng kiểm tra GEMINI_CHAT_MODEL trong file .env.`;
  }

  return rawMessage;
}

function recordsForUser(records, userEmail) {
  return records.filter((record) => record.user === userEmail);
}

async function appendJsonRecord(filePath, record) {
  let finalRecord;
  await withLock(filePath, async () => {
    const records = await readJsonFileAsync(filePath, []);
    records.unshift(toJsonBigInt(record));
    await saveJsonFileAsync(filePath, records);
    finalRecord = record;
  });
  return finalRecord;
}

async function writeDownloadFile(fileName, content) {
  const outputPath = path.join(outputsDirectory, fileName);
  await fsPromises.writeFile(outputPath, content, "utf8");
  return outputPath;
}

async function sendDownload(response, fileName, content) {
  const outputPath = await writeDownloadFile(fileName, content);
  response.download(outputPath, fileName);
}

function wrapRoute(handler) {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      sendError(response, error.statusCode || 400, error);
    }
  };
}

async function requestChatReply(messages) {
  if (GEMINI_API_KEY) {
    return await requestGeminiChatReply(messages);
  }

  return await requestOpenAIChatReply(messages);
}

async function requestGeminiChatReply(messages) {
  const instructions = await buildChatSystemPrompt();
  const contents = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const geminiResponse = await fetch(`${GEMINI_API_URL}/models/${encodeURIComponent(GEMINI_CHAT_MODEL)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: instructions }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        temperature: 0.35,
      },
    }),
  });

  const payload = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    const message = normalizeGeminiErrorMessage(geminiResponse.status, payload);
    throw new HttpError(geminiResponse.status, message);
  }

  const reply = extractGeminiResponseText(payload);
  if (!reply) {
    throw new Error("Gemini did not return a text reply");
  }

  return appendLengthLimitNote(reply, payload.candidates?.[0]?.finishReason);
}

async function requestOpenAIChatReply(messages) {
  if (!OPENAI_API_KEY) {
    throw new HttpError(503, "Thiếu OPENAI_API_KEY trên server. Vui lòng cấu hình biến môi trường này trước khi dùng chatbot.");
  }

  const instructions = await buildChatSystemPrompt();
  const input = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const openaiResponse = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      instructions,
      input,
      max_output_tokens: CHAT_MAX_OUTPUT_TOKENS,
      reasoning: { effort: "low" },
    }),
  });

  const payload = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) {
    const message = normalizeOpenAIErrorMessage(openaiResponse.status, payload);
    throw new HttpError(openaiResponse.status, message);
  }

  const reply = extractOpenAIResponseText(payload);
  if (!reply) {
    throw new Error("OpenAI did not return a text reply");
  }

  return reply;
}

function extractOpenAIResponseText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  const textParts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function appendLengthLimitNote(reply, finishReason) {
  if (finishReason !== "MAX_TOKENS") {
    return reply;
  }

  return `${reply}\n\nLưu ý: Câu trả lời đã chạm giới hạn độ dài. Hãy hỏi \"tiếp tục\" hoặc tăng CHAT_MAX_OUTPUT_TOKENS trong .env.`;
}

function extractGeminiResponseText(payload) {
  const textParts = [];
  for (const candidate of payload.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

app.post("/api/chat", chatLimiter, wrapRoute(async (request, response) => {
  const messages = readChatMessages(request.body || {});
  const reply = await requestChatReply(messages);
  sendOk(response, {
    reply,
    provider: GEMINI_API_KEY ? "gemini" : "openai",
    model: GEMINI_API_KEY ? GEMINI_CHAT_MODEL : OPENAI_CHAT_MODEL,
  });
}));

// Apply auth middleware to all API routes below
app.use("/api/prime", requireAuth);
app.use("/api/rsa", requireAuth);
app.use("/api/history", requireAuth);
app.use("/api/download", requireAuth);

app.post("/api/prime/check", apiLimiter, wrapRoute(async (request, response) => {
  const candidateNumber = readBigIntInput(request.body.number, "number");
  const requiredBits = readIntegerInput(
    request.body.bits,
    DEFAULT_BIT_LENGTH,
    2,
    MAX_SEARCH_BIT_LENGTH,
    "bits",
  );
  const rounds = readIntegerInput(
    request.body.rounds,
    DEFAULT_MILLER_RABIN_ROUNDS,
    1,
    256,
    "rounds",
  );
  const method = readSearchMethod(request.body.method);

  const actualBits = bitLength(candidateNumber);
  const hasRequiredBitLength = actualBits === requiredBits;
  
  const checkResult = hasRequiredBitLength
    ? await runTaskInWorker("prime.check", { number: candidateNumber, rounds, method })
    : {
        result: "invalid_bit_length",
        isPrime: false,
        isProbablePrime: false,
        method,
        algorithm: "Bit length validation",
        certificateType: "none",
      };
    
  const result = !hasRequiredBitLength
    ? "invalid_bit_length"
    : checkResult.isPrime
      ? "prime_or_probable_prime"
      : "composite";

  const payload = {
    ...checkResult,
    result,
    bits: actualBits,
    requiredBits,
    rounds,
    number: candidateNumber,
  };

  await addHistoryRecord(
    "prime.check",
    "success",
    `Checked ${actualBits}-bit number: ${result}`,
    payload,
    request.user.email
  );
  sendOk(response, payload);
}));

app.post("/api/prime/search", heavyTaskLimiter, wrapRoute(async (request, response) => {
  const bitLengthValue = readIntegerInput(
    request.body.bits,
    DEFAULT_BIT_LENGTH,
    2,
    MAX_SEARCH_BIT_LENGTH,
    "bits",
  );
  const rounds = readIntegerInput(
    request.body.rounds,
    DEFAULT_MILLER_RABIN_ROUNDS,
    1,
    256,
    "rounds",
  );
  const maxAttempts = readIntegerInput(
    request.body.maxAttempts,
    0,
    0,
    1_000_000,
    "maxAttempts",
  );
  const method = readSearchMethod(request.body.method);

  const searchResult = await runTaskInWorker("prime.search", {
    bits: bitLengthValue,
    rounds,
    maxAttempts,
    method,
  });
  
  const record = await appendJsonRecord(primesFilePath, {
    id: `${Date.now()}`,
    createdAt: nowIso(),
    user: request.user.email,
    ...searchResult,
  });

  await addHistoryRecord(
    "prime.search",
    "success",
    `Found ${searchResult.bits}-bit prime with ${searchResult.algorithm || searchResult.method} in ${searchResult.attempts} attempts`,
    record,
    request.user.email
  );
  sendOk(response, { result: searchResult });
}));

app.post("/api/rsa/keygen", heavyTaskLimiter, wrapRoute(async (request, response) => {
  const primeBits = readIntegerInput(request.body.primeBits, 256, 4, 4096, "primeBits");
  const rounds = readIntegerInput(
    request.body.rounds,
    DEFAULT_MILLER_RABIN_ROUNDS,
    1,
    256,
    "rounds",
  );
  const publicExponent = request.body.publicExponent === undefined
    ? 65537n
    : readBigIntInput(request.body.publicExponent, "publicExponent");

  const keyPair = await runTaskInWorker("rsa.keygen", {
    primeBits,
    rounds,
    publicExponent,
  });
  
  const keyRecord = await appendJsonRecord(rsaKeysFilePath, {
    id: `${Date.now()}`,
    createdAt: nowIso(),
    user: request.user.email,
    primeBits,
    rounds,
    ...keyPair,
  });

  await addHistoryRecord(
    "rsa.keygen",
    "success",
    `Generated RSA key pair with ${primeBits}-bit primes`,
    keyRecord,
    request.user.email
  );
  sendOk(response, { keyPair });
}));

app.post("/api/rsa/encrypt", apiLimiter, wrapRoute(async (request, response) => {
  const messageNumber = readBigIntInput(
    request.body.messageNumber ?? request.body.message,
    "message",
  );
  const n = readBigIntInput(request.body.n, "n");
  const e = readBigIntInput(request.body.e, "e");
  
  const cipherNumber = rsaEncrypt(messageNumber, n, e);
  const payload = {
    messageNumber,
    n,
    e,
    cipherNumber,
    cipherHex: `0x${cipherNumber.toString(16)}`,
  };

  await addHistoryRecord("rsa.encrypt", "success", "Encrypted RSA message number", payload, request.user.email);
  sendOk(response, payload);
}));

app.post("/api/rsa/decrypt", apiLimiter, wrapRoute(async (request, response) => {
  const cipherNumber = readBigIntInput(request.body.cipherNumber, "cipherNumber");
  const n = readBigIntInput(request.body.n, "n");
  const d = readBigIntInput(request.body.d, "d");
  
  const messageNumber = rsaDecrypt(cipherNumber, n, d);
  const payload = {
    cipherNumber,
    n,
    d,
    messageNumber,
    messageHex: `0x${messageNumber.toString(16)}`,
  };

  await addHistoryRecord("rsa.decrypt", "success", "Decrypted RSA cipher number", payload, request.user.email);
  sendOk(response, payload);
}));

app.post("/api/rsa/sign", apiLimiter, wrapRoute(async (request, response) => {
  const message = String(request.body.message ?? "");
  const n = readBigIntInput(request.body.n, "n");
  const d = readBigIntInput(request.body.d, "d");
  const hashAlgorithm = String(request.body.hashAlgorithm || "sha256");

  const payload = rsaSignMessage(message, n, d, hashAlgorithm);

  await addHistoryRecord(
    "rsa.sign",
    "success",
    `Signed message hash with RSA-${hashAlgorithm}`,
    payload,
    request.user.email
  );
  sendOk(response, payload);
}));

app.post("/api/rsa/verify", apiLimiter, wrapRoute(async (request, response) => {
  const message = String(request.body.message ?? "");
  const signatureNumber = readBigIntInput(request.body.signatureNumber, "signatureNumber");
  const n = readBigIntInput(request.body.n, "n");
  const e = readBigIntInput(request.body.e, "e");
  const hashAlgorithm = String(request.body.hashAlgorithm || "sha256");

  const payload = rsaVerifyMessageSignature(message, signatureNumber, n, e, hashAlgorithm);

  await addHistoryRecord(
    "rsa.verify",
    payload.valid ? "success" : "failed",
    `Verified RSA signature with ${hashAlgorithm}: ${payload.valid}`,
    payload,
    request.user.email
  );
  sendOk(response, payload);
}));

app.post("/api/rsa/mod-inverse", heavyTaskLimiter, wrapRoute(async (request, response) => {
  const e = readBigIntInput(request.body.e, "e");
  const n = readBigIntInput(request.body.n, "n");
  
  const [p, q] = await runTaskInWorker("rsa.factorize", { n });
  const phiN = (p - 1n) * (q - 1n);
  const lambdaN = lcm(p - 1n, q - 1n);
  const d = modInverse(e, phiN);
  const payload = { e, n, p, q, phiN, lambdaN, d };

  await addHistoryRecord("rsa.mod-inverse", "success", "Calculated d from n using factorization", payload, request.user.email);
  sendOk(response, payload);
}));

app.get("/api/history", wrapRoute(async (request, response) => {
  const records = await getHistoryRecords();
  sendOk(response, { records: recordsForUser(records, request.user.email) });
}));

app.delete("/api/history/:id", wrapRoute(async (request, response) => {
  const deleted = await deleteHistoryRecord(request.params.id, request.user.email);

  if (!deleted) {
    sendError(response, 404, "history record not found or access denied");
    return;
  }

  sendOk(response, { deleted: true });
}));

app.get("/api/download/prime-results", wrapRoute(async (request, response) => {
  const records = await readJsonFileAsync(primesFilePath, []);
  const userRecords = recordsForUser(records, request.user.email);
  const textContent = userRecords.map((r) => {
    return [
      `ID: ${r.id}`,
      `Created At: ${r.createdAt}`,
      `Prime Number: ${r.primeNumber}`,
      `Bits: ${r.bits}`,
      `Method: ${r.method || "probable"}`,
      `Algorithm: ${r.algorithm || r.method || "Miller-Rabin"}`,
      `Certificate Type: ${r.certificateType || "miller_rabin_witnesses"}`,
      `Certificate Depth: ${r.certificateDepth || 0}`,
      `Rounds: ${r.rounds}`,
      `Attempts: ${r.attempts}`,
      `Elapsed: ${r.elapsedSeconds}s`,
      r.certificate ? `Certificate JSON: ${JSON.stringify(r.certificate)}` : "Certificate JSON: N/A",
      "----------------------------------------",
    ].join("\n");
  }).join("\n\n");

  await sendDownload(
    response,
    "prime-results.txt",
    textContent || "No records found",
  );
}));

app.get("/api/download/rsa-keys", wrapRoute(async (request, response) => {
  const records = await readJsonFileAsync(rsaKeysFilePath, []);
  const userRecords = recordsForUser(records, request.user.email);
  const textContent = userRecords.map((r) => {
    return [
      `ID: ${r.id}`,
      `Created At: ${r.createdAt}`,
      `Prime Bits: ${r.primeBits}`,
      `Rounds: ${r.rounds}`,
      `Attempts: ${r.attempts}`,
      `p: ${r.p}`,
      `q: ${r.q}`,
      `n: ${r.n}`,
      `phiN: ${r.phiN}`,
      `e: ${r.e}`,
      `d: ${r.d}`,
      "----------------------------------------",
    ].join("\n");
  }).join("\n\n");

  await sendDownload(
    response,
    "rsa-keys.txt",
    textContent || "No records found",
  );
}));

app.get("/api/download/experiment-log", wrapRoute(async (request, response) => {
  await sendDownload(response, "experiment-log.txt", await exportHistory("txt", request.user.email));
}));

app.use((request, response) => {
  sendError(response, 404, "route not found");
});

const domain = "primelab.io";

if (require.main === module) {
  const server = app.listen(port, () => {
    console.log(`PrimeLab Express server running at http://${domain}:${port}`);
    console.log(`Local address: http://localhost:${port}`);
    console.log(`Note: To use ${domain}, add "127.0.0.1 ${domain}" to your hosts file.`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the existing PrimeLab server or set another PORT in .env.`);
      console.error(`PowerShell: Get-NetTCPConnection -LocalPort ${port} | Select-Object OwningProcess`);
      console.error("Then stop it with: Stop-Process -Id <PID> -Force");
      process.exit(1);
    }

    throw error;
  });
}

module.exports = app;
