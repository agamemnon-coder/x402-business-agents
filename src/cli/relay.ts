// npm run relay [-- --enrol [--replace]] [-- --local] [-- --once]
// Connects this ledger (KIT11_DB) to the relay Worker, so the dashboard and passkey approvals work on a phone at
// one fixed address. Every approval the phone sends is verified here, against the pinned passkey and the exact
// terms hash, before anything is decided; then the executor runs as with the local approval page.
//   --enrol    opens a ten-minute window and prints a one-time code for enrolling the approver's passkey
//   --replace  with --enrol: the new passkey replaces the enrolled one once it is enrolled
//   --local    no Cloudflare: serves the same relay on http://localhost:4400 (KIT11_RELAY_PORT) for a laptop
//   --once     one sync (and the executions it starts), then exit

import { randomBytes } from "node:crypto";
import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { openEnrolment } from "../passkey/ledger.js";
import { relayConfig, viewerLink, type RelayConfig } from "../relay/config.js";
import { startLocalRelay } from "../relay/local.js";
import { RelayRunner } from "../relay/runner.js";

const args = process.argv.slice(2);
const once = args.includes("--once");
let cfg: RelayConfig;
if (args.includes("--local")) {
  const token = randomBytes(32).toString("hex");
  const { url } = await startLocalRelay({ port: Number(process.env.KIT11_RELAY_PORT ?? 4400), token });
  cfg = { url, origin: url, rpId: new URL(url).hostname, token };
} else {
  cfg = await relayConfig();
}

const db = openDb();
const label = process.env.KIT11_APPROVER ?? "max";
const stamp = () => new Date().toISOString().slice(11, 19);
console.log(`relay    ${cfg.url}/  (approvals ${cfg.url}/approve/<id>; ledger ${process.env.KIT11_DB ?? "data/kit11.sqlite"})`);
console.log(`viewer   ${viewerLink(cfg)}  (open once on each device; it unlocks the dashboard and the approval pages there, and approves nothing)`);
if (args.includes("--enrol")) {
  const { window, code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin, replace: args.includes("--replace") });
  console.log(`ENROL    on the phone open ${cfg.url}/enrol and type ${code} (valid until ${window.expires_at.slice(11, 19)} UTC, five tries)`);
}

const runner = new RelayRunner({ db, cfg, fetch, execute, label, log: (line) => console.log(`${stamp()} ${line}`) });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  console.log(`${stamp()} stopping; waiting for running executions`);
  // Deliver the last verdicts (an execution may just have finished) before leaving.
  void runner.idle().then(() => runner.syncOnce()).catch(() => undefined).then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let lastError = "";
while (!stopping) {
  try {
    await runner.syncOnce();
    if (lastError) console.log(`${stamp()} relay reachable again`);
    lastError = "";
    if (once) {
      await runner.idle();
      await runner.syncOnce();
      break;
    }
  } catch (e) {
    const message = (e as Error).message;
    if (message !== lastError) console.error(`${stamp()} relay unreachable: ${message}`);
    lastError = message;
    if (once) process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
process.exit(0);
