import type { Index } from "../types.js";
import type { CallNode } from "../query/trace.js";
import { diagramSvg } from "./diagram.js";
import { sourceUrl, type Report } from "./model.js";

/**
 * The field guide: one self-contained HTML file. Works offline (fonts fall
 * back to system faces), follows the reader's light/dark setting, and links
 * every path to the code host when the repo has a remote.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (n: number) => n.toLocaleString("en");
const plural = (n: number, w: string) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;

/** Inline `code` and **bold** in Claude's prose, escaped first. */
function prose(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
}

/** Palette and fonts, shared with the dashboard. */
export const THEME_CSS = `
:root {
  --bg: #f6f7f4; --panel: #ffffff; --ink: #1b1f1a; --muted: #5c6459; --line: #dde2d8; --line-strong: #c3cbbd;
  --accent: #2f7d5b; --accent-ink: #1f5c41; --accent-soft: #e4f0e9; --code-bg: #eef1eb; --edge: #8f9a89;
  --high: #b3261e; --high-soft: #fbe5e3; --medium: #925c00; --medium-soft: #fbf0dc; --low: #4f5a4b; --low-soft: #eceee9;
  --display: "Fraunces", Georgia, "Times New Roman", serif;
  --body: "Inter Tight", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111511; --panel: #181d18; --ink: #e5eae2; --muted: #9aa596; --line: #283028; --line-strong: #3a453a;
  --accent: #6fcf9f; --accent-ink: #9fe2bf; --accent-soft: #1b2e24; --code-bg: #141914; --edge: #6d786a;
  --high: #ff8a80; --high-soft: #331816; --medium: #f0b860; --medium-soft: #2e2512; --low: #b6bfb2; --low-soft: #222822; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #111511; --panel: #181d18; --ink: #e5eae2; --muted: #9aa596; --line: #283028; --line-strong: #3a453a;
  --accent: #6fcf9f; --accent-ink: #9fe2bf; --accent-soft: #1b2e24; --code-bg: #141914; --edge: #6d786a;
  --high: #ff8a80; --high-soft: #331816; --medium: #f0b860; --medium-soft: #2e2512; --low: #b6bfb2; --low-soft: #222822; color-scheme: dark; }
`;

