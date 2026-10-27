import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Risk } from "../analysis/risks.js";
import type { ErrorLookup } from "../query/errors.js";
import type { Report } from "../report/model.js";

const run = promisify(execFile);

/**
 * Optional Braid support. [Braid](https://github.com/ar-0911/braid) runs many
 * coding agents on one repository, each on its own branch and worktree. When
 * a repository has Braid set up, Spelunk shows which parts of the code each
 * agent is changing and where they are about to collide, compares each
 * agent's branch (`impact --agent`), and can hand risks or an error to Braid
 * as tasks ("Fix with Braid").
 *
 * The two tools only talk through Braid's command line (`braid agents --json`,
 * `braid start`, `braid do`), so neither depends on the other. `SPELUNK_BRAID`
 * names the command (default `braid`); `SPELUNK_BRAID=off` turns this off.
 */

export interface BraidAgent {
  name: string;
  status: string;
  task: string;
  branch: string;
  base: string;
  worktree: string;
  running: boolean;
  ahead: number | null;
  owns: { path: string; kind: string }[];
  intents: string[];
  /** Files changed since the agent's base, uncommitted work included (Braid snapshots it). */
  files: string[];
  needs: string | null;
}

export interface BraidRisk {
  a: string;
  /** Another agent, or "@<base>" for the base branch. */
  b: string;
  severity: "conflict" | "semantic" | "overlap";
  files: string[];
}

export interface BraidState {
  schema: number;
  repo: string;
  name: string;
  base: string;
  daemon: number | null;
  agents: BraidAgent[];
  risks: BraidRisk[];
  plans: { id: number; goal: string; base: string; status: string; tasks: { id: string; title: string; status: string; agent: string | null }[] }[];
  approvals: { id: number; status: string; agent: string; title: string }[];
}

export function braidCommand(): string[] | undefined {
  const v = process.env.SPELUNK_BRAID?.trim();
  if (v && /^(off|no|false|0)$/i.test(v)) return undefined;
  return v ? v.split(/\s+/) : ["braid"];
}

const LIVE = new Set(["active", "ready", "blocked", "exited"]);

/** True when Braid has been set up in this repository (it keeps its state in the shared .git dir). */
export async function braidHere(root: string): Promise<boolean> {
  if (!braidCommand()) return false;
  const common = await run("git", ["-C", root, "rev-parse", "--git-common-dir"]).then((r) => r.stdout.trim(), () => "");
  if (!common) return false;
  return existsSync(join(isAbsolute(common) ? common : resolve(root, common), "braid", "state.db"));
}

/** True when the `braid` command runs, so tasks can be handed to it. */
export async function braidInstalled(): Promise<boolean> {
  const cmd = braidCommand();
  if (!cmd) return false;
  return run(cmd[0]!, [...cmd.slice(1), "--version"], { timeout: 15_000 }).then(() => true, () => false);
}

