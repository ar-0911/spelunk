import { posix } from "node:path";
import type { FileFacts, Index } from "../types.js";
import type { Graph } from "./graph.js";

/** A directory of related files, the unit the map and Claude explain. */
export interface Module {
  /** Directory path, "" for the repo root. */
  path: string;
  files: FileFacts[];
  /** Source lines (code files only). */
  lines: number;
  /** Manifest that owns this directory, e.g. "packages/core/package.json". */
  owner?: string;
  /** Modules this one imports from / is imported by, with file-edge counts. */
  dependsOn: Map<string, number>;
  usedBy: Map<string, number>;
}

const dirOf = (p: string) => (posix.dirname(p) === "." ? "" : posix.dirname(p));

/**
 * Groups files by directory. When there are more than `max` directories,
 * the deepest ones fold into their parents until the count fits, so a big
 * repo still yields a readable map.
 */
export function modules(index: Index, g: Graph, options: { max?: number; roles?: Set<string> } = {}): Module[] {
  const max = options.max ?? 60;
  const roles = options.roles ?? new Set(["source"]);
  const files = index.files.filter((f) => roles.has(f.role));
  const key = new Map<string, string>(files.map((f) => [f.path, dirOf(f.path)]));

  const count = () => new Set(key.values()).size;
  while (count() > max) {
    const dirs = [...new Set(key.values())];
    const deepest = Math.max(...dirs.map((d) => (d ? d.split("/").length : 0)));
    if (deepest === 0) break;
    for (const [f, d] of key) if (d && d.split("/").length === deepest) key.set(f, dirOf(d));
  }

  const ownerDirs = index.manifests
    .filter((m) => ["npm", "python", "go", "cargo", "maven", "gradle", "ruby"].includes(m.kind))
    .map((m) => ({ dir: dirOf(m.path), path: m.path }))
    .sort((a, b) => b.dir.length - a.dir.length);

  const byPath = new Map<string, Module>();
  for (const f of files) {
    const p = key.get(f.path)!;
    let m = byPath.get(p);
    if (!m) {
      const owner = ownerDirs.find((o) => o.dir === "" || p === o.dir || p.startsWith(`${o.dir}/`));
      m = { path: p, files: [], lines: 0, ...(owner ? { owner: owner.path } : {}), dependsOn: new Map(), usedBy: new Map() };
      byPath.set(p, m);
    }
    m.files.push(f);
    m.lines += f.lines;
  }
  for (const f of files) {
    const from = key.get(f.path)!;
    for (const t of g.out.get(f.path) ?? []) {
      const to = key.get(t);
      if (to === undefined || to === from) continue;
      const a = byPath.get(from)!;
      const b = byPath.get(to)!;
      a.dependsOn.set(to, (a.dependsOn.get(to) ?? 0) + 1);
      b.usedBy.set(from, (b.usedBy.get(from) ?? 0) + 1);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** Which module a file belongs to. */
export function moduleOf(mods: Module[], path: string): Module | undefined {
  return mods.find((m) => m.files.some((f) => f.path === path));
}
