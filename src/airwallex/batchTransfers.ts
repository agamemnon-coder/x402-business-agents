// Airwallex Batch Transfers (docs: payouts/batch-transfers/create-a-batch-transfer; API: payouts/batch_transfers, read
// 12 November 2026): one Airwallex object for a whole list of payouts. Purser uses it for a batch the CFO signed with one
// Face ID (src/policy/batch.ts): the signed list becomes ONE batch at Airwallex, is read back and compared item by item
// before it is submitted, and Airwallex's own approval workflow still applies to it (a batch created by API waits
// IN_APPROVAL when "Require API-initiated transfers to go through the same approval workflow?" is Yes).
//
// Flow at Airwallex: create (DRAFTING) → add_items (≤ 100 per call) → quote (optional; fills each item's transfer_draft)
// → list items → submit (→ IN_APPROVAL or SCHEDULED). Only a DRAFTING batch can be deleted. A batch create with a
// request_id Airwallex has seen is rejected, so a lost answer is resolved by listing batches by that request_id; an item
// sent again under its request_id is ignored by Airwallex (safe to replay).
//
// On by default since 13 November (AIRWALLEX_BATCH_TRANSFER=off is an emergency stop only: the batch then runs line by
// line, as before). Amounts are converted to integer cents here and nowhere else.

import { cents } from "./adapter.js";
import type { Airwallex } from "./client.js";
import { fromCents } from "../lib/money.js";

export const BATCH_TRANSFER_FLAG = "AIRWALLEX_BATCH_TRANSFER";
export const batchTransferOn = (env: Record<string, string | undefined> = process.env): boolean => env[BATCH_TRANSFER_FLAG] !== "off";

/** The batch statuses Airwallex documents (batch-transfer-statuses). */
export const BATCH_STATUSES = ["DRAFTING", "IN_APPROVAL", "APPROVAL_RECALLED", "APPROVAL_REJECTED", "APPROVAL_BLOCKED", "SCHEDULED", "OVERDUE", "BOOKING", "PARTIALLY_BOOKED", "BOOKED", "FAILED", "CANCELLED", "CANCELLATION_REQUESTED"] as const;

/** One payout of a batch, in our terms. */
export interface BatchItemIn {
  requestId: string;
  beneficiaryId: string;
  amountCents: number;
  currency: string;
  sourceCurrency: string;
  method: "SWIFT" | "LOCAL";
  reference: string;
  reason: string;
  /** Each line's own approval hash, and the batch's, in the item's metadata at Airwallex. */
  metadata: Record<string, string>;
}

export interface AwxBatch {
  id: string;
  requestId: string;
  status: string;
  shortReference: string | null;
  totalItemCount: number;
  validItemCount: number;
  metadata: Record<string, string>;
  /** Per currency pair, what the payer pays and the fee, from quote_summary (after a quote). */
  quotes: { sourceCurrency: string; transferCurrency: string; payerPaysCents: number; feeCents: number; feeCurrency: string | null }[];
  quoteExpiresAt: string | null;
}

export interface AwxBatchItem {
  id: string;
  requestId: string;
  status: string;
  transferId: string | null;
  errors: string[];
  /** The transfer as Airwallex will book it (after a quote, until BOOKED); null when Airwallex shows none. */
  draft: null | {
    beneficiaryId: string | null;
    amountCents: number;
    currency: string;
    sourceCurrency: string;
    method: string;
    reference: string;
    reason: string | null;
    feeCents: number | null;
    feeCurrency: string | null;
    payerPaysCents: number | null;
    metadata: Record<string, string>;
  };
}