/** `braid agents --json`, or undefined when Braid isn't set up here, isn't installed or is too old. */
export async function braidState(root: string): Promise<BraidState | undefined> {
  const cmd = braidCommand();
  if (!cmd || !(await braidHere(root))) return undefined;
  try {
    const { stdout } = await run(cmd[0]!, [...cmd.slice(1), "agents", "--json"], { cwd: root, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
    const s = JSON.parse(stdout) as BraidState;
    return s && Array.isArray(s.agents) ? s : undefined;
  } catch {
    return undefined;
  }
}

export interface AgentsOnMap {
  base: string;
  watcher: boolean;
  agents: (BraidAgent & { modules: string[]; live: boolean })[];
  /** Per module: which live agents change files in it. */
  modules: { path: string; agents: { name: string; files: string[] }[] }[];
  /** Predicted collisions between live agents, with the modules they're in. */
  risks: (BraidRisk & { modules: string[] })[];
  plans: BraidState["plans"];
  waiting: number;
}

/** Puts Braid's agents on Spelunk's module map: who is changing which part, and where they'll collide. */
export function agentsOnMap(state: BraidState, report: Pick<Report, "modules">): AgentsOnMap {
  const owner = new Map<string, string>();
  for (const m of report.modules) for (const f of m.files) owner.set(f.path, m.path);
  const byLength = [...report.modules].sort((a, b) => b.path.length - a.path.length);
  const moduleOf = (file: string) => owner.get(file) ?? byLength.find((m) => m.path === "" || file.startsWith(`${m.path}/`))?.path;
  const agents = state.agents.map((a) => ({ ...a, live: LIVE.has(a.status), modules: [...new Set(a.files.map(moduleOf).filter((m): m is string => m !== undefined))].sort() }));
  const mods = new Map<string, Map<string, string[]>>();
  for (const a of agents.filter((x) => x.live)) {
    for (const f of a.files) {
      const m = moduleOf(f);
      if (m === undefined) continue;
      const per = mods.get(m) ?? new Map<string, string[]>();
      per.set(a.name, [...(per.get(a.name) ?? []), f]);
      mods.set(m, per);
    }
  }
  const SEV = { conflict: 0, semantic: 1, overlap: 2 };
  return {
    base: state.base,
    watcher: Boolean(state.daemon),
    agents,
    modules: [...mods].map(([path, per]) => ({ path, agents: [...per].map(([name, files]) => ({ name, files })) })).sort((a, b) => b.agents.length - a.agents.length || a.path.localeCompare(b.path)),
    // Semantic hints name "file uses name()" rather than a path; map what parses as a file.
    risks: state.risks
      .map((r) => ({ ...r, modules: [...new Set(r.files.map((f) => moduleOf(f.split(" ")[0]!)).filter((m): m is string => m !== undefined))] }))
      .sort((x, y) => SEV[x.severity] - SEV[y.severity]),
    plans: state.plans.filter((p) => p.status === "running" || p.status === "proposed"),
    waiting: state.approvals.filter((a) => a.status === "pending").length,
  };
}

/** module path → live agents changing it, for the diagram badges. */
export function agentMarks(m: AgentsOnMap): Map<string, string[]> {
  return new Map(m.modules.map((x) => [x.path, x.agents.map((a) => a.name)]));
}

export function formatAgents(m: AgentsOnMap): string {
  const live = m.agents.filter((a) => a.live);
  if (!m.agents.length) return 'Braid is set up here but no agents are running. Start some with `braid start "task"` or `braid do "goal"`.';
  const out = [`Braid: ${live.length} agent${live.length === 1 ? "" : "s"} working, landing on ${m.base}${m.watcher ? "" : " (watcher stopped: braid daemon start)"}${m.waiting ? `, ${m.waiting} waiting for your OK` : ""}.`];
  for (const a of m.agents) {
    out.push("", `${a.name}  [${a.status}]  ${a.task.slice(0, 100)}`);
    if (a.modules.length) out.push(`  parts: ${a.modules.map((p) => p || "(root)").join(", ")}`);
    if (a.files.length) out.push(`  files: ${a.files.slice(0, 12).join(", ")}${a.files.length > 12 ? ` and ${a.files.length - 12} more` : ""}`);
    if (a.needs) out.push(`  needs you: ${a.needs.slice(0, 160)}`);
  }
  const shared = m.modules.filter((x) => x.agents.length > 1);
  if (shared.length) out.push("", "Parts more than one agent is changing:", ...shared.map((x) => `  ${x.path || "(root)"}: ${x.agents.map((a) => a.name).join(", ")}`));
  if (m.risks.length) out.push("", "Predicted collisions:", ...m.risks.map((r) => `  ${r.severity.toUpperCase().padEnd(8)} ${r.a} ↔ ${r.b}: ${r.files.slice(0, 6).join(", ")}`));
  return out.join("\n");
}

/** One Braid task that fixes a group of risks: what's wrong, where, and how to check it. */
export function riskTask(risks: Risk[]): string {
  const first = risks[0];
  if (!first) return "";
  const where = (r: Risk) => r.locations.slice(0, 4).map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`).join(", ");
  const kinds = [...new Set(risks.map((r) => r.kind))].join(", ");
  const lines = risks.slice(0, 15).map((r) => `- ${r.title}${r.detail && r.detail !== r.title ? `: ${r.detail}` : ""} (${where(r)})`);
  // The first words name the agent (Braid makes "swallowed-error" out of them), so they say what it fixes.
  return `${first.kind.replace(/-/g, " ")} ${risks.length === 1 ? "fix" : `fixes (${risks.length})`}: Spelunk found ${risks.length === 1 ? "this" : `these${kinds.includes(",") ? ` (${kinds})` : ""}`}:\n${lines.join("\n")}${risks.length > 15 ? `\n- and ${risks.length - 15} more of the same kind` : ""}\nChange only what each finding needs, keep behaviour the same otherwise, and add or update a test that shows the fix.`;
}

/** A Braid task that fixes the bug behind an error, starting from where Spelunk traced it. */
export function errorTask(input: string, e: ErrorLookup): string {
  const start = e.start ? `${e.start.path}${e.start.line ? `:${e.start.line}` : ""}${e.start.symbol ? ` in ${e.start.symbol.name}()` : ""}` : undefined;
  const origins = e.origins.slice(0, 5).map((o) => `- ${o.path}:${o.line}${o.symbol ? ` in ${o.symbol.name}()` : ""}`);
  return [
    `Error fix: ${(e.message || input.trim().split("\n")[0] || "").slice(0, 120)}\n\nFix the bug behind this error:\n${input.trim().slice(0, 1500)}`,
    start ? `Spelunk traced it to ${start}: ${e.start!.why}` : "",
    origins.length ? `Code that raises or logs this message:\n${origins.join("\n")}` : "",
    "Find the cause rather than hiding the error, and add a test that fails without the fix.",
  ].filter(Boolean).join("\n\n");
}

export interface StartRequest {
  /** One agent per task. */
  tasks?: string[];
  /** Or one goal for Braid to plan into parallel tasks (`braid do`). */
  goal?: string;
  /** Branch to land on; Braid's default base when absent. */
  base?: string;
}

/**
 * Hands work to Braid: `braid start` for tasks, `braid do --yes` for a goal. Runs
 * in the background (planning a goal takes a while); output goes to a log in .spelunk/.
 */
export async function startBraid(root: string, req: StartRequest): Promise<{ command: string; log: string }> {
  const cmd = braidCommand();
  if (!cmd) throw new Error("Braid support is off (SPELUNK_BRAID=off).");
  const base = req.base?.trim();
  if (base && !/^[\w./-]+$/.test(base)) throw new Error(`"${base}" isn't a branch name.`);
  const tasks = (req.tasks ?? []).map((t) => t.trim()).filter(Boolean);
  const goal = req.goal?.trim();
  if (!tasks.length && !goal) throw new Error("Say what the agents should do.");
  const args = goal ? ["do", "--yes", ...(base ? ["--base", base] : []), goal] : ["start", ...(base ? ["--base", base] : []), ...tasks];
  const dir = join(root, ".spelunk");
  await mkdir(dir, { recursive: true });
  const log = join(dir, "braid.log");
  const fh = await open(log, "a");
  await fh.write(`\n--- ${new Date().toISOString()} braid ${args[0]} ---\n`);
  const child = spawn(cmd[0]!, [...cmd.slice(1), ...args], { cwd: root, detached: true, stdio: ["ignore", fh.fd, fh.fd] });
  await new Promise<void>((ok, fail) => {
    child.once("spawn", ok);
    child.once("error", (err) => fail(new Error(`Couldn't run ${cmd[0]}: ${err.message}. Install Braid (https://github.com/ar-0911/braid) or set SPELUNK_BRAID.`)));
  });
  child.unref();
  await fh.close();
  const shown = [cmd.join(" "), ...args.map((a) => (/^[\w./=-]+$/.test(a) ? a : JSON.stringify(a.length > 60 ? `${a.slice(0, 57)}...` : a)))].join(" ");
  return { command: shown, log };
}
