import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MODEL = "claude-opus-5-5";

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
  inputTokens: number;
  outputTokens: number;
}

export class ClaudeError extends Error {}

/** What explain() needs from Claude; tests pass a fake. */
export interface JsonClient {
  json<T>(req: JsonRequest): Promise<T>;
}

/**
 * Claude with a disk cache: the same prompt (which embeds file hashes) never
 * costs twice, so re-running `spelunk explain` after a small change only
 * pays for the modules that changed.
 */
export class Claude implements JsonClient {
  private client: Anthropic;
  readonly usage: Usage = { calls: 0, cached: 0, inputTokens: 0, outputTokens: 0 };

  constructor(
    private cacheDir: string,
    apiKey?: string,
  ) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async json<T>(req: JsonRequest): Promise<T> {
    const key = createHash("sha256").update(JSON.stringify([MODEL, req])).digest("hex");
    const file = join(this.cacheDir, `${key}.json`);
    const hit = await readFile(file, "utf8").catch(() => undefined);
    if (hit) {
      this.usage.cached++;
      return JSON.parse(hit) as T;
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: req.maxTokens ?? 32000,
          // If a safety classifier declines, the API retries on its recommended fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: req.prompt }],
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ClaudeError("Your Anthropic API key was rejected. Set ANTHROPIC_API_KEY or run `ant auth login`.");
      if (err instanceof Anthropic.RateLimitError) throw new ClaudeError("Claude is rate limiting this key. Wait a minute and run the command again; finished parts are cached.");
      if (err instanceof Anthropic.APIError) throw new ClaudeError(`Claude returned an error (${err.status ?? "network"}): ${err.message}`);
      throw err;
    }
    this.usage.calls++;
    this.usage.inputTokens += (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    this.usage.outputTokens += message.usage.output_tokens ?? 0;
    if (message.stop_reason === "refusal") throw new ClaudeError("Claude declined to explain this part of the code.");
    if (message.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off. Try a smaller module with --max-chars.");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const value = JSON.parse(text) as T;
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }
}

/** Opus 5.5 list prices, for the estimate shown before a run. */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 4 + outputTokens * 20) / 1_000_000;
}
