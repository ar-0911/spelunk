import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Graph } from "../analysis/graph.js";
import { moduleOf, modules } from "../analysis/modules.js";
import { allRoutes } from "../analysis/routes.js";
import type { Risk } from "../analysis/risks.js";
import type { Index, SymbolInfo } from "../types.js";
import { resolveTarget, trace, type CallNode } from "./trace.js";

const run = promisify(execFile);

/**
 * "What does this change touch?" for a branch or PR: the functions it edits,
 * the files and modules that depend on them, the routes whose handlers reach
 * them, the tests to run, and the risks sitting in the changed lines.
 */

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  /** Changed line ranges in the new file. */
  ranges: [number, number][];
  symbols: SymbolInfo[];
  inIndex: boolean;
}

export interface Impact {
  base: string;
  head: string;
  files: ChangedFile[];
  /** Files that import a changed file, directly (depth 1) or through others. */
  dependents: { path: string; depth: number; via: string }[];
  modules: { path: string; changed: number; affected: number }[];
  routes: { method: string; path: string; file: string; line: number; reason: string }[];
  tests: { path: string; reason: string }[];
  /** Changed source files that no test reaches. */
  untested: string[];
  env: { name: string; path: string; line: number }[];
  risks: Risk[];
}

/** Parses `git diff --unified=0` into changed line ranges per file. */
export function parseDiff(diff: string): Omit<ChangedFile, "symbols" | "inIndex">[] {
  const files: Omit<ChangedFile, "symbols" | "inIndex">[] = [];
  let cur: Omit<ChangedFile, "symbols" | "inIndex"> | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      cur = { path: m?.[2] ?? "", status: "modified", ranges: [] };
      files.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("new file mode")) cur.status = "added";
    else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    else if (line.startsWith("rename to ")) {
      cur.status = "renamed";
      cur.path = line.slice("rename to ".length);
    } else if (line.startsWith("@@")) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        // A pure deletion (count 0) still touches the code around that point.
        cur.ranges.push(count === 0 ? [Math.max(1, start), Math.max(1, start)] : [start, start + count - 1]);
      }
    }
  }
  return files.filter((f) => f.path);
}

/** The base to compare with when none is given: the remote default branch, else main or master. */
export async function defaultBase(root: string): Promise<string> {
  const git = (args: string[]) => run("git", ["-C", root, ...args]).then((r) => r.stdout.trim(), () => "");
  const head = await git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head;
  for (const b of ["origin/main", "origin/master", "main", "master"]) if (await git(["rev-parse", "--verify", "--quiet", b])) return b;
  return "HEAD~1";
}

export async function gitDiff(root: string, base: string, options: { includeWorkingTree?: boolean } = {}): Promise<string> {
  if (base.startsWith("-")) throw new Error(`"${base}" isn't a branch or commit.`);
  // base...HEAD: only what this branch added since it split off, not what landed on base meanwhile.
  const args = ["-C", root, "diff", "--unified=0", "--no-color", "--find-renames", options.includeWorkingTree ? base : `${base}...HEAD`, "--"];
  try {
    return (await run("git", args, { maxBuffer: 256 * 1024 * 1024 })).stdout;
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(/unknown revision|bad revision|ambiguous argument/.test(msg) ? `Can't find "${base}" in this repository. Fetch it first, or name another branch.` : `git diff failed: ${msg.trim()}`);
  }
}

const overlaps = (s: SymbolInfo, ranges: [number, number][]) => ranges.some(([a, b]) => s.line <= b && s.endLine >= a);

function treeHas(nodes: CallNode[], keys: Set<string>): CallNode | undefined {
  for (const n of nodes) {
    if (keys.has(`${n.path}#${n.line}`)) return n;
    const deep = treeHas(n.children, keys);
    if (deep) return deep;
  }
  return undefined;
}

