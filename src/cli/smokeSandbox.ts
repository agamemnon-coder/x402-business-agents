// npm run smoke:sandbox [-- --new] [-- --allow-production]
// One small FX conversion and one small transfer against the Airwallex SANDBOX, printed with the time (UTC) and the
// git commit, and written to out/smoke-sandbox.json (gitignored). See src/smoke/sandbox.ts for what it does and refuses.
// Keys come from AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY in the environment and are never printed.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { Airwallex, AirwallexError, fromEnv } from "../airwallex/client.js";
import { AirwallexRest } from "../airwallex/adapter.js";
import { redactSecrets } from "../lib/redact.js";
import { sandboxBase, smokeSandbox } from "../smoke/sandbox.js";

const args = process.argv.slice(2);
const base = sandboxBase(process.env, args.includes("--allow-production"));
if (!base.ok) {
  console.error(base.reason);
  process.exit(2);
}
const cfg = fromEnv();
if (!cfg) {
  console.error("AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set in the environment (sandbox keys); nothing was sent");
  process.exit(2);
}

function commit(): string {
  try {
    const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
    return dirty ? `${head}-dirty` : head;
  } catch {
    return "unknown";
  }
}

const outDir = resolve("out");
try {
  const s = await smokeSandbox({
    rail: new AirwallexRest(new Airwallex({ ...cfg, baseUrl: base.base })),
    outDir, commit: commit(), newRun: args.includes("--new"), log: (line) => console.log(line),
  });
  console.log("");
  console.log("Airwallex SANDBOX smoke run (test money)");
  console.log(`  conversion  ${s.conversion_id} (${s.conversion_status}): bought EUR 10.00 with USD`);
  console.log(`  transfer    ${s.transfer_id} (${s.transfer_status}): EUR 10.00 by SWIFT to the allowlisted test payee`);
  console.log(`  time (UTC)  ${s.finished_at}`);
  console.log(`  commit      ${s.commit}`);
  console.log(`  written to  out/smoke-sandbox.json`);
} catch (e) {
  const hint = e instanceof AirwallexError && e.status === 403 ? " (this key may be read-only: a create needs a key with write access)" : "";
  console.error(`smoke:sandbox stopped: ${redactSecrets((e as Error).message).slice(0, 400)}${hint}. The request ids are kept in out/smoke-sandbox.json; running again resumes under them.`);
  process.exit(1);
}
