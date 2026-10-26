import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The model for explain and ask. SPELUNK_MODEL overrides it, e.g. for a cheaper model or a newer one. */
export const MODEL = process.env.SPELUNK_MODEL?.trim() || "claude-opus-5-5";

/** Server-side fallback when a safety classifier declines: retried on the API's recommended model. Dropped if the API no longer knows it. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
let fallbackSupported = !process.env.SPELUNK_NO_FALLBACK;

export interface JsonRequest {
  /** Stable instructions; cached across calls, so keep per-call details out. */
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface Usage {
  calls: number;
  cached: number;
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({ calls: 0, cached: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function addUsage(u: Usage, m: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined): void {
  u.calls++;
  u.inputTokens += m?.input_tokens ?? 0;
  u.outputTokens += m?.output_tokens ?? 0;
  u.cacheReadTokens += m?.cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += m?.cache_creation_input_tokens ?? 0;
}

export class ClaudeError extends Error {}

/** What explain() needs from Claude; tests pass a fake. */
export interface JsonClient {
  json<T>(req: JsonRequest): Promise<T>;
}

/**
 * A beta-messages stream with the fallback beta when the API accepts it. If
 * the API rejects the beta (it was retired), the request is retried once
 * without it and later requests leave it out.
 */
export async function streamMessage(client: Anthropic, params: Omit<Anthropic.Beta.MessageCreateParamsStreaming, "stream" | "betas" | "fallbacks">, signal?: AbortSignal): Promise<Anthropic.Beta.BetaMessage> {
  const options = signal ? { signal } : {};
  if (fallbackSupported) {
    try {
      return await client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" }, options).finalMessage();
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError && /beta|fallback/i.test(err.message))) throw err;
      fallbackSupported = false;
    }
  }
  return client.beta.messages.stream(params, options).finalMessage();
}

export function claudeError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) return new ClaudeError("Your Anthropic API key was rejected. Set ANTHROPIC_API_KEY or run `ant auth login`.");
  if (err instanceof Anthropic.RateLimitError) return new ClaudeError("Claude is rate limiting this key. Wait a minute and try again; finished parts are cached.");
  if (err instanceof Anthropic.NotFoundError && /model/i.test(err.message)) return new ClaudeError(`The model "${MODEL}" isn't available to this key. Set SPELUNK_MODEL to one that is.`);
  if (err instanceof Anthropic.APIUserAbortError) return new ClaudeError("Stopped.");
  if (err instanceof Anthropic.APIError) return new ClaudeError(`Claude returned an error (${err.status ?? "network"}): ${err.message}`);
  return err;
}

