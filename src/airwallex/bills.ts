// Airwallex Spend Bills (docs: spend/accounts-payable/bills-via-api, API: spend/bills, spend/vendors, files/upload; read
// 19 November 2026; the API is marked beta). Each invoice Purser pays becomes a Bill in Airwallex's own accounts payable,
// so the CFO sees the agent-paid bills in Airwallex next to the transfers that paid them (src/ap/billSync.ts).
//
// What the sandbox showed on 19 November (probe, docs/runs/2026-11-19-airwallex-bills.md):
//  - Spend is on for this account: GET /spend/bills and GET /spend/vendors answer 200; creates answer 201.
//  - List bills IGNORES an external_id filter (a made-up external_id listed every bill), and a second bill with the same
//    external_id is accepted: Airwallex does not keep external_id unique, so Purser does (its own record, then a full
//    listing matched here, before any create).
//  - A create sent again with the same request_id is refused (400 invalid_argument), so a resend can never make a second
//    bill; a lost answer is resolved by listing, never by resending.
//  - mark_as_paid takes no body: it adds a bill payment of type EXTERNAL with no transfer. The Airwallex transfer that paid
//    the bill can only be named in the bill's own description (set at create); it cannot be linked by API.
//  - Files go to files.sandbox.airwallex.com (purpose SPEND_ATTACHMENT; a file name of at most 50 characters).
//
// Off by default: AIRWALLEX_BILLS=on switches it on. Nothing here moves money: a bill is a record of an invoice.

import { createHash } from "node:crypto";
import { AirwallexAmbiguous, type Airwallex } from "./client.js";
import { cents } from "./adapter.js";

export const BILLS_FLAG = "AIRWALLEX_BILLS";
export const billsOn = (env: Record<string, string | undefined> = process.env): boolean => env[BILLS_FLAG] === "on";

/** The bill statuses Airwallex documents (List bills). */
export const BILL_STATUSES = ["DRAFT", "AWAITING_APPROVAL", "AWAITING_PAYMENT", "PAYMENT_IN_PROGRESS", "PAID", "REJECTED", "SCHEDULED"] as const;

/** The most list pages read when matching an external_id (Airwallex filters none server-side). */
export const MAX_LIST_PAGES = 20;
/** Airwallex's limit on an uploaded file's name and notes. */
export const FILE_NAME_MAX = 50;

export interface AwxVendor { id: string; externalId: string; name: string; status: string }

export interface AwxBillPayment { id: string; type: string; amount: string; currency: string; transferId: string | null }

