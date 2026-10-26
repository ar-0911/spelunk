import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Graph } from "../analysis/graph.js";
import { modules, type Module } from "../analysis/modules.js";
import { allRoutes } from "../analysis/routes.js";
import type { Risk } from "../analysis/risks.js";
import { resolveTarget, trace, type CallNode } from "../query/trace.js";
import type { FileFacts, Index } from "../types.js";
import { estimateCost, MODEL, type JsonClient } from "./claude.js";

/**
 * The Claude half of Spelunk. Static analysis already knows where things are
 * and how they connect; Claude reads each module (source when it fits, a
 * skeleton when it doesn't) and writes what people actually need: what a
 * module is for, how the main flows run, and where things break.
 */

export interface ModuleExplanation {
  summary: string;
  responsibilities: string[];
  keyFiles: { path: string; role: string }[];
  gotchas: string[];
}

export interface Flow {
  name: string;
  summary: string;
  steps: { what: string; path: string; symbol?: string; line?: number }[];
}

export interface Overview {
  oneLiner: string;
  whatItDoes: string;
  architecture: string;
  flows: Flow[];
  runLocally: string[];
  debugging: {
    firstChecks: string[];
    logs: string[];
    failurePoints: { symptom: string; likelyCause: string; whereToLook: string }[];
  };
  glossary: { term: string; meaning: string }[];
}

export interface Explanations {
  model: string;
  generatedAt: string;
  commit?: string;
  modules: Record<string, ModuleExplanation>;
  overview?: Overview;
}

const MODULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "responsibilities", "keyFiles", "gotchas"],
  properties: {
    summary: { type: "string", description: "Two or three sentences: what this module is for and how the rest of the code uses it." },
    responsibilities: { type: "array", items: { type: "string" }, description: "3-6 short bullets, each a concrete job this module does." },
    keyFiles: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["path", "role"], properties: { path: { type: "string" }, role: { type: "string", description: "One line: what this file does." } } },
      description: "Every file in the module that matters, most important first.",
    },
    gotchas: { type: "array", items: { type: "string" }, description: "Non-obvious behaviour, assumptions, or ways this module fails that someone debugging should know. Empty if none." },
  },
} as const;

const OVERVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["oneLiner", "whatItDoes", "architecture", "flows", "runLocally", "debugging", "glossary"],
  properties: {
    oneLiner: { type: "string", description: "One sentence: what this codebase is." },
    whatItDoes: { type: "string", description: "A short paragraph for someone new: what the software does and for whom." },
    architecture: { type: "string", description: "A paragraph on how the pieces fit: the main parts, how they talk, where state lives." },
    flows: {
      type: "array",
      description: "The 3-6 most important end-to-end flows (a request, a job, a command), each as ordered steps grounded in real files.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "summary", "steps"],
        properties: {
          name: { type: "string" },
          summary: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["what", "path"],
              properties: { what: { type: "string" }, path: { type: "string", description: "A repo-relative file path from the material." }, symbol: { type: "string" } },
            },
          },
        },
      },
    },
    runLocally: { type: "array", items: { type: "string" }, description: "Steps to install, configure, run and test locally, using the real commands from the manifests." },
    debugging: {
      type: "object",
      additionalProperties: false,
      required: ["firstChecks", "logs", "failurePoints"],
      properties: {
        firstChecks: { type: "array", items: { type: "string" }, description: "What to check first when something breaks." },
        logs: { type: "array", items: { type: "string" }, description: "Where errors show up and what the important log lines mean." },
        failurePoints: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["symptom", "likelyCause", "whereToLook"],
            properties: { symptom: { type: "string" }, likelyCause: { type: "string" }, whereToLook: { type: "string", description: "File paths and symbols." } },
          },
          description: "The likeliest ways this code breaks, from the evidence given.",
        },
      },
    },
    glossary: { type: "array", items: { type: "object", additionalProperties: false, required: ["term", "meaning"], properties: { term: { type: "string" }, meaning: { type: "string" } } }, description: "Project-specific terms a newcomer will meet." },
  },
} as const;

const SYSTEM = `You explain codebases to two kinds of readers: the person who owns the code but didn't write all of it (often it was generated by an AI assistant) and needs to debug it, and engineers new to the team.

Rules:
- Use only what the material shows. Never invent files, functions, commands, endpoints or behaviour. If something is unclear from the material, say so plainly.
- Name real file paths and symbols so the reader can jump to them.
- Plain, direct sentences. Explain what code does and why it matters, not how it is formatted.
- Point out what is surprising, fragile or easy to get wrong; that is what a debugger needs most.
- Material marked "skeleton only" shows signatures and comments, not bodies. Don't claim to know what those bodies do beyond what the names and comments say.`;

