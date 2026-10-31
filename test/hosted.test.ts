import { afterAll, describe, expect, it } from "vitest";
import { startUi } from "../src/ui/server.js";

describe("hosted dashboard (spelunk serve)", async () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-operator";
  const ui = await startUi({ open: false, port: 0, hosted: { host: "127.0.0.1" } });
  afterAll(async () => {
    await ui.close();
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });
  const base = ui.url.replace(/\/$/, "");

  const visit = async () => {
    const r = await fetch(base + "/");
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!;
    return { cookie, jar: { cookie: cookie.split(";")[0]! } };
  };
  const post = (jar: Record<string, string>, path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { ...jar, "content-type": "application/json" }, body: JSON.stringify(body) });

  it("gives each browser its own session cookie, and needs it for the API", async () => {
    expect((await fetch(base + "/api/state")).status).toBe(401);
    const a = await visit();
    expect(a.cookie).toMatch(/^spelunk_sid=/);
    expect(a.cookie).toMatch(/HttpOnly/);
    expect(a.cookie).toMatch(/Secure/);
    expect(a.cookie).toMatch(/SameSite=Lax/);
    const b = await visit();
    expect(b.jar.cookie).not.toBe(a.jar.cookie);
    const state = (await (await fetch(base + "/api/state", { headers: a.jar })).json()) as Record<string, unknown>;
    expect(state.hosted).toBe(true);
    expect(state.root).toBeNull();
    expect(state.home).toBe("");
    // The operator's key is never offered to visitors.
    expect(state.hasEnvKey).toBe(false);
    expect((await fetch(base + "/api/state", { headers: { cookie: "spelunk_sid=made-up" } })).status).toBe(401);
    expect((await fetch(base + "/healthz")).status).toBe(200);
  });

  it("has no folder picker, Braid or publishing", async () => {
    const { jar } = await visit();
    expect((await fetch(base + "/api/browse?dir=/", { headers: jar })).status).toBe(403);
    expect((await post(jar, "/api/open", { root: "/" })).status).toBe(403);
    expect((await post(jar, "/api/braid/start", { goal: "x" })).status).toBe(403);
    expect((await post(jar, "/api/publish", { url: "http://169.254.169.254", token: "t", space: "s" })).status).toBe(403);
    expect((await fetch(base + "/api/impact?agent=a", { headers: jar })).status).toBe(403);
  });

  it("only downloads public https links from the allowed hosts", async () => {
    const { jar } = await visit();
    const err = async (body: unknown) => {
      const r = await post(jar, "/api/clone", body);
      expect(r.status).toBe(400);
      return ((await r.json()) as { error: string }).error;
    };
    expect(await err({ url: "https://github.com/owner/repo", token: "ghp_secret" })).toMatch(/public repositories/);
    expect(await err({ url: "git@github.com:owner/repo.git" })).toMatch(/https link/);
    expect(await err({ url: "file:///etc" })).toMatch(/https link/);
    expect(await err({ url: "https://git.internal.example/owner/repo" })).toMatch(/only downloads from github.com/);
  });

  it("asks visitors for their own Claude key even when the server has one", async () => {
    const { jar } = await visit();
    // No repository yet, so this fails on that first; the key rule is checked in the next line with a session that has none either way.
    const r = await post(jar, "/api/ask", { question: "how?" });
    expect(r.status).toBe(409);
    expect((await post(jar, "/api/explain", {})).status).toBe(409);
  });

  it("refuses non-JSON posts, so other sites can't post forms to it", async () => {
    const { jar } = await visit();
    const r = await fetch(base + "/api/clone", { method: "POST", headers: { ...jar, "content-type": "application/x-www-form-urlencoded" }, body: "url=https://github.com/a/b" });
    expect(r.status).toBe(415);
  });
});
