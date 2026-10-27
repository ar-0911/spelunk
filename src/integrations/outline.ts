import type { Node } from "web-tree-sitter";
import { languageFor } from "../lang/languages.js";
import { parse } from "../lang/parser.js";

/**
 * `spelunk outline`: split files into their top-level entities, with the members of classes, interfaces and
 * impl blocks, for a structural merge. Braid's merge driver sends the base, ours and theirs versions of a
 * file and merges entity by entity, so two methods added to the same class no longer conflict.
 *
 * In:  {"files": [{"path": "src/a.ts", "text": "..."}]}   (the path only picks the language)
 * Out: {"files": [{"path", "language", "ok", "items": [Item]}]}, leaving out files in languages Spelunk doesn't parse.
 * Item: {kind, name?, start, end, members?: Item[]}. Lines are 1-based and inclusive. Comments, decorators and
 * attributes just above an entity belong to it. `ok` is false when the file doesn't parse cleanly.
 */
export interface OutlineItem {
  kind: string;
  name?: string;
  start: number;
  end: number;
  members?: OutlineItem[];
}

const LEADING = /^(comment|line_comment|block_comment|decorator|attribute_item|inner_attribute_item|annotation)$/;
const WRAPPERS = /^(export_statement|decorated_definition|ambient_declaration)$/;
const MEMBER_BODIES = /^(class_body|interface_body|declaration_list|enum_body|object_type|field_declaration_list|enum_variant_list|enum_class_body|protocol_body)$/;
const DECLARATIONS = /^(lexical_declaration|variable_declaration|var_declaration|const_declaration|short_var_declaration|type_declaration|field_declaration|local_variable_declaration|property_declaration)$/;

function nameOf(node: Node): string | undefined {
  const direct = node.childForFieldName("name") ?? node.childForFieldName("property");
  if (direct) return direct.text;
  if (node.type === "impl_item") {
    const trait = node.childForFieldName("trait")?.text;
    const type = node.childForFieldName("type")?.text;
    return trait ? `${trait} for ${type}` : type;
  }
  if (DECLARATIONS.test(node.type)) {
    // const a = 1, var x int, type T struct{}, int f = 0;
    for (const child of node.namedChildren) {
      if (!child) continue;
      const name = child.childForFieldName("name") ?? child.childForFieldName("declarator");
      if (name) return (name.childForFieldName("name") ?? name).text;
    }
  }
  return undefined;
}

/** The entity a wrapper (export, decorators) holds, so `export class A` is keyed like `class A`. */
function unwrap(node: Node): Node {
  if (!WRAPPERS.test(node.type)) return node;
  const inner = node.childForFieldName("declaration") ?? node.childForFieldName("definition")
    ?? node.namedChildren.filter((c): c is Node => !!c && !LEADING.test(c.type)).at(-1);
  return inner ?? node;
}

function describe(node: Node): Omit<OutlineItem, "start" | "end"> {
  const inner = unwrap(node);
  if (inner.type === "expression_statement") {
    const expr = inner.namedChildren[0];
    if (expr?.type === "call_expression") return { kind: "call", name: expr.childForFieldName("function")?.text ?? "" };
    if (expr && /assignment/.test(expr.type)) return { kind: "assign", name: expr.childForFieldName("left")?.text ?? "" };
    return { kind: inner.type };
  }
  const name = nameOf(inner);
  return { kind: inner.type, ...(name !== undefined ? { name } : {}) };
}

function items(nodes: (Node | null)[], depth: number): OutlineItem[] {
  const out: OutlineItem[] = [];
  let leadStart: number | undefined;
  for (const node of nodes) {
    if (!node) continue;
    if (LEADING.test(node.type)) {
      leadStart ??= node.startPosition.row + 1;
      continue;
    }
    const item: OutlineItem = { ...describe(node), start: leadStart ?? node.startPosition.row + 1, end: node.endPosition.row + 1 };
    leadStart = undefined;
    const body = unwrap(node).childForFieldName("body");
    if (depth === 0 && body && MEMBER_BODIES.test(body.type)) item.members = items(body.namedChildren, depth + 1);
    out.push(item);
  }
  return out; // trailing comments belong to no entity
}

export async function outlineFiles(req: { files: { path: string; text: string }[] }) {
  if (!req || !Array.isArray(req.files)) throw new Error('Send {"files": [{"path": "...", "text": "..."}]} on stdin.');
  const out = [];
  for (const f of req.files) {
    const lang = typeof f?.path === "string" ? languageFor(f.path) : undefined;
    if (!lang?.grammar || typeof f.text !== "string") continue;
    const tree = await parse(lang.grammar, f.text);
    if (!tree) continue;
    out.push({ path: f.path, language: lang.id, ok: !tree.rootNode.hasError, items: items(tree.rootNode.namedChildren, 0) });
    tree.delete();
  }
  return { files: out };
}
