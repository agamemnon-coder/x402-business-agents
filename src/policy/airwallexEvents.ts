// Airwallex webhooks for every object Purser uses (awards item 5). The runner has already checked the HMAC with its
// own copy of the secret (cardHooks.ts); here each event is recorded once and checked against the ledger:
// - a card's status against what the CFO policy wants (live at Airwallex while frozen here is a disagreement);
// - a payout or a conversion against the ones Purser made (one it did not make is a disagreement);
// - a settled deposit into one of Northwind's Global Accounts goes to the receivables agent, which books it once.
// A webhook only ever records what Airwallex reports; it cannot approve, pay, thaw or change a limit. Disagreements
// stand as an alarm in /health for a day (src/ops/health.ts); the hourly reconciliation stays the backstop.

import type { DB } from "../db/open.js";
import { audit } from "../audit/log.js";
import { matchReceipt } from "../agents/receivables.js";
import { fromCents, toCents } from "../lib/money.js";
import { CARD_EVENTS } from "../airwallex/webhooks.js";
import { wantCardStatus } from "./cards.js";

export type EventObject = "card_transaction" | "card" | "transfer" | "conversion" | "deposit" | "other";

/** Every event Purser subscribes to: card transactions, cards, payouts, conversions and deposits. */
export const ALL_EVENTS = [
  ...CARD_EVENTS,
  "issuing.card.active", "issuing.card.inactive", "issuing.card.closed", "issuing.card.blocked", "issuing.card.lost", "issuing.card.stolen",
  "payout.transfer.scheduled", "payout.transfer.processing", "payout.transfer.sent", "payout.transfer.paid", "payout.transfer.failed", "payout.transfer.cancelled",
  "conversion.scheduled", "conversion.overdue", "conversion.settled", "conversion.cancelled",
  "deposit.pending", "deposit.settled", "deposit.rejected", "deposit.reversed",
];

/** Where the receivables agent keeps Northwind's Global Account ids, so a deposit webhook can be matched. */
const GA_KEY = "receivables.global_accounts";

export function setKnownGlobalAccounts(db: DB, ids: string[], now = new Date()): void {
  const value = [...new Set(ids)].sort().join(",");
  const before = (db.prepare("SELECT value FROM settings WHERE key = ?").get(GA_KEY) as { value: string } | undefined)?.value;
  if (before === value) return;
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(GA_KEY, value, now.toISOString());
  audit(db, "treasury", "setting.changed", GA_KEY, { before: before ?? null, after: value }, now);
}
const knownGlobalAccounts = (db: DB) => new Set(((db.prepare("SELECT value FROM settings WHERE key = ?").get(GA_KEY) as { value: string } | undefined)?.value ?? "").split(",").filter(Boolean));

export function objectOf(name: string): EventObject {
  if (name.startsWith("issuing.card_transaction") || name.startsWith("issuing.transaction.")) return "card_transaction";
  if (name.startsWith("issuing.card.")) return "card";
  if (name.startsWith("payout.transfer.")) return "transfer";
  if (name.startsWith("conversion.")) return "conversion";
  if (name.startsWith("deposit.")) return "deposit";
  return "other";
}

export interface Checked {
  object: EventObject;
  object_id: string | null;
  status: string | null;
  amount_cents: number | null;
  currency: string | null;
  /** True: the ledger agrees; false: it cannot explain this; null: nothing to compare. */
  agrees: boolean | null;
  outcome: string;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const cents = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && x > 0 ? toCents(x.toFixed(2)) : null;
};
/** The status the event names: the object's own, else the event name's last part (payout.transfer.paid → PAID). */
const statusOf = (name: string, o: Record<string, unknown>) => (str(o.card_status) ?? str(o.status) ?? name.split(".").pop() ?? "").toUpperCase() || null;

