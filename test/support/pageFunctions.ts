// Functions a script hands to a browser (page.evaluate and the like) are sent as their source text and run in the page,
// where no helper of the bundler that ran the script exists. tsx runs this repository's scripts through esbuild with
// keepNames on, which wraps every named function or arrow in __name(...): inside a page function that throws
// "ReferenceError: __name is not defined" (walk 2 of docs/runs/2026-11-19-mega-run.md). This transforms a file as tsx
// does and lists the page functions whose text names such a helper.
import { transformSync } from "esbuild";
import ts from "typescript";

/** The Playwright calls whose function argument runs in the browser. */
export const BROWSER_CALLS = ["evaluate", "evaluateHandle", "evaluateAll", "addInitScript", "waitForFunction", "$eval", "$$eval"] as const;
const CALLS: ReadonlySet<string> = new Set(BROWSER_CALLS);
/** Helpers esbuild may put in transformed code, which exist in the script's module but not in the page. */
const HELPER = /\b__(name|defProp|publicField|async|spreadValues|objRest)\b/;

/** One page function using a helper: the call it is handed to, and its text as tsx sends it. */
export interface PageFunctionHit { call: string; code: string }

/** The page functions of a TypeScript source, as tsx would send them, that use an esbuild helper. */
export function pageFunctionsUsingHelpers(source: string, file: string): PageFunctionHit[] {
  // The options tsx 4 gives esbuild (its dist: target node<version>, keepNames, minifyWhitespace), with ESM out.
  const js = transformSync(source, { loader: "ts", format: "esm", target: `node${process.versions.node}`, keepNames: true, minifyWhitespace: true, sourcefile: file }).code;
  const sf = ts.createSourceFile(`${file}.js`, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const hits: PageFunctionHit[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && CALLS.has(n.expression.name.text)) {
      for (const a of n.arguments) {
        if (!(ts.isArrowFunction(a) || ts.isFunctionExpression(a))) continue;
        const code = a.getText(sf);
        if (HELPER.test(code)) hits.push({ call: n.expression.name.text, code });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
