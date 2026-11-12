// The Odoo connector, over Odoo's External API (odoo.com/documentation/18.0/developer/reference/external_api.html):
// xmlrpc/2/common `authenticate(db, login, key, {})` gives the user id; xmlrpc/2/object `execute_kw(db, uid, key, model,
// method, args, kwargs)` calls a model; an API key is used in place of the password ("API Keys", new in 14.0). The model
// fields used are Odoo 18's own (odoo/odoo, branch 18.0): account.move (move_type 'in_invoice' | 'in_refund' | 'entry',
// partner_id, ref, invoice_date, invoice_date_due, currency_id, journal_id, payment_reference, invoice_line_ids,
// line_ids, reversed_entry_id, amount_total, payment_state), account.move.line (name, account_id, quantity, price_unit,
// tax_ids, debit, credit), account.payment (payment_type, partner_type, partner_id, amount, currency_id, date, memo,
// journal_id), res.partner (name, vat, email, is_company, supplier_rank), res.partner.bank (acc_number, partner_id),
// ir.attachment (name, datas, res_model, res_id, mimetype), account.account (code, name, deprecated), res.currency
// (name). One2many values use Odoo's commands: (0, 0, values) creates, (6, 0, ids) sets.
//
// Not done here: reconciling a payment with its bill (Odoo's payment register wizard; a person matches it), a bank's
// BIC (it sits on res.bank), and journal entries in a foreign currency.

import { ErpError, errorForStatus, step, type ErpAccount, type ErpConnector, type ErpVendorRow, type PaymentStatus, type PushProgress, type RefResolver, type Transport } from "./connector.js";
import { amount, type JournalEntry, type ObjectKind, type Payment, type PurchaseInvoice, type VatCode, type Vendor } from "./model.js";
import { base64 } from "./rest.js";
import { decodeResponse, encodeCall, XmlRpcFault, type XmlValue } from "./xmlrpc.js";

export interface OdooConfig {
  url: string;
  db: string;
  login: string;
  apiKey: string;
  companyCurrency: string;
  purchaseJournalId: number;
  /** Odoo bank journal id per Purser bank account, e.g. {"1200": 6}. */
  bankJournalIds: Record<string, number>;
  generalJournalId: number;
  /** Odoo account.tax id for each of Purser's VAT treatments (0: no tax). */
  taxIds: Record<VatCode, number>;
  /** Purser chart code to Odoo account code, where they differ. */
  glMap: Record<string, string>;
  /** Post a bill or payment once its total matches (action_post); otherwise leave it in draft for a person. */
  post: boolean;
  /** Compare Odoo's computed total with the invoice before posting (default on; a dry run turns it off). */
  verifyTotals?: boolean;
}

export class OdooConnector implements ErpConnector {
  readonly name = "odoo" as const;
  private uid: number | null = null;
  private accounts: Map<string, number> | null = null;
  private currencies = new Map<string, number>();

  constructor(private readonly cfg: OdooConfig, private readonly transport: Transport) {}

  private async rpc(endpoint: "common" | "object", method: string, params: XmlValue[]): Promise<XmlValue> {
    const url = `${this.cfg.url.replace(/\/$/, "")}/xmlrpc/2/${endpoint}`;
    const res = await this.transport.send({ method: "POST", url, headers: { "content-type": "text/xml" }, body: encodeCall(method, params) });
    if (res.status !== 200) throw errorForStatus(res.status, res.headers, `Odoo ${endpoint}.${method}`, "");
    try {
      return decodeResponse(res.body);
    } catch (e) {
      if (e instanceof XmlRpcFault) {
        const access = /AccessDenied|Access Denied|AccessError/i.test(e.faultString);
        throw new ErpError(access ? "auth" : "validation", `Odoo ${method}: ${e.faultString.split("\n").slice(-2).join(" ").slice(0, 400)}`);
      }
      throw new ErpError("unexpected", `Odoo ${method}: ${(e as Error).message}`);
    }
  }

  private major: number | null = null;