export interface BatchTransferRail {
  /** The connected account this client acts for (x-on-behalf-of), or null for the company's own account. */
  readonly payingAccount?: string | null;
  createBatch(a: { requestId: string; name: string; metadata: Record<string, string> }): Promise<AwxBatch>;
  /** The batch created under this request_id, if any (GET /batch_transfers?request_id=…, strict). */
  findBatchByRequestId(requestId: string): Promise<AwxBatch | undefined>;
  getBatch(id: string): Promise<AwxBatch>;
  addItems(id: string, items: BatchItemIn[]): Promise<AwxBatch>;
  quoteBatch(id: string, validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1"): Promise<AwxBatch>;
  listItems(id: string): Promise<AwxBatchItem[]>;
  submitBatch(id: string): Promise<AwxBatch>;
  /** Only a DRAFTING batch. */
  deleteBatch(id: string): Promise<void>;
}

// --- The REST mapping -----------------------------------------------------------------------------------------------

interface RawBatch {
  id: string; request_id: string; status: string; short_reference_id?: string | null;
  total_item_count?: number; valid_item_count?: number; metadata?: Record<string, string> | null;
  quote_summary?: { expires_at?: string | null; quotes?: { amount_payer_pays?: number | string; fee_amount?: number | string; fee_currency?: string; source_currency?: string; transfer_currency?: string }[] } | null;
}
interface RawItem {
  id: string; request_id: string; status: string; transfer_id?: string | null;
  errors?: { code?: string; source?: string }[] | null;
  transfer_draft?: {
    beneficiary_id?: string | null; transfer_amount?: number | string; transfer_currency?: string; source_currency?: string;
    transfer_method?: string; reference?: string; reason?: string | null; fee_amount?: number | string | null; fee_currency?: string | null;
    amount_payer_pays?: number | string | null; metadata?: Record<string, string> | null;
  } | null;
}

const optCents = (v: unknown): number | null => (v == null || v === "" ? null : cents(v));

export function toBatch(b: RawBatch): AwxBatch {
  return {
    id: b.id, requestId: b.request_id, status: b.status, shortReference: b.short_reference_id ?? null,
    totalItemCount: b.total_item_count ?? 0, validItemCount: b.valid_item_count ?? 0, metadata: b.metadata ?? {},
    quotes: (b.quote_summary?.quotes ?? []).map((q) => ({
      sourceCurrency: q.source_currency ?? "", transferCurrency: q.transfer_currency ?? "",
      payerPaysCents: cents(q.amount_payer_pays ?? 0), feeCents: cents(q.fee_amount ?? 0), feeCurrency: q.fee_currency ?? null,
    })),
    quoteExpiresAt: b.quote_summary?.expires_at ?? null,
  };
}

export function toItem(i: RawItem): AwxBatchItem {
  const d = i.transfer_draft;
  return {
    id: i.id, requestId: i.request_id, status: i.status, transferId: i.transfer_id ?? null,
    errors: (i.errors ?? []).map((e) => [e.code, e.source].filter(Boolean).join(" at ")),
    draft: d ? {
      beneficiaryId: d.beneficiary_id ?? null, amountCents: cents(d.transfer_amount ?? 0), currency: d.transfer_currency ?? "",
      sourceCurrency: d.source_currency ?? "", method: d.transfer_method ?? "", reference: d.reference ?? "", reason: d.reason ?? null,
      feeCents: optCents(d.fee_amount), feeCurrency: d.fee_currency ?? null, payerPaysCents: optCents(d.amount_payer_pays), metadata: d.metadata ?? {},
    } : null,
  };
}

/** add_items' body for one payout: a saved beneficiary, exactly the signed amount, currencies, method and texts. */
export function itemBody(i: BatchItemIn): Record<string, unknown> {
  return {
    request_id: i.requestId, beneficiary_id: i.beneficiaryId, transfer_amount: fromCents(i.amountCents), transfer_currency: i.currency,
    source_currency: i.sourceCurrency, transfer_method: i.method, reference: i.reference, reason: i.reason, metadata: i.metadata,
  };
}

export class AirwallexBatchRest implements BatchTransferRail {
  constructor(private readonly api: Airwallex) {}
  get payingAccount(): string | null { return this.api.onBehalfOf; }

