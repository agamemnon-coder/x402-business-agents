// The replay check (20 Nov): what Airwallex's sandbox answers when Purser sends the same money-moving create twice under
// one request_id, the second time also with a changed amount. Purser's exactly-once rests on it: after a lost answer it
// looks the request_id up before any retry (src/airwallex/port.ts), and its routed rail reads a duplicate answer as
// "the first send went through" (DUPLICATE_CODES in src/airwallex/routedRail.ts, written before Airwallex's own code for
// it had been seen). This sends, for each of three EUR 1.00 transfers, one FX conversion and one empty batch: the create,
// the identical create again, the create again with the amount one cent higher, then the request_id looked up (exactly
// one object, with the first terms). Each transfer is then taken to PAID by the sandbox's simulation endpoint and read
// back; the batch is deleted. Test money only; the client refuses any base URL but the sandbox's (src/airwallex/client.ts).

import { randomUUID } from "node:crypto";
import { AirwallexRest, onlyRequestId } from "../airwallex/adapter.js";
import { AirwallexBatchRest } from "../airwallex/batchTransfers.js";
import { Airwallex, AirwallexError, type AirwallexConfig } from "../airwallex/client.js";
import { refusedOutright } from "../airwallex/routedRail.js";
import { MANUFACTURER } from "../config/payees.js";
import { fromCents } from "../lib/money.js";
import type { HttpLine } from "./awxCoverageLive.js";

/** One send: Airwallex's HTTP status and code, the object's id when it made or returned one. */
export interface Send {
  http: number | null;
  code: string | null;
  id: string | null;
  amount: string | null;
  trace_id: string | null;
  /** Whether Purser's routed rail would read this answer as a refusal that moved nothing (it must not, for a duplicate). */
  purser_reads_as_refusal: boolean | null;
}

export interface ReplayCase {
  kind: "transfer" | "conversion" | "batch";
  label: string;
  request_id: string;
  first: Send;
  same_again: Send;
  changed_amount: Send | null;
  /** The request_id looked up afterwards: how many objects Airwallex lists under it, and the one it lists. */
  lookup: { listed: number | null; id: string | null; amount: string | null; error: string | null };
  /** For a transfer: its status after the simulated SENT and PAID, read back; for a batch: deleted or not. */
  after: string | null;
  /** Exactly one object under the request_id, the first one, with the first terms; no second send made another. */
  one_object: boolean;
  /** Each repeat was refused, or answered with the first object unchanged; none made a second object. */
  repeats_safe: boolean;
}

export interface ReplayRecord {
  run: string; ran_at: string; finished_at: string; sandbox: true; test_money: true; made_by: string;
  payee: { name: string; beneficiary_id: string | null };
  budget: { approved: number | null; used: number };
  cases: ReplayCase[];
  summary: {
    cases: number; one_object: number; repeats_safe: number; repeats_sent: number; repeats_refused: number; repeats_returned_first: number;
    duplicate_codes_seen: string[]; codes_purser_reads_as_refusal: string[];
  };
  calls: HttpLine[];
  errors: string[];
  /** A dated note added after the run (a fix it led to); the figures above stay as the run found them. */
  after_the_run?: string;
}

const blank = (): Send => ({ http: null, code: null, id: null, amount: null, trace_id: null, purser_reads_as_refusal: null });

async function send<T>(fn: () => Promise<T>, read: (t: T) => { id: string; amount: string | null }): Promise<Send> {
  try {
    const t = await fn();
    const r = read(t);
    return { http: 200, code: null, id: r.id, amount: r.amount, trace_id: null, purser_reads_as_refusal: false };
  } catch (e) {
    if (e instanceof AirwallexError) return { http: e.status, code: e.code ?? null, id: null, amount: null, trace_id: e.traceId, purser_reads_as_refusal: refusedOutright(e) };
    throw e;
  }
}

/** A repeat is safe when Airwallex refused it, or answered with the first object (same id, first amount). */
const repeatSafe = (first: Send, again: Send, firstAmount: string) =>
  again.http !== null && (again.http >= 400 || (again.id === first.id && again.amount === firstAmount));

