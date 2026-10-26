import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { extract } from "../lang/extract.js";
import { languageFor } from "../lang/languages.js";
import { parse } from "../lang/parser.js";
import { INDEX_VERSION, type FileFacts, type Index } from "../types.js";
import { detectLines, roleFor } from "./detect.js";
import { readManifests } from "./project.js";
import { createResolver } from "./resolve.js";
import { churn, gitInfo, listFiles } from "./walk.js";

const MAX_BYTES = 1_000_000;

export interface ScanOptions {
  /** Called with progress, e.g. for a spinner. */
  onProgress?(done: number, total: number): void;
  /** Ignore the previous index and parse every file again. */
  full?: boolean;
}

export const indexPath = (root: string) => join(root, ".spelunk", "index.json");

export async function loadIndex(root: string): Promise<Index | undefined> {
  try {
    const index = JSON.parse(await readFile(indexPath(root), "utf8")) as Index;
    return index.version === INDEX_VERSION ? index : undefined;
  } catch {
    return undefined;
  }
}

export async function saveIndex(index: Index): Promise<string> {
  const path = indexPath(index.root);
  await mkdir(join(index.root, ".spelunk"), { recursive: true });
  await writeFile(path, JSON.stringify(index));
  // Keep the index out of the user's commits without touching their .gitignore.
  await writeFile(join(index.root, ".spelunk", ".gitignore"), "*\n");
  return path;
}

async function factsFor(path: string, source: string, hash: string): Promise<FileFacts> {
  const def = languageFor(path)!;
  const head = source.slice(0, 2000);
  const role = roleFor(path, def.id, head);
  const lineFacts = detectLines(path, def.id, source, def.lineComment);
  const base: FileFacts = {
    path,
    language: def.id,
    role,
    hash,
    bytes: Buffer.byteLength(source),
    lines: source.split("\n").length,
    symbols: [],
    imports: [],
    calls: [],
    callSites: [],
    swallowed: [],
    ...lineFacts,
  };
  if (!def.grammar || role === "generated") return base;
  const tree = await parse(def.grammar, source);
  if (!tree) return base;
  try {
    const t = extract(tree, def.id);
    return {
      ...base,
      symbols: t.symbols,
      imports: t.imports.map((i) => ({ ...i, targets: [] })),
      calls: t.calls,
      callSites: t.callSites,
      swallowed: t.swallowed,
      ...(t.doc ? { doc: t.doc } : {}),
      ...(t.parseErrors ? { parseErrors: t.parseErrors } : {}),
    };
  } finally {
    tree.delete();
  }
}

/** Reads the repository into an Index. Unchanged files (same hash) are reused from the last scan. */
export async function scan(rootArg: string, options: ScanOptions = {}): Promise<Index> {
  const root = resolve(rootArg);
  const git = await gitInfo(root);
  const previous = options.full ? undefined : await loadIndex(root);
  const prevByPath = new Map(previous?.files.map((f) => [f.path, f]));
  const paths = await listFiles(root, git);

  const files: FileFacts[] = [];
  const skipped: Index["skipped"] = [];
  let done = 0;
  for (const path of paths) {
    options.onProgress?.(++done, paths.length);
    if (!languageFor(path)) {
      skipped.push({ path, reason: "unknown language" });
      continue;
    }
    let buf: Buffer;
    try {
      buf = await readFile(join(root, path));
    } catch {
      continue; // deleted since git listed it
    }
    if (buf.length > MAX_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_BYTES / 1_000_000} MB` });
      continue;
    }
    if (buf.subarray(0, 8000).includes(0)) {
      skipped.push({ path, reason: "binary" });
      continue;
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    const prev = prevByPath.get(path);
    if (prev && prev.hash === hash) {
      files.push(prev);
      continue;
    }
    files.push(await factsFor(path, buf.toString("utf8"), hash));
  }

  // Resolution depends on the whole file set, so it runs every time.
  const manifests = await readManifests(root, paths);
  const resolver = await createResolver(root, paths, manifests);
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
    files,
    manifests,
    churn: await churn(root, git),
    skipped,
  };
}
