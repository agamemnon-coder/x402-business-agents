// Purser Cloud's Airwallex actions around one company's engine (14 Nov). The engine's own steps run unchanged; this
// file only chooses the bank of each action and says which one it was:
//
//   new supplier   the payee's bank is asked through Airwallex (verify_account), then the CFO signs the payee_add; once
//                  signed, the supplier is added at Airwallex (schema, validation, create) with a twin at the simulated bank
//   Pay            planned at the payee's bank: Airwallex's balances, a live quote for the shortfall only; if Airwallex is
//                  off, over a cap or fails, planned again on the simulated bank, and the invoice says so
//   approve        the payment runs at the bank it was planned at, and only there: the signed terms name that bank's ids
//                  (payee, quote), and request_ids make a second try adopt, never repeat
//   Pay all        one batch over every ready invoice, planned at one bank; at Airwallex it is one batch transfer
//   money in       a deposit on the bank's simulation into the USD account, booked
//
// Every step is test money: the Airwallex sandbox or the simulated bank, never a live bank.

import type { DB } from "../db/open.js";
import { AirwallexAmbiguous } from "../airwallex/client.js";
import { FakePayeeNames, type AccountToCheck, type NameCheck, type PayeeNameVerifier } from "../airwallex/payeeName.js";
import { failureWords, type ActGuard, type Bank, type RouteRow, type RouteStore, type RoutedRail } from "../airwallex/routedRail.js";
import type { EngineHost, NameCheckView, ProposalView, Settled } from "./host.js";

/** One line of what happened at which bank, for the invoice and the Airwallex panel. */
export interface ActNote { at: string; ref: string; what: string; bank: Bank; label: string }

export interface ActStore extends RouteStore {
  note(n: ActNote): void;
  notes(limit?: number): ActNote[];
}

/** The route table and the notes in memory (tests and the Node engine). */
export function memoryActStore(): ActStore {
  const rows = new Map<string, RouteRow>();
  const notes: ActNote[] = [];
  return {
    get: (k) => rows.get(k) ?? null,
    set: (k, r) => { rows.set(k, r); },
    note: (n) => { notes.push(n); },
    notes: (limit = 50) => notes.slice(-limit).reverse(),
  };
}

export const BANK_WORDS: Record<Bank, string> = { airwallex: "Airwallex sandbox · test money", simulated: "Simulated bank · test money" };

/**
 * The payee's bank, asked through Airwallex when it may be, else the labelled stand-in ("stand-in, test world: no bank
 * was asked" on the check, in the signed terms and on screen). A lost answer is not replaced: it fails.
 */
export class ActVerifier implements PayeeNameVerifier {
  source: "airwallex" | "stand-in" = "stand-in";
  private readonly standIn = Object.assign(new FakePayeeNames(), { confirmAll: true });
  constructor(private readonly awx: PayeeNameVerifier | null, private readonly guard: ActGuard, private readonly fellBack: (why: string) => void) {}
  async verifyAccount(a: AccountToCheck): Promise<NameCheck> {
    const why = this.awx ? await this.guard.blocked() : "no Airwallex gateway in this deployment";
    if (!why && this.awx) {
      try {
        const r = await this.awx.verifyAccount(a);
        this.source = "airwallex";
        return r;
      } catch (e) {
        if (e instanceof AirwallexAmbiguous) throw e;
        this.fellBack(failureWords(e));
      }
    } else this.fellBack(why ?? "off");
    this.source = "stand-in";
    return this.standIn.verifyAccount(a);
  }
}

export interface AwxInvoiceView {
  invoice_id: string;
  bank: Bank | null;
  bank_words: string | null;
  payee: { beneficiary_id: string; bank: Bank; twin: string | null } | null;
  name_check: { code: string; match: string | null; label: string; source: "airwallex" | "stand-in" } | null;
  quote: { quote_id: string; pair: string; buy: string; sell: string; rate: string; valid_to: string } | null;
  conversion: { conversion_id: string | null; request_id: string; status: string | null } | null;
  transfer: { transfer_id: string | null; request_id: string; status: string | null; amount: string; currency: string; approval_sha256: string } | null;
  batch: { batch_id: string; awx_batch_id: string | null; status: string | null } | null;
  notes: ActNote[];
}