const CSS = `
${THEME_CSS}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 var(--body); }
.wrap { max-width: 1200px; margin: 0 auto; padding: 36px max(16px, env(safe-area-inset-right, 0px)) 80px max(16px, env(safe-area-inset-left, 0px)); display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 44px; }
nav { position: sticky; top: 20px; align-self: start; font-size: 13.5px; }
nav .k { font: 500 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
nav a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { background: var(--accent-soft); color: var(--ink); outline: none; }
main { min-width: 0; }
h1, h2, h3 { font-family: var(--display); line-height: 1.15; text-wrap: balance; margin: 0; font-weight: 600; }
h1 { font-size: clamp(30px, 5vw, 44px); margin-top: 10px; }
h2 { font-size: 26px; margin-bottom: 12px; }
h3 { font-size: 18px; margin: 24px 0 8px; }
p { margin: 0 0 12px; max-width: 72ch; }
section { padding-top: 40px; scroll-margin-top: 12px; }
a { color: var(--accent-ink); }
code { font-family: var(--mono); font-size: .86em; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
pre { font: 12.5px/1.55 var(--mono); background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
.eyebrow { font: 500 12px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.lede { font-size: 17px; color: var(--muted); max-width: 66ch; margin-top: 12px; }
.facts { display: flex; flex-wrap: wrap; gap: 8px 26px; margin-top: 18px; color: var(--muted); font-size: 14px; }
.facts b { color: var(--ink); font-variant-numeric: tabular-nums; }
.langbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 16px; max-width: 640px; background: var(--line); }
.langbar span { display: block; }
.langs { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--muted); margin-top: 8px; }
.langs i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.figure { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; overflow-x: auto; }
.figure svg { display: block; width: 100%; height: auto; }
.figure svg text { font-family: var(--body); }
.sp-node:hover rect { stroke: var(--accent); }
.cap { font-size: 13px; color: var(--muted); margin-top: 8px; }
.tw { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: 0; }
th { font: 500 11px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--code-bg); }
td.p { font-family: var(--mono); font-size: 12.5px; white-space: nowrap; }
td.n { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
details.mod { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 10px; scroll-margin-top: 12px; }
details.mod > summary { cursor: pointer; list-style: none; padding: 12px 16px; display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline; }
details.mod > summary::-webkit-details-marker { display: none; }
details.mod > summary::before { content: "▸"; color: var(--muted); font-size: 11px; }
details.mod[open] > summary::before { content: "▾"; }
details.mod > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 10px; }
.mn { font: 600 14px/1.3 var(--mono); }
.md { color: var(--muted); font-size: 13.5px; flex: 1 1 280px; }
.modbody { border-top: 1px solid var(--line); padding: 14px 16px; }
.modbody ul { margin: 4px 0 12px; padding-left: 20px; }
.modbody .tw { margin: 10px 0 0; }
.pill { display: inline-block; font: 600 11px/1 var(--mono); padding: 4px 7px; border-radius: 999px; white-space: nowrap; }
.high { background: var(--high-soft); color: var(--high); }
.medium { background: var(--medium-soft); color: var(--medium); }
.low { background: var(--low-soft); color: var(--low); }
.tag { display: inline-block; font: 500 11px/1 var(--mono); padding: 3px 6px; border-radius: 4px; background: var(--code-bg); color: var(--muted); }
ol.flow { list-style: none; counter-reset: s; padding: 0; margin: 0 0 16px; border-left: 2px solid var(--line); }
ol.flow > li { counter-increment: s; position: relative; padding: 0 0 12px 24px; max-width: 80ch; }
ol.flow > li::before { content: counter(s); position: absolute; left: -12px; top: 1px; width: 22px; height: 22px; border-radius: 50%; background: var(--panel); border: 2px solid var(--accent); color: var(--accent-ink); font: 600 11px/18px var(--mono); text-align: center; }
.loc { font: 12px var(--mono); color: var(--muted); }
ul.tree { list-style: none; margin: 0; padding-left: 18px; border-left: 1px dashed var(--line-strong); }
ul.tree.top { border: 0; padding-left: 0; }
ul.tree li { padding: 2px 0; font-size: 13.5px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 16px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.card h4 { margin: 0 0 6px; font: 600 14.5px/1.3 var(--body); }
.card p { font-size: 13.5px; color: var(--muted); margin: 0; }
.risk { border-left: 3px solid var(--line-strong); padding: 6px 0 6px 12px; margin: 0 0 8px; }
.risk.high { border-color: var(--high); background: none; color: inherit; }
.risk.medium { border-color: var(--medium); background: none; color: inherit; }
.risk.low { background: none; color: inherit; }
.search { width: 100%; max-width: 560px; font: 15px var(--body); padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--panel); color: var(--ink); }
.search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
#results { margin-top: 10px; }
#results .r { padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.note { border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 8px 8px 0; padding: 10px 14px; margin: 0 0 16px; max-width: 80ch; font-size: 14px; }
footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
@media (max-width: 900px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 0; padding-top: 20px; }
  nav { position: static; display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  nav .k { width: 100%; }
  nav a { border: 1px solid var(--line); padding: 3px 9px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`;

const LANG_COLORS = ["#2f7d5b", "#3b6fb6", "#b5672a", "#8a4fb0", "#c0414f", "#4c9a9a", "#9a8a2e", "#6b7280"];

