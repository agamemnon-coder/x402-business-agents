// CI's npm audit (root): fails on any advisory npm audit reports, except one listed in .audit-allow.json with a reason
// and an expiry. An allowed advisory must not reach a runtime dependency (npm audit --omit=dev must report none of it),
// and an entry past its expiry fails. Run: node scripts/audit-check.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const audit = (args) => {
  try { return JSON.parse(execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { return JSON.parse(e.stdout); }
};
const ids = (report) => {
  const out = new Set();
  for (const v of Object.values(report.vulnerabilities ?? {})) for (const via of v.via ?? []) {
    if (via && typeof via === "object" && typeof via.url === "string") out.add(via.url.split("/").pop());
  }
  return out;
};
const allow = JSON.parse(readFileSync(new URL("../.audit-allow.json", import.meta.url), "utf8")).allow;
const today = new Date().toISOString().slice(0, 10);
const problems = [];
for (const a of allow) if (!(a.expires > today)) problems.push(`${a.id}: its allowance expired on ${a.expires}`);
const all = ids(audit([]));
const runtime = ids(audit(["--omit=dev"]));
for (const id of all) if (!allow.some((a) => a.id === id)) problems.push(`${id}: not allowed (.audit-allow.json)`);
for (const id of runtime) problems.push(`${id}: reaches a runtime dependency (npm audit --omit=dev)`);
for (const id of all) if (allow.some((a) => a.id === id)) console.log(`allowed until ${allow.find((a) => a.id === id).expires}: ${id} (development tools only)`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`npm audit: ${all.size} advisory/ies, all allowed and development-only; runtime dependencies clean`);
