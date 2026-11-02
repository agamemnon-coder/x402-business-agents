// Light hourly reconciliation (finance item 5): every money movement in the ledger is checked against the system that
// moved it, by id and amount. Sandbox balances are millions of test money, so totals say nothing; the flows do.
//   Airwallex transfers: Airwallex's status and amount for each transfer the ledger holds; and each payout row with no
//   transfer id (still SUBMITTING; or, for 7 days after its close, closed as refused at create or by --close-unsent) looked up by its request_id: a transfer there is a
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
import { resolveSettlements, type ResolvedSettlement, type SettlementLookup } from "./settlements.js";

/** A payout row closed with no transfer id is looked up at Airwallex for this many days after its close. */
export const CLOSED_LOOKUP_DAYS = 7;

export interface ReconcileSources {
  /** Airwallex's view of a transfer. */
  transfer?: (id: string) => Promise<{ status: string; amountCents: number; currency: string }>;
  /** Airwallex's transfer under a request_id, if it holds one. */
  transferByRequestId?: (requestId: string) => Promise<{ id: string; status: string; amountCents: number; currency: string } | undefined>;
  /** Airwallex's list of a card's transactions. */
  cardTransactions?: (cardId: string) => Promise<CardTransaction[]>;
  /** Null if the receipt carries exactly this *USDZ transfer, otherwise what is wrong. */
  chainTransfer?: (tx: string, from: string, to: string, cents: number) => Promise<string | null>;
  /** Metal's facilitator: what settled to Northwind under a payment's nonce (src/finance/settlements.ts). */
  settlementByNonce?: SettlementLookup;
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
  /** Refunds held at Metal for over two hours, looked up on chain (not differences; not refunded yet). */
  held?: { ref: string; since: string | null; chain: string }[];
  /** Customer payments left "being settled", resolved now (src/finance/settlements.ts). */
  settlements?: ResolvedSettlement[];
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
      // Every row without a transfer id: SUBMITTING, always; closed (refused at create, or by the CFO's --close-unsent)
      // during its first 7 days, the window in which a transfer Airwallex made after all would show up.
      const since = new Date(now.getTime() - CLOSED_LOOKUP_DAYS * 24 * 3600_000).toISOString();
      const open = (db.prepare("SELECT request_id, invoice_no, amount, status, failure_type, updated_at FROM transfers WHERE transfer_id IS NULL AND status IN ('SUBMITTING', 'CANCELLED')").all() as { request_id: string; invoice_no: string; amount: string; status: string; failure_type: string | null; updated_at: string }[])
        .filter((r) => r.status === "SUBMITTING" || Date.parse(r.updated_at) >= Date.parse(since));
      for (const r of open) {
        checked++;
        let t: Awaited<ReturnType<NonNullable<ReconcileSources["transferByRequestId"]>>>;
        try {
          t = await src.transferByRequestId(r.request_id);
        } catch (e) {
          // A look-up that cannot be confirmed (an unfiltered list, has_more, an error) is never read as "no transfer".
          differences.push({ area: "airwallex transfer", ref: r.request_id, ledger: `no transfer for invoice ${r.invoice_no} (EUR ${r.amount}, ${r.status})`, outside: `the look-up by request_id could not be confirmed: ${(e as Error).message.slice(0, 160)}` });
          continue;
        }
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

  // Refunds sent but held at Metal for over HELD_FOLLOW_MS: looked up on chain by their transaction (read-only). They are
  // not a difference (Metal holds them on purpose) and never counted as refunded; the result and /health show them.
  const held: { ref: string; since: string | null; chain: string }[] = [];
  for (const h of heldRefunds(db, now)) {
    let chain = "no transaction yet";
    if (h.tx_hash && h.to_address && src.chainTransfer) {
      const business = (db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined)?.address;
      chain = business ? (await src.chainTransfer(h.tx_hash, business, h.to_address, h.amount_cents)) ?? "the transfer is on chain as recorded" : "the ledger does not know the business account";
    } else if (h.tx_hash) chain = "not looked up (no RPC)";
    held.push({ ref: h.payment_id, since: h.since, chain });
  }

  // Customer payments left "being settled": resolved from the ledger and the facilitator. A payment found charged with
  // no sale is a difference (recorded by the resolution itself, which the runner also runs on its own).
  const s = await resolveSettlements(db, src.settlementByNonce, now);
  if (s.skipped) skipped.push(s.skipped);
  const charged: Difference[] = s.resolved.filter((r) => r.outcome === "CHARGED").map((r) => ({
    area: "metal", ref: r.key, ledger: `no sale for a customer payment of ${fromCents(r.cents)} USDZ`, outside: `charged in ${r.tx ?? "an unknown transaction"}, no delivery recorded; owed back unless a person finds it was delivered`,
  }));

  const at = now.toISOString();
  db.transaction(() => {
    for (const d of differences) audit(db, "system", "reconcile.difference", d.ref, { ...d }, now);
    audit(db, "system", "reconcile.done", null, { checked, differences: differences.length + charged.length, skipped, ...(held.length ? { held } : {}), ...(s.resolved.length ? { settlements: s.resolved } : {}) }, now);
  }).immediate();
  return { at, checked, skipped, differences: [...differences, ...charged], ...(held.length ? { held } : {}), ...(s.resolved.length ? { settlements: s.resolved } : {}) };
}

/** A refund held at Metal longer than this is followed: on /health and by the reconciliation. */
export const HELD_FOLLOW_MS = 2 * 60 * 60_000;

/** Refunds still HELD (sent, held at Metal) since longer than HELD_FOLLOW_MS, or since an unknown time. */
export function heldRefunds(db: DB, now = new Date()): { sale_id: number; payment_id: string; tx_hash: string | null; to_address: string; amount_cents: number; since: string | null }[] {
  const rows = db.prepare(`SELECT r.sale_id, r.payment_id, r.tx_hash, r.to_address, r.amount_cents,
      (SELECT MIN(a.ts) FROM audit_log a WHERE a.subject = CAST(r.sale_id AS TEXT) AND a.event IN ('refund.held', 'refund.already_held')) AS since
    FROM refunds r WHERE r.outcome = 'HELD' ORDER BY r.sale_id`).all() as { sale_id: number; payment_id: string; tx_hash: string | null; to_address: string; amount_cents: number; since: string | null }[];
  return rows.filter((r) => !r.since || now.getTime() - Date.parse(r.since) > HELD_FOLLOW_MS);
}

/** Refunds that were held at Metal and later refused: sent, then not paid. Nothing was refunded for them. */
export function heldThenRefused(db: DB): { sale_id: number; payment_id: string; reason: string | null }[] {
  return db.prepare(`SELECT r.sale_id, r.payment_id, r.refusal_reason AS reason FROM refunds r WHERE r.outcome = 'REFUSED'
    AND EXISTS (SELECT 1 FROM audit_log a WHERE a.subject = CAST(r.sale_id AS TEXT) AND a.event IN ('refund.held', 'refund.already_held')) ORDER BY r.sale_id`).all() as { sale_id: number; payment_id: string; reason: string | null }[];
}

/** The latest reconciliation, for the dashboard, or null if none ran. */
export function lastReconciliation(db: DB): { at: string; checked: number; differences: number; skipped: string[] } | null {
  const r = db.prepare("SELECT ts, payload_json FROM audit_log WHERE event = 'reconcile.done' ORDER BY seq DESC LIMIT 1").get() as { ts: string; payload_json: string } | undefined;
  if (!r) return null;
  const p = JSON.parse(r.payload_json) as { checked: number; differences: number; skipped?: string[] };
  return { at: r.ts, checked: p.checked, differences: p.differences, skipped: p.skipped ?? [] };
}