export interface AwxView {
  /** Whether a new action may use the Airwallex sandbox now, and why not. */
  airwallex: { on: boolean; why: string | null };
  caps: { company_cents_day: number; global_cents_day: number; company_used_cents: number; global_used_cents: number; currencies: string[] } | null;
  invoices: AwxInvoiceView[];
  deposits: { deposit_id: string; bank: Bank; amount: string; currency: string; outcome: string; received_at: string }[];
  notes: ActNote[];
}

export interface ActDeps {
  host: EngineHost;
  db: DB;
  rail: RoutedRail;
  guard: ActGuard;
  store: ActStore;
  /** The caps as they stand, for the panel; null when the deployment has none. */
  caps?: () => Promise<AwxView["caps"]>;
  now?: () => Date;
}

type Propose = { ok: true; proposal: ProposalView } | { ok: false; reason: string };

/** The engine's actions with their bank chosen, labelled and recorded. */
export function airwallexActions(d: ActDeps) {
  const { host, db, rail, guard, store } = d;
  const now = d.now ?? (() => new Date());
  const note = (ref: string, what: string, bank: Bank, label: string) => store.note({ at: now().toISOString(), ref, what, bank, label });
  const planned = (proposalId: string): Bank | null => store.get(`plan:${proposalId}`)?.bank ?? null;
  const plan = (proposalId: string, bank: Bank) => store.set(`plan:${proposalId}`, { bank, twin: null });

  /** The bank of a supplier's account on file: the bank that made it (a seeded supplier is the simulated bank's). */
  const payeeBank = (vendor: string): Bank | null => {
    const b = db.prepare("SELECT beneficiary_id FROM beneficiaries WHERE name = ? AND status = 'ACTIVE' ORDER BY rowid DESC LIMIT 1").get(vendor.trim()) as { beneficiary_id: string } | undefined;
    return b ? rail.bankOfId("ben", b.beneficiary_id) : null;
  };
  const invoiceVendor = (id: string) => (db.prepare("SELECT vendor FROM ap_invoices WHERE id = ?").get(id) as { vendor: string } | undefined)?.vendor ?? null;

  /** The bank to plan at: the payee's, unless Airwallex may not be used now (then the simulated bank, with why). */
  const planBank = async (vendors: string[]): Promise<{ bank: Bank; why: string | null }> => {
    const banks = vendors.map(payeeBank);
    if (!banks.length || banks.some((b) => b !== "airwallex")) return { bank: "simulated", why: banks.some((b) => b === "airwallex") ? "the batch also pays suppliers at the simulated bank, so it all goes there" : null };
    const why = await guard.blocked();
    return why ? { bank: "simulated", why } : { bank: "airwallex", why: null };
  };

  /** One action at a bank, with the first Airwallex-side failure it met (read inside the action's own context). */
  const at = <T>(bank: Bank, fn: () => Promise<T>): Promise<{ out: T; failure: string | null }> =>
    rail.within(bank, async () => { const out = await fn(); return { out, failure: rail.failure }; });

  /** Plans at Airwallex; if Airwallex was why it could not, plans again on the simulated bank, labelled. */
  async function twoTries<T extends { ok: boolean }>(ref: string, what: string, first: { bank: Bank; why: string | null }, run: () => Promise<T>, idOf: (r: T) => string | null): Promise<T> {
    let why = first.why;
    if (first.bank === "airwallex") {
      const { out, failure } = await at("airwallex", run);
      if (out.ok) { const id = idOf(out); if (id) plan(id, "airwallex"); note(ref, what, "airwallex", `${what} at the Airwallex sandbox`); return out; }
      if (!failure) return out; // the engine's own reason, not Airwallex's: shown as it is
      why = failure;
    }
    const out = await rail.within("simulated", run);
    const id = out.ok ? idOf(out) : null;
    if (id) plan(id, "simulated");
    if (why) note(ref, what, "simulated", `${what} on the simulated bank: ${why}`);
    return out;
  }

  /** An approved proposal runs at the bank it was planned at, and only there. */
  const execBank = (proposalId: string): Bank => {
    const known = planned(proposalId);
    if (known) return known;
    const p = db.prepare("SELECT kind, terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string } | undefined;
    if (!p) return "simulated";
    const t = JSON.parse(p.terms_json) as { beneficiary_id?: string };
    return t.beneficiary_id ? rail.bankOfId("ben", t.beneficiary_id) : "simulated";
  };

  const after = (proposalId: string, bank: Bank, out: { settled?: Settled | null }, failure: string | null) => {
    if (out.settled?.error && failure) note(proposalId, "payment", bank, `stopped at the ${bank === "airwallex" ? "Airwallex sandbox" : "simulated bank"}: ${failure}. Nothing is sent twice; try again, or Pay again for a new plan`);
  };

  return {
    async propose(invoiceId: string): Promise<Propose> {
      const vendor = invoiceVendor(invoiceId);
      return twoTries(invoiceId, "planned", await planBank(vendor ? [vendor] : []), () => host.propose(invoiceId), (o) => (o.ok ? o.proposal.id : null));
    },

    async proposeBatch(ids: string[]) {
      const vendors = ids.map(invoiceVendor).filter((v): v is string => !!v);
      const out = await twoTries(`batch:${ids.length}`, "Pay all planned", await planBank(vendors), () => host.proposeBatch(ids), (o) => (o.ok ? o.proposal.id : null));
      if (out.ok) for (const l of out.planned) plan(l.proposal_id, planned(out.proposal.id) ?? "simulated");
      return out;
    },

    async approve(a: { proposal_id: string; terms_sha256: string; credential: unknown; hold?: boolean }) {
      const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(a.proposal_id) as { kind: string } | undefined)?.kind;
      // A new supplier is added at Airwallex when it may be (its terms name no bank's id); a payment where it was planned.
      let bank: Bank = kind === "payee_add" ? ((await guard.blocked()) ? "simulated" : "airwallex") : execBank(a.proposal_id);
      if (kind === "payee_add" && bank === "simulated") note(a.proposal_id, "new supplier", "simulated", `added on the simulated bank: ${await guard.blocked()}`);
      const { out, failure } = await at(bank, () => host.approve(a));
      if (kind === "payee_add") {
        const ben = db.prepare("SELECT json_extract(p.terms_json, '$.vendor') AS vendor FROM proposals p WHERE proposal_id = ?").get(a.proposal_id) as { vendor: string } | undefined;
        const made = ben ? payeeBank(ben.vendor) : null;
        if (made) { bank = made; note(a.proposal_id, "new supplier", made, made === "airwallex" ? "added at the Airwallex sandbox (schema, validation, create)" : "added on the simulated bank"); }
      }
      after(a.proposal_id, bank, out, failure);
      return out;
    },

    /** Any other action on an approved proposal (the hands-on demo's pay route): at the bank it was planned at. */
    runAt<T>(proposalId: string, fn: () => Promise<T>): Promise<T> {
      return rail.within(execBank(proposalId), fn);
    },

    async retry(proposalId: string) {
      const bank = execBank(proposalId);
      const { out, failure } = await at(bank, () => host.retry(proposalId));
      after(proposalId, bank, out, failure);
      return out;
    },

    async addSupplier(invoiceId: string, v: { by: string; how: string; address: { street: string; city: string; postcode: string } }) {
      return rail.within((await guard.blocked()) ? "simulated" : "airwallex", () => host.addSupplier(invoiceId, v));
    },

    async depositIn(a: { amountCents: number; reference: string; payer: string }) {
      const why = await guard.blocked();
      const { out, failure } = await at(why ? "simulated" : "airwallex", () => host.depositIn(a));
      if (out.ok) {
        const bank = store.get(`dep:${out.deposit_id}`)?.bank ?? "simulated";
        note(out.deposit_id, "money in", bank, bank === "airwallex" ? "deposit simulated at the Airwallex sandbox into the USD global account" : `deposit on the simulated bank${why ? `: ${why}` : failure ? `: ${failure}` : ""}`);
      }
      return out;
    },

    async view(): Promise<AwxView> {
      const why = await guard.blocked();
      return { airwallex: { on: !why, why }, caps: d.caps ? await d.caps() : null, invoices: invoiceViews(db, rail, store), deposits: depositViews(db, store), notes: store.notes(30) };
    },
  };
}

