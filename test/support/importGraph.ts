// The module graph below a source file, as a Worker's bundler and its type check follow it: static imports, re-exports
// and dynamic imports with a literal specifier, type-only ones included (the type check reads those files too). Used
// to pin that an agent's core (src/ap/checkerCore.ts) stays Worker-safe: no node: built-in and no native package
// anywhere below it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

export interface ImportGraph {
  /** Every source file reached (the entry included), relative to the repository root. */
  files: string[];
  /** Every package or built-in a reached file names ("zod", "node:crypto"), with the files that name it. */
  packages: Record<string, string[]>;
}

const ROOT = resolve(import.meta.dirname, "../..");
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** The file a relative specifier names: this repository writes "./x.js" for x.ts. */
function fileOf(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  const tries = [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base, `${base}.ts`, resolve(base, "index.ts")];
  const hit = tries.find(isFile);
  if (!hit) throw new Error(`${relative(ROOT, from)} imports ${spec}, which is no file`);
  return hit;
}

/** Walks the graph from `entry` (a path relative to the repository root). */
export function importGraph(entry: string): ImportGraph {
  const seen = new Set<string>();
  const packages: Record<string, string[]> = {};
  const todo = [resolve(ROOT, entry)];
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { fileName: spec } of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      if (spec.startsWith(".")) todo.push(fileOf(file, spec));
      else (packages[spec] ??= []).push(relative(ROOT, file));
    }
  }
  return { files: [...seen].map((f) => relative(ROOT, f)).sort(), packages };
}
