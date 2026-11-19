// Booked journal entries and contacts to an accounting system (docs/integrations/workplace.md, "Accounting"), in the
// shape of Purser's ERP connectors (src/erp/connector.ts): the same canonical model (src/erp/model.ts), the same
// transport, token provider, errors and push steps. BooksPush is the part of ErpConnector this needs: Exact Online's
// and Moneybird's connectors (src/erp/exact.ts, src/erp/moneybird.ts) already have it, and Xero's (./xero.ts) is new.
//
// What goes is what Purser has booked: a supplier as a contact, and the payables journal (an invoice's accrual, its
// payment) as balanced journal entries. Pushing to the books moves no money and approves nothing; the books receive
// what the CFO's passkey already decided.

import type { ApEntry } from "../ap/books.js";
import { ErpError, redactUrl, type PushProgress, type RefResolver } from "../erp/connector.js";
import { validateJournal, validateVendor, type JournalEntry, type ObjectKind, type PurchaseInvoice, type Payment, type Vendor } from "../erp/model.js";
import { toCents } from "../lib/money.js";

export interface BooksPush {
  readonly name: string;
  pushVendor(v: Vendor, progress?: PushProgress): Promise<string>;
  pushJournalEntry(j: JournalEntry, progress?: PushProgress): Promise<string>;
  /** The system's id for an object Purser may already have sent (a lost answer), or null. */
  findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null>;
}

export interface PushOutcome { kind: "vendor" | "journal"; id: string; outcome: "pushed" | "found_existing" | "invalid" | "failed"; externalId?: string; detail?: string }

/** An entry's side as the journal writes it: two decimals, or empty for none. */
const cents = (s: string) => (s === "" ? 0 : toCents(s));

const NO_REFS: RefResolver = { vendor: () => null, invoice: () => null };

/**
 * Each contact, then each journal entry: checked against the model first, looked for (so a second run or a lost answer
 * never makes a second one), then sent. One failure never stops the others; each outcome says what happened.
 */
export async function pushBooked(c: BooksPush, items: { vendors?: Vendor[]; journals?: JournalEntry[] }): Promise<PushOutcome[]> {
  const out: PushOutcome[] = [];
  const one = async (kind: "vendor" | "journal", o: Vendor | JournalEntry, problems: string[], push: () => Promise<string>) => {
    if (problems.length) { out.push({ kind, id: o.id, outcome: "invalid", detail: problems.join("; ") }); return; }
    try {
      const found = await c.findExisting(kind, o, NO_REFS);
      if (found) { out.push({ kind, id: o.id, outcome: "found_existing", externalId: found }); return; }
      out.push({ kind, id: o.id, outcome: "pushed", externalId: await push() });
    } catch (e) {
      out.push({ kind, id: o.id, outcome: "failed", detail: redactUrl(e instanceof ErpError ? `${e.kind}: ${e.message}` : (e as Error).message).slice(0, 500) });
    }
  };
  for (const v of items.vendors ?? []) await one("vendor", v, validateVendor(v), () => c.pushVendor(v));
  for (const j of items.journals ?? []) await one("journal", j, validateJournal(j), () => c.pushJournalEntry(j));
  return out;
}

/**
 * The payables journal (src/ap/books.ts, apJournal) as journal entries: one per invoice, event and date, its lines in
 * whole cents. The id names them (AP-0004 accrual 2026-11-02), so the same booking always has the same id.
 */
export function journalsFromApEntries(entries: ApEntry[]): JournalEntry[] {
  const groups = new Map<string, ApEntry[]>();
  for (const e of entries) {
    const k = `${e.invoice_id}|${e.event}|${e.date}|${e.currency}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].map((g) => {
    const f = g[0]!;
    return {
      id: `${f.invoice_id}-${f.event}-${f.date}`,
      date: f.date,
      currency: f.currency,
      memo: f.memo.slice(0, 200),
      sourceRef: f.doc_sha256 || f.invoice_id,
      lines: g.filter((e) => cents(e.debit) > 0 || cents(e.credit) > 0).map((e) => ({
        glAccount: e.account, debitCents: cents(e.debit), creditCents: cents(e.credit), description: `${e.account_name}: ${e.memo}`.slice(0, 200),
        ...(e.cost_centre ? { costCentre: e.cost_centre } : {}),
      })),
    };
  });
}
