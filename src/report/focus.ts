import type { Graph } from "../analysis/graph.js";
import type { Index } from "../types.js";
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

/**
 * Moleculer apps keep every service in one folder and talk through the broker
 * (`ctx.call("users.get")`), so the folder map shows one box. This map has a
 * box per service and an arrow per service it calls or emits events to.
 * Undefined when the repository has fewer than two services.
 */
export function serviceMap(index: Index): { mods: Report["modules"]; pairs: Map<string, [string, string][]> } | undefined {
  const serviceOfFile = new Map<string, string>();
  const handlers = new Map<string, string[]>(); // "evt:user.created" → services handling it
  for (const f of index.files) {
    for (const s of f.symbols) {
      if (!s.broker || !s.parent) continue;
      serviceOfFile.set(f.path, s.parent);
      if (s.broker === "event") handlers.set(`evt:${s.name}`, [...(handlers.get(`evt:${s.name}`) ?? []), s.parent]);
    }
  }
  const named = new Set(serviceOfFile.values());
  if (named.size < 2) return undefined;
  // A gateway or caller with no actions of its own is named after its file: api.service.js → "api".
  const nameOf = (path: string) => serviceOfFile.get(path) ?? path.split("/").pop()!.replace(/\.service\.[cm]?[jt]s$|\.[cm]?[jt]s$/, "");
  const pairs = new Map<string, [string, string][]>();
  const fileOfService = new Map<string, string>([...serviceOfFile].map(([p, s]) => [s, p]));
  /** Pairs here are [call site "path:line", what it calls: "users.get" or the event name]. */
  const link = (from: string, to: string, at: string, what: string) => {
    if (from === to || !fileOfService.has(to)) return;
    const k = `${from}\0${to}`;
    (pairs.get(k) ?? pairs.set(k, []).get(k)!).push([at, what]);
  };
  const callers = new Set<string>();
  for (const f of index.files) {
    if (f.role !== "source") continue;
    const refs = [...f.callSites.map(([r, line]) => [r, line] as const), ...f.routes.filter((r) => r.side === "server" && r.handler).map((r) => [r.handler!, r.line] as const)];
    for (const [ref, line] of refs) {
      const from = nameOf(f.path);
      if (ref.startsWith("svc:")) link(from, ref.slice(4, ref.lastIndexOf(".")), `${f.path}:${line}`, ref.slice(4));
      else if (ref.startsWith("evt:")) for (const to of handlers.get(ref) ?? []) link(from, to, `${f.path}:${line}`, `event ${ref.slice(4)}`);
      else continue;
      if (!fileOfService.has(from)) callers.add(f.path);
    }
  }
  const byName = new Map<string, Report["modules"][number]>();
  const node = (name: string, path: string) => {
    const f = index.files.find((x) => x.path === path)!;
    return byName.get(name) ?? byName.set(name, { path: name, lines: f.lines, files: [{ path, lines: f.lines, role: f.role, usedBy: 0, symbols: f.symbols.length, ...(f.doc ? { doc: f.doc } : {}) }], dependsOn: [] }).get(name)!;
  };
  for (const [name, path] of fileOfService) node(name, path);
  for (const path of callers) node(nameOf(path), path);
  for (const [k, list] of pairs) {
    const [from, to] = k.split("\0") as [string, string];
    byName.get(from)?.dependsOn.push({ path: to, weight: list.length });
  }
  return { mods: [...byName.values()].sort((a, b) => a.path.localeCompare(b.path)), pairs };
}

/** Focus on one service: who calls it through the broker and whom it calls, with the call sites. */
export function serviceFocus(index: Index, name: string): Focus | undefined {
  const map = serviceMap(index);
  const me = map?.mods.find((m) => m.path === name);
  if (!map || !me) return undefined;
  const byName = new Map(map.mods.map((m) => [m.path, m]));
  const links = (dir: "uses" | "usedBy"): FocusLink[] =>
    [...map.pairs]
      .filter(([k]) => (dir === "uses" ? k.startsWith(`${name}\0`) : k.endsWith(`\0${name}`)))
      .map(([k, files]) => {
        const other = dir === "uses" ? k.split("\0")[1]! : k.split("\0")[0]!;
        const n = byName.get(other)!;
        const about = aboutModule(n);
        return { path: other, weight: files.length, files: files.slice(0, 40), fileCount: n.files.length, ...(about ? { about } : {}) };
      })
      .sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
  const uses = links("uses");
  const usedBy = links("usedBy");
  const about = aboutModule(me);
  return {
    path: name,
    ...(about ? { about } : {}),
    fileCount: me.files.length,
    lines: me.lines,
    uses,
    usedBy,
    readFirst: me.files.map((f) => ({ path: f.path, usedBy: f.usedBy, ...(f.doc ? { doc: f.doc } : {}) })),
    cycles: usedBy.filter((x) => uses.some((u) => u.path === x.path)).map((x) => x.path),
  };
}
