import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { formatFile, formatHits, formatTrace } from "../format.js";
import { resolveTarget, trace } from "../query/trace.js";
import { where } from "../query/where.js";
import type { Workspace } from "../workspace.js";
import { addUsage, ClaudeError, claudeError, emptyUsage, MODEL, streamMessage, type Usage } from "./claude.js";

/**
 * "Ask a question": Claude answers about the repository using Spelunk's index
 * as its tools (search, trace, outline, read a line range), so it reads the
 * few places that matter instead of the whole repo, and cites path:line for
 * every claim.
 */

type Message = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlock;

export interface AskRequest {
  system: string;
  messages: Message[];
  tools: Anthropic.Beta.BetaTool[];
  /** True on the last turn: tools stay defined (history has tool calls) but can't be called. */
  noTools?: boolean;
}

export interface AskReply {
  content: Block[];
  stop_reason: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

/** One model call; tests pass a fake. */
export interface AskModel {
  send(req: AskRequest): Promise<AskReply>;
}

export interface AskStep {
  tool: string;
  input: Record<string, unknown>;
  /** One line for progress output: what was looked at. */
  label: string;
}

export interface AskResult {
  answer: string;
  /** path:line references from the answer that exist in the index. */
  cites: { path: string; line?: number }[];
  steps: AskStep[];
  usage: Usage;
}

const SYSTEM = `You answer questions about one software repository for an engineer who is new to it. You can't see the code directly; use the tools, which read Spelunk's index of the repository (every file's symbols, imports, routes, errors and env vars) and the files themselves.

How to work:
- Start with search for the words in the question, then outline or read the most likely files. Use trace to follow a route or function through the code.
- Read only the line ranges you need. Stop when you can answer; don't explore for its own sake.
- If the code doesn't settle the question, say what you checked and what's still unknown. Never guess at code you haven't read.

How to answer:
- Lead with the direct answer in one or two sentences, then the detail.
- Cite every claim about the code as path:line (for example src/server/pages.ts:142), using paths exactly as the tools print them.
- Plain Markdown, short paragraphs or a short list. Explain any project-specific word the first time you use it.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search",
    description: "Ranked search over files, functions, routes, error messages and env vars. Returns path:line hits with why each matched. Use plain words, an error message, a symbol name or a route.",
    input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "trace",
    description: 'Follow how code connects. For a route ("PUT /api/pages/:id"): client callers and the handler\'s call tree. For a function ("updatePage" or "Store.put"): what it calls and who calls it. For a file: imports and importers.',
    input_schema: { type: "object" as const, properties: { target: { type: "string" } }, required: ["target"] },
  },
  {
    name: "outline",
    description: "One file's role, symbols with line numbers, routes, imports, importers, env vars, and throw/log lines. Cheaper than reading the file; use it to pick a line range.",
    input_schema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "read",
    description: "Read lines of a file, numbered. At most 300 lines per call; ask for the range around a symbol from outline.",
    input_schema: { type: "object" as const, properties: { path: { type: "string" }, start: { type: "integer", minimum: 1 }, end: { type: "integer", minimum: 1 } }, required: ["path", "start", "end"] },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

const INPUTS = {
  search: z.object({ query: z.string().min(1) }),
  trace: z.object({ target: z.string().min(1) }),
  outline: z.object({ path: z.string().min(1) }),
  read: z.object({ path: z.string().min(1), start: z.number().int().min(1), end: z.number().int().min(1) }),
} as const;

const MAX_TURNS = 10;
const MAX_TOOL_CHARS = 12_000;
const clip = (s: string) => (s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}\n… (cut; narrow the query or range)` : s);

