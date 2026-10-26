import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Writes a small repository to a temp directory (not a git repo, so the plain walker runs). */
export async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "spelunk-test-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text.replace(/^\n/, ""));
  }
  return root;
}

export const TS_APP = {
  "package.json": JSON.stringify({ name: "notes", scripts: { dev: "tsx src/main.ts", seed: "tsx scripts/seed.ts" } }),
  ".env.example": "DATABASE_URL=\nPORT=3000\nUNUSED_THING=\n",
  "src/main.ts": `
import { createApp } from "./app.js";
const port = Number(process.env.PORT ?? 3000);
createApp().listen(port);
`,
  "src/app.ts": `
import express from "express";
import { saveNote, listNotes } from "./services/notes.js";

/** HTTP routes for the notes API. */
export function createApp() {
  const app = express();
  app.get("/api/notes", async (_req, res) => res.json(await listNotes()));
  app.post("/api/notes", async (req, res) => res.json(await saveNote(req.body)));
  return app;
}
`,
  "src/services/notes.ts": `
import { db } from "../db.js";

/** Saves a note and returns it with its id. */
export async function saveNote(input: { text: string }) {
  validate(input);
  return db.insert(input);
}

export async function listNotes() {
  try {
    return await db.all();
  } catch {}
}

function validate(input: { text: string }) {
  if (!input.text) throw new Error("text is required");
}
`,
  "src/db.ts": `
const url = process.env.DATABASE_URL;
const secret = process.env.SECRET_KEY;
export const db = { insert: async (x: unknown) => x, all: async () => [] as unknown[], url, secret };
`,
  "src/web/client.ts": `
export async function addNote(text: string) {
  await fetch("/api/notes", { method: "POST", body: JSON.stringify({ text }) });
  await fetch("/api/notse");
}
`,
  "src/unused.ts": `export const nothing = 1;\n`,
  "scripts/seed.ts": `import { saveNote } from "../src/services/notes.js";\nawait saveNote({ text: "hi" });\n`,
  "test/notes.test.ts": `import { saveNote } from "../src/services/notes.js";\nsaveNote({ text: "x" });\n`,
};

export const PY_APP = {
  "pyproject.toml": `[project]\nname = "shop"\ndependencies = ["fastapi"]\n`,
  "app/__init__.py": "",
  "app/main.py": `
from fastapi import FastAPI
from app.api import orders

app = FastAPI()
app.include_router(orders.router)
`,
  "app/api/__init__.py": "",
  "app/api/orders.py": `
from fastapi import APIRouter
from app.services.billing import charge
from ..models import Order

router = APIRouter(prefix="/orders", tags=["orders"])


@router.post("/")
def create_order(order: Order):
    """Create an order and charge the card.

    Example::

        @app.get("/not-a-route")
    """
    return charge(order)


@router.get("/{order_id}")
def get_order(order_id: int):
    return Order(id=order_id)
`,
  "app/models.py": `
class Order:
    """An order a customer placed."""

    def __init__(self, id: int):
        self.id = id
`,
  "app/services/__init__.py": "",
  "app/services/billing.py": `
import os
import logging

STRIPE_KEY = os.environ["STRIPE_KEY"]
log = logging.getLogger(__name__)


def charge(order):
    try:
        return _send(order)
    except Exception:
        pass


def _send(order):
    log.error("charge failed")
    raise RuntimeError("declined")
`,
};

export const GO_APP = {
  "go.mod": "module example.com/shop\n\ngo 1.22\n",
  "main.go": `
package main

import "example.com/shop/orders"

func main() {
	orders.Register()
}
`,
  "orders/routes.go": `
package orders

import "net/http"

// Register wires the order handlers.
func Register() {
	http.HandleFunc("/orders", Create)
}

func Create(w http.ResponseWriter, r *http.Request) {
	Save(r)
}
`,
  "orders/store.go": `
package orders

import "net/http"

func Save(r *http.Request) error {
	return nil
}
`,
};
