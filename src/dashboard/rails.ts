// What each rail did in this ledger, with its proof (awards item 1): Airwallex and Metal are where the money moves
// and where the limits hold; Purser is the control layer above them. Every item is read from the ledger and carries
// the id or transaction that proves it: an Airwallex id (the sandbox web app shows it), or a Metal testnet explorer
// link. Nothing here is typed in by hand; an item the ledger has no record of is left out.

import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { EXPLORER_TX } from "../metal/network.js";

export interface RailItem {
  /** What the rail did, in a few words. */
  what: string;
  /** The numbers, in plain words. */
  detail: string;
  /** The proof: an Airwallex id (no public link) or a Metal transaction (explorer link). */
  proof: { label: string; href: string | null } | null;
  /** True where the sandbox simulates the other side (a merchant's charge, a deposit), said so on the page. */
  simulated?: boolean;
}

export interface RailsView {
  airwallex: RailItem[];
  metal: RailItem[];
}

type Row = Record<string, unknown>;
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const all = (db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as Row[];
const one = (db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).get(...a) as Row | undefined;
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s);
const tx = (hash: unknown): RailItem["proof"] => (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? { label: short(hash), href: `${EXPLORER_TX}${hash}` } : null);
const awxId = (id: unknown): RailItem["proof"] => (typeof id === "string" && id ? { label: `Airwallex id ${short(id)}`, href: null } : null);
const events = (db: DB, event: string) => all(db, "SELECT ts, subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq", event).map((r) => ({ ts: String(r.ts), subject: String(r.subject ?? ""), p: JSON.parse(String(r.payload_json)) as Row }));
const AGENT = { sourcing: "Operations agent", support: "Sales agent", treasury: "Finance agent" } as Record<string, string>;

