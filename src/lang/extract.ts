import type { Node, Tree } from "web-tree-sitter";
import type { ImportRef, Located, SymbolInfo, SymbolKind } from "../types.js";

/** Facts that need a syntax tree. Everything else comes from lines (see scan/detect.ts). */
export interface TreeFacts {
  symbols: SymbolInfo[];
  imports: Omit<ImportRef, "targets">[];
  calls: string[];
  callSites: [string, number][];
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
  const swallowed: Located[] = [];
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

    // Imports
    switch (node.type) {
      case "import_statement":
        if (lang === "python") {
          for (const c of node.namedChildren) {
            if (c?.type === "dotted_name") addImport(c.text, node);
            else if (c?.type === "aliased_import") addImport(c.childForFieldName("name")?.text, node);
          }
        } else addImport(stringValue(node.childForFieldName("source")), node);
        break;
      case "import_from_statement": {
        const mod = node.childForFieldName("module_name");
        const names = node.childrenForFieldName("name").filter((n): n is Node => Boolean(n)).map((n) => (n.type === "aliased_import" ? n.childForFieldName("name")?.text ?? n.text : n.text));
        addImport(mod?.text, node, names.length ? { names } : {});
        break;
      }
      case "export_statement":
        addImport(stringValue(node.childForFieldName("source")), node);
        break;
      case "import_spec":
        addImport(stringValue(node.childForFieldName("path")), node);
        break;
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
      const callee = fn ? lastSegment(fn.text) : undefined;
      if (callee) {
        calls.add(callee);
        callSites.push([callee, node.startPosition.row + 1]);
      }
      const args = node.childForFieldName("arguments");
      const firstArg = args?.namedChildren[0] ?? null;
      if (fn && (fn.text === "require" || fn.type === "import") && (lang === "javascript" || lang === "typescript" || lang === "tsx")) {
        addImport(stringValue(firstArg), node);
      } else if (lang === "ruby" && (callee === "require" || callee === "require_relative" || callee === "load")) {
        const v = stringValue(firstArg);
        addImport(v && callee === "require_relative" ? `./${v}` : v, node);
      }
    }

    // new URL("./worker.ts", import.meta.url) and new Worker("./w.js") load files too.
    if (node.type === "new_expression" && (lang === "javascript" || lang === "typescript" || lang === "tsx")) {
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
      if (/^#!/.test(c.text)) continue;
      parts.push(cleanComment(c.text));
    }
    // A comment that is really a symbol's doc (directly above the first declaration) isn't a file header.
    const firstCode = root.namedChildren.find((c) => c && !isComment(c));
    const lastComment = parts.length ? root.namedChildren[parts.length - 1] : undefined;
    const attached = firstCode && lastComment && firstCode.startPosition.row - lastComment.endPosition.row <= 1 && KIND[firstCode.type];
    if (parts.length && !(attached && parts.length === 1)) doc = firstParagraph(parts.join("\n\n"));
  }

  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const inside = [...new Set(callSites.filter(([, line]) => line >= sym.line && line <= sym.endLine).map(([name]) => name))];
    if (inside.length) sym.calls = inside.slice(0, 60);
  }

  return { symbols, imports, calls: [...calls].sort(), callSites, swallowed, ...(doc ? { doc } : {}), parseErrors };
}
