const fsPromises = require("fs").promises;
const path = require("path");
const zlib = require("zlib");

const projectRoot = path.join(__dirname, "..");
const trainingDirectory = path.join(projectRoot, "AI data training");
const dataDirectory = path.join(projectRoot, "data");
const MAX_CONTEXT_CHARS = Number(process.env.CHAT_TRAINING_CONTEXT_CHARS || 50_000);
const MAX_APP_CONTEXT_CHARS = Number(process.env.CHAT_APP_CONTEXT_CHARS || 30_000);
const MAX_USER_CONTEXT_CHARS = Number(process.env.CHAT_USER_CONTEXT_CHARS || 8_000);
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json", ".pdf"]);
const APP_DOC_FILES = [
  { relativePath: "README.md", maxChars: 4_500 },
  { relativePath: "AllInOne.md", maxChars: 3_500 },
  { relativePath: "report.txt", maxChars: 1_500 },
];
const SOURCE_CONTEXT_FILES = [
  "src/prime.js",
  "src/rsa.js",
  "src/utils.js",
  "src/worker.js",
  "src/history.js",
  "server.js",
];
const FRONTEND_CONTEXT_FILES = [
  "public/js/shared.js",
  "public/js/prime-search.js",
  "public/js/prime-check.js",
  "public/js/rsa-keygen.js",
  "public/js/rsa-crypto.js",
  "public/js/history.js",
  "public/js/downloads.js",
  "public/js/chatbot.js",
];
const USER_DATA_FILES = [
  { label: "history", fileName: "history.json" },
  { label: "saved primes", fileName: "primes.json" },
  { label: "RSA keys", fileName: "rsa-keys.json" },
];
const SENSITIVE_FIELD_PATTERN = /(password|hash|token|secret|private|cipher|plain|message|primeDec|primeHex|certificate|signature|encrypted|decrypted|^p$|^q$|^d$|phi|lambda)/i;

let cachedKnowledge = null;
let cachedPrimeLabContext = null;

async function buildChatSystemPrompt(options = {}) {
  const [knowledge, primeLabContext, userContext] = await Promise.all([
    loadTrainingKnowledge(),
    loadPrimeLabAppContext(),
    buildUserDataContext(options),
  ]);

  return [
    "Bạn là PET, trợ lý ảo chuyên gia về Toán học, Mật mã học và ứng dụng PrimeLab.",
    "Bạn được dùng các phần ngữ cảnh đã được server PrimeLab trích xuất bên dưới: tài liệu học thuật, README, route, giao diện, module source và metadata dữ liệu nội bộ.",
    "Khi người dùng hỏi về PrimeLab, ưu tiên trả lời theo đúng triển khai hiện tại trong ngữ cảnh ứng dụng. Nếu thiếu dữ liệu, nói rõ là bạn chưa có đủ ngữ cảnh thay vì tự bịa.",
    "Không nói rằng bạn có thể tự mở file bất kỳ trên máy chủ theo thời gian thực; bạn chỉ sử dụng phần ngữ cảnh đã được đưa vào prompt này.",
    "Không tiết lộ hoặc suy đoán mật khẩu, token, secret, khóa riêng RSA, p, q, d, bản rõ, bản mã, chữ ký, số nguyên tố đầy đủ hoặc dữ liệu lịch sử cá nhân. Với dữ liệu người dùng, chỉ dùng metadata đã được redact và hướng người dùng xem chi tiết trong History/Downloads sau khi đăng nhập.",
    "Hãy trả lời ngắn gọn, tự nhiên, dùng markdown vừa đủ. Không bọc công thức bằng ký hiệu LaTeX $...$, $$...$$, \\(...\\) hoặc \\[...\\] vì giao diện chat không render MathJax. Viết công thức trực tiếp, ví dụ: n = p * q, c = m^e mod n.",
    "Nếu người dùng hỏi các vấn đề ngoài PrimeLab, mật mã và toán học, hãy khéo léo từ chối và hướng họ quay lại chủ đề.",
    "Quy ước RSA trên website: khóa công khai là (n, e), khóa mật là d.",
    "",
    "Ngữ cảnh ứng dụng PrimeLab:",
    primeLabContext,
    "",
    "Ngữ cảnh dữ liệu người dùng hiện tại:",
    userContext,
    "",
    "Dữ liệu tham khảo nội bộ:",
    knowledge,
  ].join("\n");
}

