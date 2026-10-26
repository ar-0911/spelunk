import { THEME_CSS } from "../report/html.js";

/**
 * The dashboard page: one HTML document with inline CSS and JS that talks to
 * the local server's /api routes. No framework, no build step, no network.
 */

const CSS = `
${THEME_CSS}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14.5px/1.55 var(--body); }
button, input { font: inherit; color: inherit; }
a { color: var(--accent-ink); }
code, .mono { font-family: var(--mono); font-size: .86em; }
code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
h1, h2, h3 { font-family: var(--display); font-weight: 600; line-height: 1.15; margin: 0; text-wrap: balance; }
h1 { font-size: clamp(26px, 4vw, 38px); }
h2 { font-size: 22px; margin: 28px 0 10px; }
h3 { font-size: 16px; margin: 18px 0 6px; font-family: var(--body); }
p { margin: 0 0 10px; max-width: 75ch; }
.muted { color: var(--muted); }
.app { display: grid; grid-template-rows: auto 1fr; height: 100%; }
header.top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.brand { font: 600 19px/1 var(--display); display: flex; align-items: center; gap: 8px; margin-right: 6px; }
.brand svg { color: var(--accent); }
.repo { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 260px; }
.repo .path { font: 12.5px var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.btn { border: 1px solid var(--line-strong); background: var(--panel); border-radius: 7px; padding: 6px 12px; cursor: pointer; white-space: nowrap; text-decoration: none; color: var(--ink); font-size: 13.5px; }
.btn:hover { border-color: var(--accent); }
.btn:focus-visible, .navb:focus-visible, .chip:focus-visible, .lnk:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
.btn:disabled { opacity: .5; cursor: default; }
.body { display: grid; grid-template-columns: 196px minmax(0, 1fr); min-height: 0; }
nav.side { border-right: 1px solid var(--line); padding: 14px 10px; overflow-y: auto; }
.navb { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; background: none; border: 0; border-radius: 7px; padding: 8px 10px; cursor: pointer; color: var(--muted); font-size: 14px; }
.navb:hover { background: var(--accent-soft); color: var(--ink); }
.navb[aria-current="page"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.navb .n { margin-left: auto; font: 11px var(--mono); }
.navhint { font-size: 12px; color: var(--muted); padding: 14px 10px 0; line-height: 1.45; }
main { overflow-y: auto; padding: 24px clamp(16px, 3vw, 36px) 80px; min-width: 0; }
.view { max-width: 1100px; }
.lede { font-size: 16px; color: var(--muted); margin-top: 8px; }
.stats { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 14px 0 6px; color: var(--muted); font-size: 13.5px; }
.stats b { color: var(--ink); font-variant-numeric: tabular-nums; }
.langbar { display: flex; height: 7px; border-radius: 4px; overflow: hidden; max-width: 560px; background: var(--line); margin-top: 8px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.card h4 { margin: 0 0 6px; font-size: 14px; }
.card .lnk { font-size: 12.5px; }
.card.click { cursor: pointer; text-align: left; width: 100%; font: inherit; color: inherit; }
.card.click:hover { border-color: var(--accent); }
.lnk { font: 12.5px var(--mono); color: var(--accent-ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); text-underline-offset: 2px; text-align: left; overflow-wrap: anywhere; }
.lnk:hover { text-decoration-color: currentColor; }
.figure { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow-x: auto; }
.figure svg { display: block; width: 100%; height: auto; }
.figure svg text { font-family: var(--body); }
.sp-node:hover rect { stroke: var(--accent); }
.tw { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 7px 12px; border-bottom: 1px solid var(--line); }
tr:last-child td { border-bottom: 0; }
th { font: 500 11px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--code-bg); }
.tag { display: inline-block; font: 500 11px/1 var(--mono); padding: 3px 6px; border-radius: 4px; background: var(--code-bg); color: var(--muted); white-space: nowrap; }
.pill { display: inline-block; font: 600 11px/1 var(--mono); padding: 4px 7px; border-radius: 999px; white-space: nowrap; }
.high { background: var(--high-soft); color: var(--high); }
.medium { background: var(--medium-soft); color: var(--medium); }
.low { background: var(--low-soft); color: var(--low); }
.searchrow { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.field { flex: 1 1 320px; max-width: 640px; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--panel); font-size: 15px; }
.field:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 14px; }
.chip { border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 4px 11px; font-size: 13px; cursor: pointer; color: var(--muted); }
.chip:hover, .chip[aria-pressed="true"] { border-color: var(--accent); color: var(--accent-ink); background: var(--accent-soft); }
.hit { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 4px 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.hit .why { color: var(--muted); font-size: 13px; }
.tree { list-style: none; margin: 0; padding-left: 18px; border-left: 1px dashed var(--line-strong); }
.tree.top { border: 0; padding-left: 0; }
.tree li { padding: 3px 0; }
.chain { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 0; }
.chain .arrow { color: var(--muted); }
.risk { border-left: 3px solid var(--line-strong); padding: 6px 0 6px 12px; margin: 0 0 10px; }
.risk.sev-high { border-color: var(--high); }
.risk.sev-medium { border-color: var(--medium); }
.note { border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 8px 8px 0; padding: 10px 14px; margin: 0 0 14px; max-width: 80ch; }
.err { border-left-color: var(--high); }
.empty { padding: 40px 0; color: var(--muted); }
ol.steps { padding-left: 20px; } ol.steps li { margin-bottom: 6px; }
.log { font: 12.5px/1.6 var(--mono); background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; max-height: 240px; overflow-y: auto; white-space: pre-wrap; }
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--line-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
/* File drawer */
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100%); background: var(--panel); border-left: 1px solid var(--line-strong); box-shadow: -12px 0 32px rgba(0,0,0,.18); display: grid; grid-template-rows: auto auto 1fr; z-index: 20; transform: translateX(102%); visibility: hidden; transition: transform .18s ease, visibility 0s linear .18s; }
.drawer.open { transform: none; visibility: visible; transition: transform .18s ease; }
.drawer .dh { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.drawer .dh .t { flex: 1; min-width: 0; }
.drawer .dh .t b { font: 600 13.5px var(--mono); overflow-wrap: anywhere; }
.drawer .tabs { display: flex; gap: 4px; padding: 8px 16px 0; border-bottom: 1px solid var(--line); }
.drawer .tabs button { border: 0; background: none; padding: 6px 10px; border-bottom: 2px solid transparent; cursor: pointer; color: var(--muted); }
.drawer .tabs button[aria-selected="true"] { color: var(--ink); border-color: var(--accent); }
.drawer .pane { overflow: auto; min-height: 0; }
.code { font: 12.5px/1.6 var(--mono); margin: 0; padding: 8px 0; counter-reset: ln; }
.code .l { display: grid; grid-template-columns: 52px 1fr; white-space: pre; min-height: 1.6em; }
.code .l > i { font-style: normal; color: var(--muted); text-align: right; padding-right: 14px; user-select: none; opacity: .7; }
.code .l.hl { background: var(--accent-soft); }
.code .l.hl > i { color: var(--accent-ink); opacity: 1; }
.outline { padding: 6px 16px 30px; }
.outline .sym { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 3px 0; }
.outline .sym > div { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; min-width: 0; overflow-wrap: anywhere; }
.outline .sym .lnk { text-align: right; }
.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.25); z-index: 15; display: none; }
.scrim.open { display: block; }
/* Folder picker */
dialog { border: 1px solid var(--line-strong); border-radius: 12px; background: var(--panel); color: var(--ink); width: min(640px, calc(100% - 32px)); padding: 0; }
dialog::backdrop { background: rgba(0,0,0,.35); }
.dlg { padding: 18px 20px; display: grid; gap: 10px; }
.dirs { max-height: 320px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; }
.dirs button { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--line); background: none; padding: 7px 12px; cursor: pointer; font: 13px var(--mono); }
.dirs button:hover { background: var(--accent-soft); }
.welcome { max-width: 640px; margin: 8vh auto 0; text-align: left; }
.welcome ol { padding-left: 20px; color: var(--muted); }
@media (max-width: 820px) {
  .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
  nav.side { border-right: 0; border-bottom: 1px solid var(--line); display: flex; overflow-x: auto; padding: 6px 10px; gap: 2px; }
  .navb { width: auto; white-space: nowrap; }
  .navb .n, .navhint { display: none; }
  .hit { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .drawer { transition: none; } .spinner { animation: none; } }
`;

