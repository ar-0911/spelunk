import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { FileFacts } from "../types.js";
import { factsFor } from "./facts.js";

/**
 * Parses files on every core. Tree-sitter is CPU-bound, so on a big repo this
 * is most of the scan; small jobs stay on the main thread, where starting
 * workers would cost more than it saves.
 */

export interface Parser {
  parse(path: string, source: string, hash: string): Promise<FileFacts>;
  close(): Promise<void>;
}

export function createParser(expectedFiles: number, workers?: number): Parser {
  const count = workers ?? Math.min(Math.max(availableParallelism() - 1, 1), 8);
  if (count < 2 || expectedFiles < 300) return { parse: factsFor, close: async () => undefined };

  // Under tsx (development) the worker is the .ts file and needs tsx's loader registered in its thread too.
  const dev = import.meta.url.endsWith(".ts");
  const script = new URL(dev ? "./worker.ts" : "./worker.js", import.meta.url);
  const url = dev
    ? new URL(`data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))}; register(); await import(${JSON.stringify(script.href)});`)}`)
    : script;
  const pending = new Map<number, { resolve(f: FileFacts): void; reject(e: Error): void; job: { path: string; source: string; hash: string } }>();
  const load = new Map<Worker, number>();
  let next = 0;

  const pool = Array.from({ length: count }, () => {
    const w = new Worker(url);
    load.set(w, 0);
    w.on("message", (m: { id: number; facts?: FileFacts; error?: string }) => {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      load.set(w, load.get(w)! - 1);
      if (m.facts) p.resolve(m.facts);
      // A file that crashed the worker's parser still gets line-based facts from the main thread.
      else factsFor(p.job.path, p.job.source, p.job.hash).then(p.resolve, p.reject);
    });
    w.on("error", (err) => {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
    return w;
  });

  return {
    parse(path, source, hash) {
      const id = next++;
      // Least-loaded worker: big files don't pile up behind each other.
      const w = pool.reduce((a, b) => (load.get(b)! < load.get(a)! ? b : a));
      load.set(w, load.get(w)! + 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, job: { path, source, hash } });
        w.postMessage({ id, path, source, hash });
      });
    },
    async close() {
      await Promise.all(pool.map((w) => w.terminate()));
    },
  };
}
