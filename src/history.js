const crypto = require("crypto");
const {
  historyFilePath,
  nowIso,
  readJsonFileAsync,
  saveJsonFileAsync,
  toJsonBigInt,
  withLock,
} = require("./utils");

async function getHistoryRecords() {
  return await readJsonFileAsync(historyFilePath, []);
}

async function addHistoryRecord(action, status, summary, payload = {}, user = "") {
  let record;
  await withLock(historyFilePath, async () => {
    const records = await getHistoryRecords();
    record = {
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      user,
      action,
      status,
      summary,
      payload: toJsonBigInt(payload),
    };

    records.unshift(record);
    await saveJsonFileAsync(historyFilePath, records);
  });
  return record;
}

async function deleteHistoryRecord(id, user = "") {
  let deleted = false;
  await withLock(historyFilePath, async () => {
    const records = await getHistoryRecords();
    const nextRecords = records.filter((record) => !(record.id === id && record.user === user));

    if (nextRecords.length === records.length) {
      deleted = false;
      return;
    }

    await saveJsonFileAsync(historyFilePath, nextRecords);
    deleted = true;
  });
  return deleted;
}

async function exportHistory(format = "json", user = "") {
  let records = await getHistoryRecords();
  records = records.filter((r) => r.user === user);

  if (format === "txt") {
    return records.map((record) => {
      return [
        `id=${record.id}`,
        `createdAt=${record.createdAt}`,
        `action=${record.action}`,
        `status=${record.status}`,
        `summary=${record.summary}`,
        `payload=${JSON.stringify(record.payload)}`,
      ].join("\n");
    }).join("\n\n");
  }

  return JSON.stringify(records, null, 2);
}

module.exports = {
  addHistoryRecord,
  deleteHistoryRecord,
  exportHistory,
  getHistoryRecords,
};
