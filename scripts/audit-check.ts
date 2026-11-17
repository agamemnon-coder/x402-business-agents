// CI's npm audit (root): fails on any advisory npm audit reports, except one listed in .audit-allow.json with a reason
// and an expiry. An allowed advisory must not reach a runtime dependency (npm audit --omit=dev must report none of it),
// and an entry past its expiry fails. Run: npx tsx scripts/audit-check.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

interface Report { vulnerabilities?: Record<string, { via?: unknown[] }> }
interface Allow { id: string; expires: string }

const audit = (args: string[]): Report => {
  try { return JSON.parse(execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
  catch (e) { return JSON.parse(String((e as { stdout?: unknown }).stdout ?? "{}")) as Report; }
};
const ids = (report: Report): Set<string> => {
  const out = new Set<string>();
  for (const v of Object.values(report.vulnerabilities ?? {})) for (const via of v.via ?? []) {
    const url = via && typeof via === "object" ? (via as { url?: unknown }).url : undefined;
    if (typeof url === "string") out.add(url.split("/").pop() ?? url);
  }
  return out;
};
const allow = (JSON.parse(readFileSync(new globalThis.URL("../.audit-allow.json", import.meta.url), "utf8")) as { allow: Allow[] }).allow;
const today = new Date().toISOString().slice(0, 10);
const problems: string[] = [];
for (const a of allow) if (!(a.expires > today)) problems.push(`${a.id}: its allowance expired on ${a.expires}`);
const all = ids(audit([]));
const runtime = ids(audit(["--omit=dev"]));
for (const id of all) if (!allow.some((a) => a.id === id)) problems.push(`${id}: not allowed (.audit-allow.json)`);
for (const id of runtime) problems.push(`${id}: reaches a runtime dependency (npm audit --omit=dev)`);
for (const id of all) if (allow.some((a) => a.id === id)) globalThis.console.log(`allowed until ${allow.find((a) => a.id === id)!.expires}: ${id} (development tools only)`);
if (problems.length) { globalThis.console.error(problems.join("\n")); process.exit(1); }
globalThis.console.log(`npm audit: ${all.size} advisory/ies, all allowed and development-only; runtime dependencies clean`);