async function loadTrainingKnowledge() {
  if (cachedKnowledge) {
    return cachedKnowledge;
  }

  const entries = await fsPromises.readdir(trainingDirectory, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, "vi"));

  const sections = [];
  let remainingChars = MAX_CONTEXT_CHARS;

  for (const fileName of files) {
    if (remainingChars <= 0) break;

    const filePath = path.join(trainingDirectory, fileName);
    const text = await readTrainingFile(filePath);
    const normalizedText = normalizeExtractedText(text);
    const excerpt = normalizedText.slice(0, remainingChars);
    remainingChars -= excerpt.length;

    sections.push([
      `### ${fileName}`,
      excerpt || "(Không trích xuất được văn bản rõ từ file này, nhưng tên file vẫn được dùng làm ngữ cảnh chủ đề.)",
    ].join("\n"));
  }

  cachedKnowledge = sections.length > 0
    ? [
        buildTrainingTopicFallback(files),
        sections.join("\n\n"),
      ].join("\n\n")
    : "Không tìm thấy file training. Trả lời dựa trên kiến thức toán học và mật mã học phổ thông.";

  return cachedKnowledge;
}

async function loadPrimeLabAppContext() {
  if (cachedPrimeLabContext) {
    return cachedPrimeLabContext;
  }

  const sections = [
    await buildPrimeLabStaticSummary(),
    await buildDocumentationSummary(),
    await buildRouteSummary(),
    await buildFrontendSummary(),
    await buildModuleSummary(),
    await buildDataInventorySummary(),
  ].filter(Boolean);

  cachedPrimeLabContext = truncateText(sections.join("\n\n"), MAX_APP_CONTEXT_CHARS);
  return cachedPrimeLabContext || "Không trích xuất được ngữ cảnh ứng dụng PrimeLab.";
}

async function buildPrimeLabStaticSummary() {
  const primeSource = await readProjectText("src/prime.js");
  const maxSearchBits = extractConstantValue(primeSource, "MAX_SEARCH_BIT_LENGTH") || "8192";
  const autoPocklingtonBits = extractConstantValue(primeSource, "AUTO_POCKLINGTON_MAX_BITS") || "512";
  const defaultRounds = extractConstantValue(primeSource, "DEFAULT_MILLER_RABIN_ROUNDS") || "50";
  const defaultAttempts = extractConstantValue(primeSource, "DEFAULT_MAX_ATTEMPTS") || "100000";

  return [
    "### Tổng quan PrimeLab hiện tại",
    "- PrimeLab là web app Node.js/Express cho kiểm tra số nguyên tố, sinh số nguyên tố lớn, RSA keygen, RSA encrypt/decrypt/sign/verify, history và downloads.",
    "- Backend dùng JavaScript BigInt native, crypto.randomBytes và worker_threads cho tác vụ nặng.",
    `- Giới hạn tìm/kiểm tra số nguyên tố hiện tại: tối đa ${maxSearchBits} bit.`,
    `- Prime search mặc định: bits = 4096, rounds = ${defaultRounds}, maxAttempts = ${defaultAttempts}, method = auto.`,
    `- Chế độ auto chọn Pocklington cho số từ ${autoPocklingtonBits} bit đổ lại; số lớn hơn dùng Miller-Rabin để tối ưu thời gian.`,
    "- Pocklington sinh n theo dạng n = F * R + 1 và trả chứng chỉ proven/certified. Miller-Rabin phân tích n - 1 = 2^s * d và trả probable prime cùng witness.",
    "- Prime check dùng Miller-Rabin cho kiểm tra xác suất nhanh.",
  ].join("\n");
}

async function buildDocumentationSummary() {
  const sections = [];

  for (const item of APP_DOC_FILES) {
    const text = await readProjectText(item.relativePath);
    if (!text) continue;
    sections.push([
      `### Tài liệu ứng dụng: ${item.relativePath}`,
      truncateText(normalizeExtractedText(text), item.maxChars),
    ].join("\n"));
  }

  return sections.join("\n\n");
}

