import { afterAll, describe, expect, it } from "vitest";
import { startUi } from "../src/ui/server.js";
import { TS_APP, repo } from "./helpers.js";

describe("dashboard server", async () => {
  const root = await repo(TS_APP);
  const ui = await startUi({ root, open: false });
  afterAll(() => ui.close());
  const token = new URL(ui.url).searchParams.get("t")!;
  const base = ui.url.replace(/\/\?t=.*/, "");
  const get = (path: string, headers: Record<string, string> = { "x-spelunk-token": token }) => fetch(base + path, { headers });

  it("swaps the link's token for a cookie, and needs one or the other for everything", async () => {
    expect((await get("/", {})).status).toBe(401);
    const swap = await fetch(ui.url, { redirect: "manual" });
    expect(swap.status).toBe(303);
    expect(swap.headers.get("location")).toBe("/");
    const cookie = swap.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const jar = { cookie: cookie.split(";")[0]! };
    expect(await (await get("/", jar)).text()).toContain("<title>Spelunk</title>");
    expect((await get("/api/state", jar)).status).toBe(200);
    expect((await fetch(`${base}/?t=${"x".repeat(token.length)}`, { redirect: "manual" })).status).toBe(401);
    expect((await get("/api/report", {})).status).toBe(401);
    expect((await get("/api/report", { "x-spelunk-token": "x".repeat(token.length) })).status).toBe(401);
  });

  it("answers with the same data as the CLI", async () => {
    const report = (await (await get("/api/report")).json()) as { name: string; diagram: string; routes: unknown[] };
    expect(report.name).toBe("notes");
    expect(report.diagram).toContain("<svg");
    expect(report.routes.length).toBe(2);
    const hits = (await (await get("/api/where?q=save%20note")).json()) as { name: string }[];
    expect(hits[0]!.name).toBe("saveNote");
    const t = (await (await get("/api/trace?target=" + encodeURIComponent("POST /api/notes"))).json()) as { traces: { flow: { name: string }[] }[] };
    expect(t.traces[0]!.flow[0]!.name).toBe("saveNote");
  });

  it("looks up errors, builds the tour, and refuses ask, publish and clone without what they need", async () => {
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "x-spelunk-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });
    const e = (await (await post("/api/error", { text: "Error: text is required" })).json()) as { start: { path: string } };
    expect(e.start.path).toBe("src/services/notes.ts");
    const tour = (await (await get("/api/tour")).json()) as { id: string }[];
    expect(tour[0]!.id).toBe("what");
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post("/api/ask", { question: "how?" })).status).toBe(400);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    expect((await post("/api/publish", { url: "https://docs.example.com" })).status).toBe(400);
    const c = await post("/api/clone", { url: "file:///etc" });
    expect(c.status).toBe(400);
    expect(((await c.json()) as { error: string }).error).toMatch(/doesn't look like a repository link/);
    // The temp repo isn't a git repository, so impact explains rather than crashing.
    expect((await get("/api/impact")).status).toBe(400);
  });

  it("keeps the folder picker inside the home folder", async () => {
    const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "x-spelunk-token": token, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await get("/api/browse?dir=/")).status).toBe(403);
    expect((await post("/api/open", { root: "/etc" })).status).toBe(403);
    // The folder Spelunk was started in is always allowed, even outside home (tests run in /tmp).
    expect((await get(`/api/browse?dir=${encodeURIComponent(root)}`)).status).toBe(200);
  });

  it("only reads files that are in the index", async () => {
    const ok = (await (await get("/api/file?path=src/db.ts")).json()) as { source: string };
    expect(ok.source).toContain("DATABASE_URL");
    expect((await get("/api/file?path=../../etc/passwd")).status).toBe(404);
  });

  it("refuses explain without a key and a POST without JSON", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await fetch(base + "/api/explain", { method: "POST", headers: { "x-spelunk-token": token, "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(400);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
    expect((await fetch(base + "/api/rescan", { method: "POST", headers: { "x-spelunk-token": token } })).status).toBe(415);
  });
});
