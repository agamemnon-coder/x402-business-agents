// npm run policy:rego -- <policy.json> [--out <dir>]: writes the OPA bundle for a company's CFO policy (docs/policy-opa.md):
// the rules (policy/purser.rego), the policy's values as data.json, and a manifest. Reads one file, writes three;
// calls nothing outside. Purser does not use the bundle: it enforces in its own code.

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { readRegoPolicy, REGO_QUERY, writeRegoBundle } from "../policy/rego.js";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const file = args.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
if (!file || (at >= 0 && !args[at + 1])) {
  console.error("usage: npm run policy:rego -- <policy.json> [--out <dir>]   (policy/example-policy.json shows the shape)");
  process.exit(2);
}
let policy;
try {
  policy = readRegoPolicy(JSON.parse(readFileSync(file, "utf8")));
} catch (e) {
  console.error(`${file}: ${(e as Error).message}`);
  process.exit(1);
}
const out = resolve(at >= 0 ? args[at + 1]! : `opa-bundle-${basename(file).replace(/\.json$/i, "")}`);
const { files, revision } = writeRegoBundle(policy, out);
for (const f of files) console.log(`wrote ${f}`);
console.log(`revision ${revision}`);
console.log(`try: opa eval -b ${out} -i <input.json> '${REGO_QUERY}'`);
