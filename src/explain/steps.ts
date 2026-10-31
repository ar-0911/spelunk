import type { Frame } from "../query/walk.js";
import type { JsonClient } from "./claude.js";

/**
 * Plain-English captions for a trace frame: one sentence on what the
 * function does, and a few words for each numbered call. Cached by the
 * client like every other Claude answer, so revisiting a frame is free.
 */

export interface StepCaptions {
  summary: string;
  steps: { n: number; what: string }[];
}

const SYSTEM = `You help a developer read unfamiliar code one function at a time.
You get one function (or HTTP route handler) with line numbers, and a numbered list of the calls it makes.
Write:
- "summary": one sentence, at most 25 words, on what this code does and why, in plain words. No "This function".
- "steps": for each numbered call you are given, at most 10 words on what that call does here (for example "loads the page or throws 404", "rejects stale edits with 409"). Describe its role in this code, not its name.
Only describe what the code shows. If a call's purpose isn't clear from the code, say what it's given or returns.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "steps"],
  properties: {
    summary: { type: "string" },
    steps: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["n", "what"], properties: { n: { type: "integer" }, what: { type: "string" } } },
    },
  },
};

export function captionPrompt(f: Frame): string {
  const code = f.code.map((t, i) => `${String(f.line + i).padStart(5)}  ${t}`).join("\n");
  const calls = f.steps
    .filter((s) => s.kind === "code")
    .map((s) => `${s.n}. ${s.ref} (line ${s.lines[0]})${s.def ? ` → ${s.def.name} in ${s.def.path}${s.def.doc ? `: ${s.def.doc}` : ""}` : ""}`)
    .join("\n");
  return `${f.kind === "route" ? "Route" : "Function"} ${f.label} in ${f.path}${f.doc ? `\nIts comment: ${f.doc}` : ""}\n\n\`\`\`\n${code}\n\`\`\`\n\nCalls:\n${calls || "(none into this repository)"}`;
}

export async function captionFrame(claude: JsonClient, f: Frame): Promise<StepCaptions> {
  const out = await claude.json<StepCaptions>({ system: SYSTEM, prompt: captionPrompt(f), schema: SCHEMA, effort: "low", maxTokens: 2000 });
  const wanted = new Set(f.steps.filter((s) => s.kind === "code").map((s) => s.n));
  return { summary: out.summary.trim(), steps: out.steps.filter((s) => wanted.has(s.n)).map((s) => ({ n: s.n, what: s.what.trim() })) };
}
