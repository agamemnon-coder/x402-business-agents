// The main run's companion record for /trace and the month-end pack (Max's last round, 1.2 and 1.3): what the main
// run's record (docs/demo/main-run.json) keeps only per group, kept per payment. Built from a copy of the main run's
// own ledger by `npm run trace-record`, with the same scrub as the record's ledger rows (src/demo/runLedger.ts), and
// written to docs/demo/main-run-trace.json. The main run's record is not changed.
//
// What it holds:
// - every payment of the run (88: each sale, supplier purchase, refund and sweep on Metal, the card charge and the
//   SWIFT transfer), each with its own rail id, its approval hash where one exists, who decided it (as its audit row
//   recorded it) and the seq of that audit row;
// - the mandates bound and replaced on Metal (the locks that held the Metal payments), from their audit rows;
// - the GL journal (src/accounting/gl.ts) with the opening lines (src/accounting/books.ts), so the books, the trial
//   balance and the GL export are rebuilt from it with the existing code;
// - the audit chain as {seq, prev_hash, row_hash} per row and nothing else from the rows, with the chain's head and
//   the result of verifyAuditChain on the ledger it was built from.
// What it never holds: anything the scrub drops (passkey credential ids and assertions, beneficiary ids, IBANs, viewer
// keys, tokens, hosts, nonces), or a row's content beyond the fields above.

import { openingLines } from "../accounting/books.js";
import { journal, type JournalLine } from "../accounting/gl.js";
import { verifyAuditChain } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { scrub, secretsIn } from "./runLedger.js";

export const TRACE_FILE = "docs/demo/main-run-trace.json";
export const TRACE_SCHEMA = "purser.main-run-trace/v1";

export type PaymentKind = "sale" | "purchase" | "refund" | "sweep" | "card" | "transfer";
export type PaymentRail = "metal" | "airwallex_card" | "airwallex_swift";

/** Who decided a payment, as its audit row recorded it (src/provenance/origin.ts), scrubbed. */
export type Origin = Record<string, unknown> | null;

export interface TracePayment {
  /** Stable on /trace: "sale-5", "purchase-55", "refund-7", "sweep-20261103-1", "card-01a1a12f", "transfer-03360bfa". */
  id: string;
  kind: PaymentKind;
  /** The ledger's own reference: the sale id, the purchase id, the refund's sale id, the sweep's payment id, the Airwallex ids. */
  ref: string;
  at: string;
  amount: string;
  currency: string;
  rail: PaymentRail;
  /** The Metal transaction hash, the Airwallex card transaction id or the Airwallex transfer id. */
  rail_id: string;
  /** The approval hash carried by the payment (the SWIFT transfer's metadata), or null when nothing was signed for it. */
  approval_sha256: string | null;
  proposal_id: string | null;
  origin: Origin;
  /** The audit row that records the payment. */
  audit: { seq: number; event: string };
  /** For a payment on Metal: the audit seq of the mandate row (bound or replaced) in force when it was paid. */
  mandate_seq: number | null;
}

export interface TraceMandate { seq: number; ts: string; event: "mandate.bound" | "mandate.replaced"; agent: string; cap: string; budget: string; tx: string; mandate_hash: string | null; proposal_id: string | null }

export interface RunTrace {
  schema: typeof TRACE_SCHEMA;
  /** "Derived from the main run's ledger (3 Nov), sanitized, generated <date>." The label every surface carries. */
  label: string;
  generated: string;
  source: { record: string; run: string; ledger_matches_record: true };
  payments: TracePayment[];
  mandates: TraceMandate[];
  /** The opening lines, then the journal, in the order src/accounting/books.ts books them (so the entry numbers match). */
  journal: JournalLine[];
  audit: { rows: number; head: string; intact: boolean; links: { seq: number; prev_hash: string; row_hash: string }[] };
}

/** The label, worded as Max approved it (6 Nov), with the generation date. */
export const traceLabel = (generated: string) => `Derived from the main run's ledger (3 Nov), sanitized, generated ${generated}.`;
export const RECORD_UNCHANGED = "The main run's record is unchanged.";

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

