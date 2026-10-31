import type { Graph } from "../analysis/graph.js";
import type { Report } from "./model.js";

/**
 * One part of the map and only its neighbours: what uses it, what it uses,
 * how strongly (file-import counts), and which files make each link. This is
 * the "focus" view; the full diagram is too busy to read link by link.
 */

export interface FocusLink {
  path: string;
  /** Files in one part importing files in the other. */
  weight: number;
  /** [importer, imported] file pairs behind the link, most-used first. */
  files: [string, string][];
  /** Summary of the neighbour, from Claude's explanation or its files' comments. */
  about?: string;
  fileCount: number;
}

export interface Focus {
  path: string;
  about?: string;
  fileCount: number;
  lines: number;
  usedBy: FocusLink[];
  uses: FocusLink[];
  /** Files in this part ranked by how many other files import them. */
  readFirst: { path: string; usedBy: number; doc?: string }[];
  /** Neighbours that are both used by and using this part: an import cycle between parts. */
  cycles: string[];
}

type Mod = Report["modules"][number];

export const aboutModule = (m: Mod): string | undefined => {
  const doc = m.explanation?.summary ?? m.files.find((f) => f.doc)?.doc;
  return doc ? (doc.length > 140 ? `${doc.slice(0, 139)}…` : doc) : undefined;
};

export function focus(mods: Report["modules"], g: Graph, path: string): Focus | undefined {
  const m = mods.find((x) => x.path === path);
  if (!m) return undefined;
  const owner = new Map<string, string>();
  for (const x of mods) for (const f of x.files) owner.set(f.path, x.path);
  const byPath = new Map(mods.map((x) => [x.path, x]));

  const links = (dir: "uses" | "usedBy"): FocusLink[] => {
    const pairs = new Map<string, [string, string][]>();
    for (const f of m.files) {
      const edges = dir === "uses" ? g.out.get(f.path) : g.in.get(f.path);
      for (const other of edges ?? []) {
        const o = owner.get(other);
        if (o === undefined || o === m.path) continue;
        const pair: [string, string] = dir === "uses" ? [f.path, other] : [other, f.path];
        (pairs.get(o) ?? pairs.set(o, []).get(o)!).push(pair);
      }
    }
    return [...pairs]
      .map(([p, files]) => {
        const n = byPath.get(p)!;
        const about = aboutModule(n);
        const hits = new Map<string, number>();
        for (const [, to] of files) hits.set(to, (hits.get(to) ?? 0) + 1);
        return { path: p, weight: files.length, files: files.sort((a, b) => (hits.get(b[1]) ?? 0) - (hits.get(a[1]) ?? 0) || a[0].localeCompare(b[0])).slice(0, 40), fileCount: n.files.length, ...(about ? { about } : {}) };
      })
      .sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
  };

  const uses = links("uses");
  const usedBy = links("usedBy");
  const usesSet = new Set(uses.map((x) => x.path));
  const about = aboutModule(m);
  return {
    path: m.path,
    ...(about ? { about } : {}),
    fileCount: m.files.length,
    lines: m.lines,
    uses,
    usedBy,
    readFirst: [...m.files]
      .sort((a, b) => b.usedBy - a.usedBy || b.lines - a.lines)
      .slice(0, 5)
      .map((f) => ({ path: f.path, usedBy: f.usedBy, ...(f.doc ? { doc: f.doc } : {}) })),
    cycles: usedBy.filter((x) => usesSet.has(x.path)).map((x) => x.path),
  };
}

/** Top-level areas for filtering the map: the package a part belongs to, or its first folder. */
export function areaOf(m: Pick<Mod, "path" | "owner">): string {
  if (m.owner && m.owner.includes("/")) return m.owner.slice(0, m.owner.lastIndexOf("/"));
  const parts = m.path.split("/").filter(Boolean);
  if (!parts.length) return "(root)";
  // apps/web, packages/core, services/billing: the second level is the area.
  return /^(apps|packages|services|libs|modules|crates|cmd|internal|plugins|projects)$/.test(parts[0]!) && parts[1] ? `${parts[0]}/${parts[1]}` : parts[0]!;
}