  /**
   * Odoo's major version, from xmlrpc/2/common version() (server_version_info [major, minor, ...]), asked once. It picks
   * the payment's reference field: account.payment has `memo` from 18.0; in 17.0 it has no such field (create refuses
   * an unknown field) and takes `ref` through its _inherits of account.move (odoo/odoo 17.0 and 18.0,
   * addons/account/models/account_payment.py).
   */
  private async version(): Promise<number> {
    if (this.major !== null) return this.major;
    const v = await this.rpc("common", "version", []);
    const info = (v as { server_version_info?: XmlValue[] } | null)?.server_version_info;
    const major = Array.isArray(info) && typeof info[0] === "number" ? info[0] : Number.parseInt(String((v as { server_version?: string } | null)?.server_version ?? ""), 10);
    if (!Number.isFinite(major)) throw new ErpError("unexpected", "Odoo did not say its version (common.version)");
    this.major = major;
    return major;
  }

  private async paymentRefField(): Promise<"memo" | "ref"> {
    return (await this.version()) >= 18 ? "memo" : "ref";
  }

  private async login(): Promise<number> {
    if (this.uid !== null) return this.uid;
    const uid = await this.rpc("common", "authenticate", [this.cfg.db, this.cfg.login, this.cfg.apiKey, {}]);
    if (typeof uid !== "number" || uid <= 0) throw new ErpError("auth", "Odoo refused the login or API key");
    this.uid = uid;
    return uid;
  }

  private async call<T extends XmlValue>(model: string, method: string, args: XmlValue[], kwargs: Record<string, XmlValue> = {}): Promise<T> {
    const uid = await this.login();
    return (await this.rpc("object", "execute_kw", [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs])) as T;
  }

  async pullChartOfAccounts(): Promise<ErpAccount[]> {
    const rows = await this.call<{ id: number; code: string; name: string }[]>("account.account", "search_read", [[["deprecated", "=", false]]], { fields: ["id", "code", "name"] });
    this.accounts = new Map(rows.map((r) => [r.code, r.id]));
    return rows.map((r) => ({ code: r.code, name: r.name, externalId: String(r.id) }));
  }

  private async accountId(code: string): Promise<number> {
    if (!this.accounts) await this.pullChartOfAccounts();
    const odooCode = this.cfg.glMap[code] ?? code;
    const id = this.accounts!.get(odooCode);
    if (id === undefined) throw new ErpError("config", `Odoo has no account ${odooCode} (Purser account ${code}); map it in ERP_ODOO_GL_MAP`);
    return id;
  }

  private async currencyId(code: string): Promise<number> {
    const known = this.currencies.get(code);
    if (known !== undefined) return known;
    const ids = await this.call<number[]>("res.currency", "search", [[["name", "=", code]]], { limit: 1 });
    if (!ids[0]) throw new ErpError("config", `Odoo has no active currency ${code}`);
    this.currencies.set(code, ids[0]);
    return ids[0];
  }

  private tax(code: VatCode): XmlValue[] {
    const id = this.cfg.taxIds[code];
    if (id === undefined) throw new ErpError("config", `no Odoo tax for ${code}; set it in ERP_ODOO_TAX_IDS`);
    return id ? [[6, 0, [id]]] : [[6, 0, []]];
  }

  private partnerOf(vendorId: string, refs: RefResolver): number {
    const p = refs.vendor(vendorId);
    if (!p) throw new ErpError("validation", `vendor ${vendorId} is not in Odoo yet`);
    return Number(p);
  }

  async pullVendors(): Promise<ErpVendorRow[]> {
    const rows = await this.call<{ id: number; name: string; vat: string | false }[]>("res.partner", "search_read", [[["supplier_rank", ">", 0]]], { fields: ["id", "name", "vat"] });
    return rows.map((r) => ({ externalId: String(r.id), name: r.name, ...(r.vat ? { vatId: r.vat } : {}) }));
  }

  // Each create or action is one step (src/erp/connector.ts step): a retry resumes after the last one that succeeded.
  async pushVendor(v: Vendor, progress?: PushProgress): Promise<string> {
    const id = await step(progress, "partner", async () => String(await this.call<number>("res.partner", "create", [{ name: v.name, ...(v.vatId ? { vat: v.vatId } : {}), ...(v.email ? { email: v.email } : {}), is_company: true, supplier_rank: 1 }])));
    if (v.iban) {
      const iban = v.iban;
      await step(progress, "bank", async () => String(await this.call<number>("res.partner.bank", "create", [{ acc_number: iban, partner_id: Number(id) }])));
    }
    return id;
  }