// A payout that went one way at Airwallex and the other way in the ledger. Earlier statuses arriving late are fine.
const PAID_LIKE = new Set(["SENT", "PAID"]);
const FAILED_LIKE = new Set(["FAILED", "CANCELLED"]);

/** Checks one event (not a card transaction) against the ledger. Never throws; never changes money. */
export function checkEvent(db: DB, name: string, o: Record<string, unknown>, now = new Date()): Checked {
  const object = objectOf(name);
  const status = statusOf(name, o);
  if (object === "card") {
    const id = str(o.card_id) ?? str(o.id);
    const card = id ? (db.prepare("SELECT agent FROM cards WHERE card_id = ?").get(id) as { agent: string } | undefined) : undefined;
    if (!card) return { object, object_id: id, status, amount_cents: null, currency: null, agrees: false, outcome: `card ${id ?? "?"} is ${status}: not one of Purser's cards` };
    const want = wantCardStatus(db, card.agent);
    // Stricter than the policy (frozen, closed, blocked) is never a risk; live while the policy has it frozen is.
    if (status === "ACTIVE" && want !== "ACTIVE") {
      return { object, object_id: id, status, amount_cents: null, currency: null, agrees: false, outcome: `${card.agent}'s card is live at Airwallex while the policy has it frozen; the next sync freezes it again` };
    }
    return { object, object_id: id, status, amount_cents: null, currency: null, agrees: true, outcome: `${card.agent}'s card is ${status} at Airwallex, which matches the policy (${want})` };
  }
  if (object === "transfer") {
    const id = str(o.id) ?? str(o.transfer_id);
    const amount = cents(o.transfer_amount ?? o.amount);
    const currency = str(o.transfer_currency) ?? str(o.currency);
    const t = id ? (db.prepare("SELECT invoice_no, status FROM transfers WHERE transfer_id = ?").get(id) as { invoice_no: string; status: string } | undefined) : undefined;
    if (!t) return { object, object_id: id, status, amount_cents: amount, currency, agrees: false, outcome: `payout ${id ?? "?"} ${status}: a payout Purser did not make` };
    const conflict = (PAID_LIKE.has(status ?? "") && FAILED_LIKE.has(t.status)) || (FAILED_LIKE.has(status ?? "") && t.status === "PAID");
    return conflict
      ? { object, object_id: id, status, amount_cents: amount, currency, agrees: false, outcome: `payout for ${t.invoice_no} is ${status} at Airwallex, which differs from the ledger (${t.status})` }
      : { object, object_id: id, status, amount_cents: amount, currency, agrees: true, outcome: `payout for ${t.invoice_no} is ${status} at Airwallex, which matches the ledger (${t.status})` };
  }
  if (object === "conversion") {
    const id = str(o.conversion_id) ?? str(o.id);
    const amount = cents(o.buy_amount);
    const currency = str(o.buy_currency);
    const c = id ? (db.prepare("SELECT status FROM fx_conversions WHERE conversion_id = ?").get(id) as { status: string } | undefined) : undefined;
    if (!c) return { object, object_id: id, status, amount_cents: amount, currency, agrees: false, outcome: `conversion ${id ?? "?"} ${status}: a conversion Purser did not make` };
    const conflict = status === "CANCELLED" && c.status === "SETTLED";
    return { object, object_id: id, status, amount_cents: amount, currency, agrees: !conflict, outcome: `conversion is ${status} at Airwallex, which ${conflict ? "differs from" : "matches"} the ledger (${c.status})` };
  }
  if (object === "deposit") {
    const id = str(o.id);
    const amount = cents(o.amount);
    const currency = str(o.currency);
    const ga = str(o.global_account_id);
    const payer = str((o.payer as Record<string, unknown> | undefined)?.name) ?? str(o.payer_name);
    // Only a settled deposit into one of Northwind's Global Accounts is booked; the poll stays the backup.
    if (!id || status !== "SETTLED" || !ga || !knownGlobalAccounts(db).has(ga) || !amount || !currency || !["EUR", "GBP"].includes(currency)) {
      return { object, object_id: id, status, amount_cents: amount, currency, agrees: null, outcome: `deposit ${status}${amount ? ` ${fromCents(amount)} ${currency}` : ""}: recorded; not matched (only settled EUR or GBP deposits into Northwind's Global Accounts are)` };
    }
    const m = matchReceipt(db, { deposit_id: id, global_account_id: ga, currency, amount_cents: amount, reference: str(o.reference), payer, received_at: str(o.created_at) ?? now.toISOString() }, now, "webhook");
    return { object, object_id: id, status, amount_cents: amount, currency, agrees: null, outcome: `deposit ${fromCents(amount)} ${currency}: ${m.outcome}, ${m.detail}` };
  }
  return { object, object_id: str(o.id), status, amount_cents: null, currency: null, agrees: null, outcome: "not an object Purser acts on; recorded" };
}

