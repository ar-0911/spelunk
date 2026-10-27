import { describe, expect, it } from "vitest";
import { outlineFiles } from "../src/integrations/outline.js";

const JS = `import a from "a";

// the store
export class Store extends Base {
  count = 0;

  /** Saves. */
  save(x) {
    return x;
  }

  load() {}
}
register("a");
register("b");
X = X + 1;
const helper = () => 1;
`;

describe("outline (for Braid's merge driver)", () => {
  it("splits a file into entities and class members, with comments attached", async () => {
    const { files } = await outlineFiles({ files: [{ path: "src/store.js", text: JS }] });
    const f = files[0]!;
    expect(f).toMatchObject({ path: "src/store.js", language: "javascript", ok: true });
    expect(f.items.map((i) => [i.kind, i.name, i.start, i.end])).toEqual([
      ["import_statement", undefined, 1, 1],
      ["class_declaration", "Store", 3, 13],
      ["call", "register", 14, 14],
      ["call", "register", 15, 15],
      ["assign", "X", 16, 16],
      ["lexical_declaration", "helper", 17, 17],
    ]);
    expect(f.items[1]!.members!.map((m) => [m.kind, m.name, m.start, m.end])).toEqual([
      ["field_definition", "count", 5, 5],
      ["method_definition", "save", 7, 10],
      ["method_definition", "load", 12, 12],
    ]);
  });

  it("covers other languages' classes, impls and decorators", async () => {
    const { files } = await outlineFiles({ files: [
      { path: "a.ts", text: "export abstract class C {\n  private a = 1;\n  @dec()\n  b(): void {}\n}\ninterface I {\n  x: string;\n}\n" },
      { path: "a.rs", text: "use std::io;\nimpl S {\n    fn a(&self) {}\n}\n#[test]\nfn t() {}\n" },
      { path: "A.java", text: "class A {\n  int f;\n  void m() {}\n}\n" },
      { path: "notes.txt", text: "hello" },
    ] });
    expect(files.map((f) => f.path)).toEqual(["a.ts", "a.rs", "A.java"]);
    const [ts, rs, java] = files;
    expect(ts!.items[0]!.members!.map((m) => [m.name, m.start])).toEqual([["a", 2], ["b", 3]]);
    expect(ts!.items[1]).toMatchObject({ kind: "interface_declaration", name: "I" });
    expect(rs!.items.map((i) => [i.kind, i.name, i.start])).toEqual([["use_declaration", undefined, 1], ["impl_item", "S", 2], ["function_item", "t", 5]]);
    expect(java!.items[0]!.members!.map((m) => m.name)).toEqual(["f", "m"]);
  });

  it("says when a file doesn't parse", async () => {
    const { files } = await outlineFiles({ files: [{ path: "a.js", text: "class {{{\n" }] });
    expect(files[0]!.ok).toBe(false);
  });

  it("refuses input that isn't a files list", async () => {
    await expect(outlineFiles({} as never)).rejects.toThrow(/files/);
  });
});