  private async bill(inv: PurchaseInvoice, refs: RefResolver, refund: { of: string } | null): Promise<number> {
    const lines: XmlValue[] = [];
    for (const l of inv.lines) lines.push([0, 0, { name: l.description, account_id: await this.accountId(l.glAccount), quantity: 1, price_unit: amount(l.netCents), tax_ids: this.tax(l.vatCode) }]);
    return this.call<number>("account.move", "create", [{
      move_type: refund ? "in_refund" : "in_invoice", partner_id: this.partnerOf(inv.vendorId, refs), ref: refund ? `${inv.number}-CR` : inv.number,
      invoice_date: inv.issueDate, invoice_date_due: inv.dueDate, currency_id: await this.currencyId(inv.currency), journal_id: this.cfg.purchaseJournalId,
      ...(refund ? { reversed_entry_id: Number(refund.of) } : inv.paymentReference ? { payment_reference: inv.paymentReference } : {}),
      invoice_line_ids: lines,
    }]);
  }

  /** Odoo computes the tax itself: post only when its total is the invoice's, to the cent. */
  private async checkAndPost(id: number, grossCents: number, progress?: PushProgress): Promise<void> {
    if (this.cfg.verifyTotals !== false) {
      const [m] = await this.call<{ amount_total: number }[]>("account.move", "read", [[id]], { fields: ["amount_total"] });
      if (!m || Math.round(m.amount_total * 100) !== grossCents) {
        // The draft stays for a person, and stays theirs: the sync runner never clears needs_review by itself.
        throw new ErpError("needs_review", `Odoo computed a total of ${m?.amount_total.toFixed(2) ?? "?"} for move ${id}, the invoice says ${amount(grossCents).toFixed(2)}; it is left in draft for a person (check the taxes)`, { externalId: String(id) });
      }
    }
    if (this.cfg.post) await step(progress, "posted", async () => { await this.call("account.move", "action_post", [[id]]); return "done"; });
  }

  async pushPurchaseInvoice(inv: PurchaseInvoice, refs: RefResolver, progress?: PushProgress): Promise<string> {
    const id = Number(await step(progress, "move", async () => String(await this.bill(inv, refs, null))));
    if (inv.pdf) {
      const pdf = inv.pdf;
      await step(progress, "attachment", async () => String(await this.call<number>("ir.attachment", "create", [{ name: pdf.fileName, datas: base64(pdf.bytes), res_model: "account.move", res_id: id, mimetype: "application/pdf" }])));
    }
    await this.checkAndPost(id, inv.totals.grossCents, progress);
    return String(id);
  }

  async pushCreditNote(original: PurchaseInvoice, originalExternalId: string, refs: RefResolver, progress?: PushProgress): Promise<string> {
    const id = Number(await step(progress, "move", async () => String(await this.bill(original, refs, { of: originalExternalId }))));
    await this.checkAndPost(id, original.totals.grossCents, progress);
    return String(id);
  }

  async pushPayment(p: Payment, refs: RefResolver, progress?: PushProgress): Promise<string> {
    const journal = this.cfg.bankJournalIds[p.bankAccount];
    if (journal === undefined) throw new ErpError("config", `no Odoo bank journal for Purser account ${p.bankAccount}; set it in ERP_ODOO_BANK_JOURNALS`);
    const refField = await this.paymentRefField();
    const id = Number(await step(progress, "payment", async () => String(await this.call<number>("account.payment", "create", [{
      payment_type: "outbound", partner_type: "supplier", partner_id: this.partnerOf(p.vendorId, refs), amount: amount(p.amountCents),
      currency_id: await this.currencyId(p.currency), date: p.date, [refField]: `Purser payment ${p.id}`, journal_id: journal,
    }]))));
    if (this.cfg.post) await step(progress, "posted", async () => { await this.call("account.payment", "action_post", [[id]]); return "done"; });
    return String(id);
  }