export interface ExplainOptions {
  /** Max characters of source to send per module before falling back to skeletons. */
  maxChars?: number;
  /** Max modules to explain (largest first). */
  maxModules?: number;
  concurrency?: number;
  onProgress?(message: string): void;
}

function skeleton(f: FileFacts): string {
  const lines = [`// ${f.path} (${f.lines} lines, skeleton only)`];
  if (f.doc) lines.push(`// ${f.doc}`);
  for (const s of f.symbols) lines.push(`${s.doc ? `/** ${s.doc} */\n` : ""}${s.signature}${s.endLine > s.line ? ` … (${s.endLine - s.line + 1} lines)` : ""}`);
  for (const r of f.routes.filter((r) => r.side === "server")) lines.push(`// route ${r.method} ${r.path} (line ${r.line})`);
  return lines.join("\n");
}

async function moduleMaterial(index: Index, g: Graph, m: Module, maxChars: number): Promise<{ text: string; chars: number }> {
  const parts: string[] = [`Module: ${m.path || "(repo root)"}${m.owner ? ` (package ${m.owner})` : ""}`];
  if (m.dependsOn.size) parts.push(`Imports from: ${[...m.dependsOn.keys()].join(", ")}`);
  if (m.usedBy.size) parts.push(`Used by: ${[...m.usedBy.keys()].join(", ")}`);
  // Most-imported files first, so the budget goes to what everything else depends on.
  const files = [...m.files].sort((a, b) => (g.in.get(b.path)?.size ?? 0) - (g.in.get(a.path)?.size ?? 0) || a.lines - b.lines);
  let budget = maxChars;
  for (const f of files) {
    const text = await readFile(join(index.root, f.path), "utf8").catch(() => "");
    if (text && text.length <= budget) {
      parts.push(`\n<file path="${f.path}">\n${text}\n</file>`);
      budget -= text.length;
    } else parts.push(`\n<file path="${f.path}" skeleton>\n${skeleton(f)}\n</file>`);
  }
  const text = parts.join("\n");
  return { text, chars: text.length };
}

function flowText(nodes: CallNode[], indent = ""): string {
  return nodes.map((n) => `${indent}- ${n.name} (${n.path}:${n.line})\n${flowText(n.children, `${indent}  `)}`).join("");
}

