import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
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
  const listed = await listFiles(root, git);
  const allPaths = listed.files;
  // Manifests and import resolution still see the whole repo, so imports out of the scoped folders resolve.
  const paths = allPaths.filter(inScope);

  const skipped: Index["skipped"] = [...listed.skipped];
  // mtime and size only prove a file unchanged when it was last written before the previous scan began (git's "racy" rule).
  const trustStat = previous ? Date.parse(previous.scannedAt) - 2000 : 0;
  const started = new Date().toISOString();
  const slots: (FileFacts | undefined)[] = new Array(paths.length);
  const parser = createParser(previous ? Math.max(0, paths.length - prevByPath.size) : paths.length, options.workers);
  let done = 0;
  // A symlinked folder inside the repo (src/vendor -> /etc) passes the lstat check on each file, so each folder's real path is checked too.
  const realRoot = await realpath(root).catch(() => root);
  const realDirs = new Map<string, Promise<boolean>>();
  const insideRepo = (dir: string) => {
    let hit = realDirs.get(dir);
    if (!hit) {
      hit = realpath(join(root, dir)).then((r) => r === realRoot || r.startsWith(realRoot + sep), () => false);
      realDirs.set(dir, hit);
    }
    return hit;
  };
  const work = async (i: number) => {
    const path = paths[i]!;
    if (!languageFor(path)) {
      skipped.push({ path, reason: "unknown language" });
      return;
    }
    const abs = join(root, path);
    const st = await lstat(abs).catch(() => undefined);
    if (!st) return; // deleted since git listed it
    // A symlink can point anywhere on the machine; its target is read only if it's itself part of the repo.
    if (st.isSymbolicLink()) {
      skipped.push({ path, reason: "symbolic link" });
      return;
    }
    if (!st.isFile()) return;
    if (!(await insideRepo(dirname(path)))) {
      skipped.push({ path, reason: "inside a symbolic link that leads out of the repository" });
      return;
    }
    const prev = prevByPath.get(path);
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs && st.mtimeMs < trustStat) {
      slots[i] = prev;
      return;
    }
    let buf: Buffer;
    try {
      buf = await readFile(abs);
    } catch {
      return;
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
    const facts = prev && prev.hash === hash ? prev : await parser.parse(path, buf.toString("utf8"), hash);
    slots[i] = { ...facts, size: st.size, mtime: st.mtimeMs };
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
  // moleculer-runner loads services by convention: `moleculer-runner services` starts every *.service.js under services/.
  for (const m of manifests) {
    for (const c of m.commands) {
      const run = c.command.match(/\bmoleculer-runner\b(.*)/);
      if (!run) continue;
      const base = posix.dirname(m.path) === "." ? "" : `${posix.dirname(m.path)}/`;
      const dirs = run[1]!.split(/\s+/).filter((a) => a && !a.startsWith("-") && !/[&|;]/.test(a)).map((a) => base + a.replace(/^\.\/|\/+$/g, ""));
      for (const f of files) {
        if (f.entry || f.role === "test") continue;
        const loaded = /\.service\.[cm]?[jt]s$/.test(f.path) && (!dirs.length || dirs.some((d) => f.path.startsWith(`${d}/`) || f.path === d));
        if (loaded) f.entry = `moleculer service (${c.name})`;
        else if (/(^|\/)moleculer\.config\.[cm]?[jt]s$/.test(f.path)) f.entry = `moleculer config (${c.name})`;
      }
    }
  }

  return {
    version: INDEX_VERSION,
    root,
    scannedAt: started,
    ...(git.head ? { commit: git.head } : {}),
    ...(git.remote ? { remote: git.remote } : {}),
    ...(only.length ? { only } : {}),
    files,
    manifests,
    churn: await churn(root, git),
    skipped,
  };
}