async function buildRouteSummary() {
  const source = await readProjectText("server.js");
  if (!source) return "";

  const routes = [];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let routeMatch;
  while ((routeMatch = routePattern.exec(source)) !== null) {
    routes.push(`${routeMatch[1].toUpperCase()} ${routeMatch[2]}`);
  }

  const protectedPrefixes = [];
  const protectedPattern = /app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*requireAuth/g;
  let protectedMatch;
  while ((protectedMatch = protectedPattern.exec(source)) !== null) {
    protectedPrefixes.push(protectedMatch[1]);
  }

  return [
    "### Route và API",
    `Routes phát hiện: ${routes.join("; ") || "không có"}.`,
    `API yêu cầu đăng nhập: ${protectedPrefixes.join("; ") || "không có"}.`,
    "Chatbot nằm ở POST /api/chat; route này nhận token nếu frontend gửi kèm để lấy metadata người dùng đã redact.",
  ].join("\n");
}

async function buildFrontendSummary() {
  const viewEntries = await fsPromises.readdir(path.join(projectRoot, "views"), { withFileTypes: true }).catch(() => []);
  const views = [];

  for (const entry of viewEntries.filter((item) => item.isFile() && item.name.endsWith(".html"))) {
    const relativePath = `views/${entry.name}`;
    const html = await readProjectText(relativePath);
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
    const formIds = [...html.matchAll(/<form[^>]*id=["'`]([^"'`]+)["'`]/gi)].map((match) => match[1]);
    views.push(`${relativePath}${title ? ` (${title})` : ""}${formIds.length ? `, forms: ${formIds.join(", ")}` : ""}`);
  }

  const endpoints = new Set();
  for (const relativePath of FRONTEND_CONTEXT_FILES) {
    const source = await readProjectText(relativePath);
    if (!source) continue;
    const endpointPattern = /(?:apiPost|apiGet|apiDelete|fetch)\(\s*["'`]([^"'`]+)["'`]/g;
    let endpointMatch;
    while ((endpointMatch = endpointPattern.exec(source)) !== null) {
      endpoints.add(endpointMatch[1]);
    }
  }

  return [
    "### Giao diện frontend",
    `Các trang views: ${views.join("; ") || "không có"}.`,
    `Endpoint frontend gọi: ${Array.from(endpoints).sort().join("; ") || "không có"}.`,
  ].join("\n");
}

async function buildModuleSummary() {
  const lines = ["### Module source chính"];

  for (const relativePath of SOURCE_CONTEXT_FILES) {
    const source = await readProjectText(relativePath);
    if (!source) continue;

    const functions = [...source.matchAll(/\bfunction\s+([A-Za-z0-9_]+)/g)]
      .map((match) => match[1])
      .slice(0, 28);
    const exports = extractModuleExports(source).slice(0, 40);
    lines.push(`- ${relativePath}: functions ${functions.join(", ") || "không rõ"}; exports ${exports.join(", ") || "không rõ"}.`);
  }

  return lines.join("\n");
}

async function buildDataInventorySummary() {
  const entries = await fsPromises.readdir(dataDirectory, { withFileTypes: true }).catch(() => []);
  const lines = [
    "### Data inventory an toàn",
    "Các file data được tóm tắt ở mức metadata; không đưa raw value, khóa riêng, password hash hoặc số nguyên tố đầy đủ vào prompt.",
  ];

  for (const entry of entries.filter((item) => item.isFile()).sort((left, right) => left.name.localeCompare(right.name))) {
    const filePath = path.join(dataDirectory, entry.name);
    const stats = await fsPromises.stat(filePath).catch(() => null);
    const sizeText = stats ? `${stats.size} bytes` : "không rõ kích thước";

    if (path.extname(entry.name).toLowerCase() === ".json") {
      lines.push(`- ${entry.name}: ${sizeText}; ${await summarizeJsonFileMetadata(filePath)}.`);
    } else {
      lines.push(`- ${entry.name}: ${sizeText}; file phụ trợ, chỉ dùng metadata.`);
    }
  }

  return lines.join("\n");
}

async function buildUserDataContext(options = {}) {
  const { userEmail, fullName } = normalizeChatUserOptions(options);
  if (!userEmail) {
    return "Chưa có token đăng nhập trong request chat, nên PET chỉ dùng ngữ cảnh chung của ứng dụng và không đọc metadata theo người dùng.";
  }

  const sections = [
    `Current account: ${fullName ? `${fullName} ` : ""}<${userEmail}>.`,
    "Only use records whose user field matches this account. Do not mix in data from any other account.",
    "Token đăng nhập hợp lệ đã được nhận. Dưới đây chỉ là metadata đã redact của dữ liệu thuộc người dùng hiện tại.",
  ];

  for (const item of USER_DATA_FILES) {
    const records = await readJsonArray(path.join(dataDirectory, item.fileName));
    const userRecords = records.filter((record) => String(record?.user || "").trim().toLowerCase() === userEmail);
    sections.push(summarizeUserRecords(item.label, userRecords));
  }

  return truncateText(sections.join("\n"), MAX_USER_CONTEXT_CHARS);
}

function normalizeChatUserOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const nestedUser = source.user && typeof source.user === "object" ? source.user : {};

  return {
    userEmail: String(source.userEmail || source.email || nestedUser.email || "").trim().toLowerCase(),
    fullName: String(source.fullName || source.name || nestedUser.fullName || nestedUser.name || "").trim(),
  };
}

function summarizeUserRecords(label, records) {
  const recentRecords = records.slice(0, 5).map((record) => sanitizeForPrompt(record));
  const counts = summarizeRecordCounts(records);
  const latestRecord = records[0];
  const latestTimestamp = latestRecord?.createdAt || latestRecord?.updatedAt || latestRecord?.timestamp || "";
  return [
    `- ${label}: ${records.length} bản ghi của người dùng hiện tại.`,
    `  Phan loai: ${counts || "khong co ban ghi"}.`,
    latestTimestamp ? `  Moi nhat: ${latestTimestamp}.` : "  Chua co moc thoi gian moi nhat.",
    recentRecords.length
      ? `  Gần đây (đã redact): ${JSON.stringify(recentRecords)}`
      : "  Chưa có bản ghi gần đây.",
  ].join("\n");
}

function summarizeRecordCounts(records) {
  const counts = new Map();

  for (const record of records) {
    const key = String(record?.action || record?.type || record?.operation || record?.method || "record").trim() || "record";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([key, count]) => `${key}: ${count}`)
    .join(", ");
}

function sanitizeForPrompt(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 120)}...` : value;
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (depth >= 3) {
    return "{...}";
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    if (!isPromptSafeField(key) && typeof item !== "object") {
      continue;
    }
    result[key] = sanitizeForPrompt(item, depth + 1);
  }
  return result;
}

function isPromptSafeField(key) {
  return /^(id|user|type|action|operation|method|selectedMethod|algorithm|proofMethod|certificateType|certificateDepth|primality|bits|requiredBits|rounds|requestedRounds|maxAttempts|attempts|elapsedSeconds|createdAt|updatedAt|timestamp|status|result|valid|hashAlgorithm|summary|input|payload|keyPair|publicKey|modulusBits|primeBits|publicExponent)$/i.test(key);
}

async function summarizeJsonFileMetadata(filePath) {
  const data = await readJsonValue(filePath, null);
  if (Array.isArray(data)) {
    const keys = collectKeys(data.slice(0, 20));
    return `JSON array ${data.length} bản ghi; fields mẫu: ${keys.join(", ") || "không rõ"}`;
  }
  if (data && typeof data === "object") {
    return `JSON object; fields: ${Object.keys(data).join(", ") || "không rõ"}`;
  }
  return "không đọc được JSON hoặc file rỗng";
}

function collectKeys(values) {
  const keys = new Set();
  for (const value of values) {
    collectKeysFromValue(value, keys, 0);
  }
  return Array.from(keys).slice(0, 40);
}

function collectKeysFromValue(value, keys, depth) {
  if (!value || typeof value !== "object" || depth > 2) {
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item) => collectKeysFromValue(item, keys, depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectKeysFromValue(item, keys, depth + 1);
  }
}

async function readJsonArray(filePath) {
  const data = await readJsonValue(filePath, []);
  return Array.isArray(data) ? data : [];
}

async function readJsonValue(filePath, fallback) {
  try {
    const rawText = await fsPromises.readFile(filePath, "utf8");
    if (!rawText.trim()) return fallback;
    return JSON.parse(rawText);
  } catch {
    return fallback;
  }
}

async function readProjectText(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  try {
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(projectRoot)) {
      return "";
    }
    return await fsPromises.readFile(resolvedPath, "utf8");
  } catch {
    return "";
  }
}

function extractConstantValue(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  return match ? match[1].trim().replace(/^["'`]|["'`]$/g, "") : null;
}

function extractModuleExports(source) {
  const match = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => /^[A-Za-z0-9_]+/.test(line))
    .map((line) => line.split(":")[0].trim());
}