/** Static facts the overview call starts from: manifests, entry points, routes and their call trees. */
function overviewMaterial(index: Index, g: Graph, mods: Module[], explained: Record<string, ModuleExplanation>, risks: Risk[]): string {
  const parts: string[] = [];
  parts.push("## Manifests and commands");
  for (const m of index.manifests) {
    const cmds = m.commands.slice(0, 15).map((c) => `  - ${c.name}: ${c.command}`).join("\n");
    parts.push(`- ${m.path} (${m.kind}${m.name ? `, ${m.name}` : ""})${m.env?.length ? ` env: ${m.env.join(", ")}` : ""}\n${cmds}`);
  }
  parts.push("\n## Entry points");
  for (const f of index.files.filter((f) => f.entry)) parts.push(`- ${f.path}: ${f.entry}`);
  parts.push("\n## Modules");
  for (const m of mods) {
    const e = explained[m.path];
    parts.push(`### ${m.path || "(root)"} (${m.files.length} files, ${m.lines} lines)\n${e ? `${e.summary}\nGotchas: ${e.gotchas.join(" | ") || "none"}` : "(not explained)"}`);
  }
  const server = allRoutes(index, "server");
  if (server.length) {
    parts.push(`\n## Server routes (${server.length})`);
    for (const r of server.slice(0, 150)) parts.push(`- ${r.method} ${r.path} → ${r.file}:${r.line}`);
    parts.push("\n## Call trees of some routes (static analysis)");
    const picks = server.filter((r) => r.method !== "GET").slice(0, 6).concat(server.filter((r) => r.method === "GET").slice(0, 3));
    for (const r of picks) {
      const t = resolveTarget(index, `${r.method} ${r.path}`)[0];
      if (!t) continue;
      const tr = trace(index, g, t, { depth: 2 });
      parts.push(`### ${r.method} ${r.path} (${r.file}:${r.line})${tr.callers.length ? `\nCalled from: ${tr.callers.map((c) => `${c.path}:${c.line}`).join(", ")}` : ""}\n${flowText(tr.flow) || "(no resolved calls)"}`);
    }
  }
  const env = [...new Set(index.files.flatMap((f) => f.env.map((e) => `${e.text} (${f.path})`)))];
  if (env.length) parts.push(`\n## Environment variables read\n${env.slice(0, 80).join("\n")}`);
  const logs = index.files.filter((f) => f.role === "source").flatMap((f) => f.logs.map((l) => `${f.path}:${l.line} ${l.text}`));
  if (logs.length) parts.push(`\n## Error and warning log statements\n${logs.slice(0, 60).join("\n")}`);
  const tests = index.files.filter((f) => f.role === "test");
  parts.push(`\n## Tests\n${tests.length} test files${tests.length ? `, e.g. ${tests.slice(0, 15).map((t) => t.path).join(", ")}` : ""}`);
  const topRisks = risks.filter((r) => r.severity !== "low").slice(0, 25);
  if (topRisks.length) parts.push(`\n## Static risk findings\n${topRisks.map((r) => `- [${r.kind}] ${r.title} (${r.locations.map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`).join(", ")})`).join("\n")}`);
  return parts.join("\n");
}

export const explanationsPath = (root: string) => join(root, ".spelunk", "explain.json");

export async function loadExplanations(root: string): Promise<Explanations | undefined> {
  try {
    return JSON.parse(await readFile(explanationsPath(root), "utf8")) as Explanations;
  } catch {
    return undefined;
  }
}

export interface Plan {
  modules: { module: Module; chars: number }[];
  estimate: { inputTokens: number; outputTokens: number; dollars: number };
}

/** What `explain` would send, and roughly what it costs, before spending anything. */
export async function plan(index: Index, g: Graph, options: ExplainOptions = {}): Promise<Plan> {
  const maxChars = options.maxChars ?? 120_000;
  const mods = modules(index, g, { max: options.maxModules ?? 40 });
  const sized = await Promise.all(mods.map(async (m) => ({ module: m, chars: (await moduleMaterial(index, g, m, maxChars)).chars })));
  const input = sized.reduce((n, s) => n + s.chars / 3.5, 0) + 30_000;
  const output = sized.length * 1500 + 6000;
  return { modules: sized, estimate: { inputTokens: Math.round(input), outputTokens: output, dollars: Math.round(estimateCost(input, output) * 100) / 100 } };
}

export async function explain(index: Index, g: Graph, risks: Risk[], claude: JsonClient, options: ExplainOptions = {}): Promise<Explanations> {
  const maxChars = options.maxChars ?? 120_000;
  const mods = modules(index, g, { max: options.maxModules ?? 40 });
  const result: Explanations = { model: MODEL, generatedAt: new Date().toISOString(), ...(index.commit ? { commit: index.commit } : {}), modules: {} };

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < mods.length) {
      const m = mods[next++]!;
      const { text } = await moduleMaterial(index, g, m, maxChars);
      const e = await claude.json<ModuleExplanation>({
        system: SYSTEM,
        prompt: `Explain this module of the repository.\n\n${text}`,
        schema: MODULE_SCHEMA,
        effort: "medium",
      });
      const paths = new Set(m.files.map((f) => f.path));
      e.keyFiles = e.keyFiles.filter((k) => paths.has(k.path));
      result.modules[m.path] = e;
      options.onProgress?.(`Explained ${m.path || "(root)"} (${++done}/${mods.length})`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, mods.length) }, worker));

  options.onProgress?.("Writing the overview, flows and debugging guide");
  const overview = await claude.json<Overview>({
    system: SYSTEM,
    prompt: `Here is what static analysis found in this repository, plus a summary of each module. Write the overview a newcomer or a debugging owner needs.\n\n${overviewMaterial(index, g, mods, result.modules, risks)}`,
    schema: OVERVIEW_SCHEMA,
    effort: "high",
  });
  // Keep only steps that point at real files, and add line numbers where the symbol is known.
  const byPath = new Map(index.files.map((f) => [f.path, f]));
  for (const flow of overview.flows) {
    flow.steps = flow.steps.filter((s) => byPath.has(s.path)).map((s) => {
      const sym = s.symbol ? byPath.get(s.path)!.symbols.find((x) => x.name === s.symbol!.split(".").pop()) : undefined;
      return sym ? { ...s, line: sym.line } : s;
    });
  }
  result.overview = overview;
  await mkdir(join(index.root, ".spelunk"), { recursive: true });
  await writeFile(explanationsPath(index.root), JSON.stringify(result, null, 2));
  return result;
}