/** Runs one tool against the workspace. Errors come back as text so Claude can correct itself. */
async function runTool(ws: Workspace, name: string, raw: unknown): Promise<{ text: string; label: string; error?: boolean }> {
  const schema = INPUTS[name as keyof typeof INPUTS];
  if (!schema) return { text: `Unknown tool ${name}.`, label: name, error: true };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { text: `Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`, label: name, error: true };
  const input = parsed.data as unknown as { query: string; target: string; path: string; start: number; end: number };
  const fileOf = (p: string) => ws.index.files.find((f) => f.path === p) ?? ws.index.files.find((f) => f.path.endsWith(`/${p}`));

  switch (name) {
    case "search":
      return { text: formatHits(input.query, where(ws.index, input.query, { limit: 12 })), label: `Searched for "${input.query}"` };
    case "trace": {
      const targets = resolveTarget(ws.index, input.target);
      if (!targets.length) return { text: `Nothing called "${input.target}". Try search.`, label: `Traced ${input.target}` };
      return { text: clip(targets.slice(0, 2).map((t) => formatTrace(trace(ws.index, ws.graph, t, { depth: 2 }))).join("\n\n---\n\n")), label: `Traced ${input.target}` };
    }
    case "outline": {
      const f = fileOf(input.path);
      return f ? { text: clip(formatFile(ws, f)), label: `Outlined ${f.path}` } : { text: `No file "${input.path}" in the index. Use search to find it.`, label: `Outlined ${input.path}`, error: true };
    }
    case "read": {
      const f = fileOf(input.path);
      if (!f) return { text: `No file "${input.path}" in the index. Use search to find it.`, label: `Read ${input.path}`, error: true };
      // Only indexed files are readable, so a path can't reach outside the repository.
      const src = await readFile(join(ws.index.root, f.path), "utf8").catch(() => undefined);
      if (src === undefined) return { text: `Couldn't read ${f.path}.`, label: `Read ${f.path}`, error: true };
      const lines = src.split("\n");
      const start = Math.min(input.start, lines.length);
      const end = Math.min(Math.max(input.end, start), start + 299, lines.length);
      const body = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(5)}  ${l}`).join("\n");
      return { text: clip(`${f.path} lines ${start}-${end} of ${lines.length}\n${body}`), label: `Read ${f.path}:${start}-${end}` };
    }
  }
  return { text: `Unknown tool ${name}.`, label: name, error: true };
}

/** path:line (or a bare path) references in the answer that name real files. */
export function citations(ws: Workspace, answer: string): AskResult["cites"] {
  const paths = new Set(ws.index.files.map((f) => f.path));
  const out = new Map<string, AskResult["cites"][number]>();
  for (const m of answer.matchAll(/([\w@./-]+\.[A-Za-z0-9]+)(?::(\d+))?/g)) {
    const path = m[1]!.replace(/^\.\//, "");
    if (!paths.has(path)) continue;
    const line = m[2] ? Number(m[2]) : undefined;
    out.set(`${path}:${line ?? ""}`, { path, ...(line ? { line } : {}) });
  }
  return [...out.values()];
}

export interface AskOptions {
  /** Earlier turns, for follow-up questions in the dashboard. */
  history?: { question: string; answer: string }[];
  /** A short overview of the repo (from the report), so Claude starts oriented. */
  overview?: string;
  onStep?(step: AskStep): void;
}

export async function ask(ws: Workspace, model: AskModel, question: string, options: AskOptions = {}): Promise<AskResult> {
  const messages: Message[] = [];
  for (const h of options.history ?? []) messages.push({ role: "user", content: h.question }, { role: "assistant", content: h.answer });
  messages.push({ role: "user", content: `${!options.history?.length && options.overview ? `<repository_overview>\n${options.overview}\n</repository_overview>\n\n` : ""}${question}` });

  const steps: AskStep[] = [];
  const usage = emptyUsage();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // On the last turn tools can't be called, so Claude has to answer with what it found.
    const reply = await model.send({ system: SYSTEM, messages, tools: TOOLS, ...(turn === MAX_TURNS - 1 ? { noTools: true } : {}) });
    addUsage(usage, reply.usage);
    if (reply.stop_reason === "refusal") throw new ClaudeError("Claude declined to answer this question.");
    // Thinking and tool blocks go back exactly as received.
    messages.push({ role: "assistant", content: reply.content as Anthropic.Beta.BetaContentBlockParam[] });

    const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (reply.stop_reason !== "tool_use" || !calls.length) {
      if (reply.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Ask a narrower question.");
      const answer = reply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
      return { answer, cites: citations(ws, answer), steps, usage };
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const r = await runTool(ws, call.name, call.input);
      const step = { tool: call.name, input: (call.input ?? {}) as Record<string, unknown>, label: r.label };
      steps.push(step);
      options.onStep?.(step);
      results.push({ type: "tool_result", tool_use_id: call.id, content: r.text, ...(r.error ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new ClaudeError("Claude didn't finish answering. Ask a narrower question.");
}

/** The real model: Opus with adaptive thinking, streamed so long turns don't time out. */
export class ClaudeAsk implements AskModel {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async send(req: AskRequest): Promise<AskReply> {
    try {
      return await streamMessage(this.client, {
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        tools: req.tools,
        ...(req.noTools ? { tool_choice: { type: "none" as const } } : {}),
        messages: req.messages,
      });
    } catch (err) {
      throw claudeError(err);
    }
  }
}
