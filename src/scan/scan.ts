import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { languageFor } from "../lang/languages.js";
import { INDEX_VERSION, type FileFacts, type Index } from "../types.js";
import { createParser } from "./pool.js";
import { readManifests } from "./project.js";
import { createResolver } from "./resolve.js";
import { churn, gitInfo, listFiles } from "./walk.js";

const MAX_BYTES = 1_000_000;

export interface ScanOptions {
  /** Called with progress, e.g. for a spinner. */
  onProgress?(done: number, total: number): void;
  /** Ignore the previous index and parse every file again. */
  full?: boolean;
  /** Only these directories (repo-relative), for one corner of a big monorepo. Kept for later scans. */
  only?: string[];
  /** Parser threads; default: one per core, up to 8. 1 parses on the main thread. */
  workers?: number;
}

export const indexPath = (root: string) => join(root, ".spelunk", "index.jsonl");

/**
 * The index is JSON Lines: a header, then one line per file. Writing and
 * reading it line by line keeps memory flat and avoids the ~512 MB limit on a
 * single JS string, which a monorepo with 100k files would otherwise hit.
 */
export async function loadIndex(root: string): Promise<Index | undefined> {
  try {
    const lines = createInterface({ input: createReadStream(indexPath(root)), crlfDelay: Infinity });
    let header: Omit<Index, "files"> | undefined;
    const files: FileFacts[] = [];
    for await (const line of lines) {
      if (!line) continue;
      if (!header) {
        header = JSON.parse(line) as Omit<Index, "files">;
        if (header.version !== INDEX_VERSION) return undefined;
      } else files.push(JSON.parse(line) as FileFacts);
    }
    return header ? { ...header, files } : undefined;
  } catch {
    return undefined;
  }
}

export async function saveIndex(index: Index): Promise<string> {
  const path = indexPath(index.root);
  await mkdir(join(index.root, ".spelunk"), { recursive: true });
  const tmp = `${path}.tmp`;
  const out = createWriteStream(tmp);
  const write = async (s: string) => {
    if (!out.write(s)) await once(out, "drain");
  };
  const { files, ...header } = index;
  await write(`${JSON.stringify(header)}\n`);
  for (const f of files) await write(`${JSON.stringify(f)}\n`);
  out.end();
  await once(out, "finish");
  await rename(tmp, path); // a reader never sees half an index
  // Keep the index out of the user's commits without touching their .gitignore.
  await writeFile(join(index.root, ".spelunk", ".gitignore"), "*\n");
  return path;
}

/** Reads the repository into an Index. Unchanged files (same hash) are reused from the last scan. */
export async function scan(rootArg: string, options: ScanOptions = {}): Promise<Index> {
  const root = resolve(rootArg);
  const git = await gitInfo(root);
  const previous = options.full ? undefined : await loadIndex(root);
  const prevByPath = new Map(previous?.files.map((f) => [f.path, f]));
  const only = (options.only ?? previous?.only ?? []).map((d) => d.replace(/^\.\/|\/+$/g, "")).filter(Boolean);
  const inScope = (p: string) => !only.length || only.some((d) => p === d || p.startsWith(`${d}/`));
  const allPaths = await listFiles(root, git);
  // Manifests and import resolution still see the whole repo, so imports out of the scoped folders resolve.
  const paths = allPaths.filter(inScope);

  const skipped: Index["skipped"] = [];
  const slots: (FileFacts | undefined)[] = new Array(paths.length);
  const parser = createParser(previous ? Math.max(0, paths.length - prevByPath.size) : paths.length, options.workers);
  let done = 0;
  const work = async (i: number) => {
    const path = paths[i]!;
    if (!languageFor(path)) {
      skipped.push({ path, reason: "unknown language" });
      return;
    }
    let buf: Buffer;
    try {
      buf = await readFile(join(root, path));
    } catch {
      return; // deleted since git listed it
    }
    if (buf.length > MAX_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_BYTES / 1_000_000} MB` });
      return;
    }
    if (buf.subarray(0, 8000).includes(0)) {
      skipped.push({ path, reason: "binary" });
      return;
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    const prev = prevByPath.get(path);
    slots[i] = prev && prev.hash === hash ? prev : await parser.parse(path, buf.toString("utf8"), hash);
  };
  try {
    // A bounded number of files in flight: enough to keep every parser busy without holding the repo in memory.
    let cursor = 0;
    const lanes = Array.from({ length: 64 }, async () => {
      while (cursor < paths.length) {
        await work(cursor++);
        options.onProgress?.(++done, paths.length);
      }
    });
    await Promise.all(lanes);
  } finally {
    await parser.close();
  }
  const files = slots.filter((f): f is FileFacts => Boolean(f));
  skipped.sort((a, b) => a.path.localeCompare(b.path));

  // Resolution depends on the whole file set, so it runs every time.
  const manifests = await readManifests(root, allPaths);
  const resolver = await createResolver(root, allPaths, manifests);
  for (const f of files) {
    f.imports = f.imports.map((imp) => {
      const { targets, external } = resolver.resolve(f.path, f.language, imp);
      const { external: _old, ...rest } = imp;
      return { ...rest, targets: targets.filter((t) => t !== f.path), ...(external ? { external } : {}) };
    });
  }
  // package.json "bin" and Python console scripts mark entry points too.
  for (const m of manifests) {
    for (const c of m.commands.filter((c) => c.name.startsWith("bin "))) {
      const bin = posix.normalize(posix.join(posix.dirname(m.path), c.command));
      const candidates = [bin, bin.replace(/^(.*\/)?(dist|build|lib)\//, "$1src/").replace(/\.[cm]?js$/, ".ts")];
      const target = files.find((f) => candidates.includes(f.path));
      if (target && !target.entry) target.entry = c.name;
    }
  }

  return {
    version: INDEX_VERSION,
    root,
    scannedAt: new Date().toISOString(),
    ...(git.head ? { commit: git.head } : {}),
    ...(git.remote ? { remote: git.remote } : {}),
    ...(only.length ? { only } : {}),
    files,
    manifests,
    churn: await churn(root, git),
    skipped,
  };
}
