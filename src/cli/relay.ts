// npm run relay [-- --enrol [--replace]] [-- --local] [-- --once]
// Connects this ledger (KIT11_DB) to the relay Worker, so the dashboard and passkey approvals work on a phone at
// one fixed address. Every approval the phone sends is verified here, against the pinned passkey and the exact
// terms hash, before anything is decided; then the executor runs as with the local approval page.
//   --enrol    opens a ten-minute window and prints a one-time code for enrolling the approver's passkey
//   --replace  with --enrol: the new passkey replaces the enrolled one once it is enrolled
//   --local    no Cloudflare: serves the same relay on http://localhost:4400 (KIT11_RELAY_PORT) for a laptop
//   --once     one sync (and the executions it starts), then exit

import { displayKey } from "../relay/sign.js";
import { redactSecrets } from "../lib/redact.js";
import { keyPath } from "../metal/agentCli.js";
import { randomBytes } from "node:crypto";
import { openDb } from "../db/open.js";
import { execute } from "../executors/index.js";
import { openEnrolment } from "../passkey/ledger.js";
import { relayConfig, viewerLink, type RelayConfig } from "../relay/config.js";
import { startLocalRelay } from "../relay/local.js";
import { RelayRunner } from "../relay/runner.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { cardRows, pollCardTransactions, syncCardsIfChanged } from "../policy/cards.js";

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
const signer = displayKey(keyPath("relay-display-key.pem"));
console.log(`viewer   ${viewerLink(cfg, signer.publicSpki)}  (open once on each device: it unlocks the dashboard and pins this runner's key; it approves nothing)`);
if (args.includes("--enrol")) {
  const { window, code } = openEnrolment(db, { rpId: cfg.rpId, origin: cfg.origin, replace: args.includes("--replace") });
  console.log(`ENROL    on the phone open ${cfg.url}/enrol and type ${code} (valid until ${window.expires_at.slice(11, 19)} UTC, five tries)`);
}

const runner = new RelayRunner({ db, cfg, fetch, execute, label, signer, log: (line) => console.log(`${stamp()} ${line}`) });
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

// The agents' cards (K2): every few seconds, a limit the CFO changed goes to Airwallex, and new authorisations come
// in (the webhook, once set up, brings them sooner). A failure here is logged and tried again; it never stops the relay.
const issuing = issuingFromEnv();
let cardsAt = 0;
let cardsError = "";
async function cardsTick(): Promise<void> {
  if (!issuing || cardRows(db).length === 0 || Date.now() - cardsAt < 5000) return;
  cardsAt = Date.now();
  try {
    const synced = await syncCardsIfChanged(db, issuing.rail);
    if (synced.length) console.log(`${stamp()} cards    limits updated at Airwallex: ${synced.join(", ")}`);
    const fresh = await pollCardTransactions(db, issuing.rail);
    if (fresh) console.log(`${stamp()} cards    ${fresh} new card transaction(s) from Airwallex`);
    cardsError = "";
  } catch (e) {
    const message = redactSecrets((e as Error).message);
    if (message !== cardsError) console.error(`${stamp()} cards    ${message}`);
    cardsError = message;
  }
}

let lastError = "";
while (!stopping) {
  await cardsTick();
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
