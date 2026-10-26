import { resolve } from "node:path";
import { buildGraph, type Graph } from "./analysis/graph.js";
import { findRisks, type Risk } from "./analysis/risks.js";
import { loadExplanations, type Explanations } from "./explain/explain.js";
import { loadIndex, saveIndex, scan, type ScanOptions } from "./scan/scan.js";
import type { Index } from "./types.js";

/**
 * A scanned repository with its derived views. The graph is cheap and built
 * eagerly; risks read files (for duplicates) so they're computed on demand.
 */
export class Workspace {
  readonly graph: Graph;
  private risksPromise?: Promise<Risk[]>;

  constructor(readonly index: Index) {
    this.graph = buildGraph(index);
  }

  risks(): Promise<Risk[]> {
    return (this.risksPromise ??= findRisks(this.index, this.graph));
  }

  explanations(): Promise<Explanations | undefined> {
    return loadExplanations(this.index.root);
  }
}

export interface OpenOptions extends ScanOptions {
  /** Rescan (incrementally) even when an index exists. */
  refresh?: boolean;
}

/** Loads the saved index, scanning first when there is none or `refresh` is set. */
export async function openWorkspace(root: string, options: OpenOptions = {}): Promise<Workspace> {
  const abs = resolve(root);
  let index = options.refresh || options.full ? undefined : await loadIndex(abs);
  if (!index) {
    index = await scan(abs, options);
    await saveIndex(index);
  }
  return new Workspace(index);
}
