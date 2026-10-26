import type { CallNode } from "../query/trace.js";
import type { Report } from "./model.js";

/**
 * The onboarding tour: a fixed path through a new codebase for someone's
 * first day, built from the report. Every step says why it matters and names
 * the few files to open, in order. Claude's explanations fill in the prose
 * when they exist; without them the tour still works from the index.
 */

export interface TourStep {
  id: string;
  title: string;
  /** A short paragraph; inline `code` allowed. */
  body: string;
  /** Files to open for this step, in reading order. */
  open: { path: string; line?: number; why: string }[];
  /** Commands to run, when the step has any. */
  commands?: { command: string; why: string }[];
  /** Something to try in Spelunk before moving on. */
  tryIt?: { kind: "find" | "trace"; query: string; prompt: string };
}

const firstSentence = (s: string | undefined) => s?.split(/(?<=[.!?])\s/)[0];

function flatten(nodes: CallNode[], out: CallNode[] = []): CallNode[] {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

export function buildTour(r: Report): TourStep[] {
  const steps: TourStep[] = [];
  const o = r.overview;
  const source = r.modules.filter((m) => m.lines > 0);

  steps.push({
    id: "what",
    title: `What ${r.name} is`,
    body: o
      ? `${o.oneLiner} ${o.whatItDoes}`
      : `${r.name} is ${r.stats.codeFiles.toLocaleString("en")} code files (${r.stats.codeLines.toLocaleString("en")} lines), mostly ${r.languages.slice(0, 2).map((l) => l.language).join(" and ")}. It has ${r.stats.routes} HTTP routes and ${r.stats.tests} test files.`,
    open: r.entries.length ? [] : [{ path: r.modules[0]?.files[0]?.path ?? "", why: "A place to start reading" }].filter((x) => x.path),
  });

  // Root manifest first, then the usual order: set up, run, test.
  const order = ["setup", "install", "bootstrap", "migrate", "seed", "dev", "start", "run", "build", "test"];
  const rank = (c: Report["commands"][number]) => {
    const i = order.findIndex((w) => c.name.includes(w));
    return c.manifest.split("/").length * 100 + (i < 0 ? 50 : i);
  };
  const cmds = r.commands.filter((c) => /^(npm run (dev|start|test|build|setup|bootstrap|seed|migrate)|make (dev|run|test|setup|install)|bin )/.test(c.name) || c.kind === "python").filter((c) => !/:prod\b|:ci\b/.test(c.name)).sort((a, b) => rank(a) - rank(b)).slice(0, 6);
  steps.push({
    id: "run",
    title: "Get it running",
    body: o?.runLocally.length
      ? o.runLocally.join(" ")
      : "Run it before you read it: seeing the app work makes the code easier to follow. These are the commands the project defines; start with install, then dev or start.",
    open: [],
    commands: cmds.map((c) => ({ command: c.name.startsWith("npm run ") || c.name.startsWith("make ") ? c.name : c.command, why: `${c.name.startsWith("bin ") ? "The CLI" : "Defined"} in ${c.manifest}` })),
  });

  const missing = r.env.filter((e) => e.readAt.length && !e.documented);
  if (r.env.length) {
    steps.push({
      id: "config",
      title: "The settings it needs",
      body: `The code reads ${r.env.length} environment variables. ${missing.length ? `${missing.length} of them aren't in the example .env file, so a fresh setup will miss them: ${missing.slice(0, 6).map((e) => `\`${e.name}\``).join(", ")}.` : "All of them are in the example .env file."} When the app won't start, a missing setting is the usual reason.`,
      open: [...new Set(r.env.flatMap((e) => e.readAt.map((l) => l.path)))].slice(0, 2).map((path) => ({ path, why: "Where settings are read" })),
    });
  }

  steps.push({
    id: "map",
    title: "The big parts",
    body: o?.architecture ?? `The code is split into ${source.length} parts (folders). The biggest ones are ${[...source].sort((a, b) => b.lines - a.lines).slice(0, 4).map((m) => `\`${m.path || "(root)"}\``).join(", ")}. The diagram on the Overview page shows which parts use which.`,
    open: [...source].sort((a, b) => b.lines - a.lines).slice(0, 4).map((m) => {
      const top = [...m.files].sort((a, b) => b.usedBy - a.usedBy)[0]!;
      return { path: top.path, why: m.explanation ? firstSentence(m.explanation.summary)! : `The most-used file in ${m.path || "the root"}` };
    }),
  });

  if (r.entries.length) {
    steps.push({
      id: "entry",
      title: "Where the program starts",
      body: "Every run begins in one of these files. Read the top of each: it shows what gets set up (config, database, server) and in which order.",
      open: r.entries.slice(0, 4).map((e) => ({ path: e.path, why: e.label })),
    });
  }

  const flow = o?.flows[0];
  const sf = r.staticFlows[0];
  if (flow) {
    steps.push({
      id: "flow",
      title: `Follow one request: ${flow.name}`,
      body: `${flow.summary} Open each step in order and keep the previous one in mind.`,
      open: flow.steps.slice(0, 8).map((s) => ({ path: s.path, ...(s.line ? { line: s.line } : {}), why: s.what })),
      ...(sf ? { tryIt: { kind: "trace" as const, query: sf.label, prompt: `Trace ${sf.label} to see the same path as a call tree.` } } : {}),
    });
  } else if (sf) {
    const calls = flatten(sf.tree).slice(0, 6);
    steps.push({
      id: "flow",
      title: `Follow one request: ${sf.label}`,
      body: `Most bugs are easiest to find by following a request from the screen to the database. This one starts ${sf.callers.length ? "in the front end, " : ""}goes to its handler, then into the functions it calls.`,
      open: [...sf.callers.slice(0, 1).map((c) => ({ path: c.path, line: c.line, why: "The front end sends the request here" })), { path: sf.path, line: sf.line, why: "The route handler" }, ...calls.map((c) => ({ path: c.path, line: c.line, why: `${c.name}()` }))],
      tryIt: { kind: "trace", query: sf.label, prompt: `Trace ${sf.label} and click through the call tree.` },
    });
  }

  const core = r.modules.flatMap((m) => m.files.filter((f) => f.role === "source")).sort((a, b) => b.usedBy - a.usedBy).slice(0, 5);
  if (core.length) {
    steps.push({
      id: "core",
      title: "The files everything depends on",
      body: "These are imported by more of the code than any others. Changing them affects the most, so it pays to know them well.",
      open: core.map((f) => ({ path: f.path, why: `Imported by ${f.usedBy} files${f.doc ? `. ${firstSentence(f.doc)}` : ""}` })),
    });
  }

  const hot = r.risks.find((g) => g.kind === "hotspot")?.items ?? [];
  const swallowed = r.risks.find((g) => g.kind === "swallowed-error")?.items ?? [];
  if (hot.length || swallowed.length) {
    steps.push({
      id: "risks",
      title: "Where bugs hide",
      body: `${hot.length ? "Hotspots are big files that change often; most bugs land there. " : ""}${swallowed.length ? `${swallowed.length} places catch an error and do nothing with it, so failures there leave no trace. ` : ""}Look at these before you need to.`,
      open: [...hot.slice(0, 3), ...swallowed.slice(0, 3)].map((x) => ({ path: x.locations[0]!.path, ...(x.locations[0]!.line ? { line: x.locations[0]!.line } : {}), why: x.title })),
    });
  }

  const debug = o?.debugging;
  steps.push({
    id: "debug",
    title: "When something breaks",
    body: debug
      ? `First checks: ${debug.firstChecks.slice(0, 3).join(" ")} Logs: ${debug.logs.slice(0, 2).join(" ")}`
      : "Copy the exact error, paste it into Error lookup to find the code that raised it, then trace that code to see who calls it.",
    open: r.errorLogs.slice(0, 3).map((l) => ({ path: l.path, line: l.line, why: "Logs errors" })),
    ...(r.errorLogs[0] ? { tryIt: { kind: "find" as const, query: "error", prompt: "Search for where errors are handled." } } : {}),
  });

  const testCmd = r.commands.find((c) => /^(npm run test|make test)/.test(c.name) || /pytest|go test|cargo test/.test(c.command));
  steps.push({
    id: "tests",
    title: "How it's tested",
    body: r.tests.length
      ? `There are ${r.tests.length} test files. Before changing a file, find the tests that cover it (Changes shows them for a branch) and run them first so you know they pass.`
      : "There are no automated tests, so check changes by hand, starting from the request you followed earlier.",
    open: [...r.tests].sort((a, b) => b.covers.length - a.covers.length).slice(0, 3).map((t) => ({ path: t.path, why: `Covers ${t.covers.slice(0, 2).join(", ") || "end to end"}` })),
    ...(testCmd ? { commands: [{ command: testCmd.name.startsWith("npm run") ? testCmd.name : testCmd.command, why: "Runs the tests" }] } : {}),
  });

  if (o?.glossary.length) {
    steps.push({ id: "words", title: "Words this team uses", body: o.glossary.slice(0, 8).map((g) => `**${g.term}**: ${g.meaning}`).join(" "), open: [] });
  }
  return steps.filter((s) => s.body);
}

export function formatTour(r: Report, steps: TourStep[]): string {
  const out = [`# Your first day in ${r.name}`, "", `${steps.length} steps. Open each file in order; you don't need to read every line.`, ""];
  steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, "", s.body, "");
    if (s.commands?.length) out.push(...s.commands.map((c) => `    ${c.command}    # ${c.why}`), "");
    if (s.open.length) out.push(...s.open.map((f) => `- \`${f.line ? `${f.path}:${f.line}` : f.path}\`: ${f.why}`), "");
    if (s.tryIt) out.push(`Try it: ${s.tryIt.prompt} (\`spelunk ${s.tryIt.kind === "find" ? "where" : "trace"} "${s.tryIt.query}"\`)`, "");
  });
  return out.join("\n");
}
