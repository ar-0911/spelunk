import { describe, expect, it } from "vitest";
import { codeOnly, explainFeature, formatFeature, formatFeatures, listFeatures } from "../src/analysis/features.js";
import { openWorkspace } from "../src/workspace.js";
import { repo } from "./helpers.js";

/** The shape of a typical vibe-coded app: Drizzle tables, services, Express routes, React screens, one shared auth helper. */
const COMMENTS_APP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "wiki", dependencies: { express: "4", "drizzle-orm": "0" } }),
  "src/db/schema.ts": `
import { pgTable, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id"),
  name: text("name"),
});

export const pages = pgTable("pages", {
  id: text("id"),
  title: text("title"),
});

export const comments = pgTable("comments", {
  id: text("id"),
  pageId: text("page_id"),
  body: text("body"),
});
`,
  "src/db/index.ts": `
export const db = { select: (..._a: unknown[]) => db, from: (..._a: unknown[]) => db, insert: (..._a: unknown[]) => db, values: (..._a: unknown[]) => db, where: (..._a: unknown[]) => [] };
`,
  "src/lib/auth.ts": `
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

/** Every route checks the session here. */
export function requireUser(req: { headers: Record<string, string> }) {
  const rows = db.select().from(users).where(req.headers.cookie);
  if (!rows.length) throw new Error("Sign in first.");
  return rows[0];
}
`,
  "src/services/comments.ts": `
import { db } from "../db/index.js";
import { comments } from "../db/schema.js";

export async function listComments(pageId: string) {
  return db.select().from(comments).where(pageId);
}

/** Adds a comment to a page. */
export async function addComment(pageId: string, body: string) {
  if (!body) throw new Error("Say something.");
  return db.insert(comments).values({ pageId, body });
}
`,
  "src/services/pages.ts": `
import { db } from "../db/index.js";
import { pages } from "../db/schema.js";

export async function createPage(title: string) {
  return db.insert(pages).values({ title });
}

export async function getPage(id: string) {
  return db.select().from(pages).where(id);
}
`,
  "src/services/weather.ts": `
export async function forecast(city: string) {
  const res = await fetch("https://weather.example/" + city);
  return res.json();
}
`,
  "src/app.ts": `
import express from "express";
import { requireUser } from "./lib/auth.js";
import { addComment, listComments } from "./services/comments.js";
import { createPage, getPage } from "./services/pages.js";
import { forecast } from "./services/weather.js";

export function createApp() {
  const app = express();
  app.get("/api/pages/:id/comments", async (req, res) => {
    requireUser(req);
    res.json(await listComments(req.params.id));
  });
  app.post("/api/pages/:id/comments", async (req, res) => {
    requireUser(req);
    res.json(await addComment(req.params.id, req.body.body));
  });
  app.post("/api/pages", async (req, res) => {
    requireUser(req);
    res.json(await createPage(req.body.title));
  });
  app.get("/api/pages/:id", async (req, res) => {
    requireUser(req);
    res.json(await getPage(req.params.id));
  });
  app.get("/api/weather/:city", async (req, res) => {
    requireUser(req);
    res.json(await forecast(req.params.city));
  });
  app.get("/api/me", async (req, res) => {
    res.json(requireUser(req));
  });
  app.get("/healthz", (_req, res) => {
    res.send("ok");
  });
  return app;
}
`,
  "src/web/CommentsPanel.tsx": `
export function CommentsPanel({ pageId }: { pageId: string }) {
  async function send(body: string) {
    await fetch(\`/api/pages/\${pageId}/comments\`, { method: "POST", body: JSON.stringify({ body }) });
  }
  return <button onClick={() => send("hi")}>Comment</button>;
}
`,
  "src/web/PageEditor.tsx": `
import { CommentsPanel } from "./CommentsPanel.js";

export function PageEditor({ id }: { id: string }) {
  return <div><CommentsPanel pageId={id} /></div>;
}
`,
  "test/comments.test.ts": `import { addComment } from "../src/services/comments.js";\naddComment("p", "x");\n`,
};

/** The same app with every name a reader might rely on changed: files, functions, components. */
function renamed(files: Record<string, string>): Record<string, string> {
  const swaps: [RegExp, string][] = [
    [/services\/comments/g, "logic/h1"],
    [/services\/pages/g, "logic/h2"],
    [/addComment/g, "doThing"],
    [/listComments/g, "fetchStuff"],
    [/createPage/g, "makeIt"],
    [/getPage\b/g, "loadIt"],
    [/CommentsPanel/g, "SidePanel"],
    [/PageEditor/g, "MainScreen"],
  ];
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    let p = path;
    let t = text;
    for (const [re, to] of swaps) {
      p = p.replace(re, to);
      t = t.replace(re, to);
    }
    out[p] = t;
  }
  return out;
}

const open = async (files: Record<string, string>) => {
  const ws = await openWorkspace(await repo(files));
  return { ws, list: await listFeatures(ws.index, ws.graph), explain: async (id: string) => explainFeature(ws.index, ws.graph, id, await ws.risks()) };
};

