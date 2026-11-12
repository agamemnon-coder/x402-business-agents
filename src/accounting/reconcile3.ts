// Purser = T0 = Moneybird (master list 134): one comparison of Purser's ledger with what T0 and Moneybird read back,
// per document and per account, to the cent. The result is computed: every difference names the document or account,
// the field, and each side's amount. "Agree" is true only when at least one thing was compared and no difference was
// found; nothing is assumed equal because it was not read.
//
// This module only compares. Where the three views come from is the caller's business: the console feeds it the
// recorded sandbox checks (src/accounting/recordedChecks.ts), and a live read-back would feed it the same way.

import type { LedgerEntry } from "../ledger/core.js";

export type SystemName = "Purser" | "T0" | "Moneybird";

/** Amounts in whole cents, per field (net, vat, gross, paid, or an account's net debit). */
export type Amounts = Readonly<Record<string, number>>;

/** One system's view: per document (its number), per account (its code), or both. A side that was not read is absent. */
export interface View {
  documents?: ReadonlyMap<string, Amounts>;
  accounts?: ReadonlyMap<string, number>;
}

export interface Difference {
  kind: "document" | "account";
  /** The document number or the account code. */
  key: string;
  field: string;
  /** Each compared system's amount in cents; null where that system does not hold the document or account. */
  amounts: Partial<Record<SystemName, number | null>>;
}

export interface ThreeWay {
  /** The systems compared with Purser: those whose view was given. */
  compared: Exclude<SystemName, "Purser">[];
  documents: number;
  accounts: number;
  differences: Difference[];
  /** True only when something was compared and nothing differs. */
  agree: boolean;
}

function compareMaps(kind: Difference["kind"], purser: ReadonlyMap<string, Amounts> | undefined, others: [Exclude<SystemName, "Purser">, ReadonlyMap<string, Amounts> | undefined][]): { n: number; diffs: Difference[] } {
  const present = others.filter((o): o is [Exclude<SystemName, "Purser">, ReadonlyMap<string, Amounts>] => o[1] !== undefined);
  if (!purser || present.length === 0) return { n: 0, diffs: [] };
  const keys = new Set<string>([...purser.keys(), ...present.flatMap(([, m]) => [...m.keys()])]);
  const diffs: Difference[] = [];
  for (const key of [...keys].sort()) {
    const mine = purser.get(key);
    const fields = new Set<string>([...Object.keys(mine ?? {}), ...present.flatMap(([, m]) => Object.keys(m.get(key) ?? {}))]);
    for (const field of [...fields].sort()) {
      const p = mine ? (mine[field] ?? null) : null;
      const amounts: Difference["amounts"] = { Purser: p };
      let off = false;
      for (const [name, m] of present) {
        const theirs = m.get(key);
        const v = theirs ? (theirs[field] ?? null) : null;
        amounts[name] = v;
        if (v !== p) off = true;
      }
      if (off) diffs.push({ kind, key, field, amounts });
    }
  }
  return { n: keys.size, diffs };
}

const asAmounts = (m: ReadonlyMap<string, number> | undefined): ReadonlyMap<string, Amounts> | undefined =>
  m ? new Map([...m].map(([k, v]) => [k, { net: v }])) : undefined;

/** Compares Purser's view with T0's and Moneybird's, per document and per account. */
export function reconcile3(views: { purser: View; t0?: View; moneybird?: View }): ThreeWay {
  const others: [Exclude<SystemName, "Purser">, View | undefined][] = [["T0", views.t0], ["Moneybird", views.moneybird]];
  const docs = compareMaps("document", views.purser.documents, others.map(([n, v]) => [n, v?.documents]));
  const accts = compareMaps("account", asAmounts(views.purser.accounts), others.map(([n, v]) => [n, asAmounts(v?.accounts)]));
  const compared = others.filter(([, v]) => v !== undefined && (v.documents !== undefined || v.accounts !== undefined)).map(([n]) => n);
  const differences = [...docs.diffs, ...accts.diffs];
  return { compared, documents: docs.n, accounts: accts.n, differences, agree: compared.length > 0 && docs.n + accts.n > 0 && differences.length === 0 };
}

/**
 * Purser's own view from ledger entries: per account (and currency) the net debit in cents, and per supplier document
 * (the doc_ref on its payables lines) the gross owed and the amount paid against it.
 */
export function purserView(entries: readonly LedgerEntry[]): Required<View> {
  const accounts = new Map<string, number>();
  const documents = new Map<string, { gross: number; paid: number }>();
  for (const e of entries) {
    for (const l of e.lines) {
      const key = `${l.account} ${l.currency}`;
      accounts.set(key, (accounts.get(key) ?? 0) + l.debit_cents - l.credit_cents);
      if (l.account === "2100" && l.doc_ref) {
        const d = documents.get(l.doc_ref) ?? { gross: 0, paid: 0 };
        d.gross += l.credit_cents;
        d.paid += l.debit_cents;
        documents.set(l.doc_ref, d);
      }
    }
  }
  return { accounts, documents };
}

/** "12.34" or "-12.34" from whole cents, for the difference list. */
export const money = (c: number | null | undefined): string => {
  if (c === null || c === undefined) return "not there";
  const a = Math.abs(c);
  return `${c < 0 ? "-" : ""}${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
};

/** One plain line per difference: "Document VE-889, gross: Purser 2.42, Moneybird 2.43". */
export function differenceLines(r: ThreeWay): string[] {
  return r.differences.map((d) => `${d.kind === "document" ? "Document" : "Account"} ${d.key}, ${d.field}: ${Object.entries(d.amounts).map(([n, v]) => `${n} ${money(v)}`).join(", ")}`);
}
