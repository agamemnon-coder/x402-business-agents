// npm run tokenize -- <command>: an invoice the CFO approved with a passkey becomes a token on Metal (prototype, test
// money, the financier simulated). docs/tokenize.md; the live run's steps are in docs/runs/driver/tokenize-runbook.md.
//
//   stand-in   the whole flow on an in-memory EVM (ethereumjs) with a *USDZ stand-in: mint, finance, settle, verify,
//              and the refusals. Same contract bytecode, the same signed transactions and requests as live; 0 network.
//   preflight  live, reads only (at most 6): the chain id and the four roles' balances; and offline: the passkey
//              approval and the document, checked as the mint checks them, the plan and the calls each step needs
//   fund       live: create the four test keys when missing and send each what it lacks from a donor key
//   deploy     live: deploy PurserInvoiceToken with Purser's issuer key, settling in Metal's *USDZ
//   mint       live: check the ledger's passkey approval and the document, then mint the token to the creditor
//   finance    live: the creditor offers the token at a discount; the simulated financier pays and takes it
//   settle     live: the debtor's paying wallet pays the face value to the holder; the token is burned
//   verify     live (one read): recompute the record from the ledger and the document and compare with the chain
//   record     write docs/runs/<date>-tokenize.md and .json from this run's ledger and call log; 0 calls
//   facts      this run's own ledger as JSON; 0 calls
//
// Live commands need TOKENIZE_GO=yes, TOKENIZE_CALL_BUDGET, TOKENIZE_CALL_BUDGET_TOTAL, TOKENIZE_CALL_LOG,
// TOKENIZE_DB=…/tokenize*.sqlite, METAL_RPC_URL and KIT11_KEYS_DIR outside the repository (src/tokenize/guard.ts).
// Every transaction's hash is stored before it is sent, and a command that stopped can be run again: nothing is sent
// twice (src/tokenize/client.ts). The live commands never load the in-memory chain: only stand-in imports it.

import { existsSync } from "node:fs";
import { LIVE_COMMANDS, type LiveCommand } from "../tokenize/guard.js";
import { redactSecrets } from "../lib/redact.js";

const cmd = process.argv[2] ?? "stand-in";
const say = (s: string) => console.log(redactSecrets(s));
const err = (s: string) => console.error(redactSecrets(s));

if (cmd === "stand-in") {
  // No live service is reachable from the stand-in: their settings are cleared and fetch refuses.
  for (const k of "AIRWALLEX_CLIENT_ID AIRWALLEX_API_KEY KIT11_ANTHROPIC_API_KEY ANTHROPIC_API_KEY METAL_RPC_URL T0_API_KEY".split(" ")) delete process.env[k];
  globalThis.fetch = (async (i: unknown) => { throw new Error(`tokenize stand-in: no network (${String(i).slice(0, 60)})`); }) as typeof fetch;
  process.exitCode = (await (await import("../tokenize/standInRun.js")).standInRun(say)) ? 0 : 1;
} else if (cmd === "facts") {
  const path = process.env.TOKENIZE_DB;
  if (!path || !existsSync(path)) { console.error("TOKENIZE_DB names no ledger yet"); process.exit(2); }
  const { openRunLedger } = await import("../tokenize/ledger.js");
  const ledger = openRunLedger(path, { readonly: true });
  console.log(JSON.stringify({ state: ledger.state(), transactions: ledger.txs() }, null, 2));
  ledger.close();
} else if (cmd === "record") {
  const { recordRefusals, writeRunRecord } = await import("../tokenize/runRecord.js");
  const why = recordRefusals(process.env);
  if (why.length) { for (const w of why) err(`REFUSED  ${w}`); process.exit(2); }
  try {
    const out = writeRunRecord({ env: process.env });
    say(`RECORDED ${out.md}\n         ${out.json}\n         ${out.record.transactions.length} transactions, ${out.record.calls.used} calls${out.record.calls.budget_total ? ` of ${out.record.calls.budget_total}` : ""}; no request was made`);
  } catch (e) { err(`REFUSED  ${(e as Error).message}`); process.exit(2); }
} else if ((LIVE_COMMANDS as readonly string[]).includes(cmd)) {
  const { runLive } = await import("../tokenize/live.js");
  process.exitCode = await runLive(cmd as LiveCommand, { env: process.env, io: { say, err } });
} else {
  console.error("usage: npm run tokenize -- stand-in | preflight | fund | deploy | mint | finance | settle | verify | record | facts");
  process.exit(2);
}