export function railsView(db: DB): RailsView {
  const airwallex: RailItem[] = [];
  const metal: RailItem[] = [];

  // Airwallex Issuing: the cards, and Airwallex's own approve or decline on each charge.
  const issued = events(db, "card.issued");
  if (issued.length) {
    airwallex.push({ what: "A company card per agent (Issuing)", detail: `${issued.length} virtual Visa cards; each card's limits, merchant categories and currency sit on the card at Airwallex`, proof: { label: issued.map((c) => `•••• ${String(c.p.last4)}`).join(" · "), href: null } });
  }
  if (has(db, "card_transactions")) {
    const ok = all(db, "SELECT transaction_id, amount_cents, merchant FROM card_transactions WHERE approved = 1 ORDER BY occurred_at");
    const no = all(db, "SELECT transaction_id, amount_cents, merchant, failure_reason FROM card_transactions WHERE approved = 0 ORDER BY occurred_at");
    if (ok.length) airwallex.push({ what: "Approved by Airwallex", detail: `${ok.length} charge${ok.length > 1 ? "s" : ""}, €${fromCents(ok.reduce((s, r) => s + Number(r.amount_cents), 0))} in all, inside the card's limits`, proof: awxId(ok[0]!.transaction_id), simulated: true });
    if (no.length) {
      const why = [...new Set(no.map((r) => String(r.failure_reason ?? "declined")))].join(", ");
      airwallex.push({ what: "Declined by Airwallex", detail: `${no.length} charge${no.length > 1 ? "s" : ""} the card refused itself (${why}); the agent could not spend past it`, proof: awxId(no[0]!.transaction_id), simulated: true });
    }
  }
  // FX and SWIFT: the conversion on the locked quote and the payout, both carrying the approval hash.
  if (has(db, "fx_conversions")) {
    for (const c of all(db, "SELECT conversion_id, buy_amount, sell_amount, status FROM fx_conversions")) {
      airwallex.push({ what: "FX conversion on a locked quote", detail: `USD ${c.sell_amount} → EUR ${c.buy_amount}, only the shortfall, ${String(c.status)}`, proof: awxId(c.conversion_id) });
    }
  }
  if (has(db, "transfers")) {
    for (const t of all(db, "SELECT transfer_id, amount, currency, status, fee_actual, invoice_no FROM transfers WHERE transfer_id IS NOT NULL")) {
      airwallex.push({ what: "SWIFT payout of an invoice", detail: `${String(t.currency)} ${t.amount} to the allowlisted supplier, ${String(t.status)}${t.fee_actual ? `, fee ${t.fee_actual}` : ""}; the approval hash is in the transfer's metadata`, proof: awxId(t.transfer_id), simulated: t.status === "PAID" });
    }
  }
  for (const d of events(db, "credit.deposited")) {
    airwallex.push({ what: "Earnings credited from Metal", detail: `USD ${String(d.p.amount)} booked once, referenced by the sweep's transaction (1 test USD = 1 USD)`, proof: awxId(d.p.deposit_id), simulated: true });
  }

  // Metal: the mandates, the payments under them, and the chain's own refusals.
  const bound = events(db, "mandate.bound").filter((m) => m.subject in AGENT);
  if (bound.length) {
    // As each agent's mandate stands now: the last bind or replacement.
    const now = [...bound, ...events(db, "mandate.replaced").filter((m) => m.subject in AGENT)].reduce((m, e) => m.set(e.subject, e), new Map<string, (typeof bound)[number]>());
    metal.push({ what: "A mandate per agent, on chain", detail: [...now.values()].map((m) => `${AGENT[m.subject]}: ${String(m.p.cap)} a payment, ${String(m.p.budget)} in total, one payee`).join("; "), proof: tx(bound[0]!.p.tx) });
  }
  if (has(db, "sales")) {
    const s = one(db, "SELECT COUNT(*) AS n, MIN(CASE WHEN tx_hash IS NOT NULL THEN tx_hash END) AS first FROM sales WHERE status = 'DELIVERED' AND scheme = 'exact'");
    if (s && Number(s.n) > 0) {
      const firstTx = one(db, "SELECT tx_hash FROM sales WHERE status = 'DELIVERED' AND tx_hash IS NOT NULL ORDER BY sale_id LIMIT 1");
      metal.push({ what: "Paid per request (x402), with a signed order", detail: `${String(s.n)} stock checks sold, each paid under the customer's mandate and settled by Metal's facilitator`, proof: tx(firstTx?.tx_hash) });
    }
  }
  if (has(db, "upstream_purchases")) {
    const n = one(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'");
    const first = one(db, "SELECT tx_hash FROM upstream_purchases WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY created_at LIMIT 1");
    if (n && Number(n.n) > 0) metal.push({ what: "The agent buys from its supplier", detail: `${String(n.n)} purchases, each under the Operations agent's mandate`, proof: tx(first?.tx_hash) });
  }
  const refused = events(db, "upstream.refused");
  if (refused.length) {
    metal.push({ what: "Refused by the chain", detail: `${refused.length} payment${refused.length > 1 ? "s" : ""} over the mandate's cap (${String(refused[0]!.p.reason)}): nothing moved, the agent asked the CFO`, proof: null });
  }
  const replaced = events(db, "mandate.replaced");
  if (replaced.length) metal.push({ what: "Mandate replaced after Face ID", detail: `${replaced.length} replacement${replaced.length > 1 ? "s" : ""} approved by the CFO's passkey; the old mandate is revoked on chain`, proof: tx(replaced[0]!.p.tx) });
  if (has(db, "refunds")) {
    const n = one(db, "SELECT COUNT(*) AS n, SUM(amount_cents) AS c FROM refunds WHERE outcome = 'PAID'");
    const first = one(db, "SELECT tx_hash FROM refunds WHERE outcome = 'PAID' AND tx_hash IS NOT NULL ORDER BY sale_id LIMIT 1");
    if (n && Number(n.n) > 0) metal.push({ what: "Refunds as mandate pulls", detail: `${String(n.n)} refund${Number(n.n) > 1 ? "s" : ""}, ${fromCents(Number(n.c))} test USD, back to the paying account only, each under its own payment id`, proof: tx(first?.tx_hash) });
  }
  const sweep = events(db, "credit.locked")[0];
  if (sweep) metal.push({ what: "Sweep, after finality", detail: `earnings moved once their block (${String(sweep.p.block)}) was finalized (${String(sweep.p.finalized_block)}); booked at Airwallex exactly once`, proof: tx(sweep.p.tx) });
  if (has(db, "clearing_ops")) {
    const c = one(db, "SELECT COUNT(*) AS n FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'");
    if (c && Number(c.n) > 0) metal.push({ what: "Pay-per-call clearing", detail: `${String(c.n)} sales paid by signed receipts from one deposit, no transaction each`, proof: null });
  }
  if (has(db, "quarantines")) {
    const q = one(db, "SELECT COUNT(*) AS n FROM quarantines");
    if (q && Number(q.n) > 0) metal.push({ what: "Receive policy: money from strangers held", detail: `${String(q.n)} payment${Number(q.n) > 1 ? "s" : ""} from unknown senders held by Metal until the CFO returns or accepts them with Face ID`, proof: null });
  }
  const decided = events(db, "dispute.decided");
  if (decided.length) {
    const opened = events(db, "dispute.opened")[0];
    // The opened case lists its sales as "5,6,7": count them, never the characters.
    const sales = opened && typeof opened.p.sales === "string" ? opened.p.sales.split(",").filter(Boolean).length : 0;
    const orders = sales ? String(sales) : "";
    metal.push({ what: "Dispute desk, decided from the chain", detail: `${decided.length} case${decided.length > 1 ? "s" : ""}${orders ? ` (${orders} orders)` : ""}: each payment checked against the customer's mandate and its signed order; refund ${String(decided[0]!.p.refund)} test USD`, proof: null });
  }
  return { airwallex, metal };
}