  async createBatch(a: { requestId: string; name: string; metadata: Record<string, string> }): Promise<AwxBatch> {
    // Wallet-funded (no funding_source) and no transfer_date: dispatched as soon as Airwallex (and its approvers) allow.
    return toBatch(await this.api.call<RawBatch>("POST", "/batch_transfers/create", { request_id: a.requestId, name: a.name, metadata: a.metadata }));
  }
  async findBatchByRequestId(requestId: string): Promise<AwxBatch | undefined> {
    const r = await this.api.call<{ items?: RawBatch[]; page_after?: string | null }>("GET", "/batch_transfers", undefined, { request_id: requestId });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's batch list came without items");
    if (r.page_after || r.items.some((b) => b.request_id !== requestId)) throw new Error("Airwallex's batch list was not filtered by the request_id");
    if (r.items.length > 1) throw new Error(`Airwallex lists more than one batch under request_id ${requestId}`);
    return r.items[0] ? toBatch(r.items[0]) : undefined;
  }
  async getBatch(id: string): Promise<AwxBatch> {
    return toBatch(await this.api.call<RawBatch>("GET", `/batch_transfers/${encodeURIComponent(id)}`));
  }
  async addItems(id: string, items: BatchItemIn[]): Promise<AwxBatch> {
    if (items.length === 0 || items.length > 100) throw new Error("add_items takes 1 to 100 items per call");
    return toBatch(await this.api.call<RawBatch>("POST", `/batch_transfers/${encodeURIComponent(id)}/add_items`, { items: items.map(itemBody) }));
  }
  async quoteBatch(id: string, validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1"): Promise<AwxBatch> {
    return toBatch(await this.api.call<RawBatch>("POST", `/batch_transfers/${encodeURIComponent(id)}/quote`, { validity }));
  }
  async listItems(id: string): Promise<AwxBatchItem[]> {
    const r = await this.api.call<{ items?: RawItem[]; page_after?: string | null }>("GET", `/batch_transfers/${encodeURIComponent(id)}/items`, undefined, { page_size: "1000" });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's item list came without items");
    // One page holds up to 1000 items; a batch from Purser holds at most 50 (BATCH_MAX_LINES). More pages is an error.
    if (r.page_after) throw new Error("Airwallex's item list has more pages than a Purser batch can hold");
    return r.items.map(toItem);
  }
  async submitBatch(id: string): Promise<AwxBatch> {
    return toBatch(await this.api.call<RawBatch>("POST", `/batch_transfers/${encodeURIComponent(id)}/submit`));
  }
  async deleteBatch(id: string): Promise<void> {
    await this.api.call<unknown>("POST", `/batch_transfers/${encodeURIComponent(id)}/delete`);
  }
}

// --- The in-memory stand-in, for tests (never a live run) ---------------------------------------------------------------

interface FakeBatch { batch: AwxBatch; items: (AwxBatchItem & { input: BatchItemIn })[] }

/**
 * Airwallex batch transfers in memory, following the documented lifecycle. `approvalWorkflow` holds a submitted batch
 * IN_APPROVAL until `decideInWebApp`; `tamper` lets a test change what Airwallex would book (as if an item were edited
 * or dropped on Airwallex's side) to show the read-back refuses it.
 */
export class FakeBatchTransfers implements BatchTransferRail {
  batches = new Map<string, FakeBatch>();
  calls: string[] = [];
  approvalWorkflow = true;
  /** Beneficiary ids Airwallex holds; an item to any other id fails validation. Null: any id is accepted. */
  knownBeneficiaries: Set<string> | null = null;
  /** The SWIFT fee per item, in the source currency. */
  feeCents = 1340;
  /** Lose the answer to the next batch create (the batch is still made). */
  loseNextCreateAnswer = false;
  /** Change what Airwallex holds after add_items: (items) => void. */
  tamper: ((items: (AwxBatchItem & { input: BatchItemIn })[]) => void) | null = null;
  private n = 0;

  private get(id: string): FakeBatch {
    const b = this.batches.get(id);
    if (!b) throw Object.assign(new Error(`Airwallex /batch_transfers/${id} -> 404 not_found`), { status: 404 });
    return b;
  }
  private view(b: FakeBatch): AwxBatch {
    const valid = b.items.filter((i) => i.status !== "VALIDATION_FAILED");
    b.batch.totalItemCount = b.items.length;
    b.batch.validItemCount = valid.length;
    return structuredClone(b.batch);
  }

