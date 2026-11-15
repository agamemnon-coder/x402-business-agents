// The agents' live sandbox cards (14 Nov): the contract between Purser Cloud and the kit11 Worker's AwxCards entrypoint.
// Both Workers import this file. Pure: no I/O, no Node modules.
//
//   AWX_CARDS_ALLOW   every call the card gateway may make at Airwallex: method and path, nothing else. Reads, the three
//                     writes Max allowed (create a card, set its status, set its limits), the cardholder a new card needs,
//                     and the sandbox's own purchase simulation (to show a decline). Anything else is refused before fetch.
//   cardCallCheck     the one check of a call: on the list, a plain path, and for a write the exact body shape
//   safeCard, safeTx  what may leave the kit11 Worker: the last four digits only. Never the full card number, never a
//                     CVV, never the cardholder. Everything else Airwallex sends is dropped here.
//
// Sandbox only, test money only. The kit11 side talks to https://api.sandbox.airwallex.com and nothing else.

/** What a call does. */
export type CardCallKind = "read" | "write" | "sim";

export interface CardRule { method: "GET" | "POST"; path: RegExp; kind: CardCallKind; name: string }

const ID = "[A-Za-z0-9_-]{1,64}";
const p = (s: string) => new RegExp(`^${s.replace(/\{id\}/g, ID)}$`);

/** Every call the card gateway may make, under /api/v1. */
export const AWX_CARDS_ALLOW: readonly CardRule[] = [
  { method: "GET", path: p("/issuing/cards"), kind: "read", name: "cards" },
  { method: "GET", path: p("/issuing/cards/{id}"), kind: "read", name: "one card" },
  { method: "GET", path: p("/issuing/transactions"), kind: "read", name: "card transactions" },
  { method: "GET", path: p("/issuing/cardholders"), kind: "read", name: "cardholders" },
  { method: "POST", path: p("/issuing/cardholders/create"), kind: "write", name: "cardholder (for a new card only)" },
  { method: "POST", path: p("/issuing/cards/create"), kind: "write", name: "create card" },
  { method: "POST", path: p("/issuing/cards/{id}/update"), kind: "write", name: "card status or limits" },
  { method: "POST", path: p("/simulation/issuing/create"), kind: "sim", name: "purchase (sandbox simulation)" },
];

/** The only host: the sandbox. */
export const CARDS_SANDBOX_BASE = "https://api.sandbox.airwallex.com/api/v1";
/** The query keys a read may carry. */
const QUERY_KEYS = new Set(["page_num", "page_size", "card_id", "cardholder_id"]);
const QUERY_VALUE = /^[A-Za-z0-9_-]{1,64}$/;

/** Ceilings on what a card may be set to, whatever the policy says: test money, small amounts. */
export const CARD_MAX_PER_TX_EUR = 500;
export const CARD_MAX_MONTHLY_EUR = 2000;
/** The most a simulated purchase may be. */
export const SIM_MAX_EUR = 600;

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v as J : null);
const keysAre = (o: J, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);
// Whole cents only, to a rounding hair: 19.99 or 30.01 times 100 is not an exact integer in floating point.
const amountOk = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/** The transaction limits a write may carry: EUR, one per purchase and one a month, within the ceilings. */
function limitsOk(tl: unknown): boolean {
  const o = obj(tl);
  if (!o || o.currency !== "EUR" || !Array.isArray(o.limits) || o.limits.length !== 2) return false;
  const by = new Map<string, unknown>();
  for (const l of o.limits) { const x = obj(l); if (!x || !keysAre(x, ["amount", "interval"])) return false; by.set(String(x.interval), x.amount); }
  return amountOk(by.get("PER_TRANSACTION"), CARD_MAX_PER_TX_EUR) && amountOk(by.get("MONTHLY"), CARD_MAX_MONTHLY_EUR);
}