export function runTrace(db: DB, o: { generated: string; record: { run: string; audit: { rows: number; head: string } }; recordFile: string }): RunTrace {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.generated)) throw new Error("generated must be a date, YYYY-MM-DD");
  const chain = verifyAuditChain(db);
  if (!chain.ok) throw new Error(`the ledger's audit chain is broken at seq ${chain.seq}: ${chain.reason}`);
  if (chain.rows !== o.record.audit.rows || chain.head !== o.record.audit.head) throw new Error(`this ledger is not the record's: ${chain.rows} rows, head ${chain.head.slice(0, 12)}…; the record says ${o.record.audit.rows} rows, head ${o.record.audit.head.slice(0, 12)}…`);

  const rowOf = (event: string, subject: string) => {
    const rows = db.prepare("SELECT seq, payload_json FROM audit_log WHERE event = ? AND subject = ? ORDER BY seq").all(event, subject) as { seq: number; payload_json: string }[];
    if (rows.length !== 1) throw new Error(`expected one ${event} row for ${subject}, found ${rows.length}`);
    return { seq: rows[0]!.seq, payload: parse(rows[0]!.payload_json) };
  };
  const originOf = (p: Record<string, unknown>): Origin => (p.origin && typeof p.origin === "object" ? scrub(p.origin as Record<string, unknown>) : null);

  const mandates: TraceMandate[] = (db.prepare("SELECT seq, ts, event, subject, payload_json FROM audit_log WHERE event IN ('mandate.bound', 'mandate.replaced') ORDER BY seq").all() as { seq: number; ts: string; event: TraceMandate["event"]; subject: string; payload_json: string }[]).map((r) => {
    const p = scrub(parse(r.payload_json));
    return { seq: r.seq, ts: r.ts, event: r.event, agent: r.subject, cap: String(p.cap), budget: String(p.budget), tx: String(p.tx), mandate_hash: typeof p.mandate_hash === "string" ? p.mandate_hash : null, proposal_id: typeof p.proposal_id === "string" ? p.proposal_id : null };
  });
  const mandateAt = (agent: string, seq: number) => mandates.filter((m) => m.agent === agent && m.seq < seq).pop()?.seq ?? null;

  const payments: TracePayment[] = [];
  const metal = (x: Omit<TracePayment, "rail" | "approval_sha256" | "proposal_id" | "mandate_seq">, agent: string) => payments.push({ ...x, rail: "metal", approval_sha256: null, proposal_id: null, mandate_seq: mandateAt(agent, x.audit.seq) });

  // The same rows the GL journal books (src/accounting/gl.ts): delivered sales, paid purchases, refunds and sweeps,
  // approved card charges, transfers SENT or PAID.
  for (const s of db.prepare("SELECT sale_id, price_cents, tx_hash, created_at FROM sales WHERE status = 'DELIVERED' ORDER BY sale_id").all() as { sale_id: number; price_cents: number; tx_hash: string; created_at: string }[]) {
    const row = rowOf("sale.delivered", String(s.sale_id));
    metal({ id: `sale-${s.sale_id}`, kind: "sale", ref: String(s.sale_id), at: s.created_at, amount: fromCents(s.price_cents), currency: "USDZ", rail_id: s.tx_hash, origin: originOf(row.payload), audit: { seq: row.seq, event: "sale.delivered" } }, "customer");
  }
  for (const u of db.prepare("SELECT id, price_cents, tx_hash, created_at FROM upstream_purchases WHERE outcome = 'PAID' ORDER BY id").all() as { id: number; price_cents: number; tx_hash: string; created_at: string }[]) {
    const row = rowOf("upstream.paid", String(u.id));
    metal({ id: `purchase-${u.id}`, kind: "purchase", ref: String(u.id), at: u.created_at, amount: fromCents(u.price_cents), currency: "USDZ", rail_id: u.tx_hash, origin: originOf(row.payload), audit: { seq: row.seq, event: "upstream.paid" } }, "sourcing");
  }
  for (const r of db.prepare("SELECT sale_id, amount_cents, tx_hash FROM refunds WHERE outcome = 'PAID' ORDER BY refund_id").all() as { sale_id: number; amount_cents: number; tx_hash: string }[]) {
    const row = rowOf("refund.paid", String(r.sale_id));
    const at = (db.prepare("SELECT ts FROM audit_log WHERE seq = ?").get(row.seq) as { ts: string }).ts;
    metal({ id: `refund-${r.sale_id}`, kind: "refund", ref: String(r.sale_id), at, amount: fromCents(r.amount_cents), currency: "USDZ", rail_id: r.tx_hash, origin: originOf(row.payload), audit: { seq: row.seq, event: "refund.paid" } }, "support");
  }
  for (const w of db.prepare("SELECT payment_id, amount_cents, tx_hash, created_at FROM sweeps WHERE outcome = 'PAID' ORDER BY created_at").all() as { payment_id: string; amount_cents: number; tx_hash: string; created_at: string }[]) {
    const row = rowOf("sweep.paid", w.payment_id);
    metal({ id: w.payment_id, kind: "sweep", ref: w.payment_id, at: w.created_at, amount: fromCents(w.amount_cents), currency: "USDZ", rail_id: w.tx_hash, origin: originOf(row.payload), audit: { seq: row.seq, event: "sweep.paid" } }, "treasury");
  }
  for (const c of db.prepare("SELECT transaction_id, amount_cents, currency, occurred_at FROM card_transactions WHERE approved = 1 ORDER BY occurred_at, transaction_id").all() as { transaction_id: string; amount_cents: number; currency: string; occurred_at: string }[]) {
    const row = rowOf("card.charge_approved", c.transaction_id);
    payments.push({ id: `card-${c.transaction_id.slice(0, 8)}`, kind: "card", ref: c.transaction_id, at: c.occurred_at, amount: fromCents(c.amount_cents), currency: c.currency, rail: "airwallex_card", rail_id: c.transaction_id, approval_sha256: null, proposal_id: null, origin: originOf(row.payload), audit: { seq: row.seq, event: "card.charge_approved" }, mandate_seq: null });
  }
  for (const t of db.prepare("SELECT transfer_id, amount, currency, approval_sha256, updated_at FROM transfers WHERE status IN ('SENT', 'PAID') ORDER BY updated_at").all() as { transfer_id: string; amount: string; currency: string; approval_sha256: string; updated_at: string }[]) {
    const row = rowOf("transfer.created", t.transfer_id);
    const proposal = (db.prepare("SELECT proposal_id FROM proposals WHERE terms_sha256 = ?").get(t.approval_sha256) as { proposal_id: string } | undefined)?.proposal_id ?? null;
    payments.push({ id: `transfer-${t.transfer_id.slice(0, 8)}`, kind: "transfer", ref: t.transfer_id, at: t.updated_at, amount: t.amount, currency: t.currency, rail: "airwallex_swift", rail_id: t.transfer_id, approval_sha256: t.approval_sha256, proposal_id: proposal, origin: originOf(row.payload), audit: { seq: row.seq, event: "transfer.created" }, mandate_seq: null });
  }
  payments.sort((a, b) => a.at.localeCompare(b.at) || a.audit.seq - b.audit.seq);

  const moved = journal(db);
  const links = (db.prepare("SELECT seq, prev_hash, row_hash FROM audit_log ORDER BY seq").all() as { seq: number; prev_hash: string; row_hash: string }[]).map((r) => ({ seq: r.seq, prev_hash: r.prev_hash, row_hash: r.row_hash }));
  const out: RunTrace = {
    schema: TRACE_SCHEMA, label: traceLabel(o.generated), generated: o.generated,
    source: { record: o.recordFile, run: o.record.run, ledger_matches_record: true },
    payments, mandates, journal: scrub([...openingLines(db, moved), ...moved]),
    audit: { rows: chain.rows, head: chain.head, intact: chain.ok, links },
  };
  const leaked = secretsIn(JSON.stringify(out));
  if (leaked.length) throw new Error(`the companion would carry something private: ${leaked.join("; ")}`);
  return out;
}