  async createBatch(a: { requestId: string; name: string; metadata: Record<string, string> }): Promise<AwxBatch> {
    this.calls.push("createBatch");
    if ([...this.batches.values()].some((b) => b.batch.requestId === a.requestId)) throw Object.assign(new Error("Airwallex /batch_transfers/create -> 400 duplicate_request_id"), { status: 400, code: "duplicate_request_id" });
    const id = `btr_${++this.n}`;
    const fb: FakeBatch = { batch: { id, requestId: a.requestId, status: "DRAFTING", shortReference: `B261112-${this.n}`, totalItemCount: 0, validItemCount: 0, metadata: { ...a.metadata }, quotes: [], quoteExpiresAt: null }, items: [] };
    this.batches.set(id, fb);
    if (this.loseNextCreateAnswer) { this.loseNextCreateAnswer = false; throw new Error("network: no answer"); }
    return this.view(fb);
  }
  async findBatchByRequestId(requestId: string): Promise<AwxBatch | undefined> {
    this.calls.push("findBatchByRequestId");
    const b = [...this.batches.values()].find((x) => x.batch.requestId === requestId);
    return b ? this.view(b) : undefined;
  }
  async getBatch(id: string): Promise<AwxBatch> { this.calls.push("getBatch"); return this.view(this.get(id)); }
  async addItems(id: string, items: BatchItemIn[]): Promise<AwxBatch> {
    this.calls.push("addItems");
    const b = this.get(id);
    if (b.batch.status !== "DRAFTING") throw Object.assign(new Error("Airwallex add_items -> 400 batch not DRAFTING"), { status: 400 });
    for (const i of items) {
      if (b.items.some((x) => x.requestId === i.requestId)) continue; // the same request_id is ignored
      const ok = !this.knownBeneficiaries || this.knownBeneficiaries.has(i.beneficiaryId);
      b.items.push({ id: `bti_${++this.n}`, requestId: i.requestId, status: ok ? "VALIDATED" : "VALIDATION_FAILED", transferId: null, errors: ok ? [] : ["beneficiary_not_found at beneficiary_id"], draft: null, input: structuredClone(i) });
    }
    if (this.tamper) { this.tamper(b.items); this.tamper = null; }
    return this.view(b);
  }
  async quoteBatch(id: string): Promise<AwxBatch> {
    this.calls.push("quoteBatch");
    const b = this.get(id);
    const pairs = new Map<string, { sourceCurrency: string; transferCurrency: string; payerPaysCents: number; feeCents: number; feeCurrency: string }>();
    for (const i of b.items) {
      if (i.status === "VALIDATION_FAILED") continue;
      const x = i.input;
      i.draft = { beneficiaryId: x.beneficiaryId, amountCents: x.amountCents, currency: x.currency, sourceCurrency: x.sourceCurrency, method: x.method, reference: x.reference, reason: x.reason, feeCents: this.feeCents, feeCurrency: x.sourceCurrency, payerPaysCents: x.amountCents + this.feeCents, metadata: { ...x.metadata } };
      const k = `${x.sourceCurrency}${x.currency}`;
      const p = pairs.get(k) ?? { sourceCurrency: x.sourceCurrency, transferCurrency: x.currency, payerPaysCents: 0, feeCents: 0, feeCurrency: x.sourceCurrency };
      p.payerPaysCents += x.amountCents + this.feeCents;
      p.feeCents += this.feeCents;
      pairs.set(k, p);
    }
    b.batch.quotes = [...pairs.values()];
    b.batch.quoteExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return this.view(b);
  }
  async listItems(id: string): Promise<AwxBatchItem[]> {
    this.calls.push("listItems");
    return structuredClone(this.get(id).items).map(({ input: _input, ...rest }) => rest);
  }
  async submitBatch(id: string): Promise<AwxBatch> {
    this.calls.push("submitBatch");
    const b = this.get(id);
    if (b.batch.status !== "DRAFTING") throw Object.assign(new Error(`Airwallex submit -> 400 batch is ${b.batch.status}`), { status: 400 });
    b.batch.status = this.approvalWorkflow ? "IN_APPROVAL" : "SCHEDULED";
    if (!this.approvalWorkflow) this.book(b);
    return this.view(b);
  }
  async deleteBatch(id: string): Promise<void> {
    this.calls.push("deleteBatch");
    const b = this.get(id);
    if (b.batch.status !== "DRAFTING") throw Object.assign(new Error("Airwallex delete -> 400 batch not DRAFTING"), { status: 400 });
    b.batch.status = "CANCELLED";
  }
  /** A person at Airwallex approves or rejects the batch in the web app (never Purser). */
  decideInWebApp(id: string, decision: "approve" | "reject"): void {
    const b = this.get(id);
    if (b.batch.status !== "IN_APPROVAL") throw new Error(`batch ${id} is ${b.batch.status}`);
    if (decision === "reject") { b.batch.status = "APPROVAL_REJECTED"; return; }
    b.batch.status = "SCHEDULED";
    this.book(b);
  }
  private book(b: FakeBatch): void {
    for (const i of b.items) if (i.status === "VALIDATED") { i.status = "BOOKED"; i.transferId = `tr_b${++this.n}`; i.draft = null; }
    b.batch.status = "BOOKED";
  }
}
