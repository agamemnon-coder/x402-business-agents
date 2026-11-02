// Light hourly reconciliation (finance item 5): every money movement in the ledger is checked against the system that
// moved it, by id and amount. Sandbox balances are millions of test money, so totals say nothing; the flows do.
//   Airwallex transfers: Airwallex's status and amount for each transfer the ledger holds; and each payout row with no
//   transfer id (still SUBMITTING, closed as refused at create, or closed by the CFO's --close-unsent) looked up by its request_id: a transfer there is a
//   difference (Airwallex may hold a payout the ledger thinks was never made; review of 2 November).
//   Card transactions: both ways, approved at Airwallex but missing here, or approved here but not at Airwallex.
//   Metal: each sale, supplier purchase, refund and sweep the ledger calls paid has a receipt with exactly that *USDZ
//   transfer, from the payer to the payee.
// A difference is an alarm: an audit row each (reconcile.difference) and a red band on the dashboard. Nothing is fixed
// automatically; a person looks.

import { audit } from "../audit/log.js";
import type { CardTransaction } from "../airwallex/issuing.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";

export interface ReconcileSources {
  /** Airwallex's view of a transfer. */
  transfer?: (id: string) => Promise<{ status: string; amountCents: number; currency: string }>;
  /** Airwallex's transfer under a request_id, if it holds one. */
  transferByRequestId?: (requestId: string) => Promise<{ id: string; status: string; amountCents: number; currency: string } | undefined>;
  /** Airwallex's list of a card's transactions. */
  cardTransactions?: (cardId: string) => Promise<CardTransaction[]>;
  /** Null if the receipt carries exactly this *USDZ transfer, otherwise what is wrong. */
  chainTransfer?: (tx: string, from: string, to: string, cents: number) => Promise<string | null>;
}

export interface Difference {
  area: "airwallex transfer" | "card" | "metal";
  ref: string;
  ledger: string;
  outside: string;
}

export interface Reconciliation {
  at: string;
  checked: number;
  /** Areas not checked, and why (no keys, no RPC). */
  skipped: string[];
  differences: Difference[];
}

/** Card transactions this fresh may still be on their way into the ledger (the poll waits up to 2 minutes). */
const SETTLING_MS = 5 * 60 * 1000;
/** The newest Metal payments checked per kind: a daily check, not a full audit (npm run verify does that). */
const METAL_ROWS = 200;