export function impact(index: Index, g: Graph, diff: string, risks: Risk[], refs: { base: string; head: string }): Impact {
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const files: ChangedFile[] = parseDiff(diff)
    .map((c) => {
      const f = byPath.get(c.path);
      const symbols = f && c.status !== "deleted" ? f.symbols.filter((s) => s.kind !== "interface" && s.kind !== "type" && (c.status === "added" || overlaps(s, c.ranges))) : [];
      return { ...c, symbols, inIndex: Boolean(f) };
    })
    // Code first (the files whose functions changed), then the rest, each in path order.
    .sort((a, b) => Number(!a.symbols.length) - Number(!b.symbols.length) || a.path.localeCompare(b.path));
  const changed = new Set(files.filter((f) => f.inIndex).map((f) => f.path));

  // Breadth-first over importers, up to three hops.
  const dependents: Impact["dependents"] = [];
  const seen = new Set(changed);
  let frontier = [...changed].map((p) => ({ path: p, via: p }));
  for (let depth = 1; depth <= 3 && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { path, via } of frontier) {
      for (const user of g.in.get(path) ?? []) {
        if (seen.has(user)) continue;
        seen.add(user);
        dependents.push({ path: user, depth, via });
        next.push({ path: user, via });
      }
    }
    frontier = next;
  }

  const mods = modules(index, g);
  const modCount = new Map<string, { changed: number; affected: number }>();
  for (const p of changed) {
    const m = moduleOf(mods, p);
    if (m) modCount.set(m.path, { changed: (modCount.get(m.path)?.changed ?? 0) + 1, affected: modCount.get(m.path)?.affected ?? 0 });
  }
  for (const d of dependents) {
    const m = moduleOf(mods, d.path);
    if (m) modCount.set(m.path, { changed: modCount.get(m.path)?.changed ?? 0, affected: (modCount.get(m.path)?.affected ?? 0) + 1 });
  }

  // Routes: defined in changed lines, or whose handler's call tree reaches a changed function.
  const changedKeys = new Set(files.flatMap((f) => f.symbols.map((s) => `${f.path}#${s.line}`)));
  const routes: Impact["routes"] = [];
  for (const r of allRoutes(index, "server").filter((r) => byPath.get(r.file)?.role === "source")) {
    const cf = files.find((f) => f.path === r.file);
    if (cf && (cf.status === "added" || cf.ranges.some(([a, b]) => r.line >= a && r.line <= b))) {
      routes.push({ method: r.method, path: r.path, file: r.file, line: r.line, reason: cf.status === "added" ? "new route" : "route definition changed" });
      continue;
    }
    // A handler can only reach changed code through imports, so routes outside the dependents are skipped untraced.
    if (!changedKeys.size || !seen.has(r.file)) continue;
    const t = resolveTarget(index, `${r.method} ${r.path}`).find((x) => x.path === r.file && x.line === r.line);
    const hit = t && treeHas(trace(index, g, t, { depth: 3 }).flow, changedKeys);
    if (hit) routes.push({ method: r.method, path: r.path, file: r.file, line: r.line, reason: `calls ${hit.name}()` });
  }

  // Tests: changed test files, and tests importing a changed or dependent file.
  const tests = new Map<string, string>();
  for (const f of index.files.filter((x) => x.role === "test")) {
    if (changed.has(f.path)) {
      tests.set(f.path, "changed in this diff");
      continue;
    }
    const out = g.out.get(f.path) ?? new Set();
    const direct = [...out].find((p) => changed.has(p));
    if (direct) tests.set(f.path, `imports ${direct}`);
    else {
      const indirect = [...out].find((p) => seen.has(p));
      if (indirect) tests.set(f.path, `imports ${indirect}, which depends on the change`);
    }
  }
  const reached = new Set<string>();
  for (const t of tests.keys()) for (const p of g.out.get(t) ?? []) {
    reached.add(p);
    for (const q of g.out.get(p) ?? []) reached.add(q);
  }
  const untested = [...changed].filter((p) => byPath.get(p)?.role === "source" && !reached.has(p));

  const env = files.flatMap((f) => (byPath.get(f.path)?.env ?? []).filter((e) => f.status === "added" || f.ranges.some(([a, b]) => e.line >= a && e.line <= b)).map((e) => ({ name: e.text, path: f.path, line: e.line })));
  const inChange = (path: string, line?: number) => {
    const f = files.find((x) => x.path === path);
    if (!f) return false;
    if (line === undefined || f.status === "added") return true;
    return f.ranges.some(([a, b]) => line >= a - 2 && line <= b + 2);
  };
  return {
    ...refs,
    files,
    dependents,
    modules: [...modCount].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.changed - a.changed || b.affected - a.affected),
    routes,
    tests: [...tests].map(([path, reason]) => ({ path, reason })),
    untested,
    env,
    risks: risks.filter((r) => r.locations.some((l) => inChange(l.path, l.line))),
  };
}

/** Markdown, good for a PR comment as well as the terminal. */
export function formatImpact(i: Impact): string {
  const loc = (p: string, l?: number) => `\`${l ? `${p}:${l}` : p}\``;
  const out = [`## What this change touches`, "", `Comparing \`${i.head}\` with \`${i.base}\`: ${i.files.length} files changed, ${i.dependents.length} more depend on them${i.routes.length ? `, ${i.routes.length} routes affected` : ""}.`];
  if (!i.files.length) return `${out.join("\n")}\n\nNo changes.`;
  out.push("", "### Changed", "");
  for (const f of i.files.slice(0, 60)) out.push(`- ${loc(f.path)} (${f.status})${f.symbols.length ? `: ${f.symbols.slice(0, 8).map((s) => `\`${s.parent ? `${s.parent}.` : ""}${s.name}\``).join(", ")}${f.symbols.length > 8 ? ", …" : ""}` : ""}`);
  if (i.files.length > 60) out.push(`- …and ${i.files.length - 60} more`);
  if (i.modules.length) out.push("", "### Modules", "", "| Module | Files changed | Files affected |", "|---|---:|---:|", ...i.modules.map((m) => `| \`${m.path || "(root)"}\` | ${m.changed} | ${m.affected} |`));
  if (i.routes.length) out.push("", "### Routes to re-check", "", ...i.routes.map((r) => `- **${r.method} ${r.path}** ${loc(r.file, r.line)}: ${r.reason}`));
  if (i.dependents.length) {
    const direct = i.dependents.filter((d) => d.depth === 1);
    out.push("", `### Depends on the change (${i.dependents.length})`, "", ...direct.slice(0, 25).map((d) => `- ${loc(d.path)} imports ${loc(d.via)}`));
    if (i.dependents.length > direct.length) out.push(`- …and ${i.dependents.length - direct.length} more through those`);
  }
  out.push("", "### Tests", "");
  out.push(...(i.tests.length ? i.tests.slice(0, 30).map((t) => `- ${loc(t.path)}: ${t.reason}`) : ["- No test imports the changed code."]));
  if (i.untested.length) out.push("", `Changed files no test reaches: ${i.untested.map((p) => loc(p)).join(", ")}`);
  if (i.env.length) out.push("", "### New or changed settings", "", ...i.env.map((e) => `- \`${e.name}\` read at ${loc(e.path, e.line)}`));
  if (i.risks.length) out.push("", "### Risks in the changed lines", "", ...i.risks.slice(0, 20).map((r) => `- **${r.severity}** ${r.title} ${r.locations.slice(0, 2).map((l) => loc(l.path, l.line)).join(", ")}`));
  return out.join("\n");
}