export function renderHtml(r: Report, index: Index): string {
  const link = (path: string, line?: number, label?: string) => {
    const url = sourceUrl(r, path, line);
    const text = esc(label ?? `${path}${line ? `:${line}` : ""}`);
    return url ? `<a href="${esc(url)}"><code>${text}</code></a>` : `<code>${text}</code>`;
  };
  const o = r.overview;
  const nav: [string, string][] = [
    ["start", "Start here"],
    ["run", "Run it"],
    ["architecture", "Architecture"],
    ["map", "Code map"],
    ["find", "Find anything"],
    ...(r.routes.length ? ([["routes", "Routes"]] as [string, string][]) : []),
    ["flows", "Flows"],
    ["debug", "Debugging"],
    ...(r.env.length ? ([["config", "Configuration"]] as [string, string][]) : []),
    ["risks", "Risks"],
    ["tests", "Tests"],
    ...(o?.glossary.length ? ([["glossary", "Glossary"]] as [string, string][]) : []),
  ];
  const parts: string[] = [];

  // Header
  const totalLines = r.languages.reduce((n, l) => n + l.lines, 0) || 1;
  parts.push(`<header>
<div class="eyebrow">${esc(r.remote ? r.remote.replace(/^https:\/\//, "") : r.name)}${r.commit ? ` · ${esc(r.commit.slice(0, 7))}` : ""}</div>
<h1>${esc(r.name)} field guide</h1>
<p class="lede">${o ? prose(o.oneLiner) : `Where the code lives, how it connects, and where to look when it breaks. Run <code>spelunk explain</code> to add Claude's explanations to this guide.`}</p>
<div class="facts"><span><b>${fmt(r.stats.codeFiles)}</b> code files</span><span><b>${fmt(r.stats.codeLines)}</b> lines</span><span><b>${fmt(r.stats.symbols)}</b> symbols</span><span><b>${fmt(r.stats.routes)}</b> routes</span><span><b>${fmt(r.stats.tests)}</b> test files</span><span><b>${fmt(r.stats.env)}</b> env vars</span></div>
<div class="langbar" aria-hidden="true">${r.languages.slice(0, 8).map((l, i) => `<span style="width:${((l.lines / totalLines) * 100).toFixed(2)}%;background:${LANG_COLORS[i]}"></span>`).join("")}</div>
<div class="langs">${r.languages.slice(0, 8).map((l, i) => `<span><i style="background:${LANG_COLORS[i]}"></i>${esc(l.language)} ${((l.lines / totalLines) * 100).toFixed(0)}%</span>`).join("")}</div>
</header>`);

  // Start here
  parts.push(`<section id="start"><h2>Start here</h2>`);
  if (o) parts.push(`<p>${prose(o.whatItDoes)}</p>`);
  if (r.entries.length) {
    parts.push(`<h3>Where execution starts</h3><div class="tw"><table><tr><th>File</th><th>Kind</th></tr>${r.entries.map((e) => `<tr><td class="p">${link(e.path)}</td><td>${esc(e.label)}</td></tr>`).join("")}</table></div>`);
  }
  const hot = r.risks.find((g) => g.kind === "hotspot")?.items.slice(0, 5) ?? [];
  if (hot.length) parts.push(`<h3>Read these first</h3><p>The biggest files that change most often. Most bugs live here.</p><ul>${hot.map((h) => `<li>${link(h.locations[0]!.path)} <span class="loc">${esc(h.title.replace(/^\S+ /, ""))}</span></li>`).join("")}</ul>`);
  parts.push(`</section>`);

  // Run it
  parts.push(`<section id="run"><h2>Run it</h2>`);
  if (o?.runLocally.length) parts.push(`<ol class="flow">${o.runLocally.map((s) => `<li>${prose(s)}</li>`).join("")}</ol>`);
  const cmdRows = r.commands.filter((c) => c.kind !== "compose" || r.commands.length < 40).slice(0, 60);
  if (cmdRows.length) parts.push(`<h3>Commands the project defines</h3><div class="tw"><table><tr><th>Where</th><th>Name</th><th>Runs</th></tr>${cmdRows.map((c) => `<tr><td class="p">${link(c.manifest)}</td><td>${esc(c.name)}</td><td><code>${esc(c.command)}</code></td></tr>`).join("")}</table></div>`);
  else parts.push(`<p>No package scripts, Makefile targets, Dockerfiles or CI steps were found.</p>`);
  parts.push(`</section>`);

  // Architecture
  parts.push(`<section id="architecture"><h2>Architecture</h2>${o ? `<p>${prose(o.architecture)}</p>` : ""}<div class="figure">${diagramSvg(r.modules)}<div class="cap">Each box is a directory of source files; arrows point from a module to the modules it imports. Darker boxes hold more code. Dashed arrows point upwards and usually mean a cycle. Click a box to open it in the code map.</div></div></section>`);

  // Code map
  parts.push(`<section id="map"><h2>Code map</h2><p>${plural(r.modules.length, "module")}. Open one to see its files${o ? " and Claude's notes" : ""}.</p>`);
  for (const m of r.modules) {
    const e = m.explanation;
    const roles = new Map(e?.keyFiles.map((k) => [k.path, k.role]));
    const rows = [...m.files].sort((a, b) => b.usedBy - a.usedBy || b.lines - a.lines).map((f) => `<tr><td class="p">${link(f.path, undefined, f.path.slice(m.path ? m.path.length + 1 : 0))}</td><td>${prose(roles.get(f.path) ?? f.doc ?? "")}</td><td class="n">${fmt(f.lines)}</td><td class="n">${f.usedBy || ""}</td></tr>`);
    parts.push(`<details class="mod" id="mod-${esc(encodeURIComponent(m.path || "root"))}"><summary><span class="mn">${esc(m.path || "(root)")}</span><span class="md">${e ? prose(e.summary) : `${plural(m.files.length, "file")}, ${fmt(m.lines)} lines`}</span></summary><div class="modbody">
${e?.responsibilities.length ? `<b>What it does</b><ul>${e.responsibilities.map((x) => `<li>${prose(x)}</li>`).join("")}</ul>` : ""}
${e?.gotchas.length ? `<b>Watch out for</b><ul>${e.gotchas.map((x) => `<li>${prose(x)}</li>`).join("")}</ul>` : ""}
${m.dependsOn.length ? `<p class="loc">Imports from ${m.dependsOn.map((d) => esc(d.path || "(root)")).join(", ")}</p>` : ""}
<div class="tw"><table><tr><th>File</th><th>What it is</th><th>Lines</th><th>Used by</th></tr>${rows.join("")}</table></div></div></details>`);
  }
  parts.push(`</section>`);

  // Find anything
  const searchData = index.files
    .filter((f) => f.role !== "generated")
    .flatMap((f) => [
      [f.path, "file", f.path, 0, f.doc ?? "", f.role === "source" ? 1 : 0],
      ...f.symbols.filter((s) => !s.parent || s.exported).map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s.kind, f.path, s.line, s.doc ?? "", f.role === "source" ? 1 : 0]),
      ...f.routes.filter((x) => x.side === "server").map((x) => [`${x.method} ${x.path}`, "route", f.path, x.line, "", 1]),
      ...f.env.map((x) => [x.text, "env", f.path, x.line, "", 1]),
    ]);
  parts.push(`<section id="find"><h2>Find anything</h2><p>Search files, functions, classes, routes and environment variables by name or comment.</p>
<input class="search" id="q" type="search" placeholder="e.g. auth, updatePage, /api/pages, DATABASE_URL" autocomplete="off" aria-label="Search the codebase">
<div id="results" aria-live="polite"></div>
<p class="loc">For questions in plain words, run <code>spelunk where "how are pages saved?"</code> or ask Claude Code through the Spelunk MCP server.</p></section>`);

  // Routes
  if (r.routes.length) {
    parts.push(`<section id="routes"><h2>Routes</h2><p>${plural(r.routes.length, "server route")}. "Called from" lists client code whose requests match the route.</p><div class="tw"><table><tr><th>Method</th><th>Path</th><th>Defined in</th><th>Called from</th></tr>${r.routes
      .map((x) => `<tr><td><span class="tag">${esc(x.method)}</span></td><td class="p">${esc(x.path)}</td><td class="p">${link(x.file, x.line)}</td><td class="p">${x.callers.map((c) => link(c.path, c.line)).join("<br>")}</td></tr>`)
      .join("")}</table></div></section>`);
  }

  // Flows
  parts.push(`<section id="flows"><h2>Flows</h2>`);
  if (o?.flows.length) {
    for (const f of o.flows) parts.push(`<h3>${esc(f.name)}</h3><p>${prose(f.summary)}</p><ol class="flow">${f.steps.map((s) => `<li>${prose(s.what)} <span class="loc">${link(s.path, s.line, `${s.path}${s.symbol ? ` · ${s.symbol}` : ""}`)}</span></li>`).join("")}</ol>`);
  }
  if (r.staticFlows.length) {
    parts.push(o?.flows.length ? `<h3>Call trees from static analysis</h3>` : `<p>What the busiest routes call, resolved from imports and call sites.</p>`);
    const tree = (nodes: CallNode[], top = false): string => `<ul class="tree${top ? " top" : ""}">${nodes.map((n) => `<li><b>${esc(n.name)}</b> <span class="loc">${link(n.path, n.line)}</span>${n.children.length ? tree(n.children) : ""}</li>`).join("")}</ul>`;
    for (const f of r.staticFlows) {
      parts.push(`<div class="card" style="margin-bottom:12px"><h4><span class="tag">${esc(f.label.split(" ")[0]!)}</span> ${esc(f.label.split(" ").slice(1).join(" "))}</h4><p>Handled in ${link(f.path, f.line)}${f.callers.length ? `, called from ${f.callers.map((c) => link(c.path, c.line)).join(", ")}` : ""}</p>${tree(f.tree, true)}</div>`);
    }
  }
  if (!o?.flows.length && !r.staticFlows.length) parts.push(`<p>No routes with resolvable calls were found. Use <code>spelunk trace &lt;function&gt;</code> to follow a specific function.</p>`);
  parts.push(`</section>`);

  // Debugging
  parts.push(`<section id="debug"><h2>Debugging</h2>`);
  if (o) {
    parts.push(`<div class="cards"><div class="card"><h4>Check first</h4><ul>${o.debugging.firstChecks.map((x) => `<li>${prose(x)}</li>`).join("")}</ul></div><div class="card"><h4>Where errors show up</h4><ul>${o.debugging.logs.map((x) => `<li>${prose(x)}</li>`).join("")}</ul></div></div>`);
    if (o.debugging.failurePoints.length) parts.push(`<h3>Likely failure points</h3><div class="tw"><table><tr><th>Symptom</th><th>Likely cause</th><th>Where to look</th></tr>${o.debugging.failurePoints.map((f) => `<tr><td>${prose(f.symptom)}</td><td>${prose(f.likelyCause)}</td><td>${prose(f.whereToLook)}</td></tr>`).join("")}</table></div>`);
  } else {
    parts.push(`<div class="note">Run <code>spelunk explain</code> to have Claude write a debugging guide here: what to check first, where errors appear, and the likeliest failure points.</div>`);
  }
  if (r.errorLogs.length) parts.push(`<h3>Error and warning log statements</h3><p>What the code itself reports when something goes wrong. Search your logs for these.</p><div class="tw"><table><tr><th>Where</th><th>Statement</th></tr>${r.errorLogs.slice(0, 80).map((l) => `<tr><td class="p">${link(l.path, l.line)}</td><td><code>${esc(l.text)}</code></td></tr>`).join("")}</table></div>`);
  parts.push(`<h3>Following a bug</h3><pre><code>spelunk where "the thing that broke"     # find the code
spelunk trace "POST /api/orders"          # what the route calls, and who calls it
spelunk trace createOrder                 # a function's call tree and its callers
spelunk risks --kind swallowed-error      # places where errors vanish</code></pre></section>`);

  // Configuration
  if (r.env.length) {
    parts.push(`<section id="config"><h2>Configuration</h2><div class="tw"><table><tr><th>Variable</th><th>Read in</th><th>In .env example</th></tr>${r.env
      .map((e) => `<tr><td class="p">${esc(e.name)}</td><td class="p">${e.readAt.slice(0, 3).map((a) => link(a.path, a.line)).join("<br>") || '<span class="loc">never read</span>'}</td><td>${e.documented ? "yes" : '<span class="pill low">no</span>'}</td></tr>`)
      .join("")}</table></div></section>`);
  }

  // Risks
  const counts = { high: 0, medium: 0, low: 0 };
  for (const g of r.risks) for (const x of g.items) counts[x.severity]++;
  parts.push(`<section id="risks"><h2>Risks</h2><p><span class="pill high">${counts.high} high</span> <span class="pill medium">${counts.medium} medium</span> <span class="pill low">${counts.low} low</span></p>`);
  for (const g of r.risks) {
    const shown = g.items.slice(0, 30);
    parts.push(`<h3>${esc(g.kind.replace(/-/g, " "))} <span class="loc">(${g.items.length})</span></h3><p class="loc">${esc(g.info)}</p>${shown
      .map((x) => `<div class="risk ${x.severity}"><span class="pill ${x.severity}">${x.severity}</span> ${esc(x.title)}<br><span class="loc">${x.locations.slice(0, 4).map((l) => link(l.path, l.line)).join(" · ")}${x.locations.length > 4 ? ` and ${x.locations.length - 4} more` : ""}</span></div>`)
      .join("")}${g.items.length > shown.length ? `<p class="loc">and ${g.items.length - shown.length} more; run <code>spelunk risks --kind ${g.kind}</code></p>` : ""}`);
  }
  if (!r.risks.length) parts.push(`<p>Nothing flagged.</p>`);
  parts.push(`</section>`);

  // Tests
  parts.push(`<section id="tests"><h2>Tests</h2>`);
  if (r.tests.length) {
    const runners = r.commands.filter((c) => /test|spec|pytest|vitest|jest|go test|cargo test/i.test(`${c.name} ${c.command}`)).slice(0, 8);
    if (runners.length) parts.push(`<p>Run them with:</p><ul>${runners.map((c) => `<li><code>${esc(c.command)}</code> <span class="loc">(${esc(c.name)} in ${esc(c.manifest)})</span></li>`).join("")}</ul>`);
    parts.push(`<div class="tw"><table><tr><th>Test file</th><th>Imports from the code</th></tr>${r.tests.slice(0, 120).map((t) => `<tr><td class="p">${link(t.path)}</td><td class="p">${t.covers.slice(0, 6).map((c) => esc(c)).join("<br>")}${t.covers.length > 6 ? `<br>and ${t.covers.length - 6} more` : ""}</td></tr>`).join("")}</table></div>`);
  } else parts.push(`<p>No test files were found.</p>`);
  parts.push(`</section>`);

  if (o?.glossary.length) parts.push(`<section id="glossary"><h2>Glossary</h2><div class="tw"><table>${o.glossary.map((g) => `<tr><td><b>${esc(g.term)}</b></td><td>${prose(g.meaning)}</td></tr>`).join("")}</table></div></section>`);

  parts.push(`<footer>Generated by Spelunk on ${esc(r.generatedAt.slice(0, 10))}${r.commit ? ` from commit <code>${esc(r.commit.slice(0, 12))}</code>` : ""}.${r.explainedAt ? ` Explanations written by Claude on ${esc(r.explainedAt.slice(0, 10))}; check them against the code.` : ""} Paths and line numbers drift as the code changes; run <code>spelunk map</code> again to refresh.</footer>`);

  const script = `const D=${JSON.stringify(searchData).replace(/</g, "\\u003c")};const L=${JSON.stringify(r.links ?? null)};
const q=document.getElementById("q"),out=document.getElementById("results");
const words=s=>s.replace(/([a-z0-9])([A-Z])/g,"$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
function run(){const t=q.value.trim();if(!t){out.innerHTML="";return}const ws=words(t),lt=t.toLowerCase();
const hits=[];for(const [name,kind,path,line,doc,src] of D){const n=name.toLowerCase();let s=0;if(n===lt)s+=20;else if(n.includes(lt))s+=8;
const nw=words(name),pw=words(path),dw=words(doc);for(const w of ws){if(nw.some(x=>x.startsWith(w)))s+=4;else if(pw.some(x=>x.startsWith(w)))s+=1.5;else if(dw.includes(w))s+=1;else{s-=2}}
if(s>0)hits.push([src?s:s*0.6,name,kind,path,line])}
hits.sort((a,b)=>b[0]-a[0]);out.innerHTML=hits.slice(0,25).map(([s,name,kind,path,line])=>{const loc=path+(line?":"+line:"");const u=L?L.template.replace("{path}",path).replace("{line}",line?L.anchor+line:""):"";
return '<div class="r"><span class="tag">'+esc(kind)+'</span> <b>'+esc(name)+'</b> '+(u?'<a href="'+esc(u)+'"><code>'+esc(loc)+'</code></a>':'<code>'+esc(loc)+'</code>')+'</div>'}).join("")||'<p class="loc">No matches.</p>'}
q.addEventListener("input",run);`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(r.name)} · Spelunk field guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<nav aria-label="Sections"><div class="k">Field guide</div>${nav.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join("")}</nav>
<main>
${parts.join("\n")}
</main>
</div>
<script>${script}</script>
</body>
</html>
`;
}