export interface AwxBill {
  id: string;
  externalId: string;
  invoiceNumber: string;
  status: string;
  syncStatus: string;
  currency: string;
  /** billing_amount as Airwallex answers it, e.g. "240.00". */
  amount: string;
  dueDate: string;
  issuedDate: string;
  vendorId: string;
  description: string | null;
  attachmentIds: string[];
  payments: AwxBillPayment[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BillIn {
  requestId: string;
  externalId: string;
  invoiceNumber: string;
  currency: string;
  /** The invoice's total, tax included, as "240.00": one line, quantity 1, TAX_INCLUSIVE. */
  total: string;
  issuedDate: string;
  dueDate: string;
  legalEntityId: string;
  vendorId: string;
  lineDescription: string;
  description: string;
  attachmentIds: string[];
}

export interface BillsRail {
  /** The legal entity bills and vendors belong to (GET /account: account_details.legal_entity_id). */
  legalEntityId(): Promise<string>;
  /** The vendor with this external_id, matched here over every list page. */
  findVendor(externalId: string): Promise<AwxVendor | undefined>;
  createVendor(v: { requestId: string; externalId: string; name: string; legalEntityId: string }): Promise<AwxVendor>;
  /** One PDF to the Files service, purpose SPEND_ATTACHMENT. */
  uploadAttachment(f: { bytes: Uint8Array; fileName: string; notes: string }): Promise<{ fileId: string; size: number | null }>;
  createBill(b: BillIn): Promise<AwxBill>;
  /** Every bill with this external_id, matched here over every list page (Airwallex ignores the filter). */
  findBills(externalId: string): Promise<AwxBill[]>;
  getBill(id: string): Promise<AwxBill>;
  /** Marks a bill paid outside Airwallex's own bill pay (no body: a payment of type EXTERNAL). */
  markPaid(id: string): Promise<AwxBill>;
}

// --- Plain helpers ---------------------------------------------------------------------------------------------------

/** A UUID derived from a seed (SHA-256, version and variant bits set): the same seed always gives the same request_id. */
export function seededUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest("hex").split("");
  h[12] = "5";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** A vendor's external_id in Airwallex: from its name, so the same supplier is one vendor. */
export const vendorExternalId = (name: string): string => `purser-vendor-${createHash("sha256").update(name.trim().toLowerCase()).digest("hex").slice(0, 24)}`;

/** A file name Airwallex takes: safe characters, ending .pdf, at most 50 characters. */
export function attachmentName(invoiceNo: string): string {
  const base = invoiceNo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "invoice";
  return `${base.slice(0, FILE_NAME_MAX - 4)}.pdf`;
}

// --- The REST mapping -----------------------------------------------------------------------------------------------

interface RawVendor { id: string; external_id?: string | null; name?: string | null; status?: string | null }
interface RawBill {
  id: string; external_id?: string | null; invoice_number?: string | null; status?: string | null; sync_status?: string | null;
  billing_currency?: string | null; billing_amount?: string | number | null; due_date?: string | null; issued_date?: string | null;
  vendor_id?: string | null; description?: string | null; created_at?: string | null; updated_at?: string | null;
  attachments?: { id: string }[] | null;
  bill_payments?: { id: string; type?: string | null; amount?: string | number | null; currency?: string | null; transfer?: { transfer_id?: string | null } | null }[] | null;
}
interface Page<T> { items?: T[]; page_after?: string | null }

const money = (v: unknown): string => (v == null || v === "" ? "" : (cents(v) / 100).toFixed(2));

export function toBill(b: RawBill): AwxBill {
  return {
    id: b.id, externalId: b.external_id ?? "", invoiceNumber: b.invoice_number ?? "", status: b.status ?? "", syncStatus: b.sync_status ?? "",
    currency: b.billing_currency ?? "", amount: money(b.billing_amount), dueDate: b.due_date ?? "", issuedDate: b.issued_date ?? "",
    vendorId: b.vendor_id ?? "", description: b.description ?? null, createdAt: b.created_at ?? null, updatedAt: b.updated_at ?? null,
    attachmentIds: (b.attachments ?? []).map((a) => a.id),
    payments: (b.bill_payments ?? []).map((p) => ({ id: p.id, type: p.type ?? "", amount: money(p.amount), currency: p.currency ?? "", transferId: p.transfer?.transfer_id ?? null })),
  };
}
const toVendor = (v: RawVendor): AwxVendor => ({ id: v.id, externalId: v.external_id ?? "", name: v.name ?? "", status: v.status ?? "" });

/** The body of POST /spend/bills/create for one invoice. */
export function billBody(b: BillIn): Record<string, unknown> {
  return {
    request_id: b.requestId, external_id: b.externalId, invoice_number: b.invoiceNumber, billing_currency: b.currency,
    issued_date: b.issuedDate, due_date: b.dueDate, legal_entity_id: b.legalEntityId, vendor_id: b.vendorId,
    line_items: [{ quantity: "1", unit_price: b.total, description: b.lineDescription }],
    tax_status: "TAX_INCLUSIVE", sync_status: "NOT_SYNCED", description: b.description,
    ...(b.attachmentIds.length ? { attachments: b.attachmentIds } : {}),
  };
}

export class AirwallexBillsRest implements BillsRail {
  private entity: string | null = null;
  constructor(private readonly api: Airwallex) {}

  async legalEntityId(): Promise<string> {
    if (this.entity) return this.entity;
    const r = await this.api.call<{ account_details?: { legal_entity_id?: string | null } | null }>("GET", "/account");
    const id = r?.account_details?.legal_entity_id;
    if (!id) throw new Error("Airwallex's account answered without a legal_entity_id");
    return (this.entity = id);
  }
  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let page: string | null = null;
    for (let n = 0; n < MAX_LIST_PAGES; n++) {
      const r: Page<T> = await this.api.call<Page<T>>("GET", path, undefined, page ? { page } : undefined);
      if (!r || !Array.isArray(r.items)) throw new Error(`Airwallex's ${path} list came without items`);
      out.push(...r.items);
      if (!r.page_after) return out;
      page = r.page_after;
    }
    throw new Error(`Airwallex's ${path} list has more than ${MAX_LIST_PAGES} pages; nothing was matched`);
  }
  async findVendor(externalId: string): Promise<AwxVendor | undefined> {
    const hits = (await this.all<RawVendor>("/spend/vendors")).filter((v) => v.external_id === externalId);
    if (hits.length > 1) throw new Error(`Airwallex holds ${hits.length} vendors with external_id ${externalId}`);
    return hits[0] ? toVendor(hits[0]) : undefined;
  }
  async createVendor(v: { requestId: string; externalId: string; name: string; legalEntityId: string }): Promise<AwxVendor> {
    return toVendor(await this.api.call<RawVendor>("POST", "/spend/vendors/create", {
      request_id: v.requestId, external_id: v.externalId, name: v.name, legal_entity_ids: [v.legalEntityId], status: "ACTIVE", sync_status: "NOT_SYNCED",
    }));
  }
  async uploadAttachment(f: { bytes: Uint8Array; fileName: string; notes: string }): Promise<{ fileId: string; size: number | null }> {
    const form = new FormData();
    form.set("purpose", "SPEND_ATTACHMENT");
    form.set("notes", f.notes.slice(0, FILE_NAME_MAX));
    form.set("file", new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), f.fileName.slice(0, FILE_NAME_MAX));
    const r = await this.api.upload<{ file_id?: string | null; size?: number | null }>("/files/upload", form);
    if (!r?.file_id) throw new Error("Airwallex's file upload answered without a file_id");
    return { fileId: r.file_id, size: typeof r.size === "number" ? r.size : null };
  }
  async createBill(b: BillIn): Promise<AwxBill> {
    return toBill(await this.api.call<RawBill>("POST", "/spend/bills/create", billBody(b)));
  }
  async findBills(externalId: string): Promise<AwxBill[]> {
    return (await this.all<RawBill>("/spend/bills")).filter((b) => b.external_id === externalId).map(toBill);
  }
  async getBill(id: string): Promise<AwxBill> {
    return toBill(await this.api.call<RawBill>("GET", `/spend/bills/${encodeURIComponent(id)}`));
  }
  async markPaid(id: string): Promise<AwxBill> {
    return toBill(await this.api.call<RawBill>("POST", `/spend/bills/${encodeURIComponent(id)}/mark_as_paid`));
  }
}

