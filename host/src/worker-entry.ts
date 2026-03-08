// host/src/worker-entry.ts
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) {
  throw new Error("worker-entry.ts must be run as a worker thread");
}

// Full implementation in Task 4
parentPort.postMessage({ type: "error", pid: 0, message: "not yet implemented" });
