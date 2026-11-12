// npm run cloud:smoke-demo -- --base https://<the demo's host> [--slugs a,b,c]
//
// After a deploy or a re-seed of the demo deployment (docs/cloud-demo.md): GET requests only, at most a fixed number,
// checking that it answers as the runbook says. Sends no key and reads none; prints addresses and statuses only.
// Exit code 0 when every check passes, 1 when one fails, 2 when the arguments are wrong.

import { DEMO_COMPANIES } from "../demoworld/companies.js";
import { smokeBase, smokeDemo, smokeLines } from "../demoworld/smoke.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = opt("--base");
const slugs = (opt("--slugs") ?? DEMO_COMPANIES.map((c) => c.slug).join(",")).split(",").filter(Boolean);
const known = new Set(["--base", "--slugs"]);
if (!base || args.length % 2 !== 0 || args.some((a, i) => i % 2 === 0 && !known.has(a))) {
  console.error("usage: npm run cloud:smoke-demo -- --base https://<the demo's host> [--slugs northwind-outdoor,bakery-de-test,fietslab-bike-workshop]");
  process.exit(2);
}
try { smokeBase(base); } catch (e) { console.error((e as Error).message); process.exit(2); }

const report = await smokeDemo(base, { slugs });
for (const line of smokeLines(report)) console.log(line);
process.exit(report.ok ? 0 : 1);