/** Each invoice's Airwallex record: the bank, the payee, the bank check, the quote, the conversion and the transfer. */
export function invoiceViews(db: DB, rail: RoutedRail, store: ActStore): AwxInvoiceView[] {
  const invs = db.prepare("SELECT id, vendor, invoice_no, proposal_id FROM ap_invoices ORDER BY received_at DESC, id DESC LIMIT 50").all() as { id: string; vendor: string; invoice_no: string; proposal_id: string | null }[];
  const notes = store.notes(200);
  return invs.map((inv) => {
    const ben = db.prepare("SELECT beneficiary_id, name, details_json FROM beneficiaries WHERE name = ? AND status = 'ACTIVE' ORDER BY rowid DESC LIMIT 1").get(inv.vendor.trim()) as { beneficiary_id: string; name: string; details_json: string | null } | undefined;
    const p = inv.proposal_id ? db.prepare("SELECT proposal_id, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { proposal_id: string; terms_json: string; terms_sha256: string } | undefined : undefined;
    const t = p ? JSON.parse(p.terms_json) as { amount?: string; currency?: string; transfer_request_id?: string; conversion?: { request_id: string; quote_id: string; buy_currency: string; buy_amount: string; sell_currency: string; sell_amount: string; client_rate: string; valid_to: string } | null; fx?: { quote_id?: string } } : null;
    const tr = t?.transfer_request_id ? db.prepare("SELECT transfer_id, status, amount, currency, approval_sha256 FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { transfer_id: string | null; status: string; amount: string; currency: string; approval_sha256: string } | undefined : undefined;
    const conv = t?.conversion ? db.prepare("SELECT conversion_id, status FROM fx_conversions WHERE request_id = ?").get(t.conversion.request_id) as { conversion_id: string; status: string } | undefined : undefined;
    const check = db.prepare("SELECT code, match, label FROM payee_name_checks WHERE vendor = ? ORDER BY checked_at DESC LIMIT 1").get(inv.vendor.trim()) as { code: string; match: string | null; label: string } | undefined;
    const batch = p ? db.prepare(`SELECT b.batch_id, a.awx_batch_id, a.status FROM batch_lines b LEFT JOIN awx_batches a ON a.batch_id = b.batch_id WHERE b.proposal_id = ? ORDER BY b.batch_id DESC LIMIT 1`).get(p.proposal_id) as { batch_id: string; awx_batch_id: string | null; status: string | null } | undefined : undefined;
    const bank = p ? store.get(`plan:${p.proposal_id}`)?.bank ?? (tr?.transfer_id ? rail.bankOfId("tr", tr.transfer_id) : null) : null;
    const benRoute = ben ? { beneficiary_id: ben.beneficiary_id, bank: rail.bankOfId("ben", ben.beneficiary_id), twin: store.get(`ben:${ben.beneficiary_id}`)?.twin ?? null } : null;
    return {
      invoice_id: inv.id, bank, bank_words: bank ? BANK_WORDS[bank] : null,
      payee: benRoute,
      name_check: check ? { ...check, source: check.label.startsWith("stand-in") ? "stand-in" as const : "airwallex" as const } : null,
      quote: t?.conversion ? { quote_id: t.conversion.quote_id, pair: `${t.conversion.sell_currency}/${t.conversion.buy_currency}`, buy: `${t.conversion.buy_currency} ${t.conversion.buy_amount}`, sell: `${t.conversion.sell_currency} ${t.conversion.sell_amount}`, rate: t.conversion.client_rate, valid_to: t.conversion.valid_to } : null,
      conversion: t?.conversion ? { conversion_id: conv?.conversion_id ?? null, request_id: t.conversion.request_id, status: conv?.status ?? null } : null,
      transfer: t?.transfer_request_id && p ? { transfer_id: tr?.transfer_id ?? null, request_id: t.transfer_request_id, status: tr?.status ?? null, amount: t.amount ?? "", currency: t.currency ?? "", approval_sha256: tr?.approval_sha256 ?? p.terms_sha256 } : null,
      batch: batch ?? null,
      notes: notes.filter((n) => n.ref === inv.id || (p && n.ref === p.proposal_id)),
    };
  }).filter((v): v is AwxInvoiceView => !!v);
}

function depositViews(db: DB, store: ActStore): AwxView["deposits"] {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'receipts'").get();
  if (!has) return [];
  return (db.prepare("SELECT deposit_id, currency, amount_cents, outcome, received_at FROM receipts ORDER BY received_at DESC LIMIT 20").all() as { deposit_id: string; currency: string; amount_cents: number; outcome: string; received_at: string }[])
    .map((r) => ({ deposit_id: r.deposit_id, bank: store.get(`dep:${r.deposit_id}`)?.bank ?? "simulated", amount: (r.amount_cents / 100).toFixed(2), currency: r.currency, outcome: r.outcome, received_at: r.received_at }));
}

export type { NameCheckView };
