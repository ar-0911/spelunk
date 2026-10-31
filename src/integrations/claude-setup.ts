import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * `spelunk setup claude`: makes Claude Code use Spelunk in every project.
 *
 * 1. Registers `spelunk mcp` as a user-scope MCP server. Claude Code starts it
 *    in whichever project it opens, so one registration covers them all. The
 *    command is this very Node and this very cli.js, so it works however
 *    Spelunk was installed (npm -g, a git clone, pnpm link).
 * 2. Adds a short note to ~/.claude/CLAUDE.md telling Claude to ask Spelunk
 *    before grepping. Tools alone aren't enough: without the note, Claude
 *    tends to reach for grep and read whole files out of habit.
 *
 * Running it again replaces both, so it is also how to update them.
 */

const START = "<!-- spelunk:start -->";
const END = "<!-- spelunk:end -->";

export const CLAUDE_MD_NOTE = `${START}
## Finding your way around code: use Spelunk first

The \`spelunk\` MCP server has an index of this repository: symbols, imports, call graph, HTTP routes, env vars. Before grep, find or reading whole files:

- \`where\` to find a feature, error message, route or name; \`symbols\` for a function or class by name.
- \`trace\` to see what calls what (a route, function or file); \`dependents\` before changing a file.
- \`file\` to see a file's symbols with line numbers, then \`source\` to read just the function you need.
- \`lookup_error\` for stack traces and log lines. \`overview\` and \`module\` in an unfamiliar repo.

Fall back to grep and reading files when Spelunk has no answer or you need exact text.
${END}`;

export interface SetupResult {
  steps: string[];
  /** Commands the person has to run themselves, when the claude CLI isn't on PATH. */
  manual: string[];
}

/** The note added to (or updated in) a CLAUDE.md, leaving the rest of the file as it was. */
export function withNote(existing: string): string {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start >= 0 && end > start) return existing.slice(0, start) + CLAUDE_MD_NOTE + existing.slice(end + END.length);
  return existing.trim() ? `${existing.replace(/\s*$/, "")}\n\n${CLAUDE_MD_NOTE}\n` : `${CLAUDE_MD_NOTE}\n`;
}

export async function setupClaude(options: { dryRun?: boolean; claudeMd?: string; claude?: string } = {}): Promise<SetupResult> {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const serverCommand = [process.execPath, cli, "mcp"];
  const claude = options.claude ?? "claude";
  const steps: string[] = [];
  const manual: string[] = [];
  const quote = (a: string) => (/^[\w./:@-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const addArgs = ["mcp", "add", "--scope", "user", "spelunk", "--", ...serverCommand];

  const hasClaude = await run(claude, ["--version"]).then(
    () => true,
    () => false,
  );
  if (!hasClaude) {
    manual.push([claude, ...addArgs].map(quote).join(" "));
  } else if (options.dryRun) {
    steps.push(`Would run: ${[claude, ...addArgs].map(quote).join(" ")}`);
  } else {
    // `mcp add` refuses a name that exists, so an earlier registration is removed first.
    await run(claude, ["mcp", "remove", "--scope", "user", "spelunk"]).catch(() => undefined);
    await run(claude, addArgs);
    steps.push(`Registered the spelunk MCP server for every project (user scope): ${serverCommand.map(quote).join(" ")}`);
  }

  const md = options.claudeMd ?? join(homedir(), ".claude", "CLAUDE.md");
  const before = existsSync(md) ? await readFile(md, "utf8") : "";
  const after = withNote(before);
  if (after === before) steps.push(`${md} already has the Spelunk note.`);
  else if (options.dryRun) steps.push(`Would ${before ? "update" : "create"} ${md} with a note telling Claude to use Spelunk before grep.`);
  else {
    await mkdir(dirname(md), { recursive: true });
    await writeFile(md, after);
    steps.push(`${before.includes(START) ? "Updated" : "Added"} the Spelunk note in ${md}.`);
  }
  return { steps, manual };
}