/** The rule for a call, or why it is refused. */
export function cardCallCheck(method: string, path: string, body?: unknown, query?: Record<string, string>): { rule: CardRule } | { refused: string } {
  if ((method !== "GET" && method !== "POST") || typeof path !== "string") return { refused: "not a call" };
  if (path.length > 160 || /[?#\s%]|\.\./.test(path)) return { refused: "not a plain path" };
  const rule = AWX_CARDS_ALLOW.find((a) => a.method === method && a.path.test(path));
  if (!rule) return { refused: `${method} ${path.replace(/[A-Za-z0-9_-]{20,}/g, "{id}")} is not on the card allow-list` };
  for (const [k, v] of Object.entries(query ?? {})) if (!QUERY_KEYS.has(k) || typeof v !== "string" || !QUERY_VALUE.test(v)) return { refused: "a query value is not plain" };
  if (method === "GET") return body === undefined ? { rule } : { refused: "a read carries no body" };
  const b = obj(body);
  if (!b) return { refused: "a write needs a JSON body" };
  if (path === "/issuing/cards/create") {
    const ac = obj(b.authorization_controls);
    if (typeof b.request_id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(b.request_id)) return { refused: "a new card needs its request_id" };
    if (b.form_factor !== "VIRTUAL") return { refused: "only a virtual card" };
    if (!ac || !limitsOk(ac.transaction_limits)) return { refused: "a new card needs EUR limits within the ceilings" };
    return { rule };
  }
  if (/^\/issuing\/cards\/[^/]+\/update$/.test(path)) {
    // Exactly one of two shapes: the status alone, or the limits alone. Nothing else about a card changes here.
    if (keysAre(b, ["card_status"])) return b.card_status === "ACTIVE" || b.card_status === "INACTIVE" ? { rule } : { refused: "a status is ACTIVE or INACTIVE" };
    const ac = obj(b.authorization_controls);
    const tl = obj(ac?.transaction_limits);
    if (keysAre(b, ["authorization_controls"]) && ac && keysAre(ac, ["transaction_limits"]) && tl) {
      const { cash_withdrawal_limits: cw, ...rest } = tl;
      if ((cw === undefined || (Array.isArray(cw) && cw.length === 0)) && limitsOk(rest)) return { rule };
    }
    return { refused: "an update sets the status or the limits, nothing else" };
  }
  if (path === "/simulation/issuing/create") {
    if (!keysAre(b, ["card_id", "transaction_amount", "transaction_currency", "merchant_category_code", "merchant_info"])) return { refused: "a simulated purchase has a fixed shape" };
    if (b.transaction_currency !== "EUR" || !amountOk(b.transaction_amount, SIM_MAX_EUR) || typeof b.merchant_category_code !== "string" || !/^\d{4}$/.test(b.merchant_category_code)) return { refused: "a simulated purchase is in EUR, small, with a merchant category" };
    return { rule };
  }
  if (path === "/issuing/cardholders/create") return b.type === "DELEGATE" ? { rule } : { refused: "only a delegate cardholder (an agent)" };
  return { refused: "not a known write" };
}

// --- What may leave the kit11 Worker -----------------------------------------------------------------------------------

/** A card as Purser Cloud gets it: the last four digits only; its id (the Cloud needs it to act); its status and limits. */
export interface SafeCard {
  card_id: string;
  last4: string | null;
  status: string;
  nickname: string | null;
  brand: string | null;
  limits: { currency: "EUR"; per_tx_cents: number; monthly_cents: number } | null;
  created_at: string | null;
}

/** One authorization or transaction on a card: no card number, no cardholder. */
export interface SafeTx {
  id: string;
  card_id: string;
  at: string;
  amount_cents: number;
  currency: string;
  status: string;
  approved: boolean;
  failure_reason: string | null;
  merchant: string | null;
  mcc: string | null;
  type: string | null;
}

const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const centsOf = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d{1,12}(\.\d{1,4})?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : null;
};
/** The last four digits of a masked or full number; nothing else of it is ever kept. */
export const last4Of = (v: unknown): string | null => {
  const d = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return d.length >= 4 ? d.slice(-4) : null;
};

export function safeCard(raw: unknown): SafeCard | null {
  const c = obj(raw);
  const id = str(c?.card_id, 64) ?? str(c?.id, 64);
  if (!c || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const tl = obj(obj(c.authorization_controls)?.transaction_limits);
  const lim = Array.isArray(tl?.limits) ? (tl.limits as unknown[]).map(obj) : [];
  const per = lim.find((l) => l?.interval === "PER_TRANSACTION"), mon = lim.find((l) => l?.interval === "MONTHLY");
  const perC = centsOf(per?.amount), monC = centsOf(mon?.amount);
  return {
    card_id: id, last4: last4Of(c.card_number), status: str(c.card_status, 20) ?? str(c.status, 20) ?? "UNKNOWN",
    nickname: str(c.nick_name), brand: str(c.brand, 20),
    limits: tl?.currency === "EUR" && perC !== null && monC !== null ? { currency: "EUR", per_tx_cents: perC, monthly_cents: monC } : null,
    created_at: str(c.created_at, 40),
  };
}

const DECLINED = new Set(["FAILED", "DECLINED", "REVERSED", "EXPIRED"]);

export function safeTx(raw: unknown): SafeTx | null {
  const t = obj(raw);
  if (!t) return null;
  const id = str(obj(t.card_transaction_data)?.card_transaction_id, 64) ?? str(t.card_transaction_id, 64) ?? str(t.transaction_id, 64) ?? str(t.id, 64);
  const card = str(t.card_id, 64);
  const at = str(t.transaction_date, 40) ?? str(t.transacted_at, 40) ?? str(t.created_at, 40);
  const amount = centsOf(t.transaction_amount) ?? centsOf(t.billing_amount);
  const currency = str(t.transaction_currency, 3) ?? str(t.billing_currency, 3);
  const failure = str(t.failure_reason, 80);
  const status = str(t.status, 40) ?? str(t.process_result, 40) ?? (failure ? "DECLINED" : "APPROVED");
  if (!id || !card || !at || amount === null || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const m = obj(t.merchant);
  return {
    id, card_id: card, at, amount_cents: amount, currency, status, approved: !DECLINED.has(status), failure_reason: failure,
    merchant: (str(m?.name) ?? "").replace(/_+$/, "").trim() || null, mcc: str(m?.category_code, 4), type: str(t.transaction_type, 40) ?? str(t.type, 40),
  };
}

// --- The entrypoint's one method: what the Cloud asks, and what it gets ------------------------------------------------

/** A write carries the hash of the action the CFO signed with their passkey (the Cloud checked the signature). */
type Signed = { action_sha256: string };
export type CardsAsk =
  | { op: "scope" }
  | { op: "card"; card_id: string }
  | { op: "list" }
  | { op: "transactions"; card_id: string }
  | ({ op: "create"; holder: { email: string; first_name: string; last_name: string }; nickname: string; created_by: string; limits: { per_tx_cents: number; monthly_cents: number }; mccs: string[]; active_days: number } & Signed)
  | ({ op: "status"; card_id: string; status: "ACTIVE" | "INACTIVE" } & Signed)
  /** Freeze several cards in one call (older test cards): updates only, no read-back; at most FREEZE_MANY_MAX. */
  | ({ op: "freeze_many"; card_ids: string[] } & Signed)
  | ({ op: "limits"; card_id: string; limits: { per_tx_cents: number; monthly_cents: number } } & Signed)
  | ({ op: "simulate"; card_id: string; amount_cents: number; merchant: string; mcc: string } & Signed);

/** Why the gateway did not answer with data: fixed words and codes; Airwallex's code and trace id only, never its words. */
export type CardsRefusal = { ok: false; code: "no_key" | "writes_off" | "refused" | "forbidden" | "not_found" | "airwallex" | "no_answer"; reason: string; status?: number; awx_code?: string | null; trace_id?: string | null };
export type CardsAnswer =
  | { ok: true; op: "scope"; issuing: "ok" }
  | { ok: true; op: "card" | "create" | "status" | "limits"; card: SafeCard }
  | { ok: true; op: "transactions"; items: SafeTx[] }
  /** Every agent card (by nickname) the sandbox lists, with its limits; cut: more pages than were read. */
  | { ok: true; op: "list"; cards: SafeCard[]; cut: boolean }
  | { ok: true; op: "simulate"; tx: SafeTx }
  | { ok: true; op: "freeze_many"; frozen: { card_id_last4: string; ok: boolean; reason: string | null }[] }
  | CardsRefusal;

/** What the Cloud holds: the service binding's named entrypoint. */
export interface CardsPort { ask(a: CardsAsk): Promise<CardsAnswer> }

export const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Cards frozen in one freeze_many call: one login and this many updates stay well under a Worker's subrequest limit. */
export const FREEZE_MANY_MAX = 40;
export const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;
