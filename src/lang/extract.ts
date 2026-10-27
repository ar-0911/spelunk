import type { Node, Tree } from "web-tree-sitter";
import type { ImportRef, Located, SymbolInfo, SymbolKind } from "../types.js";

/** Facts that need a syntax tree. Everything else comes from lines (see scan/detect.ts). */
export interface TreeFacts {
  symbols: SymbolInfo[];
  imports: Omit<ImportRef, "targets">[];
  calls: string[];
  callSites: [string, number][];
  /** Lines covered by calls that register a route ("/path" as first argument). */
  spans: [number, number][];
  swallowed: Located[];
  doc?: string;
  parseErrors: number;
}

const KIND: Record<string, SymbolKind> = {
  function_declaration: "function",
  generator_function_declaration: "function",
  function_definition: "function",
  function_item: "function",
  method_definition: "method",
  method_declaration: "method",
  method: "method",
  singleton_method: "method",
  constructor_declaration: "method",
  class_declaration: "class",
  abstract_class_declaration: "class",
  class_definition: "class",
  class: "class",
  object_declaration: "class",
  record_declaration: "class",
  struct_declaration: "struct",
  interface_declaration: "interface",
  protocol_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  enum_item: "enum",
  struct_item: "struct",
  trait_item: "trait",
  mod_item: "module",
  module: "module",
  type_spec: "type",
};

const CALL_TYPES = new Set(["call_expression", "call", "method_invocation", "invocation_expression", "function_call_expression", "member_call_expression", "macro_invocation"]);

const IDENT = /^[A-Za-z_$][\w$]*$/;

function lastSegment(text: string): string | undefined {
  const seg = text.split(/[.:>\-!]+/).filter(Boolean).pop();
  return seg && IDENT.test(seg) ? seg : undefined;
}

/**
 * How a call names its target: "save" for a bare call, "recv.save" for one on
 * a receiver ("this.save", "res.json", "pages.update", "Store.put"). The
 * receiver is what lets tracing tell a module or class call from a method on
 * some local object; "?" means the receiver isn't a plain name (a chained call).
 */
export function callRef(text: string): string | undefined {
  const segs = text.replace(/\s+/g, "").replace(/<[^<>]*>/g, "").split(/\?\.|::|->|[.!]/).filter(Boolean);
  const name = segs.pop();
  if (!name || !IDENT.test(name)) return undefined;
  if (!segs.length) return name;
  const r = segs.pop()!;
  const recv = r === "$this" ? "this" : IDENT.test(r) ? r : "?";
  return `${recv}.${name}`;
}

/** The plain name of a call reference: "res.json" → "json". */
export const refName = (ref: string) => ref.slice(ref.lastIndexOf(".") + 1);

function nameOf(node: Node): string | undefined {
  const field = node.childForFieldName("name");
  if (field) return field.text;
  // C/C++: function_definition → declarator → function_declarator → declarator
  let d = node.childForFieldName("declarator");
  while (d) {
    const inner = d.childForFieldName("declarator");
    if (!inner) return lastSegment(d.text);
    d = inner;
  }
  // Kotlin and a few others put the name in an unnamed-field identifier child.
  for (const c of node.namedChildren) {
    if (c && /^(simple_identifier|identifier|type_identifier|constant)$/.test(c.type)) return c.text;
  }
  return undefined;
}

/** A license or copyright banner ("/*! express, MIT Licensed"), which says nothing about what the file does. */
const LICENSE = /^\/\*!|copyright|\(c\)\s*\d{4}|licensed under|spdx-license-identifier|@license|all rights reserved/i;