const JS = String.raw`
const T = new URLSearchParams(location.search).get("t") || "";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n).toLocaleString("en");
const prose = (s) => esc(s).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
const LANG_COLORS = ["#2f7d5b", "#3b6fb6", "#b5672a", "#8a4fb0", "#c0414f", "#4c9a9a", "#9a8a2e", "#6b7280"];

async function api(path, body) {
  const res = await fetch(path, { method: body ? "POST" : "GET", headers: { "x-spelunk-token": T, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({ error: "The Spelunk server stopped. Start it again with spelunk ui." }));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// A clickable path:line that opens the file drawer.
const loc = (path, line, label) => '<button class="lnk" data-open="' + esc(path) + '" data-line="' + (line || "") + '">' + esc(label || (path + (line ? ":" + line : ""))) + "</button>";
const traceBtn = (target, label) => '<button class="lnk" data-trace="' + esc(target) + '">' + esc(label || target) + "</button>";

let state = {}, report = null, view = "overview", riskKind = "";

const VIEWS = [
  ["overview", "Overview", "M3 12h18M3 6h18M3 18h12"],
  ["find", "Find", "M11 19a8 8 0 1 1 5.3-14 8 8 0 0 1-5.3 14Zm10 2-4.3-4.3"],
  ["trace", "Trace", "M4 6h6v4H4zM14 14h6v4h-6zM7 10v4a2 2 0 0 0 2 2h5"],
  ["risks", "Risks", "M12 3 2 21h20L12 3Zm0 7v5m0 3v.5"],
  ["routes", "Routes", "M4 7h10M4 12h16M4 17h7"],
  ["debug", "Debugging", "M9 9h6v8a3 3 0 0 1-6 0V9Zm-4 3h4m6 0h4M6 7l3 2m9-2-3 2M6 19l3-2m9 2-3-2"],
  ["config", "Config", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  ["explain", "Explain with Claude", "M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"],
];
const icon = (d) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';

function renderNav() {
  const counts = { risks: report ? report.risks.reduce((n, g) => n + g.items.length, 0) : "", routes: report ? report.routes.length : "", config: report ? report.env.length : "" };
  $("#nav").innerHTML = VIEWS.map(([id, label, d]) => '<button class="navb" data-view="' + id + '"' + (view === id ? ' aria-current="page"' : "") + ">" + icon(d) + esc(label) + (counts[id] !== undefined && counts[id] !== "" ? '<span class="n">' + counts[id] + "</span>" : "") + "</button>").join("") +
    '<p class="navhint">Click any <span class="mono" style="color:var(--accent-ink)">path:line</span> to read the code there.</p>';
}

function go(v, arg) {
  view = v;
  renderNav();
  const main = $("#main");
  main.scrollTop = 0;
  if (!state.root) return renderWelcome();
  if (!report) { main.innerHTML = '<div class="view empty"><span class="spinner"></span> Reading the repository…</div>'; return; }
  ({ overview: vOverview, find: vFind, trace: vTrace, risks: vRisks, routes: vRoutes, debug: vDebug, config: vConfig, explain: vExplain })[v](arg);
}

// ---------- Welcome & folder picker
function renderWelcome() {
  $("#main").innerHTML = '<div class="welcome"><h1>Find your way around a codebase</h1><p class="lede">Spelunk reads a project folder and shows you how it fits together: what each part does, where things live, how a request flows through the code, and where bugs are likely to hide.</p>' +
    '<p style="margin-top:20px"><button class="btn primary" data-pick>Choose a project folder</button></p><ol><li>Pick the folder that holds the code (the one with package.json, pyproject.toml, go.mod or .git).</li><li>Spelunk reads it locally. Nothing leaves your computer unless you ask Claude to explain it.</li><li>Start at Overview, or type what you are looking for in Find.</li></ol></div>';
}

let pickerDir = "";
async function openPicker(dir) {
  const d = $("#picker");
  if (!d.open) d.showModal();
  try {
    const r = await api("/api/browse?dir=" + encodeURIComponent(dir || state.root || state.home));
    pickerDir = r.dir;
    $("#pickpath").value = r.dir;
    $("#pickhint").textContent = r.looksLikeRepo ? "This looks like a project folder." : "Open a folder below, or type a path.";
    $("#dirs").innerHTML = (r.parent ? '<button data-dir="' + esc(r.parent) + '">↑ ..</button>' : "") + r.dirs.map((n) => '<button data-dir="' + esc(r.dir.replace(/\/$/, "") + "/" + n) + '">' + esc(n) + "/</button>").join("") || '<p class="muted" style="padding:8px 12px">No folders here.</p>';
  } catch (e) { $("#pickhint").textContent = e.message; }
}

async function useFolder(path) {
  $("#picker").close();
  state.root = path;
  report = null;
  renderTop();
  go("overview");
  try {
    await api("/api/open", { root: path });
    await refresh();
  } catch (e) { $("#main").innerHTML = '<div class="view"><div class="note err">' + esc(e.message) + '</div><button class="btn" data-pick>Choose another folder</button></div>'; }
}

async function refresh() {
  report = await api("/api/report");
  renderTop();
  go(view);
}

function renderTop() {
  $("#repo").innerHTML = state.root ? '<span class="path" title="' + esc(state.root) + '">' + esc(state.root) + '</span><button class="btn" data-pick>Change</button>' : '<button class="btn" data-pick>Choose a folder</button>';
  $("#actions").innerHTML = state.root ? '<button class="btn" id="rescan" title="Read the folder again after changes">Rescan</button><a class="btn" target="_blank" rel="noopener" href="/guide?t=' + encodeURIComponent(T) + '">Field guide ↗</a>' : "";
}

// ---------- Overview
function vOverview() {
  const r = report, o = r.overview;
  const total = r.languages.reduce((n, l) => n + l.lines, 0) || 1;
  const hot = (r.risks.find((g) => g.kind === "hotspot") || { items: [] }).items.slice(0, 6);
  const rank = (c) => (/^(npm run|make|bin|poetry|uv|cargo|go) /.test(c.name + " ") ? 0 : c.kind === "ci" || /^(EXPOSE|CMD|ENTRYPOINT)$/.test(c.name) ? 2 : 1);
  const cmds = r.commands.filter((c) => rank(c) < 2).sort((a, b) => rank(a) - rank(b)).slice(0, 7);
  let h = '<div class="view"><div class="mono muted" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase">' + esc(r.remote ? r.remote.replace(/^https:\/\//, "") : "local project") + (r.commit ? " · " + esc(r.commit.slice(0, 7)) : "") + "</div>" +
    "<h1>" + esc(r.name) + "</h1>" + (o ? '<p class="lede">' + prose(o.oneLiner) + "</p>" : '<p class="lede">How this project is laid out. <button class="lnk" data-view="explain">Ask Claude</button> to add plain-English explanations of each part.</p>') +
    '<div class="stats"><span><b>' + fmt(r.stats.codeFiles) + "</b> code files</span><span><b>" + fmt(r.stats.codeLines) + "</b> lines</span><span><b>" + fmt(r.stats.routes) + "</b> routes</span><span><b>" + fmt(r.stats.tests) + "</b> test files</span><span><b>" + fmt(r.stats.env) + "</b> settings</span></div>" +
    '<div class="langbar">' + r.languages.map((l, i) => '<span style="width:' + (l.lines / total) * 100 + "%;background:" + LANG_COLORS[i % 8] + '" title="' + esc(l.language) + '"></span>').join("") + "</div>" +
    '<div class="stats" style="font-size:12.5px">' + r.languages.slice(0, 6).map((l, i) => '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;background:' + LANG_COLORS[i % 8] + '"></i>' + esc(l.language) + " " + Math.round((l.lines / total) * 100) + "%</span>").join("") + "</div>";
  if (o) h += "<h2>What it does</h2><p>" + prose(o.whatItDoes) + "</p><p>" + prose(o.architecture) + "</p>";
  h += '<h2>Where to start</h2><div class="cards">' +
    '<div class="card"><h4>Where the program starts</h4>' + (r.entries.length ? r.entries.map((e) => "<div>" + loc(e.path) + ' <span class="tag">' + esc(e.label) + "</span></div>").join("") : '<p class="muted">No entry point found.</p>') + "</div>" +
    '<div class="card"><h4>Read these first</h4><p class="muted" style="font-size:12.5px">Big files that change often. Most bugs live here.</p>' + (hot.length ? hot.map((x) => "<div>" + loc(x.locations[0].path) + "</div>").join("") : '<p class="muted">No git history to rank by.</p>') + "</div>" +
    '<div class="card"><h4>How to run it</h4>' + (o && o.runLocally.length ? '<ol class="steps" style="margin:0;font-size:13px">' + o.runLocally.map((s) => "<li>" + prose(s) + "</li>").join("") + "</ol>" : cmds.length ? cmds.map((c) => '<div style="margin-bottom:6px"><code>' + esc(c.name) + '</code><div class="muted mono" style="font-size:11.5px;overflow-wrap:anywhere">' + esc(c.command.slice(0, 70)) + "</div></div>").join("") : '<p class="muted">No commands found.</p>') + "</div></div>";
  h += '<h2>How the parts connect</h2><p class="muted">Each box is a folder of code. Arrows point to the folders it uses. Click a box to see what is inside.</p><div class="figure">' + r.diagram + "</div>";
  h += '<h2>The parts</h2><div class="cards">' + r.modules.map((m) => {
    const e = m.explanation, doc = e ? e.summary : (m.files.find((f) => f.doc) || {}).doc;
    return '<button class="card click" data-module="' + esc(m.path) + '"><h4 class="mono" style="font-size:13px">' + esc(m.path || "(root)") + '</h4><p class="muted" style="font-size:12.5px;margin-bottom:6px">' + m.files.length + " files · " + fmt(m.lines) + " lines</p>" + (doc ? '<p style="font-size:13px;margin:0">' + prose(doc.length > 220 ? doc.slice(0, 220) + "…" : doc) + "</p>" : "") + "</button>";
  }).join("") + "</div>";
  if (o && o.glossary.length) h += '<h2>Words this project uses</h2><div class="tw"><table>' + o.glossary.map((g) => "<tr><td><b>" + esc(g.term) + "</b></td><td>" + prose(g.meaning) + "</td></tr>").join("") + "</table></div>";
  $("#main").innerHTML = h + "</div>";
}

function vModule(path) {
  const m = report.modules.find((x) => x.path === path);
  if (!m) return go("overview");
  const e = m.explanation;
  const usedBy = report.modules.filter((x) => x.dependsOn.some((d) => d.path === m.path));
  let h = '<div class="view"><button class="lnk" data-view="overview">← Overview</button><h1 class="mono" style="font-size:24px;margin-top:10px">' + esc(m.path || "(root)") + '</h1><p class="lede">' + m.files.length + " files · " + fmt(m.lines) + " lines" + (m.owner ? " · package " + esc(m.owner) : "") + "</p>";
  if (e) h += "<p>" + prose(e.summary) + '</p><h3>What it does</h3><ul>' + e.responsibilities.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>" + (e.gotchas.length ? '<h3>Watch out for</h3><ul>' + e.gotchas.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>" : "");
  const roles = new Map((e ? e.keyFiles : []).map((k) => [k.path, k.role]));
  h += '<h3>Files</h3><div class="tw"><table><tr><th>File</th><th>What it is</th><th>Lines</th><th>Used by</th></tr>' + [...m.files].sort((a, b) => b.usedBy - a.usedBy).map((f) => "<tr><td>" + loc(f.path, 0, f.path.slice(m.path ? m.path.length + 1 : 0)) + "</td><td>" + prose(roles.get(f.path) || f.doc || "") + '</td><td class="muted">' + fmt(f.lines) + '</td><td class="muted">' + (f.usedBy || "") + "</td></tr>").join("") + "</table></div>";
  h += '<h3>Uses</h3><div class="chips">' + (m.dependsOn.map((d) => '<button class="chip" data-module="' + esc(d.path) + '">' + esc(d.path || "(root)") + "</button>").join("") || '<span class="muted">Nothing else in the project.</span>') + "</div>";
  h += '<h3>Used by</h3><div class="chips">' + (usedBy.map((d) => '<button class="chip" data-module="' + esc(d.path) + '">' + esc(d.path || "(root)") + "</button>").join("") || '<span class="muted">Nothing else in the project.</span>') + "</div>";
  $("#main").innerHTML = h + "</div>";
}

// ---------- Find
let findTimer;
function vFind(q) {
  $("#main").innerHTML = '<div class="view"><h1>Find</h1><p class="lede">Type what you are looking for in plain words: a feature, an error message, a page, a setting.</p>' +
    '<div class="searchrow"><input class="field" id="q" type="search" placeholder="e.g. login, send email, payment failed, DATABASE_URL" autocomplete="off" aria-label="What are you looking for?"></div>' +
    '<div class="chips">' + ["login", "database", "send email", "error handling", "config", "upload"].map((x) => '<button class="chip" data-q="' + x + '">' + x + "</button>").join("") + '</div><div id="hits"></div></div>';
  const input = $("#q");
  input.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(() => search(input.value), 200); });
  if (q) { input.value = q; search(q); }
  input.focus();
}
async function search(q) {
  if (!q.trim()) { $("#hits").innerHTML = ""; return; }
  const hits = await api("/api/where?q=" + encodeURIComponent(q));
  if (q !== $("#q").value) return;
  $("#hits").innerHTML = hits.length ? hits.map((h) => '<div class="hit"><span class="tag">' + esc(h.kind) + "</span><div><div>" + (h.name ? "<b>" + esc(h.name) + "</b> " : "") + loc(h.path, h.line) +
    (h.kind === "symbol" || h.kind === "route" ? ' · ' + traceBtn(h.kind === "route" ? h.name : h.name, "trace") : "") + '</div><div class="why">' + esc(h.why) + "</div></div></div>").join("") : '<p class="empty">Nothing matches. Try other words, or a name you saw on screen or in an error.</p>';
}

// ---------- Trace
function vTrace(target) {
  const ex = report.routes.slice(0, 4).map((r) => r.method + " " + r.path).concat(report.entries.slice(0, 2).map((e) => e.path));
  $("#main").innerHTML = '<div class="view"><h1>Trace</h1><p class="lede">Follow how the code connects. Enter a web address the app serves, a function name or a file, and see what calls it and what it calls.</p>' +
    '<form class="searchrow" id="tf"><input class="field" id="tq" placeholder="e.g. POST /api/login, saveUser, src/server.ts" autocomplete="off" aria-label="What to trace"><button class="btn primary">Trace</button></form>' +
    '<div class="chips">' + ex.map((x) => '<button class="chip" data-trace="' + esc(x) + '">' + esc(x) + "</button>").join("") + '</div><div id="tr"></div></div>';
  $("#tf").addEventListener("submit", (e) => { e.preventDefault(); runTrace($("#tq").value); });
  if (target) { $("#tq").value = target; runTrace(target); }
}
const tree = (nodes, top) => '<ul class="tree' + (top ? " top" : "") + '">' + nodes.map((n) => "<li>" + traceBtn(n.name) + " " + loc(n.path, n.line) + (n.children.length ? tree(n.children) : "") + "</li>").join("") + "</ul>";
const steps = (nodes, top) => '<ul class="tree' + (top ? " top" : "") + '">' + nodes.map((s) => "<li>" + loc(s.path, s.line) + (s.via.length ? ' <span class="muted" style="font-size:12.5px">' + esc(s.via.slice(0, 6).join(", ")) + "</span>" : "") + (s.children.length ? steps(s.children) : "") + "</li>").join("") + "</ul>";
async function runTrace(target) {
  if (!target.trim()) return;
  $("#tr").innerHTML = '<p class="muted"><span class="spinner"></span> Tracing…</p>';
  const { traces, more } = await api("/api/trace?target=" + encodeURIComponent(target));
  if (!traces.length) { $("#tr").innerHTML = '<p class="empty">Nothing called "' + esc(target) + '". <button class="lnk" data-find="' + esc(target) + '">Search for it instead</button>.</p>'; return; }
  $("#tr").innerHTML = traces.map((t) => {
    let h = '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0"><span class="tag">' + esc(t.target.kind) + "</span> " + esc(t.target.label) + "</h3><div>" + loc(t.target.path, t.target.line) + "</div>";
    if (t.callers.length) h += "<h3>Called from the front end</h3>" + t.callers.map((c) => "<div>" + loc(c.path, c.line) + ' <span class="muted mono" style="font-size:12px">' + esc(c.label) + "</span></div>").join("");
    if (t.fromEntries.length) h += "<h3>How the program gets here</h3>" + t.fromEntries.map((p) => '<div class="chain">' + p.map((x) => loc(x)).join('<span class="arrow">→</span>') + "</div>").join("");
    if (t.flow.length) h += "<h3>What it calls</h3>" + tree(t.flow, true);
    if (t.downstream.length) h += "<h3>What it uses</h3>" + steps(t.downstream, true);
    if (t.usedBy.length) h += "<h3>Used by (" + t.usedBy.length + ")</h3>" + t.usedBy.slice(0, 40).map((u) => "<div>" + loc(u.path, u.line) + "</div>").join("");
    if (!t.callers.length && !t.flow.length && !t.downstream.length && !t.usedBy.length && !t.fromEntries.length) h += '<p class="muted" style="margin-top:10px">No connections found. It may be reached by name at runtime, or by a framework convention.</p>';
    return h + "</div>";
  }).join("") + (more.length ? '<p class="muted">Also matches: ' + more.map((m) => loc(m.path, m.line, m.label + " (" + m.path + ")")).join(", ") + "</p>" : "");
}

// ---------- Risks
function vRisks() {
  const groups = report.risks;
  const list = riskKind ? groups.filter((g) => g.kind === riskKind) : groups;
  let h = '<div class="view"><h1>Risks</h1><p class="lede">Places where bugs tend to hide. These are hints from reading the code, not proof that something is broken.</p><div class="chips"><button class="chip" data-kind="" aria-pressed="' + !riskKind + '">All</button>' +
    groups.map((g) => '<button class="chip" data-kind="' + g.kind + '" aria-pressed="' + (riskKind === g.kind) + '">' + esc(g.kind.replace(/-/g, " ")) + " " + g.items.length + "</button>").join("") + "</div>";
  if (!groups.length) h += '<p class="empty">Nothing flagged.</p>';
  for (const g of list) {
    h += "<h2>" + esc(g.kind.replace(/-/g, " ")) + ' <span class="muted" style="font-size:15px">' + g.items.length + '</span></h2><p class="muted">' + prose(g.info) + "</p>";
    h += g.items.slice(0, riskKind ? 300 : 12).map((x) => '<div class="risk sev-' + x.severity + '"><span class="pill ' + x.severity + '">' + x.severity + "</span> " + esc(x.title) + (x.detail !== g.info ? '<div class="muted" style="font-size:13px">' + prose(x.detail) + "</div>" : "") + "<div>" + x.locations.slice(0, 6).map((l) => loc(l.path, l.line)).join(" · ") + "</div></div>").join("");
    if (!riskKind && g.items.length > 12) h += '<button class="lnk" data-kind="' + g.kind + '">Show all ' + g.items.length + "</button>";
  }
  $("#main").innerHTML = h + "</div>";
}

// ---------- Routes
function vRoutes() {
  $("#main").innerHTML = '<div class="view"><h1>Routes</h1><p class="lede">Every web address the server answers, where its code is, and which front-end code calls it.</p><div class="searchrow"><input class="field" id="rf" type="search" placeholder="Filter, e.g. /api/users or POST" aria-label="Filter routes"></div><div id="rt"></div></div>';
  const draw = (f) => {
    const rows = report.routes.filter((r) => !f || (r.method + " " + r.path + " " + r.file).toLowerCase().includes(f.toLowerCase()));
    $("#rt").innerHTML = rows.length ? '<div class="tw"><table><tr><th>Method</th><th>Path</th><th>Code</th><th>Called from</th><th></th></tr>' + rows.map((r) => '<tr><td><span class="tag">' + esc(r.method) + '</span></td><td class="mono" style="font-size:12.5px">' + esc(r.path) + "</td><td>" + loc(r.file, r.line) + "</td><td>" + r.callers.slice(0, 3).map((c) => loc(c.path, c.line)).join("<br>") + "</td><td>" + traceBtn(r.method + " " + r.path, "trace") + "</td></tr>").join("") + "</table></div>" : '<p class="empty">No routes found.</p>';
  };
  $("#rf").addEventListener("input", (e) => draw(e.target.value));
  draw("");
}

// ---------- Debugging
function vDebug() {
  const d = report.overview && report.overview.debugging;
  let h = '<div class="view"><h1>Debugging</h1><p class="lede">Something broke? Work through it in this order.</p><ol class="steps"><li>Reproduce it and copy the exact error text.</li><li>Paste words from the error into <button class="lnk" data-view="find">Find</button> to see the code that raises or logs it.</li><li>Open that code, then <button class="lnk" data-view="trace">Trace</button> it to see who calls it and what it calls.</li><li>Check <button class="lnk" data-view="risks">Risks</button> for that file. Swallowed errors and hotspots are the usual suspects.</li></ol>';
  if (d) {
    h += "<h2>First checks</h2><ul>" + d.firstChecks.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul><h2>Where the logs are</h2><ul>" + d.logs.map((x) => "<li>" + prose(x) + "</li>").join("") + "</ul>";
    if (d.failurePoints.length) h += '<h2>Common failures</h2><div class="tw"><table><tr><th>Symptom</th><th>Likely cause</th><th>Where to look</th></tr>' + d.failurePoints.map((p) => "<tr><td>" + prose(p.symptom) + "</td><td>" + prose(p.likelyCause) + "</td><td>" + prose(p.whereToLook) + "</td></tr>").join("") + "</table></div>";
  } else h += '<div class="note">Claude can write a debugging guide for this project: first checks, where the logs are, and common failures with their likely causes. <button class="lnk" data-view="explain">Explain with Claude</button>.</div>';
  const flows = (report.overview ? report.overview.flows : []);
  if (flows.length) h += "<h2>Main flows</h2>" + flows.map((f) => '<div class="card" style="margin-bottom:12px"><h4>' + esc(f.name) + '</h4><p class="muted" style="font-size:13px">' + prose(f.summary) + '</p><ol class="steps">' + f.steps.map((s) => "<li>" + prose(s.what) + " " + loc(s.path, s.line) + "</li>").join("") + "</ol></div>").join("");
  if (report.errorLogs.length) h += '<h2>Where errors are logged</h2><div class="tw"><table>' + report.errorLogs.slice(0, 80).map((l) => "<tr><td>" + loc(l.path, l.line) + '</td><td class="mono" style="font-size:12px">' + esc(l.text.slice(0, 120)) + "</td></tr>").join("") + "</table></div>";
  $("#main").innerHTML = h + "</div>";
}

// ---------- Config
function vConfig() {
  const env = report.env;
  $("#main").innerHTML = '<div class="view"><h1>Config</h1><p class="lede">Settings the code reads from environment variables. A missing one is a common reason an app will not start.</p>' +
    (env.length ? '<div class="tw"><table><tr><th>Variable</th><th>Read at</th><th>In the example .env</th></tr>' + env.map((e) => '<tr><td class="mono" style="font-size:12.5px">' + esc(e.name) + "</td><td>" + (e.readAt.slice(0, 3).map((l) => loc(l.path, l.line)).join("<br>") || '<span class="muted">never read</span>') + "</td><td>" + (e.documented ? "yes" : '<span class="pill medium">missing</span>') + "</td></tr>").join("") + "</table></div>" : '<p class="empty">No environment variables found.</p>') + "</div>";
}

// ---------- Explain
let pollTimer;
async function vExplain() {
  const done = report.overview ? '<div class="note">Claude explained this project on ' + esc((report.explainedAt || "").slice(0, 10)) + '. Run it again after big changes; unchanged parts are reused for free.</div>' : "";
  $("#main").innerHTML = '<div class="view"><h1>Explain with Claude</h1><p class="lede">Claude reads the code and writes a plain-English summary of every part, the main flows, how to run it, a debugging guide and a glossary. They show up across this dashboard and in the field guide.</p>' + done + '<div id="plan"><p class="muted"><span class="spinner"></span> Working out the cost…</p></div><div id="job"></div></div>';
  try {
    const p = await api("/api/explain/plan");
    $("#plan").innerHTML = '<div class="card" style="max-width:640px"><h4>What it will cost</h4><p>' + p.modules.length + " parts, about " + fmt(Math.round(p.estimate.inputTokens / 1000)) + "k tokens in and " + fmt(Math.round(p.estimate.outputTokens / 1000)) + "k out with " + esc(p.model) + ": roughly <b>$" + p.estimate.dollars.toFixed(2) + "</b>, charged to your Anthropic account.</p>" +
      (state.hasEnvKey ? '<p class="muted" style="font-size:13px">Using the ANTHROPIC_API_KEY Spelunk was started with.</p>' : '<label for="key" style="font-size:13px">Anthropic API key</label><input class="field" id="key" type="password" autocomplete="off" placeholder="sk-ant-…" style="display:block;width:100%;margin:4px 0 6px"><p class="muted" style="font-size:12.5px">Used for this run only. It is not saved anywhere. Get one at console.anthropic.com.</p>') +
      '<button class="btn primary" id="go">Explain this project</button></div>';
    $("#go").addEventListener("click", startExplain);
  } catch (e) { $("#plan").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
  pollJob();
}
async function startExplain() {
  const key = $("#key") ? $("#key").value : "";
  try {
    $("#go").disabled = true;
    await api("/api/explain", { apiKey: key });
    if ($("#key")) $("#key").value = "";
    pollJob();
  } catch (e) { $("#go").disabled = false; $("#job").innerHTML = '<div class="note err">' + esc(e.message) + "</div>"; }
}
async function pollJob() {
  clearTimeout(pollTimer);
  if (view !== "explain") return;
  const j = await api("/api/explain/status");
  if (!j.messages.length && !j.running) return;
  $("#job").innerHTML = "<h3>" + (j.running ? '<span class="spinner"></span> Claude is reading the code' : j.error ? "Stopped" : "Done") + '</h3><div class="log">' + esc(j.messages.join("\n")) + "</div>" + (j.error ? '<div class="note err" style="margin-top:10px">' + esc(j.error) + "</div>" : "") + (j.summary ? '<p style="margin-top:10px">' + esc(j.summary) + ' <button class="lnk" data-view="overview">See the overview</button></p>' : "");
  if ($("#go")) $("#go").disabled = j.running;
  if (j.running) pollTimer = setTimeout(pollJob, 1500);
  else if (j.summary && !report.overview) report = await api("/api/report");
}

// ---------- File drawer
async function openFile(path, line) {
  $("#drawer").classList.add("open");
  $("#scrim").classList.add("open");
  $("#dtitle").innerHTML = "<b>" + esc(path) + "</b>";
  $("#dpane").innerHTML = '<p class="muted" style="padding:16px"><span class="spinner"></span></p>';
  try {
    const f = await api("/api/file?path=" + encodeURIComponent(path));
    const x = f.facts;
    $("#dtitle").innerHTML = "<b>" + esc(x.path) + '</b><div class="muted" style="font-size:12.5px">' + esc(x.language) + " · " + esc(x.role) + " · " + fmt(x.lines) + " lines" + (x.entry ? " · starts the program (" + esc(x.entry) + ")" : "") + "</div>" + (x.doc ? '<div style="font-size:13px;margin-top:4px">' + prose(x.doc) + "</div>" : "") +
      (report && report.links ? '<a style="font-size:12.5px" target="_blank" rel="noopener noreferrer" href="' + esc(report.links.template.replace("{path}", x.path).replace("{line}", line ? report.links.anchor + line : "")) + '">Open on the code host ↗</a>' : "");
    drawerData = { f, line };
    showTab(drawerTab);
  } catch (e) { $("#dpane").innerHTML = '<div class="note err" style="margin:16px">' + esc(e.message) + "</div>"; }
}
let drawerData = null, drawerTab = "code";
function showTab(tab) {
  drawerTab = tab;
  document.querySelectorAll("#dtabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  if (!drawerData) return;
  const { f, line } = drawerData, x = f.facts;
  if (tab === "code") {
    $("#dpane").innerHTML = '<pre class="code">' + f.source.split("\n").map((t, i) => '<span class="l' + (i + 1 === line ? " hl" : "") + '" id="L' + (i + 1) + '"><i>' + (i + 1) + "</i>" + esc(t) + "</span>").join("") + "</pre>";
    if (line) { const el = document.getElementById("L" + line); if (el) el.scrollIntoView({ block: "center" }); }
  } else {
    let h = '<div class="outline">';
    if (x.symbols.length) h += "<h3>Defined here</h3>" + x.symbols.map((s) => '<div class="sym"><button class="lnk" data-jump="' + s.line + '">' + s.line + '</button><div><span class="tag">' + esc(s.kind) + "</span><b>" + esc((s.parent ? s.parent + "." : "") + s.name) + "</b>" + (s.kind === "function" || s.kind === "method" ? traceBtn(s.name, "trace") : "") + (s.doc ? '<span class="muted" style="font-size:12.5px;flex-basis:100%">' + esc(s.doc.slice(0, 160)) + "</span>" : "") + "</div></div>").join("");
    if (x.routes.length) h += "<h3>Routes</h3>" + x.routes.map((r) => '<div class="sym"><button class="lnk" data-jump="' + r.line + '">' + r.line + '</button><div><span class="tag">' + esc(r.method) + "</span>" + esc(r.path) + " " + (r.side === "server" ? traceBtn(r.method + " " + r.path, "trace") : '<span class="muted">calls the server</span>') + "</div></div>").join("");
    if (f.imports.length) h += "<h3>Uses</h3>" + f.imports.map((p) => "<div>" + loc(p) + "</div>").join("");
    if (f.importedBy.length) h += "<h3>Used by</h3>" + f.importedBy.map((p) => "<div>" + loc(p) + "</div>").join("");
    if (x.env.length) h += "<h3>Settings it reads</h3>" + x.env.map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + "</button><div><code>" + esc(e.text) + "</code></div></div>").join("");
    const errs = x.throws.concat(x.logs).sort((a, b) => a.line - b.line);
    if (errs.length) h += "<h3>Errors raised or logged</h3>" + errs.slice(0, 40).map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + '</button><div><span class="mono" style="font-size:12px">' + esc(e.text) + "</span></div></div>").join("");
    if (x.notes.length) h += "<h3>Notes in the code</h3>" + x.notes.map((e) => '<div class="sym"><button class="lnk" data-jump="' + e.line + '">' + e.line + "</button><div>" + esc(e.text) + "</div></div>").join("");
    $("#dpane").innerHTML = h + "</div>";
  }
}
function closeFile() { $("#drawer").classList.remove("open"); $("#scrim").classList.remove("open"); }

// ---------- Wiring
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  try {
    if (t.matches("a[href^='#mod-']")) { e.preventDefault(); vModule(decodeURIComponent(t.getAttribute("href").slice(5)).replace(/^root$/, "")); return; }
    if (d.open !== undefined) return openFile(d.open, Number(d.line) || 0);
    if (d.jump) { drawerData.line = Number(d.jump); return showTab("code"); }
    if (d.trace !== undefined) { closeFile(); view = "trace"; renderNav(); return vTrace(d.trace); }
    if (d.find !== undefined) { view = "find"; renderNav(); return vFind(d.find); }
    if (d.q !== undefined) { $("#q").value = d.q; return search(d.q); }
    if (d.view) return go(d.view);
    if (d.module !== undefined) return vModule(d.module);
    if (d.kind !== undefined) { riskKind = d.kind; return vRisks(); }
    if (d.pick !== undefined) return openPicker();
    if (d.dir) return openPicker(d.dir);
    if (d.tab) return showTab(d.tab);
    if (t.id === "rescan") { t.disabled = true; t.textContent = "Reading…"; await api("/api/rescan", {}); await refresh(); return; }
    if (t.id === "dclose") return closeFile();
    if (t.id === "theme") { const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); const next = cur === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("spelunk-theme", next); } catch {} }
  } catch (err) { alert(err.message); }
});
$("#scrim").addEventListener("click", closeFile);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFile(); if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); go("find"); } });
$("#pickform").addEventListener("submit", (e) => { e.preventDefault(); useFolder($("#pickpath").value || pickerDir); });
$("#browse").addEventListener("click", () => openPicker($("#pickpath").value));
try { const th = localStorage.getItem("spelunk-theme"); if (th) document.documentElement.dataset.theme = th; } catch {}

(async () => {
  try {
    state = await api("/api/state");
    renderTop();
    go("overview");
    if (state.root) await refresh();
  } catch (e) { $("#main").innerHTML = '<div class="view note err">' + esc(e.message) + "</div>"; }
})();
`;

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spelunk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <header class="top">
    <div class="brand"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 20h18M6 20l4-9 3 5 2-3 3 7"/><circle cx="16" cy="6" r="2"/></svg>Spelunk</div>
    <div class="repo" id="repo"></div>
    <div id="actions" style="display:flex;gap:8px;flex-wrap:wrap"></div>
    <button class="btn" id="theme" aria-label="Switch light or dark" title="Light or dark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" style="vertical-align:-3px"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg></button>
  </header>
  <div class="body">
    <nav class="side" id="nav" aria-label="Sections"></nav>
    <main id="main"></main>
  </div>
</div>
<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-label="File">
  <div class="dh"><div class="t" id="dtitle"></div><button class="btn" id="dclose" aria-label="Close file">✕</button></div>
  <div class="tabs" id="dtabs" role="tablist"><button role="tab" data-tab="code" aria-selected="true">Code</button><button role="tab" data-tab="outline" aria-selected="false">What's in it</button></div>
  <div class="pane" id="dpane"></div>
</aside>
<dialog id="picker" aria-label="Choose a project folder">
  <form class="dlg" id="pickform">
    <h2 style="margin:0">Choose a project folder</h2>
    <div style="display:flex;gap:8px"><input class="field" id="pickpath" aria-label="Folder path" style="flex:1"><button type="button" class="btn" id="browse">Go</button></div>
    <p class="muted" id="pickhint" style="margin:0;font-size:13px"></p>
    <div class="dirs" id="dirs"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn" onclick="this.closest('dialog').close()">Cancel</button><button class="btn primary">Use this folder</button></div>
  </form>
</dialog>
<script>${JS}</script>
</body>
</html>`;
}
