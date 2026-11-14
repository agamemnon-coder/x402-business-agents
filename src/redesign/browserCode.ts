// A self-contained TypeScript module as browser code (partner review, 14 Nov): /visa and /t0 run Purser's own checks in
// the visitor's browser, the same source the server runs, its types stripped. The module may import types only (they
// vanish); a value import would leave a dangling name, so it is refused here. The output is plain script: the
// `export` keywords are dropped, and the page wraps it in its own function.

import { readFileSync } from "node:fs";
import ts from "typescript";

export function browserCode(file: string): string {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  if (/^import\s+(?!type\b)/m.test(src)) throw new Error(`${file} imports a value: it cannot run in the browser as it is`);
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: true }, reportDiagnostics: false }).outputText;
  return js.replace(/^export \{\};?\s*$/gm, "").replace(/^export (?=(?:async )?function |const |let |class )/gm, "").trim();
}
