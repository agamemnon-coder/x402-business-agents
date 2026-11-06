// The security headers on every kind of relay answer (A3): each page, the 404, JSON, a redirect, the static assets and
// /favicon.ico, by the rules in test/security-headers.rules.ts. No browser and no key: plain requests.
//   npx tsx test/browser/headers.check.ts                 against the local stand-in for the Worker (src/relay/local.ts)
//   npx tsx test/browser/headers.check.ts --live <url>    against a hosted relay, e.g. https://kit11.max-31b.workers.dev
// The live site shows a header change only after the relay is redeployed (npm run relay:deploy).
import { startLocalRelay } from "../../src/relay/local.js";
import { HEADER_PATHS, headerFaults } from "../security-headers.rules.js";

const args = process.argv.slice(2);
const liveAt = args.indexOf("--live");
if (liveAt >= 0 && !args[liveAt + 1]) throw new Error("--live needs the relay's URL");
const local = liveAt >= 0 ? null : await startLocalRelay({ port: 0, token: "headers-check" });
const base = liveAt >= 0 ? args[liveAt + 1]!.replace(/\/$/, "") : local!.url;

let failed = 0;
for (const { path, kind, status } of HEADER_PATHS) {
  const res = await fetch(`${base}${path}`, { redirect: "manual" });
  await res.arrayBuffer();
  const faults = [...(res.status === status ? [] : [`status ${res.status}, expected ${status}`]), ...headerFaults(kind, res.headers)];
  failed += faults.length ? 1 : 0;
  console.log(`${faults.length ? "FAIL" : "ok  "}  ${kind.padEnd(9)} ${path}${faults.map((f) => `\n        ${f}`).join("")}`);
}
local?.server.close();
console.log(failed ? `\n${failed} of ${HEADER_PATHS.length} answers fail (${base})` : `\nAll ${HEADER_PATHS.length} answers carry their headers (${base})`);
process.exit(failed ? 1 : 0);
