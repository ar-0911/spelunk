import { describe, expect, it } from "vitest";
import { diagramSvg, moduleLayers } from "../src/report/diagram.js";
import type { Report } from "../src/report/model.js";

const mod = (path: string, deps: string[]) => ({ path, files: [], lines: 0, dependsOn: deps.map((p) => ({ path: p, count: 1 })), usedBy: [] }) as unknown as Report["modules"][number];

describe("module diagram", () => {
  it("draws a cycle without leaving an empty layer behind", () => {
    // a ⇄ b breaks the cycle at depth 0, so no module sits there.
    const mods = [mod("a", ["b"]), mod("b", ["a"]), mod("c", ["a"])];
    const layers = moduleLayers(mods);
    expect(layers.every((l) => Array.isArray(l) && l.length > 0)).toBe(true);
    expect(layers.flat().sort()).toEqual(["a", "b", "c"]);
    expect(diagramSvg(mods)).toContain("<svg");
  });
});
