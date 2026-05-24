const fsPromises = require("fs").promises;
const path = require("path");
const zlib = require("zlib");

const trainingDirectory = path.join(__dirname, "..", "AI data training");
const MAX_CONTEXT_CHARS = Number(process.env.CHAT_TRAINING_CONTEXT_CHARS || 50_000);
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json", ".pdf"]);

let cachedKnowledge = null;

async function buildChatSystemPrompt() {
  const knowledge = await loadTrainingKnowledge();
  return [
    "Bạn là trợ lý ảo chuyên gia về Toán học và Mật mã học trên website PrimeLab.",
    "Nhiệm vụ của bạn đọc các file trong folder tài liệu, suy nghĩ và giải thích trực quan, dễ hiểu các khái niệm về số nguyên tố lớn, thuật toán kiểm tra số nguyên tố (Miller-Rabin), cách sinh khóa RSA, mã hóa và giải mã.",
    "Hãy trả lời ngắn gọn, sử dụng markdown để định dạng công thức toán học cho đẹp mắt.",
    "Không bọc công thức bằng ký hiệu LaTeX $...$, $$...$$, \\(...\\) hoặc \\[...\\] vì giao diện chat không render MathJax. Hãy viết công thức trực tiếp, ví dụ: n = p * q, c = m^e mod n.",
    "Nếu người dùng hỏi các vấn đề ngoài mật mã và toán học, hãy khéo léo từ chối và hướng họ quay lại chủ đề.",
    "Quy ước RSA trên website: khóa công khai là (n, e), khóa mật là d.",
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
  loadTrainingKnowledge,
};