export async function reconcile(db: DB, src: ReconcileSources, now = new Date()): Promise<Reconciliation> {
  const differences: Difference[] = [];
  const skipped: string[] = [];
  let checked = 0;

  // Airwallex transfers.
  if (src.transfer) {
    const rows = db.prepare("SELECT transfer_id, amount, status FROM transfers WHERE transfer_id IS NOT NULL").all() as { transfer_id: string; amount: string; status: string }[];
    for (const r of rows) {
      checked++;
      const t = await src.transfer(r.transfer_id);
      if (t.amountCents !== toCents(r.amount) || t.status !== r.status) {
        differences.push({ area: "airwallex transfer", ref: r.transfer_id, ledger: `EUR ${r.amount}, ${r.status}`, outside: `${t.currency} ${fromCents(t.amountCents)}, ${t.status}` });
      }
    }
    if (src.transferByRequestId) {
      // Every row without a transfer id: SUBMITTING, closed as refused at create, or closed by the CFO's --close-unsent.
      const open = db.prepare("SELECT request_id, invoice_no, amount, status, failure_type FROM transfers WHERE transfer_id IS NULL AND status IN ('SUBMITTING', 'CANCELLED')").all() as { request_id: string; invoice_no: string; amount: string; status: string; failure_type: string | null }[];
      for (const r of open) {
        checked++;
        const t = await src.transferByRequestId(r.request_id);
        if (t) {
          differences.push({
            area: "airwallex transfer", ref: r.request_id,
            ledger: `no transfer for invoice ${r.invoice_no} (EUR ${r.amount}, ${r.status === "SUBMITTING" ? "never answered" : r.failure_type === "closed_unsent" ? "closed by the CFO as never sent" : "closed as refused at create"})`,
            outside: `transfer ${t.id}: ${t.currency} ${fromCents(t.amountCents)}, ${t.status}`,
          });
        }
      }
    }
  } else skipped.push("Airwallex transfers (no Airwallex keys)");

  // Card transactions, both ways. A transaction can be known by two ids (src/policy/cards.ts).
  if (src.cardTransactions) {
    const cards = db.prepare("SELECT agent, card_id FROM cards").all() as { agent: string; card_id: string }[];
    for (const c of cards) {
      const theirs = await src.cardTransactions(c.card_id);
      const ours = db.prepare("SELECT transaction_id, amount_cents, approved FROM card_transactions WHERE card_id = ?").all(c.card_id) as { transaction_id: string; amount_cents: number; approved: number }[];
      const byId = new Map(ours.map((o) => [o.transaction_id, o]));
      const seen = new Set<string>();
      for (const t of theirs) {
        if (/REFUND|REVERSAL|CREDIT/i.test(t.type)) continue;
        checked++;
        const o = byId.get(t.transactionId) ?? (t.legacyId ? byId.get(t.legacyId) : undefined);
        if (o) seen.add(o.transaction_id);
        if (!o) {
          if (t.approved && now.getTime() - Date.parse(t.occurredAt) > SETTLING_MS) {
            differences.push({ area: "card", ref: t.transactionId, ledger: "not recorded", outside: `approved ${t.currency} ${fromCents(t.amountCents)} at ${t.merchant} on the ${c.agent} card` });
          }
        } else if (o.amount_cents !== t.amountCents || (o.approved === 1) !== t.approved) {
          differences.push({ area: "card", ref: t.transactionId, ledger: `${o.approved ? "approved" : "declined"} ${fromCents(o.amount_cents)}`, outside: `${t.approved ? "approved" : "declined"} ${fromCents(t.amountCents)}` });
        }
      }
      for (const o of ours) {
        if (o.approved === 1 && !seen.has(o.transaction_id)) {
          checked++;
          differences.push({ area: "card", ref: o.transaction_id, ledger: `approved ${fromCents(o.amount_cents)}`, outside: "not listed by Airwallex" });
        }
      }
    }
  } else skipped.push("card transactions (no Airwallex keys)");

  // Metal payments: the receipt must carry the exact transfer.
  if (src.chainTransfer) {
    const role = (r: string) => (db.prepare("SELECT address FROM metal_accounts WHERE role = ?").get(r) as { address: string } | undefined)?.address ?? null;
    const [business, supplier, sweep] = [role("business"), role("supplier"), role("sweep")];
    const payments: { kind: string; ref: string; tx: string; from: string | null; to: string | null; cents: number }[] = [
      ...(db.prepare(`SELECT sale_id, tx_hash, payer, price_cents FROM sales WHERE status = 'DELIVERED' AND tx_hash IS NOT NULL ORDER BY sale_id DESC LIMIT ${METAL_ROWS}`).all() as { sale_id: number; tx_hash: string; payer: string; price_cents: number }[])
        .map((s) => ({ kind: "sale", ref: `sale ${s.sale_id}`, tx: s.tx_hash, from: s.payer, to: business, cents: s.price_cents })),
      ...(db.prepare(`SELECT id, tx_hash, price_cents FROM upstream_purchases WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY id DESC LIMIT ${METAL_ROWS}`).all() as { id: number; tx_hash: string; price_cents: number }[])
        .map((u) => ({ kind: "supplier purchase", ref: `purchase ${u.id}`, tx: u.tx_hash, from: business, to: supplier, cents: u.price_cents })),
      ...(db.prepare(`SELECT payment_id, tx_hash, to_address, amount_cents FROM refunds WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY refund_id DESC LIMIT ${METAL_ROWS}`).all() as { payment_id: string; tx_hash: string; to_address: string; amount_cents: number }[])
        .map((r) => ({ kind: "refund", ref: r.payment_id, tx: r.tx_hash, from: business, to: r.to_address, cents: r.amount_cents })),
      ...(db.prepare(`SELECT payment_id, tx_hash, amount_cents FROM sweeps WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT ${METAL_ROWS}`).all() as { payment_id: string; tx_hash: string; amount_cents: number }[])
        .map((w) => ({ kind: "sweep", ref: w.payment_id, tx: w.tx_hash, from: business, to: sweep, cents: w.amount_cents })),
    ];
    for (const p of payments) {
      checked++;
      if (!p.from || !p.to) {
        differences.push({ area: "metal", ref: p.ref, ledger: `${p.kind} of ${fromCents(p.cents)} USDZ`, outside: "the ledger does not know both accounts" });
        continue;
      }
      const wrong = await src.chainTransfer(p.tx, p.from, p.to, p.cents);
      if (wrong) differences.push({ area: "metal", ref: p.ref, ledger: `${p.kind} of ${fromCents(p.cents)} USDZ in ${p.tx.slice(0, 10)}…`, outside: wrong });
    }
  } else skipped.push("Metal payments (no RPC)");

  const at = now.toISOString();
  db.transaction(() => {
    for (const d of differences) audit(db, "system", "reconcile.difference", d.ref, { ...d }, now);
    audit(db, "system", "reconcile.done", null, { checked, differences: differences.length, skipped }, now);
  }).immediate();
  return { at, checked, skipped, differences };
}

/** The latest reconciliation, for the dashboard, or null if none ran. */
export function lastReconciliation(db: DB): { at: string; checked: number; differences: number; skipped: string[] } | null {
  const r = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'reconcile.done' ORDER BY seq DESC LIMIT 1").get() as { ts: string; payload_json: string } | undefined;
  if (!r) return null;
  const p = JSON.parse(r.payload_json) as { checked: number; differences: number; skipped?: string[] };
  return { at: r.ts, checked: p.checked, differences: p.differences, skipped: p.skipped ?? [] };
}