/** Records one event once by its Airwallex event id. Returns false if it was recorded before. */
export function recordEvent(db: DB, eventId: string, name: string, c: Checked, now = new Date()): boolean {
  const r = db.prepare(
    "INSERT INTO airwallex_events (event_id, name, object, object_id, status, amount_cents, currency, agrees, outcome, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING",
  ).run(eventId, name, c.object, c.object_id, c.status, c.amount_cents, c.currency, c.agrees === null ? null : c.agrees ? 1 : 0, c.outcome, now.toISOString());
  if (r.changes && c.agrees === false) audit(db, "system", "airwallex.disagrees", c.object_id, { event: name, object: c.object, outcome: c.outcome }, now);
  return r.changes > 0;
}

export const seenEvent = (db: DB, eventId: string) => !!db.prepare("SELECT 1 FROM airwallex_events WHERE event_id = ?").get(eventId);

const LABEL: Record<EventObject, string> = { card_transaction: "Card transactions", card: "Cards", transfer: "Payouts", conversion: "Conversions", deposit: "Deposits", other: "Other" };

export interface AirwallexEventsView {
  total: number;
  disagree: number;
  by_object: { object: EventObject; label: string; n: number; disagree: number; last_at: string }[];
  recent: { name: string; object: EventObject; object_id: string | null; status: string | null; amount: string | null; currency: string | null; agrees: boolean | null; outcome: string; received_at: string }[];
}

/** The events for the dashboard: per object, and the latest ones with disagreements first. */
export function airwallexEventsView(db: DB, limit = 12): AirwallexEventsView {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'airwallex_events'").get()) return { total: 0, disagree: 0, by_object: [], recent: [] };
  const by = db.prepare("SELECT object, COUNT(*) AS n, SUM(CASE WHEN agrees = 0 THEN 1 ELSE 0 END) AS disagree, MAX(received_at) AS last_at FROM airwallex_events GROUP BY object ORDER BY n DESC, object").all() as { object: EventObject; n: number; disagree: number; last_at: string }[];
  const recent = (db.prepare("SELECT name, object, object_id, status, amount_cents, currency, agrees, outcome, received_at FROM airwallex_events ORDER BY (agrees = 0) DESC, received_at DESC, rowid DESC LIMIT ?").all(limit) as
    { name: string; object: EventObject; object_id: string | null; status: string | null; amount_cents: number | null; currency: string | null; agrees: number | null; outcome: string; received_at: string }[])
    .map((r) => ({ name: r.name, object: r.object, object_id: r.object_id, status: r.status, amount: r.amount_cents === null ? null : fromCents(r.amount_cents), currency: r.currency, agrees: r.agrees === null ? null : r.agrees === 1, outcome: r.outcome, received_at: r.received_at }));
  return {
    total: by.reduce((a, b) => a + b.n, 0),
    disagree: by.reduce((a, b) => a + b.disagree, 0),
    by_object: by.map((b) => ({ ...b, label: LABEL[b.object] })),
    recent,
  };
}
