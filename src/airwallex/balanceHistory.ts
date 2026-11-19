// Airwallex's wallet statement, line by line: GET /api/v1/balances/history (docs: api/core_resources/balances, "Retrieve
// the Balance History", read 19 November 2026). Each line is one change to a currency's cash balance, with the balance
// after it (`balance`), the change (`amount`), its source (`source`, `source_type`) and when it was posted (`posted_at`).
// Query: from_post_at / to_post_at (ISO 8601), currency, page_size, and the cursor `page` (an answer's page_after).
//
// Purser reads it and checks two things, in integer cents, reading only (it never moves or changes anything):
//   1. the statement is continuous: within a currency, each line's balance is the previous line's balance plus its
//      effect (a statement whose lines do not add up is reported, line by line, never smoothed). Read live on 19
//      November (docs/runs/2026-11-19-airwallex-deep-2.json): a conversion's HOLD line carries +amount while the balance
//      falls by it, and its HOLD_RELEASE carries -amount while the balance rises by it; their effect is the amount
//      negated (HOLD_SIGN_INVERTED). Every other line's effect is its amount;
//   2. each payout and conversion in Purser's record is on the statement, under its own Airwallex id, for exactly the
//      amount Purser recorded and with the sign money leaving (a payout) or coming in (a deposit, a bought currency).

import type { Airwallex } from "./client.js";
import { signedCents } from "../finance/awxReconcile.js";
import { fromCents } from "../lib/money.js";

export interface BalanceLine {
  id: string;
  currency: string;
  /** The change, signed: negative when money left. */
  amountCents: number;
  /** The currency's balance after this line. */
  balanceCents: number;
  feeCents: number;
  source: string | null;
  sourceType: string;
  transactionType: string;
  postedAt: string;
  description: string;
}

export interface RawBalanceLine { id?: string; currency?: string; amount?: number | string; balance?: number | string; fee?: number | string | null; source?: string | null; source_type?: string; transaction_type?: string | null; posted_at?: string; description?: string | null; account_type?: string }

export function toBalanceLine(r: RawBalanceLine): BalanceLine {
  return {
    id: r.id ?? "", currency: (r.currency ?? "").toUpperCase(), amountCents: signedCents(r.amount ?? 0), balanceCents: signedCents(r.balance ?? 0), feeCents: signedCents(r.fee ?? 0),
    source: r.source ?? null, sourceType: r.source_type ?? "", transactionType: r.transaction_type ?? "", postedAt: r.posted_at ?? "", description: (r.description ?? "").slice(0, 120),
  };
}

/** The most pages read in one statement; more means the window is too wide. */
export const MAX_PAGES = 10;
export const PAGE_SIZE = 100;