  private ref(j: JournalEntry) { return `Purser ${j.id}: ${j.memo}`; }

  async pushJournalEntry(j: JournalEntry, progress?: PushProgress): Promise<string> {
    if (j.currency !== this.cfg.companyCurrency) throw new ErpError("config", `journal entry ${j.id} is in ${j.currency}; only ${this.cfg.companyCurrency} entries are sent to Odoo so far`);
    const lines: XmlValue[] = [];
    for (const l of j.lines) lines.push([0, 0, { name: l.description ?? j.memo, account_id: await this.accountId(l.glAccount), debit: amount(l.debitCents), credit: amount(l.creditCents) }]);
    const id = Number(await step(progress, "move", async () => String(await this.call<number>("account.move", "create", [{ move_type: "entry", journal_id: this.cfg.generalJournalId, date: j.date, ref: this.ref(j), line_ids: lines }]))));
    if (this.cfg.post) await step(progress, "posted", async () => { await this.call("account.move", "action_post", [[id]]); return "done"; });
    return String(id);
  }

  /**
   * An object found with no record of its steps: a supplier's bank account, a bill's PDF, and (with posting on) its
   * posted state must be there too. A move or payment is created with its lines in one call, so those are whole.
   */
  async incomplete(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, externalId: string): Promise<string | null> {
    const id = Number(externalId);
    if (kind === "vendor") {
      if (!(o as Vendor).iban) return null;
      const banks = await this.call<number[]>("res.partner.bank", "search", [[["partner_id", "=", id]]], { limit: 1 });
      return banks.length ? null : "its bank account is not there";
    }
    const missing: string[] = [];
    if (kind === "invoice" && (o as PurchaseInvoice).pdf) {
      const att = await this.call<number[]>("ir.attachment", "search", [[["res_model", "=", "account.move"], ["res_id", "=", id]]], { limit: 1 });
      if (!att.length) missing.push("its PDF is not attached");
    }
    if (this.cfg.post) {
      const model = kind === "payment" ? "account.payment" : "account.move";
      const [r] = await this.call<{ state: string }[]>(model, "read", [[id]], { fields: ["state"] });
      if (r?.state !== "posted") missing.push(`it is ${r?.state ?? "missing"}, not posted`);
    }
    return missing.length ? missing.join("; ") : null;
  }

  async findExisting(kind: ObjectKind, o: Vendor | PurchaseInvoice | Payment | JournalEntry, refs: RefResolver): Promise<string | null> {
    let ids: number[];
    switch (kind) {
      case "vendor": ids = await this.call("res.partner", "search", [[["name", "=", (o as Vendor).name], ["supplier_rank", ">", 0]]], { limit: 1 }); break;
      case "invoice": {
        const inv = o as PurchaseInvoice;
        const p = refs.vendor(inv.vendorId);
        if (!p) return null;
        ids = await this.call("account.move", "search", [[["move_type", "=", "in_invoice"], ["partner_id", "=", Number(p)], ["ref", "=", inv.number]]], { limit: 1 });
        break;
      }
      case "payment": ids = await this.call("account.payment", "search", [[[await this.paymentRefField(), "=", `Purser payment ${o.id}`]]], { limit: 1 }); break;
      case "journal": ids = await this.call("account.move", "search", [[["move_type", "=", "entry"], ["ref", "=", this.ref(o as JournalEntry)]]], { limit: 1 }); break;
    }
    return ids[0] !== undefined ? String(ids[0]) : null;
  }

  // account.move payment_state: not_paid, in_payment, paid, partial, reversed, blocked, invoicing_legacy.
  async pullPaymentStatus(_inv: PurchaseInvoice, invoiceExternalId: string, _refs?: RefResolver): Promise<PaymentStatus> {
    const [m] = await this.call<{ payment_state: string }[]>("account.move", "read", [[Number(invoiceExternalId)]], { fields: ["payment_state"] });
    switch (m?.payment_state) {
      case "paid": case "in_payment": return "paid";
      case "partial": return "partial";
      case "not_paid": return "unpaid";
      default: return "unknown";
    }
  }
}
