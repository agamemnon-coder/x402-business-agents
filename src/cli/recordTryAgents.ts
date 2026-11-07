// npm run record-try-agents [-- --out <file>]: records the real outputs /try/sign shows when a live agent is unavailable
// (Max, 7 Nov). It runs the very code the Worker runs, in this process, against the live APIs: a test world of the
// page's own desk (worker/src/trySign.ts) walks its agents' steps with the real invoice reader (Claude Sonnet,
// claudeReadInvoice) and the real Treasury agent (Claude Opus, the runner's timing agent through claudeAgentAsk and
// adviseTry), the quote from the Airwallex sandbox (read-only; nothing is converted); then the reader reads the trick
// step's two fake invoices. It keeps each answer with its model, the API's request id, the day and how long it took,
// and writes docs/demo/try-agents-recorded.json, checked by the same reader the page uses (src/try/recorded.ts).
// Nothing is made up: an answer that is not a live Claude answer (a failure, a refusal, a reading code's check refuses)
// stops the recording, and no file is written.
//
// Needs KIT11_ANTHROPIC_API_KEY, AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (a sandbox key) in the environment. The
// timeouts are longer than the Worker's (8 s a call, 15 s for the advice) so a slow answer is recorded, not lost: the
// recording is made once, by hand, not while a visitor waits. Costs a few US cents.

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeAgentAsk, claudeReadInvoice } from "../try/claude.js";
import { RECORDED_FORMAT, RECORDED_PATH, readRecorded, type RecordedAgents, type RecordedReading } from "../try/recorded.js";
import { checkInvoiceReading } from "../claude/invoiceReading.js";
import type { TimingFacts } from "../agents/timingCore.js";
import type { AdviceCall } from "../try/treasuryAdvice.js";
import { sqlOver } from "../relay/local.js";
import { SandboxQuotes } from "../../worker/src/fxQuote.js";
import { ATTACKS, TRICKS } from "../../worker/src/trick.js";
import { AGENT_STEPS, TrySignDesk } from "../../worker/src/trySign.js";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = resolve(at >= 0 && args[at + 1] ? args[at + 1]! : RECORDED_PATH);
const key = process.env.KIT11_ANTHROPIC_API_KEY;
const awx = { clientId: process.env.AIRWALLEX_CLIENT_ID, apiKey: process.env.AIRWALLEX_API_KEY };
if (!key || !awx.clientId || !awx.apiKey) {
  console.error("record-try-agents needs KIT11_ANTHROPIC_API_KEY, AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (a sandbox key) in the environment; nothing written.");
  process.exit(2);
}
const stop = (why: string): never => { console.error(`STOP  ${why}; nothing written.`); process.exit(1); };
const day = new Date().toISOString().slice(0, 10);
const claude = (m: string | null | undefined) => !!m && /^claude-/.test(m);

const reader = claudeReadInvoice(key, fetch, 60_000);
const desk = new TrySignDesk(sqlOver(new Database(":memory:")), {
  reader, advisor: claudeAgentAsk(key, fetch, 60_000), fx: new SandboxQuotes({ clientId: awx.clientId, apiKey: awx.apiKey }), adviceDeadlineMs: 180_000,
});
const BASE = "https://record.try-sign.local";
const post = async (sub: string, body: unknown) => {
  const r = await desk.fetch(new Request(`${BASE}/api/try-sign/${sub}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "192.0.2.10" }, body: JSON.stringify(body) }));
  return { status: r.status, j: (await r.json()) as Record<string, unknown> };
};

// The waiting payment's agents, step by step, as the page walks them.
const world = await post("world", {});
if (world.status !== 201) stop(`no test world (${world.status})`);
const token = (world.j.world as { token: string }).token;
const results: Record<string, Record<string, unknown>> = {};
for (const step of AGENT_STEPS) {
  const r = await post("agents", { token });
  if (r.status !== 200) stop(`step ${step} answered ${r.status}`);
  results[step] = r.j.result as Record<string, unknown>;
  console.log(`step  ${step}: ${String(results[step]!.by ?? "")}`);
}

const read = results.read!;
if (read.source !== "live" || !claude(read.model as string)) stop(`the invoice was not read live by Claude (${String(read.by)})`);
const doc = String(read.document);
const fields = read.fields as { vendor: string; amount: string; currency: string; iban: string; invoice_no: string; due_date: string };
// The step shows the reading's fields; the whole reading is what code checked (step 2).
const checked = (results.check!.reading as Record<string, string> & { source: string }) ?? null;
if (!checked || checked.source !== "live") stop("Claude's reading of the invoice did not pass code's check");
const reading = { invoice_no: checked.invoice_no!, vendor: checked.vendor!, amount: checked.amount!, currency: checked.currency!, due_date: checked.due_date!, iban: checked.iban!, bic: checked.bic!, reference: checked.reference! };
if (reading.amount !== fields.amount || checkInvoiceReading(reading, doc)) stop("the reading and its check do not agree");
const invoice: RecordedReading = { model: String(read.model), request_id: String(read.request_id), date: day, ms: Number(read.ms), reading };

const adv = results.advise!;
if (adv.source !== "live" || !claude(adv.model as string)) stop(`the advice was not Claude's live advice (${String(adv.by)})`);
const calls = (adv.calls as AdviceCall[]).map((c) => {
  if (!c.request_id || !claude(c.model)) stop("an advice call has no Claude request id");
  return { model: c.model!, request_id: c.request_id!, ms: c.ms ?? 0, tools: c.tools.map((t) => ({ name: t.name, input: t.input })) };
});
const advice = {
  model: String(adv.model), date: day, ms: Number(adv.ms ?? calls.reduce((s, c) => s + c.ms, 0)), timing: adv.timing as "pay_now" | "wait_until", advised_date: (adv.date as string | null) ?? null,
  reason: String(adv.says), calls, facts: adv.facts as TimingFacts,
};

// The trick step's two fake invoices, read by the same reader (the documents are fixed; code blocks them either way).
const tricks: RecordedAgents["tricks"] = {};
for (const attack of ATTACKS) {
  const started = Date.now();
  const r = await reader(TRICKS[attack].text);
  if (!claude(r.model) || !r.requestId) stop(`the ${attack} invoice was not read by Claude`);
  tricks[attack] = { model: r.model, request_id: r.requestId!, date: day, ms: r.ms ?? Date.now() - started, reading: r.value };
  console.log(`trick ${attack}: ${r.value.vendor} · ${r.value.amount} · …${r.value.iban.slice(-4)}`);
}

const recording: RecordedAgents = { format: RECORDED_FORMAT, recorded_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), invoice, advice, tricks };
// Written only in the shape the page reads back, field for field.
const back = readRecorded(JSON.parse(JSON.stringify(recording)));
if (!back?.invoice || !back.advice || !back.tricks.pre_approved || !back.tricks.lookalike) stop("the recording does not read back whole");
writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`);
console.log(`wrote ${out}: invoice ${invoice.request_id}, advice ${calls.map((c) => c.request_id).join(", ")}, tricks ${ATTACKS.map((a) => tricks[a]!.request_id).join(", ")}`);