/** Every statement line posted in [from, to], all pages (cursor paging). A window is required: the whole history is never read. */
export async function listBalanceHistory(api: Pick<Airwallex, "call">, w: { from: string; to: string; currency?: string }): Promise<BalanceLine[]> {
  if (!(Date.parse(w.to) >= Date.parse(w.from))) throw new Error(`a statement window needs from ≤ to; ${w.from} … ${w.to} is not`);
  const out: BalanceLine[] = [];
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of balance history in ${w.from} … ${w.to}; narrow the window`);
    const r = await api.call<{ items?: RawBalanceLine[]; has_more?: boolean; page_after?: string | null }>("GET", "/balances/history", undefined, {
      from_post_at: w.from, to_post_at: w.to, page_size: String(PAGE_SIZE), ...(w.currency ? { currency: w.currency } : {}), ...(cursor ? { page: cursor } : {}),
    });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's balance history came without items");
    out.push(...r.items.map(toBalanceLine));
    if (r.has_more !== true) {
      // A full page that does not say whether more follow may hide lines: nothing is concluded from it.
      if (typeof r.has_more !== "boolean" && r.items.length >= PAGE_SIZE) throw new Error("Airwallex's balance history came as a full page without has_more; nothing is concluded");
      return out;
    }
    if (!r.page_after) throw new Error("Airwallex said more balance history follows but gave no page_after cursor; nothing is concluded");
    cursor = r.page_after;
  }
}

/** Lines whose amount has the opposite sign to their effect on the balance (read live, see the header). */
export const HOLD_SIGN_INVERTED: ReadonlySet<string> = new Set(["HOLD", "HOLD_RELEASE"]);
/** What a line does to its currency's balance. */
export const effectOf = (l: Pick<BalanceLine, "amountCents" | "transactionType">): number => (HOLD_SIGN_INVERTED.has(l.transactionType) ? -l.amountCents : l.amountCents);

export interface ContinuityBreak { currency: string; lineId: string; postedAt: string; expected: string; actual: string }
export interface Continuity { currencies: Record<string, { lines: number; links: number; opening: string; closing: string }>; links: number; breaks: ContinuityBreak[]; holdLines: number }

const money = (cur: string, c: number) => `${cur} ${c < 0 ? "-" : ""}${fromCents(Math.abs(c))}`;

/**
 * Whether the statement adds up: per currency, in posting order, balance(n) = balance(n-1) + effect(n). Lines with the
 * same posting time keep the order that makes them add up when one exists (Airwallex may list them either way round);
 * a link that adds up no way round is a break, reported with what was expected and what Airwallex shows.
 */
export function checkContinuity(lines: readonly BalanceLine[]): Continuity {
  const by = new Map<string, BalanceLine[]>();
  for (const l of lines) by.set(l.currency, [...(by.get(l.currency) ?? []), l]);
  const out: Continuity = { currencies: {}, links: 0, breaks: [], holdLines: lines.filter((l) => HOLD_SIGN_INVERTED.has(l.transactionType)).length };
  for (const [cur, ls] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = chain([...ls].sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt)));
    let links = 0;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!, l = ordered[i]!;
      links++;
      if (prev.balanceCents + effectOf(l) !== l.balanceCents) out.breaks.push({ currency: cur, lineId: l.id, postedAt: l.postedAt, expected: money(cur, prev.balanceCents + effectOf(l)), actual: money(cur, l.balanceCents) });
    }
    const first = ordered[0]!, last = ordered[ordered.length - 1]!;
    out.currencies[cur] = { lines: ordered.length, links, opening: money(cur, first.balanceCents - effectOf(first)), closing: money(cur, last.balanceCents) };
    out.links += links;
  }
  return out;
}

/** Within each run of lines posted at the same time, the order that adds up from the line before, when there is one. */
function chain(sorted: BalanceLine[]): BalanceLine[] {
  const out: BalanceLine[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j]!.postedAt === sorted[i]!.postedAt) j++;
    const group = sorted.slice(i, j);
    let prev = out[out.length - 1];
    while (group.length) {
      const k = prev ? group.findIndex((g) => prev!.balanceCents + effectOf(g) === g.balanceCents) : group.findIndex((g) => !group.some((h) => h !== g && h.balanceCents + effectOf(g) === g.balanceCents));
      const next = group.splice(k >= 0 ? k : 0, 1)[0]!;
      out.push(next);
      prev = next;
    }
    i = j;
  }
  return out;
}

/** One movement in Purser's record, by the Airwallex id of its source. Amounts are positive; `direction` gives the sign. */
export interface RecordedMovement { sourceId: string; label: string; currency: string; amountCents: number; direction: "out" | "in" }
export interface StatementMatch { sourceId: string; label: string; recorded: string; onStatement: string; agrees: boolean; how: string; feeLines: string | null; holdLines: number }

const FEE = (l: BalanceLine) => l.sourceType === "FEE" || l.transactionType === "FEE";

/**
 * Each recorded movement against the statement lines under its source id: it agrees when the lines in its currency
 * that move money (not a fee, not a hold or its release) sum to exactly the recorded amount with the right sign. Fee
 * lines are reported beside it, not folded in; holds are counted (a hold and its release reserve, they do not move).
 */
export function matchStatement(recorded: readonly RecordedMovement[], lines: readonly BalanceLine[]): { checked: number; agree: number; matches: StatementMatch[] } {
  const matches = recorded.map((m): StatementMatch => {
    const under = lines.filter((l) => l.source === m.sourceId && l.currency === m.currency);
    const holds = under.filter((l) => HOLD_SIGN_INVERTED.has(l.transactionType));
    const main = under.filter((l) => !FEE(l) && !HOLD_SIGN_INVERTED.has(l.transactionType)), fees = under.filter(FEE);
    const sum = main.reduce((s, l) => s + l.amountCents, 0);
    const want = m.direction === "out" ? -m.amountCents : m.amountCents;
    const agrees = main.length > 0 && sum === want;
    return {
      sourceId: m.sourceId, label: m.label, recorded: money(m.currency, want), onStatement: main.length ? `${main.length} line(s): ${money(m.currency, sum)}` : "no line under this id",
      agrees, how: !main.length ? "not on the statement in this window" : agrees ? `${main.map((l) => l.transactionType || l.sourceType).join(" + ")} for exactly the recorded amount` : "amounts differ",
      feeLines: fees.length ? `${fees.length} fee line(s): ${money(m.currency, fees.reduce((s, l) => s + l.amountCents, 0))}` : null, holdLines: holds.length,
    };
  });
  return { checked: matches.length, agree: matches.filter((m) => m.agrees).length, matches };
}

/** The soak record's payouts and conversions (docs/runs/2026-11-19-airwallex-soak.json) as recorded movements. */
export function movementsFromSoakRecord(rec: { payments?: { invoice_no: string; amount: string; currency: string; transfer_id: string | null; status_after_execute?: string; conversion?: { conversion_id: string; buy: string; sell: string } | null }[] }, sellCurrency = "USD"): RecordedMovement[] {
  const out: RecordedMovement[] = [];
  const cents = (s: string) => signedCents(s);
  for (const p of rec.payments ?? []) {
    if (p.transfer_id && p.status_after_execute === "PAID") out.push({ sourceId: p.transfer_id, label: `${p.invoice_no} payout`, currency: p.currency, amountCents: cents(p.amount), direction: "out" });
    if (p.conversion) {
      out.push({ sourceId: p.conversion.conversion_id, label: `${p.invoice_no} conversion, bought`, currency: p.currency, amountCents: cents(p.conversion.buy), direction: "in" });
      out.push({ sourceId: p.conversion.conversion_id, label: `${p.invoice_no} conversion, sold`, currency: sellCurrency, amountCents: cents(p.conversion.sell), direction: "out" });
    }
  }
  return out;
}
