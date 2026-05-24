const { parentPort, workerData } = require('worker_threads');
const { checkPrime, findPrime } = require('./prime');
const { generateRsaKeyPair, factorizeRSA } = require('./rsa');

const { type, payload } = workerData;

try {
  let result;
  switch (type) {
    case 'prime.search':
      result = findPrime(payload.bits, payload.rounds, payload.maxAttempts, payload.method);
      break;
    case 'prime.check':
      result = checkPrime(payload.number, payload.rounds, payload.method);
      break;
    case 'rsa.keygen':
      result = generateRsaKeyPair(payload.primeBits, payload.rounds, payload.publicExponent);
      break;
    case 'rsa.factorize':
      result = factorizeRSA(payload.n);
      break;
    default:
      throw new Error(`Unknown task type: ${type}`);
  }
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
