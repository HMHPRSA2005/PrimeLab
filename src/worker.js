const { parentPort, workerData } = require("worker_threads");
const { checkPrime, generatePrime } = require("./prime");
const { generateRsaKeyPair, factorizeRSA } = require("./rsa");

function runTask(task) {
  const type = task.type || task.action;
  const payload = task.payload || task;
  let result;

  switch (type) {
    case "generate-prime":
    case "prime.search":
      result = generatePrime({
        bits: payload.bits,
        method: payload.method,
        rounds: payload.rounds,
        maxAttempts: payload.maxAttempts,
      });
      break;
    case "prime.check":
      result = checkPrime(payload.number, payload.rounds, payload.method);
      break;
    case "rsa.keygen":
      result = generateRsaKeyPair(payload.primeBits, payload.rounds, payload.publicExponent);
      break;
    case "rsa.factorize":
      result = factorizeRSA(payload.n);
      break;
    default:
      throw new Error(`Unknown task type: ${type}`);
  }

  return result;
}

function postResult(task, closeAfterPost = false) {
  try {
    const result = runTask(task);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message });
  }

  if (closeAfterPost) {
    parentPort.close();
  }
}

if (workerData && (workerData.type || workerData.action)) {
  postResult(workerData, true);
} else {
  parentPort.on("message", postResult);
}