function truncateText(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 80))}\n...(đã rút gọn để giữ prompt gọn)...`;
}

function buildTrainingTopicFallback(files) {
  return [
    "### Tóm tắt chủ đề từ folder AI data training",
    `Các file được phát hiện: ${files.join("; ") || "không có"}.`,
    "Nội dung trọng tâm cần ưu tiên khi trả lời:",
    "- Cơ sở toán học của an toàn thông tin: số nguyên tố, đồng dư, ước chung lớn nhất, nghịch đảo modulo, lũy thừa modulo.",
    "- Hệ mật khóa công khai RSA: chọn p và q, tính n = p*q, phi(n) = (p-1)(q-1), chọn e sao cho gcd(e, phi(n)) = 1, tính d = e^-1 mod phi(n).",
    "- Mã hóa RSA: c = m^e mod n với khóa công khai (n, e).",
    "- Giải mã RSA: m = c^d mod n với khóa mật d.",
    "- Chữ ký số RSA: ký bằng d, xác minh bằng e.",
    "- Kiểm tra số nguyên tố và Miller-Rabin: giải thích theo hướng trực quan, phù hợp website PrimeLab.",
  ].join("\n");
}

async function readTrainingFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    const buffer = await fsPromises.readFile(filePath);
    return extractTextFromPdfBuffer(buffer);
  }

  return await fsPromises.readFile(filePath, "utf8");
}

function extractTextFromPdfBuffer(buffer) {
  const raw = buffer.toString("latin1");
  const streams = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamPattern.exec(raw)) !== null) {
    const dictionary = match[1];
    const streamBody = Buffer.from(match[2], "latin1");
    const decoded = dictionary.includes("/FlateDecode")
      ? inflatePdfStream(streamBody)
      : streamBody.toString("latin1");

    if (decoded) {
      streams.push(decoded);
    }
  }

  const sourceText = streams.length > 0 ? streams.join("\n") : raw;
  return [
    ...extractParenthesizedPdfStrings(sourceText),
    ...extractHexPdfStrings(sourceText),
  ].join(" ");
}

function inflatePdfStream(streamBody) {
  try {
    return zlib.inflateSync(streamBody).toString("utf8");
  } catch {
    try {
      return zlib.inflateRawSync(streamBody).toString("utf8");
    } catch {
      return "";
    }
  }
}

function extractParenthesizedPdfStrings(text) {
  const values = [];
  const pattern = /\((?:\\.|[^\\)]){2,}\)/g;
  const matches = text.match(pattern) || [];

  for (const item of matches) {
    values.push(
      item
        .slice(1, -1)
        .replace(/\\([()\\])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t"),
    );
  }

  return values;
}

function extractHexPdfStrings(text) {
  const values = [];
  const pattern = /<([0-9a-fA-F]{8,})>/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const hex = match[1];
    if (hex.length % 4 !== 0) continue;

    const buffer = Buffer.from(hex, "hex");
    const decoded = hex.startsWith("feff") || hex.startsWith("FEFF")
      ? decodeUtf16BigEndian(buffer.subarray(2))
      : buffer.toString("utf8");
    if (decoded.trim()) {
      values.push(decoded);
    }
  }

  return values;
}

function decodeUtf16BigEndian(buffer) {
  const swapped = Buffer.alloc(buffer.length);
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString("utf16le");
}

function normalizeExtractedText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

module.exports = {
  buildChatSystemPrompt,
  loadPrimeLabAppContext,
  loadTrainingKnowledge,
};
