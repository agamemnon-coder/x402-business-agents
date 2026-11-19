// The record of an Airwallex soak (docs/runs/<date>-airwallex-soak.json and .md), built from the run's results, its call
// log and the HTTP status of each call only (`npm run airwallex:soak -- record`, 0 calls). It also says which figures of
// the /proof band it would move once counted: the record is left out of the band (src/redesign/scale.ts NOT_IN_BAND)
// so the band stays what the deployed pages show.

import { countByEndpoint, type CallLine } from "../airwallex/callBudget.js";
import { SOAK_PASSKEY_LABEL, summarize, type SoakResults, type SoakSummary } from "./airwallexSoak.js";

type Http = { at: string; method: string; endpoint: string; status: number };

export interface SoakRecord {
  stream: "airwallex-soak"; sandbox: string; test_money: true; source: string; signer: string; simulated: string; latency_note: string;
  budget: { approved: number | null; used: number };
  summary: SoakSummary;
  band: { excluded: string; would_change_once_counted: { figure: string; by: number; how: string }[]; unchanged: string[] };
  setup: SoakResults["setup"]; started_at: string; ended_at: string | null; stopped: string | null;
  payments: SoakResults["payments"]; negatives: SoakResults["negatives"];
  calls: { total: number; by_endpoint: { endpoint: string; calls: number }[]; first: string | null; last: string | null; lines: CallLine[] };
}

/** How many audit-like rows of a refusal the band's walk would find in a value (scale.ts: event matching refus|declin|reject|fraud). */
export function refusalRowsIn(v: unknown): number {
  const rows = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    const r = o as Record<string, unknown>;
    if (typeof r.event === "string" && /refus|declin|reject|fraud/.test(r.event)) rows.add(typeof r.row_hash === "string" ? r.row_hash : JSON.stringify([r.event, r.ts ?? null, r.subject ?? null]));
    Object.values(r).forEach(walk);
  };
  walk(v);
  return rows.size;
}

export function soakRecord(r: SoakResults, calls: CallLine[], http: Http[], o: { budget: number | null; file: string }): SoakRecord {
  const summary = summarize(r, calls, http);
  const rec: SoakRecord = {
    stream: "airwallex-soak", sandbox: "api.sandbox.airwallex.com", test_money: true,
    source: "built by `npm run airwallex:soak -- record` from the run's results.json, its AIRWALLEX_CALL_LOG and the HTTP status of each call (http.json) only",
    signer: `${SOAK_PASSKEY_LABEL} (no person's Face ID)`,
    simulated: "PAID (and SENT before it) came from the sandbox's simulation endpoint (POST /simulation/transfers/{id}/transition): the sandbox does not settle by itself. Every create, quote, rate, conversion, status and read-back is Airwallex's own answer.",
    latency_note: "create→PAID is from POST /transfers/create being sent to the GET that first answered PAID: the create, two simulated transitions and the reads between them, one at a time at most one per 200 ms (src/airwallex/client.ts). It measures the API round trips, not a settlement time.",
    budget: { approved: o.budget, used: calls.length },
    summary,
    band: { excluded: "", would_change_once_counted: [], unchanged: [] },
    setup: r.setup, started_at: r.started_at, ended_at: r.ended_at, stopped: r.stopped,
    payments: r.payments, negatives: r.negatives,
    calls: { total: calls.length, by_endpoint: countByEndpoint(calls), first: calls[0]?.at ?? null, last: calls.at(-1)?.at ?? null, lines: calls },
  };
  const refusals = refusalRowsIn(rec);
  rec.band = {
    excluded: `${o.file} and its .md are in NOT_IN_BAND (src/redesign/scale.ts; src/cli/verifyAll.ts skips them the same way): verify-all compares the band with the pages as deployed, and this record is newer than them`,
    would_change_once_counted: [
      { figure: "Airwallex sandbox API calls in the run records", by: calls.length, how: "once the record is listed in the API trail (src/airwallex/apiTrail.ts), which /airwallex/calls and the band count" },
      { figure: "sandbox and testnet runs", by: 1, how: "once the run is a row of /runs (src/redesign/runs.ts)" },
      ...(refusals ? [{ figure: "refusals on record", by: refusals, how: "rows with a refusal event in the record, counted by the band's walk of docs/runs" }] : []),
    ],
    unchanged: ["tests passing", "Alta testnet transactions (none in this record)", "Claude calls with request ids (none: no model is asked)", ...(refusals ? [] : ["refusals on record (the record holds no audit row with a refusal event; its negatives are counted in summary.negatives)"])],
  };
  return rec;
}