function cleanComment(text: string): string {
  return text
    .replace(/^\/\*\*?|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\/\/?|#+|--|\*)\s?/, "").trimEnd())
    .join("\n")
    .trim();
}

function firstParagraph(text: string, max = 300): string | undefined {
  const para = text.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim();
  if (!para) return undefined;
  return para.length > max ? `${para.slice(0, max - 1)}…` : para;
}

function isComment(node: Node | null): node is Node {
  return Boolean(node && /comment/.test(node.type));
}

/** The comment block immediately above a node (or above its export/decorator wrapper). */
function docAbove(node: Node): string | undefined {
  let anchor: Node = node;
  while (anchor.parent && /^(export_statement|decorated_definition)$/.test(anchor.parent.type)) anchor = anchor.parent;
  const parts: string[] = [];
  let line = anchor.startPosition.row;
  let prev = anchor.previousSibling;
  while (isComment(prev) && prev.endPosition.row >= line - 1) {
    parts.unshift(cleanComment(prev.text));
    line = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return parts.length ? firstParagraph(parts.join("\n")) : undefined;
}

function pythonDocstring(node: Node): string | undefined {
  const body = node.childForFieldName("body") ?? (node.type === "module" ? node : null);
  const first = body?.namedChildren.find((c) => c && !isComment(c));
  if (first?.type !== "expression_statement") return undefined;
  const str = first.namedChildren[0];
  if (str?.type !== "string") return undefined;
  return firstParagraph(str.text.replace(/^[rbuf]*("""|'''|"|')|("""|'''|"|')$/gi, ""));
}

function exportedFor(lang: string, node: Node, name: string, depth: number): boolean {
  switch (lang) {
    case "typescript":
    case "tsx":
    case "javascript": {
      for (let p = node.parent; p; p = p.parent) if (p.type === "export_statement") return true;
      return false;
    }
    case "python":
      return !name.startsWith("_") && depth <= 1;
    case "go":
      return /^[A-Z]/.test(name);
    case "rust":
      return node.namedChildren.some((c) => c?.type === "visibility_modifier");
    case "java":
    case "kotlin":
    case "csharp":
    case "scala":
    case "swift":
    case "php": {
      const mods = node.namedChildren.find((c) => c && /modifiers?$/.test(c.type));
      if (mods) return /\b(public|open|internal)\b/.test(mods.text);
      return lang === "kotlin" || lang === "scala" || lang === "swift";
    }
    default:
      return depth <= 1;
  }
}

function stringValue(node: Node | null): string | undefined {
  if (!node) return undefined;
  const t = node.text.trim();
  const m = t.match(/^(["'`])([\s\S]*)\1$/) ?? t.match(/^<(.*)>$/);
  return m ? m[m.length - 1] : undefined;
}

export function extract(tree: Tree, lang: string): TreeFacts {
  const symbols: SymbolInfo[] = [];
  const imports: Omit<ImportRef, "targets">[] = [];
  const calls = new Set<string>();
  const callSites: [string, number][] = [];
  const spans: [number, number][] = [];
  /** Local names bound to a freshly built object (`const s = new UserService()`), so `s.find()` can resolve to UserService.find. File-wide, not scoped. */
  const made = new Map<string, string>();
  const swallowed: Located[] = [];
  const isJs = lang === "typescript" || lang === "tsx" || lang === "javascript";
  const addCall = (ref: string | undefined, node: Node) => {
    if (!ref) return;
    calls.add(refName(ref));
    callSites.push([ref, node.startPosition.row + 1]);
  };
  const root = tree.rootNode;
  let parseErrors = 0;

  const addImport = (spec: string | undefined, node: Node, extra: Partial<ImportRef> = {}) => {
    if (spec) imports.push({ spec, line: node.startPosition.row + 1, ...extra });
  };

  const addSymbol = (node: Node, kind: SymbolKind, name: string, parent: string | undefined, depth: number) => {
    const doc = lang === "python" ? pythonDocstring(node) ?? docAbove(node) : docAbove(node);
    symbols.push({
      name,
      kind: kind === "function" && parent ? "method" : kind,
      line: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: exportedFor(lang, node, name, depth),
      ...(parent ? { parent } : {}),
      ...(doc ? { doc } : {}),
      signature: node.text.split("\n")[0]!.trim().slice(0, 160),
    });
  };

  /** depth counts declaration nesting; insideFn stops closures from becoming symbols. */
  const walk = (node: Node, parent: string | undefined, depth: number, insideFn: boolean) => {
    if (node.type === "ERROR" || node.isMissing) parseErrors++;
    let nextParent = parent;
    let nextInsideFn = insideFn;
    let nextDepth = depth;

    const kind = KIND[node.type];
    if (kind && !insideFn) {
      let k = kind;
      if (node.type === "type_spec") {
        const t = node.childForFieldName("type")?.type;
        k = t === "struct_type" ? "struct" : t === "interface_type" ? "interface" : "type";
      }
      // Ruby/Elixir `module` vs Python root `module`: the root has no name.
      const name = node.type === "module" && !node.parent ? undefined : nameOf(node);
      if (name) {
        let owner = parent;
        if (node.type === "method_declaration" && lang === "go") {
          const recv = node.childForFieldName("receiver")?.text.match(/\*?\s*([A-Za-z_]\w*)\s*(?:\[.*\])?\s*\)$/);
          owner = recv?.[1] ?? parent;
        }
        addSymbol(node, k, name, owner, depth + 1);
        if (k === "function" || k === "method") nextInsideFn = true;
        else nextParent = name;
        nextDepth = depth + 1;
      }
    } else if (node.type === "impl_item" && !insideFn) {
      nextParent = node.childForFieldName("type")?.text ?? parent;
    } else if (node.type === "variable_declarator" && !insideFn && (lang === "typescript" || lang === "tsx" || lang === "javascript")) {
      const value = node.childForFieldName("value");
      const name = node.childForFieldName("name");
      if (value && name?.type === "identifier" && /^(arrow_function|function_expression|function|generator_function)$/.test(value.type)) {
        const decl = node.parent?.type === "lexical_declaration" || node.parent?.type === "variable_declaration" ? node.parent : node;
        const sym: SymbolInfo = {
          name: name.text,
          kind: "function",
          line: decl.startPosition.row + 1,
          endLine: decl.endPosition.row + 1,
          exported: exportedFor(lang, node, name.text, depth),
          signature: decl.text.split("\n")[0]!.trim().slice(0, 160),
        };
        const doc = docAbove(decl);
        if (doc) sym.doc = doc;
        symbols.push(sym);
        nextInsideFn = true;
      }
    }

    // `app.use = function use() {}`, `exports.x = () => {}`, `Foo.prototype.bar = function () {}`:
    // how older Node code (Express, most of npm) defines its API.
    if (node.type === "assignment_expression" && !insideFn && isJs) {
      const left = node.childForFieldName("left");
      const value = node.childForFieldName("right");
      if (left?.type === "member_expression" && value && /^(arrow_function|function_expression|function|generator_function)$/.test(value.type)) {
        const name = left.childForFieldName("property")?.text;
        const obj = left.childForFieldName("object")?.text.replace(/\s+/g, "").replace(/\.prototype$/, "");
        if (name && obj && /^[\w$.]+$/.test(obj)) {
          const onModule = obj === "exports" || obj === "module.exports";
          const stmt = node.parent?.type === "expression_statement" ? node.parent : node;
          const sym: SymbolInfo = {
            name,
            kind: onModule ? "function" : "method",
            line: stmt.startPosition.row + 1,
            endLine: stmt.endPosition.row + 1,
            exported: onModule,
            ...(onModule ? {} : { parent: obj }),
            signature: stmt.text.split("\n")[0]!.trim().slice(0, 160),
          };
          const doc = docAbove(stmt);
          if (doc) sym.doc = doc;
          symbols.push(sym);
          nextInsideFn = true;
        }
      }
    }

    // Imports
    switch (node.type) {
      case "import_statement":
        if (lang === "python") {
          // `import a.b` is used as `b.x()` (well, `a.b.x()`); `import a.b as c` as `c.x()`.
          for (const c of node.namedChildren) {
            if (c?.type === "dotted_name") addImport(c.text, node, { namespace: c.text.split(".").pop()! });
            else if (c?.type === "aliased_import") {
              const mod = c.childForFieldName("name")?.text;
              addImport(mod, node, { namespace: c.childForFieldName("alias")?.text ?? mod?.split(".").pop() ?? "" });
            }
          }
        } else addImport(stringValue(node.childForFieldName("source")), node, jsBindings(node));
        break;
      case "import_from_statement": {
        const mod = node.childForFieldName("module_name");
        const named = node.childrenForFieldName("name").filter((n): n is Node => Boolean(n));
        const names = named.map((n) => (n.type === "aliased_import" ? n.childForFieldName("name")?.text ?? n.text : n.text));
        const bindings = named.map((n) => (n.type === "aliased_import" ? n.childForFieldName("alias")?.text ?? n.text : n.text));
        addImport(mod?.text, node, names.length ? { names, bindings } : {});
        break;
      }
      case "export_statement":
        // `export { a } from "./a"` re-exports: a barrel. The names it passes on are its bindings.
        addImport(stringValue(node.childForFieldName("source")), node, jsBindings(node));
        break;
      case "import_spec": {
        // Go: the local package name is the alias, or the path's last element (skipping a /vN suffix).
        const spec = stringValue(node.childForFieldName("path"));
        const parts = spec?.split("/") ?? [];
        const last = /^v\d+$/.test(parts[parts.length - 1] ?? "") ? parts[parts.length - 2] : parts[parts.length - 1];
        addImport(spec, node, { namespace: node.childForFieldName("name")?.text ?? last ?? "" });
        break;
      }
      case "use_declaration":
        addImport(node.childForFieldName("argument")?.text, node);
        break;
      case "mod_item":
        if (!node.childForFieldName("body")) addImport(`mod:${nameOf(node)}`, node);
        break;
      case "import_declaration":
      case "using_directive":
      case "namespace_use_declaration": {
        const spec = node.text.replace(/^(import|using|use)\s+(static\s+)?/, "").replace(/;\s*$/, "").trim();
        if (lang !== "typescript" && lang !== "javascript") addImport(spec, node);
        break;
      }
      case "preproc_include": {
        const path = node.childForFieldName("path");
        if (path) addImport(path.type === "system_lib_string" ? `<${stringValue(path)}>` : stringValue(path), node);
        break;
      }
    }

    // Calls (and require()/import() which are calls too)
    if (CALL_TYPES.has(node.type)) {
      const fn = node.childForFieldName("function") ?? node.childForFieldName("method") ?? node.childForFieldName("macro") ?? node.childForFieldName("name");
      // Receivers live in their own field in Java (`object`), Ruby (`receiver`) and PHP (`object`, `scope`).
      const recv = node.type === "method_invocation" || node.type === "member_call_expression" ? node.childForFieldName("object") : lang === "ruby" ? node.childForFieldName("receiver") : node.type === "scoped_call_expression" ? node.childForFieldName("scope") : null;
      let ref = fn ? callRef(recv ? `${recv.text}.${fn.text}` : fn.text) : undefined;
      // Ruby `Foo.new` builds a Foo.
      if (lang === "ruby" && ref && /^[A-Z]\w*\.new$/.test(ref)) ref = ref.slice(0, -4);
      const callee = ref ? refName(ref) : undefined;
      addCall(ref, node);
      const args = node.childForFieldName("arguments");
      const argList = args?.namedChildren.filter((a): a is Node => Boolean(a)) ?? [];
      const firstArg = argList[0] ?? null;
      // Functions passed by name are used too: `router.get("/users", auth, getUser)`, `items.map(format)`.
      // On a route registration, `controller.getUser` counts as well.
      const route = /^["'`]\//.test(firstArg?.text ?? "");
      // A decorator (`@router.post("/")`) isn't the handler; the function under it is.
      if (route && node.parent?.type !== "decorator") spans.push([node.startPosition.row + 1, node.endPosition.row + 1]);
      for (const a of argList) {
        if (a.type === "identifier") addCall(a.text, a);
        else if (route && /^(member_expression|attribute|selector_expression|field_access|scoped_identifier)$/.test(a.type)) addCall(callRef(a.text), a);
      }
      if (fn && (fn.text === "require" || fn.type === "import") && isJs) {
        addImport(stringValue(firstArg), node, requireBindings(node));
      } else if (lang === "ruby" && (callee === "require" || callee === "require_relative" || callee === "load")) {
        const v = stringValue(firstArg);
        addImport(v && callee === "require_relative" ? `./${v}` : v, node);
      }
    }

    // `new Foo()` (JS, Java, C#, PHP) builds a Foo: a use of its class.
    if (node.type === "new_expression" || node.type === "object_creation_expression") {
      const t = node.childForFieldName("constructor") ?? node.childForFieldName("type") ?? node.namedChildren.find((c) => c && /name|identifier|qualified/.test(c.type)) ?? null;
      if (t) addCall(callRef(t.text), node);
      const holder = node.parent?.type === "variable_declarator" ? node.parent.childForFieldName("name") : null;
      const cls = t && callRef(t.text);
      if (holder?.type === "identifier" && cls && !cls.includes(".")) made.set(holder.text, cls);
    }
    // Python: `s = UserService()` builds a UserService.
    if (node.type === "assignment" && lang === "python") {
      const left = node.childForFieldName("left");
      const fn = node.childForFieldName("right")?.type === "call" ? node.childForFieldName("right")!.childForFieldName("function") : null;
      if (left?.type === "identifier" && fn?.type === "identifier" && /^[A-Z]/.test(fn.text)) made.set(left.text, fn.text);
    }
    // <Component /> in JSX renders a component: a call, for tracing. Lowercase tags are HTML.
    if ((node.type === "jsx_opening_element" || node.type === "jsx_self_closing_element") && isJs) {
      const tag = node.childForFieldName("name")?.text;
      if (tag && /^[A-Z]|\./.test(tag)) addCall(callRef(tag), node);
    }

    // new URL("./worker.ts", import.meta.url) and new Worker("./w.js") load files too.
    if (node.type === "new_expression" && isJs) {
      const ctor = node.childForFieldName("constructor")?.text;
      const arg = node.childForFieldName("arguments")?.namedChildren[0] ?? null;
      const v = stringValue(arg);
      if ((ctor === "URL" || ctor === "Worker" || ctor === "SharedWorker") && v?.startsWith(".")) addImport(v, node);
    }

    // Errors that disappear
    if (node.type === "catch_clause" || node.type === "rescue") {
      const body = node.childForFieldName("body") ?? node.namedChildren.find((c) => c?.type === "statement_block" || c?.type === "block");
      if (body && body.namedChildren.filter((c) => c && !isComment(c)).length === 0) {
        swallowed.push({ line: node.startPosition.row + 1, text: node.text.split("\n")[0]!.trim() });
      }
    } else if (node.type === "except_clause") {
      const block = node.namedChildren.find((c) => c?.type === "block");
      const stmts = block?.namedChildren.filter((c) => c && !isComment(c)) ?? [];
      if (stmts.length === 1 && stmts[0]!.type === "pass_statement") swallowed.push({ line: node.startPosition.row + 1, text: node.text.split("\n")[0]!.trim() });
    }

    for (const child of node.namedChildren) {
      if (child) walk(child, nextParent, nextDepth, nextInsideFn);
    }
  };

  walk(root, undefined, 0, false);

  // File header: the first comment (or module docstring) before any code.
  let doc: string | undefined;
  if (lang === "python") doc = pythonDocstring(root);
  if (!doc) {
    const parts: string[] = [];
    for (const c of root.namedChildren) {
      if (!isComment(c)) break;
      if (/^#!/.test(c.text) || LICENSE.test(c.text)) continue;
      parts.push(cleanComment(c.text));
    }
    // A comment that is really a symbol's doc (directly above the first declaration) isn't a file header.
    const firstCode = root.namedChildren.find((c) => c && !isComment(c));
    const lastComment = parts.length ? root.namedChildren[parts.length - 1] : undefined;
    const attached = firstCode && lastComment && firstCode.startPosition.row - lastComment.endPosition.row <= 1 && KIND[firstCode.type];
    if (parts.length && !(attached && parts.length === 1)) doc = firstParagraph(parts.join("\n\n"));
  }

  if (isJs) markJsExports(root, symbols);
  if (made.size) {
    for (const site of callSites) {
      const dot = site[0].indexOf(".");
      const cls = dot > 0 ? made.get(site[0].slice(0, dot)) : undefined;
      if (cls) site[0] = `${cls}${site[0].slice(dot)}`;
    }
  }

  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const inside = [...new Set(callSites.filter(([, line]) => line >= sym.line && line <= sym.endLine).map(([name]) => name))];
    if (inside.length) sym.calls = inside.slice(0, 60);
  }

  return { symbols, imports, calls: [...calls].sort(), callSites, spans, swallowed, ...(doc ? { doc } : {}), parseErrors };
}

/** Local names an ES import (or re-export) binds: `import d, * as ns, { a as b } from "…"`. */
function jsBindings(node: Node): Partial<ImportRef> {
  const out: Partial<ImportRef> = {};
  const names: string[] = [];
  const bindings: string[] = [];
  const clause = node.namedChildren.find((c) => c?.type === "import_clause" || c?.type === "export_clause");
  for (const c of clause?.namedChildren ?? []) {
    if (!c) continue;
    if (c.type === "identifier") out.defaultBinding = c.text;
    else if (c.type === "namespace_import") out.namespace = c.namedChildren.find((x) => x?.type === "identifier")?.text ?? "";
    else if (c.type === "named_imports" || c.type === "import_specifier" || c.type === "export_specifier") {
      for (const sp of c.type === "named_imports" ? c.namedChildren : [c]) {
        const name = sp?.childForFieldName("name")?.text;
        if (!name) continue;
        names.push(name);
        bindings.push(sp!.childForFieldName("alias")?.text ?? name);
      }
    }
  }
  // `export * from "./x"` passes everything on.
  if (node.type === "export_statement" && !clause && node.childForFieldName("source")) out.namespace = "*";
  if (names.length) Object.assign(out, { names, bindings });
  return out;
}

/** `const x = require("…")` binds a namespace; `const { a, b: c } = require("…")` binds names. */
function requireBindings(call: Node): Partial<ImportRef> {
  // `var compileETag = require("./utils").compileETag` binds one name.
  const member = call.parent?.type === "member_expression" && call.parent.childForFieldName("object")?.id === call.id ? call.parent : undefined;
  const holder = member?.parent?.type === "variable_declarator" ? member.parent.childForFieldName("name") : undefined;
  const prop = member?.childForFieldName("property")?.text;
  if (member) return holder?.type === "identifier" && prop ? { names: [prop], bindings: [holder.text] } : {};
  const decl = call.parent?.type === "variable_declarator" ? call.parent : undefined;
  const target = decl?.childForFieldName("name");
  if (!target) return {};
  if (target.type === "identifier") return { namespace: target.text };
  if (target.type !== "object_pattern") return {};
  const names: string[] = [];
  const bindings: string[] = [];
  for (const p of target.namedChildren) {
    if (p?.type === "shorthand_property_identifier_pattern") {
      names.push(p.text);
      bindings.push(p.text);
    } else if (p?.type === "pair_pattern") {
      const k = p.childForFieldName("key")?.text;
      const v = p.childForFieldName("value")?.text;
      if (k && v) {
        names.push(k);
        bindings.push(v);
      }
    }
  }
  return names.length ? { names, bindings } : {};
}

/**
 * Exports declared apart from the definition: `export { a, b as c }`,
 * `export default a`, and CommonJS `module.exports = { a }` / `exports.a = a`.
 */
/** `a = b = module.exports = x` → the assigned names (["a", "b", "module.exports"]) and the final value. */
function assignChain(node: Node): { lefts: string[]; value: Node | null } {
  const lefts: string[] = [];
  let cur: Node | null = node;
  while (cur?.type === "assignment_expression") {
    lefts.push(cur.childForFieldName("left")?.text.replace(/\s+/g, "") ?? "");
    cur = cur.childForFieldName("right");
  }
  return { lefts, value: cur };
}

function markJsExports(root: Node, symbols: SymbolInfo[]): void {
  const top = new Map(symbols.filter((s) => !s.parent).map((s) => [s.name, s]));
  // Objects that are the module's exports (`var app = exports = module.exports = {}`, `module.exports = req`): their methods are its API.
  const moduleObjects = new Set<string>();
  const isModule = (l: string) => l === "module.exports" || l === "exports";
  for (const n of root.namedChildren) {
    if (n?.type === "lexical_declaration" || n?.type === "variable_declaration") {
      for (const d of n.namedChildren) {
        const value = d?.childForFieldName("value");
        if (value?.type === "assignment_expression" && assignChain(value).lefts.some(isModule)) moduleObjects.add(d!.childForFieldName("name")!.text);
      }
    }
    const e = n?.type === "expression_statement" ? n.namedChildren[0] : null;
    if (e?.type === "assignment_expression") {
      const { lefts, value } = assignChain(e);
      if (lefts.some(isModule)) {
        for (const l of lefts) if (/^[\w$]+$/.test(l) && !isModule(l)) moduleObjects.add(l);
        if (value?.type === "identifier") moduleObjects.add(value.text);
      }
    }
  }
  for (const s of symbols) {
    if (s.parent && moduleObjects.has(s.parent)) s.exported = true;
    // `exports = module.exports = createApplication`: the function is the module.
    if (!s.parent && moduleObjects.has(s.name)) Object.assign(s, { exported: true, default: true });
  }
  const mark = (name: string | undefined, asDefault = false) => {
    const s = name ? top.get(name) : undefined;
    if (!s) return;
    s.exported = true;
    if (asDefault) s.default = true;
  };
  for (const n of root.namedChildren) {
    if (!n) continue;
    if (n.type === "export_statement") {
      const isDefault = n.children.some((c) => c?.type === "default");
      const clause = n.namedChildren.find((c) => c?.type === "export_clause");
      if (clause && !n.childForFieldName("source")) for (const sp of clause.namedChildren) mark(sp?.childForFieldName("name")?.text, sp?.childForFieldName("alias")?.text === "default");
      const decl = n.childForFieldName("declaration") ?? n.childForFieldName("value") ?? n.namedChildren.find((c) => c && c.type !== "export_clause" && c.type !== "comment") ?? null;
      if (isDefault && decl) mark(decl.type === "identifier" ? decl.text : nameOf(decl), true);
    }
    const assign = n.type === "expression_statement" ? n.namedChildren[0] : null;
    if (assign?.type !== "assignment_expression") continue;
    const left = assign.childForFieldName("left")?.text.replace(/\s+/g, "") ?? "";
    const right = assign.childForFieldName("right");
    if (left === "module.exports" && right?.type === "identifier") mark(right.text, true);
    else if (left === "module.exports" && right?.type === "object") {
      for (const p of right.namedChildren) {
        if (p?.type === "shorthand_property_identifier") mark(p.text);
        else if (p?.type === "pair" && p.childForFieldName("value")?.type === "identifier") mark(p.childForFieldName("value")!.text);
      }
    } else if (/^(module\.)?exports\.[\w$]+$/.test(left) && right?.type === "identifier") mark(right.text);
  }
}
