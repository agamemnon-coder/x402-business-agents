// npm run vic-readback: the Airi run's PaymentIntents (docs/demo/airi-run.json) read back from the Airwallex sandbox,
// GET only, one call each, and kept as a record: docs/runs/airwallex-vic-payment-intents-<date>.json, each answer as
// Airwallex returned it except what must not be kept (src/airwallex/intentReadback.ts). /visa shows a few of its
// fields, each under Airwallex's own field name (src/redesign/vicNetwork.ts).
//
// It needs:
//   AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY   the sandbox keys
//   AIRWALLEX_CALL_BUDGET                    the calls approved: 1 login and 1 GET per PaymentIntent, and at most 1 spare
//   AIRWALLEX_CALL_LOG                       a new file outside the repository: every call is counted there before it is sent
// Options:
//   --raw <file>    also keep the answers, without their secrets, in a private 0600 file outside the repository, so
//                   the record can be built again without another call
//   --from <file>   build the record again from such a file: no call at all
//   --out <file>    where to write (default docs/runs/airwallex-vic-payment-intents-<date read>.json)
// Without the keys or the budget nothing is called and nothing is written. A PaymentIntent Airwallex does not return is
// left out of the record and named in it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Airwallex, AirwallexError, fromEnv } from "../airwallex/client.js";
import { AirwallexBudgetSpent, readCallLog, type CallLine } from "../airwallex/callBudget.js";
import { VIC_INTENTS_PREFIX, intentsRecord, redactAnswer } from "../airwallex/intentReadback.js";
import { AIRI_RUN_FILE, airiRun } from "../redesign/airiRun.js";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const repo = resolve(import.meta.dirname, "../..");
const stop = (why: string): never => { console.error(`vic-readback: ${why}; nothing was written`); process.exit(2); };

const run = airiRun() ?? stop(`${AIRI_RUN_FILE} is not a live run's record`);
const purchases = run.purchases.flatMap((p) => (p.payment_intent_id ? [{ step: p.step as string, id: p.payment_intent_id }] : []));
if (purchases.length === 0) stop(`${AIRI_RUN_FILE} names no PaymentIntent`);

interface Raw { read_at: string; budget: number; calls: CallLine[]; answers: Record<string, unknown>; not_read: { step: string; id: string; why: string }[] }
let raw: Raw;

const from = opt("--from");
if (from) {
  raw = JSON.parse(readFileSync(from, "utf8")) as Raw;
  console.log(`from ${from}: ${Object.keys(raw.answers).length} answers read at ${raw.read_at}; no call made`);
} else {
  const needed = 1 + purchases.length;
  const budget = Number(process.env.AIRWALLEX_CALL_BUDGET ?? NaN), log = process.env.AIRWALLEX_CALL_LOG;
  if (!process.env.AIRWALLEX_CLIENT_ID || !process.env.AIRWALLEX_API_KEY) stop("the Airwallex sandbox keys (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY) are not set: nothing was called");
  if (!Number.isSafeInteger(budget) || !log) stop("AIRWALLEX_CALL_BUDGET (the calls approved) and AIRWALLEX_CALL_LOG (a new file outside the repository) must be set: nothing was called");
  if (budget < needed || budget > needed + 1) stop(`the budget must be ${needed} (1 login, ${purchases.length} GET) or ${needed + 1} (one spare), not ${budget}: nothing was called`);
  if (existsSync(log!) && readCallLog(log!).length > 0) stop("the call log already holds calls; give this read-back a new one: nothing was called");
  const cfg = fromEnv() ?? stop("the Airwallex sandbox keys are not set: nothing was called");
  const api = new Airwallex(cfg);
  const answers: Raw["answers"] = {}, notRead: Raw["not_read"] = [];
  for (const p of purchases) {
    try {
      // The private working copy never holds a secret: client_secret is dropped before anything is kept.
      answers[p.id] = redactAnswer(await api.call<unknown>("GET", `/pa/payment_intents/${encodeURIComponent(p.id)}`), ["a secret"]).value;
      console.log(`read      ${p.step}  ${p.id}`);
    } catch (e) {
      const why = e instanceof AirwallexError ? `Airwallex answered ${e.status}${e.code ? ` ${e.code}` : ""}` : e instanceof AirwallexBudgetSpent ? "the call budget was spent before this call" : "no answer from Airwallex";
      notRead.push({ ...p, why });
      console.log(`not read  ${p.step}  ${p.id}: ${why}`);
    }
  }
  raw = { read_at: new Date().toISOString(), budget, calls: readCallLog(log!), answers, not_read: notRead };
  const keep = opt("--raw");
  if (keep) { writeFileSync(keep, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 }); console.log(`raw       ${keep} (private, without secrets; not for the repository)`); }
  console.log(`calls     ${raw.calls.length} of ${budget}: ${raw.calls.map((c) => `${c.method} ${c.endpoint}`).join(", ")}`);
}

if (Object.keys(raw.answers).length === 0) stop(`no PaymentIntent could be read (${raw.not_read.map((n) => `${n.id}: ${n.why}`).join("; ")})`);
const rec = intentsRecord({ readAt: new Date(raw.read_at), run: AIRI_RUN_FILE, purchases, answers: raw.answers, calls: raw.calls, budget: raw.budget, notRead: raw.not_read });
const out = opt("--out") ?? resolve(repo, `docs/runs/${VIC_INTENTS_PREFIX}-${raw.read_at.slice(0, 10)}.json`);
writeFileSync(out, `${JSON.stringify(rec, null, 2)}\n`);
for (const p of rec.payment_intents) console.log(`record    ${p.purchase}  ${p.id}  status ${String(p.intent.status)}; redacted: ${p.redacted.map((r) => r.path).join(", ") || "nothing"}`);
console.log(`written   ${out}`);