describe("features, from the structure of the code", async () => {
  const app = await open(COMMENTS_APP);

  it("groups routes by the table their code reaches, not by the auth helper they all call", () => {
    const byName = Object.fromEntries(app.list.features.map((f) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual(["Comments", "Pages"]);
    expect(byName.Comments).toMatchObject({ kind: "table", entries: 2, tables: ["comments"] });
    expect(byName.Pages).toMatchObject({ kind: "table", entries: 2, tables: ["pages"] });
    // No table and nothing shared with another route: listed apart, not guessed into a feature.
    expect(app.list.other.map((e) => e.label)).toEqual(["GET /api/me", "GET /api/weather/:city", "GET /healthz"]);
  });

  it("walks one feature from the screen down to the table, with the lines that matter", async () => {
    const f = (await app.explain("comments"))!;
    expect(f.steps.map((s) => `${s.layer} ${s.path}:${s.line}`)).toEqual([
      "screen src/web/PageEditor.tsx:4",
      "client src/web/CommentsPanel.tsx:3",
      "route src/app.ts:13",
      "service src/services/comments.ts:9",
      "data src/db/schema.ts:13",
    ]);
    expect(f.steps[3]!.title).toBe("addComment writes comments");
    expect(f.steps[3]!.code.find((c) => c.hl && c.text.includes("insert(comments)"))).toBeTruthy();
    expect(f.steps[4]!.detail).toBe("Columns: id, pageId, body.");
    expect(f.actions.map((a) => `${a.label} → ${a.does?.name}`)).toEqual(["GET /api/pages/:id/comments → listComments", "POST /api/pages/:id/comments → addComment"]);
    expect(f.tests).toEqual(["test/comments.test.ts"]);
    expect(f.summary).toMatch(/^CommentsPanel \(shown in PageEditor\) sends `POST \/api\/pages\/:id\/comments`/);
    expect(formatFeature(f)).toContain("Grouped because: These 2 entry points all use the `comments` table");
  });

  it("gives the same features and steps when every file, function and component is renamed", async () => {
    const other = await open(renamed(COMMENTS_APP));
    const shape = (l: typeof app.list) => l.features.map((f) => `${f.name}:${f.entries}:${f.tables.join()}`);
    expect(shape(other.list)).toEqual(shape(app.list));
    const f = (await other.explain("comments"))!;
    expect(f.steps.map((s) => `${s.layer} ${s.path}:${s.line}`)).toEqual([
      "screen src/web/MainScreen.tsx:4",
      "client src/web/SidePanel.tsx:3",
      "route src/app.ts:13",
      "service src/logic/h1.ts:9",
      "data src/db/schema.ts:13",
    ]);
  });

  it("doesn't count a table's name in a route path, a string or a comment as using it", () => {
    const js = codeOnly('app.get("/api/comments", h); // comments\nconst x = `Shown on\ncomments`; comments.id', false);
    expect(js.split("\n")).toHaveLength(3);
    expect(js.match(/comments/g)).toEqual(["comments"]);
    expect(js).toMatch(/; comments\.id$/);
    const py = codeOnly('x = "comments"  # comments\n"""\ncomments\n"""\ncomments.id', true);
    expect(py.match(/comments/g)).toEqual(["comments"]);
    expect(py.split("\n")).toHaveLength(5);
  });

  it("lists features as text for Claude and the CLI", () => {
    const text = formatFeatures(app.list);
    expect(text).toMatch(/^2 features/);
    expect(text).toContain("Other entry points (3)");
  });
});

describe("features without tables", async () => {
  it("groups a Moleculer service's actions and the gateway routes that run them", async () => {
    const { list } = await open({
      "package.json": JSON.stringify({ name: "svc", dependencies: { moleculer: "0", "moleculer-web": "0" } }),
      "services/api.service.js": `
const ApiGateway = require("moleculer-web");
module.exports = {
	name: "api",
	mixins: [ApiGateway],
	settings: {
		routes: [{
			path: "/api",
			aliases: {
				"POST /orders": "orders.create",
				"GET /orders/:id": "orders.get",
			},
		}],
	},
};
`,
      "services/orders.service.js": `
module.exports = {
	name: "orders",
	actions: {
		create(ctx) { return this.save(ctx.params); },
		get(ctx) { return this.load(ctx.params.id); },
	},
	methods: {
		save(x) { return x; },
		load(id) { return { id }; },
	},
};
`,
    });
    const orders = list.features.find((f) => f.name === "Orders")!;
    expect(orders).toMatchObject({ kind: "service", entries: 4 });
  });

  it("groups routes that call the same function, and finds SQLAlchemy tables in Python", async () => {
    const { list, explain } = await open({
      "pyproject.toml": `[project]\nname = "shop"\ndependencies = ["fastapi", "sqlalchemy"]\n`,
      "app/__init__.py": "",
      "app/models.py": `
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    total: Mapped[int] = mapped_column()
`,
      "app/store.py": `
from app.models import Order


def place(session, total):
    session.add(Order(total=total))
    session.commit()
`,
      "app/main.py": `
from fastapi import FastAPI
from app.store import place

app = FastAPI()


@app.post("/orders")
def create(total: int):
    return place(None, total)
`,
    });
    const orders = list.features.find((f) => f.tables.includes("orders"));
    expect(orders).toMatchObject({ kind: "table", entries: 1 });
    const f = (await explain(orders!.id))!;
    expect(f.steps.map((s) => s.layer)).toEqual(["route", "service", "data"]);
    expect(f.steps[1]!.title).toBe("place writes orders");
  });
});