const cell = (s: unknown) => String(s ?? "—").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

export function renderSoakMarkdown(rec: SoakRecord, date: string): string {
  const s = rec.summary;
  const L: string[] = [];
  L.push(`# Airwallex soak, ${date}: 30 supplier payments and 5 negative controls (sandbox, test money)`, "");
  L.push(`Record: [${date}-airwallex-soak.json](${date}-airwallex-soak.json), built by \`npm run airwallex:soak -- record\` from the run's own files (0 calls). Code: [src/e2e/airwallexSoak.ts](../../src/e2e/airwallexSoak.ts), [src/cli/airwallexSoak.ts](../../src/cli/airwallexSoak.ts).`, "");
  L.push("- **Airwallex sandbox only, test money.** Every call went to `api.sandbox.airwallex.com` through Purser's own client (one at a time, at most one per 200 ms, backoff on 429), counted in one call log against an approved budget.");
  L.push(`- **Signed by the ${rec.signer}.** Each payment's exact terms were signed with it; nothing was approved in Airwallex's web app.`);
  L.push("- **PAID is simulated.** SENT and PAID came from the sandbox's simulation endpoint; the sandbox does not settle by itself.");
  L.push("- **Purser's real pipeline:** the treasury agent's code planned each payment (balance read; for a shortfall a rate check and a locked quote for the shortfall only), the virtual passkey signed the terms, the invoice payment executor booked the conversion and created the transfer with `metadata.approval_sha256`, then the transfer was read back from Airwallex and compared with the signed terms.", "");
  if (rec.stopped) L.push(`**Stopped early:** ${cell(rec.stopped)}`, "");
  L.push("## Aggregates", "", "| | |", "|---|---|");
  const row = (k: string, v: unknown) => L.push(`| ${k} | ${cell(v)} |`);
  row("Transfers created", `${s.created}/${s.planned}`);
  row("PAID at Airwallex (read back; simulated)", `${s.paid}/${s.planned}`);
  row("Read-backs matching the signed terms (approval_sha256, amount, currency, beneficiary, reference, request_id, PAID)", `${s.readback_matches}/${s.planned}`);
  row("USD→EUR conversions for the shortfall (booked / read back matching)", `${s.conversions.booked}/${s.conversions.planned} / ${s.conversions.readback_matches}/${s.conversions.planned}`);
  row("create→PAID latency p50 / p95 (min, max)", s.latency_ms.p50 === null ? "—" : `${s.latency_ms.p50} ms / ${s.latency_ms.p95} ms (${s.latency_ms.min}, ${s.latency_ms.max}; n=${s.latency_ms.n})`);
  row("Airwallex calls in all (budget)", `${s.calls.total} (${rec.budget.approved ?? "—"})`);
  row("Calls: setup / payments / negatives", `${s.calls.setup} / ${s.calls.payments} / ${s.calls.negatives}`);
  row("Calls per payment: mean (min, max)", `${s.calls.per_payment.mean} (${s.calls.per_payment.min}, ${s.calls.per_payment.max})`);
  row("Negative controls refused before any create", `${s.negatives.refused}/${s.negatives.planned}`);
  row("Calls from the one-cent change to the refusal: total / POST / creates", `${s.negatives.calls_in_window} / ${s.negatives.posts_in_window} / ${s.negatives.creates_in_window}${Object.keys(s.negatives.by_endpoint_in_window).length ? ` (${Object.entries(s.negatives.by_endpoint_in_window).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}`);
  row("Negatives' request ids found at Airwallex afterwards", s.negatives.found_at_airwallex);
  row("HTTP 429 answers / other non-2xx", s.http ? `${s.http.status_429} / ${s.http.non_2xx.filter((h) => h.status !== 429).length}` : "—");
  row("Errors", s.errors.length ? s.errors.map((e) => `${e.where}: ${e.error}`).join("; ") : "none");
  L.push("", `${rec.latency_note}`, "");
  L.push("## Payments", "", "| # | Invoice | Payee | EUR | FX (USD sold) | Proposal | Transfer | Signed terms hash = metadata.approval_sha256 | Read-back | create sent → PAID seen (UTC) | ms | Calls |", "|---|---|---|---:|---|---|---|---|---|---|---:|---:|");
  for (const x of rec.payments) {
    const rb = x.readback ? (x.readback.all_match ? "match" : `MISMATCH: ${Object.entries(x.readback.match).filter(([, ok]) => !ok).map(([k]) => k).join(", ")}`) : "—";
    const fx = x.conversion ? `USD ${x.conversion.sell} at ${x.conversion.client_rate}; ${x.conversion.readback?.all_match ? "read back, match" : `read back: ${x.conversion.readback?.differences.join("; ") ?? "—"}`}` : "—";
    const ts = x.create_sent_at && x.paid_seen_at ? `${x.create_sent_at.slice(11, 23)} → ${x.paid_seen_at.slice(11, 23)}` : "—";
    L.push(`| ${x.n} | ${cell(x.invoice_no)} | ${cell(x.payee)} | ${cell(x.amount)} | ${cell(fx)} | ${cell(x.proposal_id)} | \`${cell(x.transfer_id)}\` | \`${cell(x.terms_sha256)}\`${x.readback ? (x.readback.match.approval_sha256 ? " =" : " ≠") : ""} | ${cell(x.error ? `ERROR ${x.error}` : `${x.readback?.status ?? "—"}, ${rb}`)} | ${ts} | ${cell(x.create_to_paid_ms)} | ${x.calls.total} |`);
  }
  L.push("", "## Negative controls: one cent changed after signing", "", "Each was planned and signed like a payment; then its stored terms were changed by one cent (the approval row untouched) and handed to the same executor. Calls are counted from the change to the refusal; afterwards Airwallex was asked by the signed request ids whether it holds anything. The one call in each window is a read: the executor reads the balances (`GET /balances/current`) before it checks the hash (src/executors/invoicePayment.ts), so a changed proposal costs one read and sends nothing that moves money: no POST, no conversion, no transfer.", "");
  L.push("| # | After payment | Invoice | Change | Refused | Calls from change to refusal (POST) | Transfer / conversion at Airwallex | Executor's words |", "|---|---:|---|---|---|---|---|---|");
  for (const x of rec.negatives) {
    const ch = x.changed ? `${x.tamper}: ${x.changed.field} ${x.changed.from} → ${x.changed.to}` : x.tamper;
    const by = Object.entries(x.calls_from_change_to_refusal.by_endpoint).map(([k, v]) => `${v} ${k}`).join(", ");
    const at = x.airwallex_lookup ? `${x.airwallex_lookup.transfer_found ? "FOUND" : "none"} / ${x.airwallex_lookup.conversion_found === null ? "—" : x.airwallex_lookup.conversion_found ? "FOUND" : "none"}` : "—";
    L.push(`| ${x.n} | ${x.after_payment} | ${cell(x.invoice_no)} | ${cell(ch)} | ${x.refused ? "yes" : "NO"} | ${x.calls_from_change_to_refusal.total} (${x.calls_from_change_to_refusal.post})${by ? `: ${cell(by)}` : ""} | ${at} | ${cell(x.error ? `ERROR ${x.error}` : x.refusal)} |`);
  }
  L.push("", "## Airwallex calls by endpoint", "", "| Endpoint | Calls |", "|---|---:|");
  for (const e of rec.calls.by_endpoint) L.push(`| \`${e.endpoint}\` | ${e.calls} |`);
  L.push(`| **Total** | **${rec.calls.total}** |`, "", `First call ${rec.calls.first ?? "—"}, last ${rec.calls.last ?? "—"}. Setup: ${Object.entries(rec.setup.calls.by_endpoint).map(([k, v]) => `${v} ${k}`).join(", ")}; balances before: ${Object.entries(rec.setup.balances_before).map(([k, v]) => `${k} ${v}`).join(", ")}.`, "");
  L.push("## The /proof band", "", `${rec.band.excluded}. Once counted, it would change:`, "");
  for (const w of rec.band.would_change_once_counted) L.push(`- ${w.figure}: +${w.by} (${w.how})`);
  L.push(`- Unchanged: ${rec.band.unchanged.join("; ")}`, "");
  L.push("## Run it again", "", "```", "npm run airwallex:soak -- stand-in      # the whole soak on the in-memory stand-in, 0 network", "AWX_SOAK_GO=yes AIRWALLEX_CALL_BUDGET=450 AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- live", "AIRWALLEX_CALL_LOG=<run>/calls.jsonl KIT11_DB=<run>/awx-soak.sqlite npm run airwallex:soak -- record", "```", "");
  return `${L.join("\n")}`;
}