/** The bills rail the environment asks for: null unless AIRWALLEX_BILLS=on and Airwallex keys are set. */
export async function billsFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<BillsRail | null> {
  if (!billsOn(env)) return null;
  const { Airwallex, fromEnv } = await import("./client.js");
  const cfg = fromEnv(env);
  return cfg ? new AirwallexBillsRest(new Airwallex(cfg)) : null;
}

// --- The in-memory stand-in, for tests (never a live run) ---------------------------------------------------------------

/**
 * Airwallex Spend Bills in memory, as the sandbox behaved on 19 November: external_id is not unique, a request_id seen
 * before is refused, mark_as_paid adds an EXTERNAL payment and can be asked twice. `loseNextCreateAnswer` makes the bill
 * and loses the answer; `tamper` changes a bill on Airwallex's side so a read-back can be shown to catch it.
 */
export class FakeBills implements BillsRail {
  bills = new Map<string, AwxBill>();
  vendors = new Map<string, AwxVendor>();
  files = new Map<string, { name: string; size: number }>();
  calls: string[] = [];
  loseNextCreateAnswer = false;
  tamper: ((b: AwxBill) => void) | null = null;
  private requestIds = new Set<string>();
  private n = 0;

  async legalEntityId(): Promise<string> { this.calls.push("legalEntityId"); return "le_fake"; }
  async findVendor(externalId: string): Promise<AwxVendor | undefined> {
    this.calls.push("findVendor");
    return [...this.vendors.values()].find((v) => v.externalId === externalId);
  }
  async createVendor(v: { requestId: string; externalId: string; name: string }): Promise<AwxVendor> {
    this.calls.push("createVendor");
    this.seen(v.requestId);
    const out = { id: `ven_${++this.n}`, externalId: v.externalId, name: v.name, status: "ACTIVE" };
    this.vendors.set(out.id, out);
    return { ...out };
  }
  async uploadAttachment(f: { bytes: Uint8Array; fileName: string }): Promise<{ fileId: string; size: number | null }> {
    this.calls.push("uploadAttachment");
    if (f.fileName.length > FILE_NAME_MAX) throw Object.assign(new Error("Airwallex /files/upload -> 400 invalid_argument"), { status: 400 });
    const fileId = `file_${++this.n}`;
    this.files.set(fileId, { name: f.fileName, size: f.bytes.length });
    return { fileId, size: f.bytes.length };
  }
  async createBill(b: BillIn): Promise<AwxBill> {
    this.calls.push("createBill");
    this.seen(b.requestId);
    if (![...this.vendors.values()].some((v) => v.id === b.vendorId)) throw Object.assign(new Error("Airwallex /spend/bills/create -> 400 invalid_argument"), { status: 400, code: "invalid_argument" });
    const at = new Date(Date.UTC(2026, 10, 19, 12, 0, this.n)).toISOString();
    const bill: AwxBill = {
      id: `bill_${++this.n}`, externalId: b.externalId, invoiceNumber: b.invoiceNumber, status: "AWAITING_PAYMENT", syncStatus: "NOT_SYNCED",
      currency: b.currency, amount: money(b.total), dueDate: b.dueDate, issuedDate: b.issuedDate, vendorId: b.vendorId, description: b.description,
      attachmentIds: b.attachmentIds.filter((id) => this.files.has(id)), payments: [], createdAt: at, updatedAt: at,
    };
    this.bills.set(bill.id, bill);
    if (this.tamper) { this.tamper(bill); this.tamper = null; }
    if (this.loseNextCreateAnswer) { this.loseNextCreateAnswer = false; throw new AirwallexAmbiguous("/spend/bills/create", new Error("network: no answer")); }
    return structuredClone(bill);
  }
  async findBills(externalId: string): Promise<AwxBill[]> {
    this.calls.push("findBills");
    return [...this.bills.values()].filter((b) => b.externalId === externalId).map((b) => structuredClone(b));
  }
  async getBill(id: string): Promise<AwxBill> {
    this.calls.push("getBill");
    const b = this.bills.get(id);
    if (!b) throw Object.assign(new Error(`Airwallex /spend/bills/${id} -> 404 resource_not_found`), { status: 404 });
    return structuredClone(b);
  }
  async markPaid(id: string): Promise<AwxBill> {
    this.calls.push("markPaid");
    const b = this.bills.get(id);
    if (!b) throw Object.assign(new Error(`Airwallex /spend/bills/${id}/mark_as_paid -> 404 resource_not_found`), { status: 404 });
    if (b.status !== "PAID") {
      b.status = "PAID";
      b.payments.push({ id: `bp_${++this.n}`, type: "EXTERNAL", amount: b.amount, currency: b.currency, transferId: null });
    }
    return structuredClone(b);
  }
  private seen(requestId: string): void {
    if (this.requestIds.has(requestId)) throw Object.assign(new Error("Airwallex -> 400 invalid_argument"), { status: 400, code: "invalid_argument" });
    this.requestIds.add(requestId);
  }
}
