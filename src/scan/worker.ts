import { parentPort } from "node:worker_threads";
import { factsFor } from "./facts.js";

/** Parses files sent by the scanner's pool, one message per file. */
parentPort?.on("message", async (job: { id: number; path: string; source: string; hash: string }) => {
  try {
    parentPort!.postMessage({ id: job.id, facts: await factsFor(job.path, job.source, job.hash) });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