/** Checks a value against the subset of JSON Schema Spelunk's prompts use: type, required, properties, items, enum. */
export function matchesSchema(value: unknown, schema: Record<string, unknown>, path = "$"): string | undefined {
  const type = schema.type as string | undefined;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  if (type && type !== actual && !(type === "number" && actual === "integer")) return `${path} should be ${type}, got ${actual}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path} isn't one of the allowed values`;
  if (type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (!(k in obj)) return `${path}.${k} is missing`;
    for (const [k, sub] of Object.entries((schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {})) {
      if (k in obj) {
        const bad = matchesSchema(obj[k], sub, `${path}.${k}`);
        if (bad) return bad;
      }
    }
  }
  if (type === "array" && Array.isArray(value) && schema.items) {
    for (const [i, item] of value.entries()) {
      const bad = matchesSchema(item, schema.items as Record<string, unknown>, `${path}[${i}]`);
      if (bad) return bad;
    }
  }
  return undefined;
}

/**
 * Claude with a disk cache: the same prompt (which embeds file hashes) never
 * costs twice, so re-running `spelunk explain` after a small change only
 * pays for the modules that changed.
 */
export class Claude implements JsonClient {
  private client: Anthropic;
  readonly usage: Usage = emptyUsage();

  constructor(
    private cacheDir: string,
    apiKey?: string,
    /** Aborting stops the run's remaining requests (the dashboard does this when another folder is opened). */
    private signal?: AbortSignal,
  ) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async json<T>(req: JsonRequest): Promise<T> {
    const key = createHash("sha256").update(JSON.stringify([MODEL, req])).digest("hex");
    const file = join(this.cacheDir, `${key}.json`);
    const hit = await readFile(file, "utf8").catch(() => undefined);
    if (hit) {
      // A damaged cache entry (from an older version or a full disk) is just a miss.
      try {
        const value = JSON.parse(hit) as T;
        if (!matchesSchema(value, req.schema)) {
          this.usage.cached++;
          return value;
        }
      } catch {
        // fall through and ask again
      }
    }
    if (this.signal?.aborted) throw new ClaudeError("Stopped.");

    // One retry when the answer isn't what the schema asked for, with the problem appended so Claude can correct it.
    let prompt = req.prompt;
    let value: T | undefined;
    for (let attempt = 0; value === undefined; attempt++) {
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await streamMessage(
          this.client,
          {
            model: MODEL,
            max_tokens: req.maxTokens ?? 32000,
            output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: prompt }],
          },
          this.signal,
        );
      } catch (err) {
        throw claudeError(err);
      }
      addUsage(this.usage, message.usage);
      if (message.stop_reason === "refusal") throw new ClaudeError("Claude declined to explain this part of the code.");
      if (message.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Try a smaller module with --max-chars.");
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      let problem: string | undefined;
      try {
        const parsed = JSON.parse(text) as T;
        problem = matchesSchema(parsed, req.schema);
        if (!problem) value = parsed;
      } catch {
        problem = "it wasn't valid JSON";
      }
      if (problem && attempt >= 1) throw new ClaudeError(`Claude's answer didn't have the expected shape twice (${problem}). Run the command again; finished parts are cached.`);
      if (problem) prompt = `${req.prompt}\n\nYour previous answer was rejected because ${problem}. Answer again, matching the JSON schema exactly.`;
    }
    // Written to a temp file and renamed, so a crash never leaves half an entry.
    await mkdir(this.cacheDir, { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
    return value;
  }
}

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * List prices in dollars per million tokens. Cache writes (5-minute) are 1.25×
 * input. Longest prefix wins, so dated ids like claude-opus-5-5-20260901 match.
 */
const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-mythos-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Haiku 5.5's price for prompts up to 100K tokens; Spelunk's prompts stay well under that.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/**
 * The price for `model`: SPELUNK_PRICE_IN / SPELUNK_PRICE_OUT (dollars per
 * million tokens) when set, else the table. Undefined for a model the table
 * doesn't know, so a cost is never quoted at the wrong rates.
 */
export function priceFor(model = MODEL): Price | undefined {
  const inp = Number(process.env.SPELUNK_PRICE_IN);
  const out = Number(process.env.SPELUNK_PRICE_OUT);
  if (inp > 0 && out > 0) return { input: inp, output: out, cacheRead: inp / 10 };
  const key = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : undefined;
}

const unknownPrice = () => `Spelunk doesn't know the price of "${MODEL}". Pass --price-in and --price-out (dollars per million tokens), or set SPELUNK_PRICE_IN and SPELUNK_PRICE_OUT.`;

/** Estimated dollars, before a run (uncached input and output only). Throws for an unknown model rather than guess. */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  const p = priceFor();
  if (!p) throw new ClaudeError(unknownPrice());
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Dollars a finished run cost, with cache reads and writes at their own prices; undefined for an unknown model. */
export function usageCost(u: Usage): number | undefined {
  const p = priceFor();
  if (!p) return undefined;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.input * 1.25) / 1_000_000;
}

/** "about $0.42", or why there's no figure. The money is already spent, so this never throws. */
export function costText(u: Usage): string {
  const c = usageCost(u);
  return c === undefined ? "cost unknown: set --price-in and --price-out" : `about $${c.toFixed(2)}`;
}
