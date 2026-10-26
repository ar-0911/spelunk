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

  it("serves the page and needs the token for data", async () => {
    expect(await (await get("/", {})).text()).toContain("<title>Spelunk</title>");
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