export async function runReplay(o: { cfg: AirwallexConfig; lines: HttpLine[]; runId: string; log: (l: string) => void }): Promise<Omit<ReplayRecord, "run" | "ran_at" | "finished_at" | "made_by" | "budget" | "calls">> {
  const api = new Airwallex(o.cfg);
  const rest = new AirwallexRest(api);
  const batches = new AirwallexBatchRest(api);
  const cases: ReplayCase[] = [];
  const errors: string[] = [];
  const sha = (n: number) => `${"0".repeat(48)}${o.runId.slice(-8).padStart(8, "0")}${String(n).padStart(8, "0")}`.slice(-64);

  const ben = await rest.findBeneficiaryByIban(MANUFACTURER.iban);
  o.log(`payee: ${MANUFACTURER.name}${ben ? ` (beneficiary ${ben.id})` : ": Airwallex holds no beneficiary; no transfer is sent"}`);

  // 1-3. Three EUR 1.00 transfers, each sent three times under one request_id.
  for (let n = 1; ben && n <= 3; n++) {
    const requestId = randomUUID();
    const t = (cents: number) => ({ requestId, beneficiaryId: ben.id, amountCents: cents, currency: "EUR" as const, sourceCurrency: "EUR" as const,
      reference: `AWXREPLAY-${o.runId.slice(-6)}-${n}`, reason: "payment_to_supplier", approvalSha256: sha(n) });
    const read = (x: { id: string; amountCents: number }) => ({ id: x.id, amount: fromCents(x.amountCents) });
    const first = await send(() => rest.createTransfer(t(100)), read);
    const same = first.id ? await send(() => rest.createTransfer(t(100)), read) : blank();
    const changed = first.id ? await send(() => rest.createTransfer(t(101)), read) : blank();
    let lookup: ReplayCase["lookup"] = { listed: null, id: null, amount: null, error: null };
    try {
      const r = await api.call<{ items?: { id: string; request_id?: string; transfer_amount: number | string }[]; has_more?: unknown }>("GET", "/transfers", undefined, { request_id: requestId });
      const listed = (r.items ?? []).filter((x) => x.request_id === requestId).length;
      const hit = onlyRequestId(r, requestId);
      lookup = { listed, id: hit?.id ?? null, amount: hit ? Number(hit.transfer_amount).toFixed(2) : null, error: null };
    } catch (e) { lookup.error = (e as Error).message.slice(0, 200); }
    let after: string | null = null;
    if (first.id) {
      try {
        await rest.transitionTransfer(first.id, "SENT");
        await rest.transitionTransfer(first.id, "PAID");
        after = (await rest.getTransfer(first.id)).status;
      } catch (e) { errors.push(`transfer ${n}: ${(e as Error).message.slice(0, 200)}`); }
    }
    const c: ReplayCase = {
      kind: "transfer", label: `transfer ${n}: EUR 1.00 to ${MANUFACTURER.name}`, request_id: requestId, first, same_again: same, changed_amount: changed, lookup, after,
      one_object: first.id !== null && lookup.listed === 1 && lookup.id === first.id && lookup.amount === "1.00",
      repeats_safe: first.id !== null && repeatSafe(first, same, "1.00") && repeatSafe(first, changed, "1.00"),
    };
    cases.push(c);
    o.log(`${c.label}: first ${first.http} ${first.id ?? ""}; same again ${same.http} ${same.code ?? same.id ?? ""}; amount 1.01 ${changed.http} ${changed.code ?? changed.id ?? ""}; listed ${lookup.listed}; after ${after}`);
  }

  // 4. One conversion: USD sold for EUR 1.00 at a locked quote, sent three times under one request_id.
  try {
    const requestId = randomUUID();
    const quote = await rest.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: 100, validity: "MIN_15" });
    const read = (x: { conversionId: string; buyAmountCents: number }) => ({ id: x.conversionId, amount: fromCents(x.buyAmountCents) });
    const first = await send(() => rest.createConversion({ requestId, quote, approvalSha256: sha(4) }), read);
    const same = first.id ? await send(() => rest.createConversion({ requestId, quote, approvalSha256: sha(4) }), read) : blank();
    const changed = first.id ? await send(() => rest.createConversion({ requestId, quote: { ...quote, buyAmountCents: 101 }, approvalSha256: sha(4) }), read) : blank();
    let lookup: ReplayCase["lookup"] = { listed: null, id: null, amount: null, error: null };
    try {
      const r = await api.call<{ items: { conversion_id: string; request_id: string; buy_amount: number | string }[] }>("GET", "/fx/conversions", undefined, { request_id: requestId, page_num: "0", page_size: "100" });
      const hits = r.items.filter((x) => x.request_id === requestId);
      lookup = { listed: hits.length, id: hits[0]?.conversion_id ?? null, amount: hits[0] ? Number(hits[0].buy_amount).toFixed(2) : null, error: null };
    } catch (e) { lookup.error = (e as Error).message.slice(0, 200); }
    const c: ReplayCase = {
      kind: "conversion", label: "conversion: USD sold for EUR 1.00 at a locked quote", request_id: requestId, first, same_again: same, changed_amount: changed, lookup, after: null,
      one_object: first.id !== null && lookup.listed === 1 && lookup.id === first.id && lookup.amount === "1.00",
      repeats_safe: first.id !== null && repeatSafe(first, same, "1.00") && repeatSafe(first, changed, "1.00"),
    };
    cases.push(c);
    o.log(`${c.label}: first ${first.http} ${first.id ?? ""}; same again ${same.http} ${same.code ?? same.id ?? ""}; amount 1.01 ${changed.http} ${changed.code ?? changed.id ?? ""}; listed ${lookup.listed}`);
  } catch (e) { errors.push(`conversion: ${(e as Error).message.slice(0, 200)}`); }

  // 5. One empty batch, created twice under one request_id (a batch has no amount until items are added), then deleted.
  try {
    const requestId = randomUUID();
    const read = (x: { id: string }) => ({ id: x.id, amount: null });
    const first = await send(() => batches.createBatch({ requestId, name: `Purser replay check ${o.runId.slice(-6)}`, metadata: { purpose: "replay check" } }), read);
    const same = first.id ? await send(() => batches.createBatch({ requestId, name: `Purser replay check ${o.runId.slice(-6)}`, metadata: { purpose: "replay check" } }), read) : blank();
    let lookup: ReplayCase["lookup"] = { listed: null, id: null, amount: null, error: null };
    try {
      const b = await batches.findBatchByRequestId(requestId);
      lookup = { listed: b ? 1 : 0, id: b?.id ?? null, amount: null, error: null };
    } catch (e) { lookup.error = (e as Error).message.slice(0, 200); }
    let after: string | null = null;
    if (first.id) {
      try { await batches.deleteBatch(first.id); after = "deleted"; } catch (e) { after = "not deleted"; errors.push(`batch delete: ${(e as Error).message.slice(0, 200)}`); }
    }
    const c: ReplayCase = {
      kind: "batch", label: "batch transfer: an empty batch", request_id: requestId, first, same_again: same, changed_amount: null, lookup, after,
      one_object: first.id !== null && lookup.listed === 1 && lookup.id === first.id,
      repeats_safe: first.id !== null && same.http !== null && (same.http >= 400 || same.id === first.id),
    };
    cases.push(c);
    o.log(`${c.label}: first ${first.http} ${first.id ?? ""}; same again ${same.http} ${same.code ?? same.id ?? ""}; listed ${lookup.listed}; ${after}`);
  } catch (e) { errors.push(`batch: ${(e as Error).message.slice(0, 200)}`); }

  const repeats = cases.flatMap((c) => [c.same_again, ...(c.changed_amount ? [c.changed_amount] : [])]).filter((s) => s.http !== null);
  const refused = repeats.filter((s) => s.http! >= 400);
  return {
    sandbox: true, test_money: true, payee: { name: MANUFACTURER.name, beneficiary_id: ben?.id ?? null }, cases,
    summary: {
      cases: cases.length, one_object: cases.filter((c) => c.one_object).length, repeats_safe: cases.filter((c) => c.repeats_safe).length,
      repeats_sent: repeats.length, repeats_refused: refused.length, repeats_returned_first: repeats.length - refused.length,
      duplicate_codes_seen: [...new Set(refused.map((s) => `${s.http} ${s.code ?? "(no code)"}`))],
      codes_purser_reads_as_refusal: [...new Set(refused.filter((s) => s.purser_reads_as_refusal).map((s) => `${s.http} ${s.code ?? "(no code)"}`))],
    },
    errors,
  };
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const sendCell = (s: Send | null) => !s ? "–" : s.http === null ? "not sent" : s.http >= 400 ? `${s.http} \`${esc(s.code ?? "(no code)")}\`${s.trace_id ? ` (trace \`${esc(s.trace_id)}\`)` : ""}` : `${s.http}, ${s.id ? `\`${esc(s.id)}\`` : "no id"}${s.amount ? `, ${s.amount}` : ""}`;

/** The run log, written from the record only. */
export function replayMarkdown(r: ReplayRecord, date: string): string {
  const s = r.summary;
  const lines = [
    `# Airwallex sandbox: the same create sent twice under one request_id (${date})`,
    "",
    `Record: [${date}-airwallex-replay.json](${date}-airwallex-replay.json), written by \`npm run airwallex:replay -- live\` ([src/cli/airwallexReplay.ts](../../src/cli/airwallexReplay.ts), [src/proof/awxReplay.ts](../../src/proof/awxReplay.ts)). This page is written from the record.`,
    "",
    "- **Airwallex sandbox only, test money.** Every call went to `api.sandbox.airwallex.com` through Purser's own client, counted against an approved budget before it was sent.",
    "- **Why.** Purser's exactly-once rests on Airwallex refusing a second create under a request_id it has seen: after a lost answer Purser looks the request_id up before any retry, and its routed rail reads a duplicate answer as \"the first send went through\" (`DUPLICATE_CODES` in src/airwallex/routedRail.ts). Until this run no record held what Airwallex answers a repeated transfer, conversion or batch create (a repeated payment intent answered `duplicate_request` on 7 Nov, vic-1c).",
    "- **What ran.** For three EUR 1.00 transfers, one USD→EUR 1.00 conversion and one empty batch: the create; the identical create again (a retry after a lost answer); for the transfers and the conversion, the create again with the amount one cent higher (changed terms under the same id); then the request_id looked up. Each transfer was then taken to PAID by the sandbox's simulation endpoint (simulated, not a settlement) and read back; the batch was deleted.",
    "",
    "## Result",
    "",
    "| | |",
    "|---|---|",
    `| Creates with exactly one object under their request_id afterwards, with the first terms | ${s.one_object}/${s.cases} |`,
    `| Repeats sent (same terms, or one cent more) | ${s.repeats_sent} |`,
    `| Repeats Airwallex refused | ${s.repeats_refused}/${s.repeats_sent} |`,
    `| Repeats answered with the first object instead | ${s.repeats_returned_first} |`,
    `| Cases where no repeat made a second object | ${s.repeats_safe}/${s.cases} |`,
    `| Airwallex's answers to a repeat | ${s.duplicate_codes_seen.length ? s.duplicate_codes_seen.map((c) => `\`${esc(c)}\``).join(", ") : "none refused"} |`,
    `| Of those, read by Purser's routed rail as a refusal that moved nothing (should be none) | ${s.codes_purser_reads_as_refusal.length ? s.codes_purser_reads_as_refusal.map((c) => `\`${esc(c)}\``).join(", ") : "none"} |`,
    `| Airwallex calls (approved budget) | ${r.budget.used} (${r.budget.approved ?? "—"}) |`,
    `| Errors | ${r.errors.length ? r.errors.map(esc).join("; ") : "none"} |`,
    "",
    ...(r.after_the_run ? [`**After the run.** ${r.after_the_run}`, ""] : []),
    "## Every case",
    "",
    "| Case | request_id | First create | Same again | One cent more | Listed under the request_id | After |",
    "|---|---|---|---|---|---|---|",
    ...r.cases.map((c) => `| ${esc(c.label)} | \`${c.request_id}\` | ${sendCell(c.first)} | ${sendCell(c.same_again)} | ${c.kind === "batch" ? "– (no amount)" : sendCell(c.changed_amount)} | ${c.lookup.error ? `error: ${esc(c.lookup.error)}` : `${c.lookup.listed}${c.lookup.id ? `: \`${esc(c.lookup.id)}\`` : ""}${c.lookup.amount ? `, ${c.lookup.amount}` : ""}`} | ${c.after ?? "–"} |`),
    "",
    "## Calls",
    "",
    "Method, endpoint (ids folded), Airwallex's HTTP status and error code; never a body, a query or a header.",
    "",
    "| # | Time (UTC) | Call | HTTP | Code |",
    "|---:|---|---|---:|---|",
    ...r.calls.map((l, i) => `| ${i + 1} | ${l.at.slice(11, 23)} | \`${l.method} ${esc(l.endpoint)}\` | ${l.status} | ${l.code ? `\`${esc(l.code)}\`` : ""} |`),
    "",
  ];
  return lines.join("\n");
}
