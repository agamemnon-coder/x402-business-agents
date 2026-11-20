// Purser Cloud's two banks behind one rail (14 Nov): the Airwallex sandbox (through the gateway, test money) and the
// simulated bank (the engine's stand-in, test money). The engine's own code runs unchanged on top: a new supplier, a
// quote for the shortfall, the conversion and the payout after the CFO's signature, the sandbox's settlement to PAID,
// one batch transfer for a signed batch. What this file adds is only where each call goes:
//
//   - a call that names an object (a payee, a quote, a transfer, a request_id) goes to the bank that made it;
//   - a call that names none (balances, a rate, a new quote, a new payee) goes to the bank of the action under way
//     (`within`), which the Cloud chooses per action: the payee's bank, or the simulated bank when Airwallex is off;
//   - a payee made at Airwallex also gets a twin at the simulated bank, so a payment can fall back there, labelled;
//   - every money call at Airwallex is first spoken for under the daily caps (ActGuard.spend), once per request_id,
//     and freed again only when Airwallex refused it outright.
//
// Nothing here falls back on its own after a signature: the signed terms name the bank's own ids (payee, quote), so a
// payment whose Airwallex call fails stays failed, with its reason; a new plan may go to the simulated bank, labelled.

import type { AnyQuote, AirwallexRail, Balance, Beneficiary, Conversion, Currency, Deposit, MarketRate, NewBeneficiary, NewPayoutBeneficiary, NewPayoutTransfer, NewTransfer, PayoutRail, Quote, SandboxSim, Transfer } from "./port.js";
import type { AwxBatch, AwxBatchItem, BatchItemIn, BatchTransferRail } from "./batchTransfers.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { AirwallexAmbiguous, AirwallexError } from "./client.js";

export type Bank = "airwallex" | "simulated";
export type Rails3 = AirwallexRail & PayoutRail & SandboxSim;

/** Which bank made an object, and its twin at the simulated bank (a payee made at Airwallex). */
export interface RouteRow { bank: Bank; twin: string | null }
export interface RouteStore {
  get(key: string): RouteRow | null;
  set(key: string, row: RouteRow): void;
}

export type SpendKind = "conversion" | "transfer" | "batch_item" | "deposit";

/** The Cloud's switches and caps in front of every Airwallex call (cloud/src/engine/awxAct.ts). */
export interface ActGuard {
  /** null: Airwallex may be used now; else why not, in a few words. */
  blocked(): Promise<string | null>;
  /** Speaks for an amount under the company's and the global daily caps, once per key; throws ActCapReached over a cap. */
  spend(a: { key: string; kind: SpendKind; currency: string; cents: number }): Promise<void>;
  /** Airwallex refused the call outright: the key's amount is free again. */
  release(key: string): Promise<void>;
}

export class ActCapReached extends Error {
  readonly code = "awx_cap_reached";
  constructor(readonly reason: string) { super(reason); this.name = "ActCapReached"; }
}
export class ActOff extends Error {
  readonly code = "awx_off";
  constructor(readonly reason: string) { super(`Airwallex sandbox not used: ${reason}`); this.name = "ActOff"; }
}

/** The currencies a Cloud action may move at Airwallex (two decimals, counted together under the caps). */
export const ACT_CURRENCIES: ReadonlySet<string> = new Set(["EUR", "USD", "GBP"]);

/** The simulated bank's own ids (ben_1, tr_2, q_3 …); anything else was made at Airwallex. */
const SIM_ID = /^[a-z]+_\d+$/;

/**
 * Airwallex's answer that this request_id already made something: money may have moved, so it is not a refusal. Seen
 * live on 20 Nov (docs/runs/2026-11-20-airwallex-replay.md): transfers/create answers duplicate_request_id and
 * batch_transfers/create batch_request_id_duplicate; the other two are kept from before.
 */
const DUPLICATE_CODES: ReadonlySet<string> = new Set(["duplicate_request_id", "request_id_duplicate", "duplicate_request", "batch_request_id_duplicate"]);

/**
 * An Airwallex refusal that moved nothing (4xx), as opposed to a lost answer. A duplicate request_id is not one: the
 * first send went through (security sweep, 15 Nov), so its amount stays spoken for under the caps. Nor is a conversion
 * create answered invalid_argument: on 20 Nov the sandbox answered a repeated conversion under one request_id with
 * exactly that, not a duplicate code (docs/runs/2026-11-20-airwallex-replay.md), so it cannot be told from a first send
 * that went through.
 */
export const refusedOutright = (e: unknown): boolean =>
  e instanceof AirwallexError && e.status >= 400 && e.status < 500 && !(e.code && DUPLICATE_CODES.has(e.code))
  && !(e.code === "invalid_argument" && e.path.endsWith("/fx/conversions/create"));

/** Words for an Airwallex-side failure: its code or reason, never Airwallex's own message (it can name a payee). */
export function failureWords(e: unknown): string {
  if (e instanceof ActOff || e instanceof ActCapReached) return e.reason;
  if (e instanceof AirwallexError) return `Airwallex answered HTTP ${e.status}${e.code ? ` ${e.code}` : ""}${e.traceId ? ` (trace ${e.traceId})` : ""}`;
  if (e instanceof AirwallexAmbiguous) return "Airwallex gave no answer";
  if ((e as { name?: string })?.name === "GatewayRefused") return (e as Error).message;
  return (e as Error)?.message?.slice(0, 200) ?? String(e);
}

/** One action's bank, its first Airwallex-side failure, and where its payee look-up went (per async context). */
interface ActionCtx { bank: Bank; failure: string | null; payeesHere: Bank | null }

export class RoutedRail implements AirwallexRail, PayoutRail, SandboxSim {
  private readonly als = new AsyncLocalStorage<ActionCtx>();
  private readonly root: ActionCtx = { bank: "simulated", failure: null, payeesHere: null };
  private get ctx(): ActionCtx { return this.als.getStore() ?? this.root; }
  private readonly awx: Rails3;

  constructor(
    awx: Rails3,
    private readonly sim: Rails3,
    private readonly routes: RouteStore,
    private readonly guard: ActGuard,
    private readonly awxBatches?: BatchTransferRail,
    /** A step that went to the simulated bank instead (a payee or a deposit, never money after a signature), in words. */
    private readonly onFallback: (what: string, why: string) => void = () => undefined,
  ) {
    // Every Airwallex call: its failure is remembered for the action's fallback decision, then thrown as it came.
    this.awx = new Proxy(awx, {
      get: (t, k) => {
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (typeof v !== "function") return v;
        return async (...a: unknown[]) => {
          try { return await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a); } catch (e) { this.ctx.failure ??= failureWords(e); throw e; }
        };
      },
    });
  }

  /** The bank of the action under way. */
  get current(): Bank { return this.ctx.bank; }
  /** The first Airwallex-side failure of the action under way, in words; null when none. */
  get failure(): string | null { return this.ctx.failure; }

  /**
   * Runs one action with its bank: calls that name no object go there. The bank travels with the action's own async
   * context, so two requests to one company's engine at the same moment never see each other's bank.
   */
  within<T>(bank: Bank, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ bank, failure: null, payeesHere: null }, fn);
  }

  /** The bank that made an object, by its key ("ben:…", "quote:…", "req:…", "tr:…"), or null when unknown. */
  routeOf(key: string): RouteRow | null { return this.routes.get(key); }

  /** The bank of an id this rail never recorded: the simulated bank's own shape, else Airwallex. */
  bankOfId(kind: "ben" | "quote" | "tr", id: string): Bank {
    return this.routes.get(`${kind}:${id}`)?.bank ?? (SIM_ID.test(id) ? "simulated" : "airwallex");
  }

  private open(): Promise<Rails3> { return this.on(this.ctx.bank); }

  private async on(bank: Bank): Promise<Rails3> {
    if (bank === "simulated") return this.sim;
    const why = await this.guard.blocked();
    if (why) { this.ctx.failure ??= why; throw new ActOff(why); }
    return this.awx;
  }

  /**
   * A step that moves no money (a new payee, a deposit in): at Airwallex when the action is there, and at the simulated
   * bank instead when Airwallex is off or fails, labelled. A lost answer is not retried elsewhere: it may have happened.
   */
  private async orSimulated<T>(what: string, fn: (r: Rails3, bank: Bank) => Promise<T>): Promise<{ value: T; bank: Bank }> {
    if (this.ctx.bank === "simulated") return { value: await fn(this.sim, "simulated"), bank: "simulated" };
    try {
      return { value: await fn(await this.on("airwallex"), "airwallex"), bank: "airwallex" };
    } catch (e) {
      if (e instanceof AirwallexAmbiguous) throw e;
      this.ctx.failure ??= failureWords(e);
      this.onFallback(what, failureWords(e));
      return { value: await fn(this.sim, "simulated"), bank: "simulated" };
    }
  }

  /** A money call at Airwallex: spoken for first; freed only when Airwallex refused it outright. */
  private async money<T>(key: string, kind: SpendKind, currency: string, cents: number, fn: () => Promise<T>): Promise<T> {
    if (!ACT_CURRENCIES.has(currency)) { const e = new ActOff(`${currency} is not moved at the Airwallex sandbox from Cloud (EUR, USD, GBP only)`); this.ctx.failure ??= e.reason; throw e; }
    try { await this.guard.spend({ key, kind, currency, cents }); } catch (e) { this.ctx.failure ??= failureWords(e); throw e; }
    try {
      return await fn();
    } catch (e) {
      if (refusedOutright(e)) await this.guard.release(key);
      throw e;
    }
  }

  // ---- Reads and plans: the action's bank -------------------------------------------------------------------------

  async balances(): Promise<Partial<Record<Currency, Balance>>> { return (await this.open()).balances(); }
  async balancesAll(): Promise<Record<string, Balance>> { return (await this.open()).balancesAll(); }
  /** The USD account money comes in to: the action's bank's (the simulated bank's when Airwallex is off or fails). */
  async usdGlobalAccountId(): Promise<string> { return (await this.orSimulated("the USD account", (r) => r.usdGlobalAccountId())).value; }
  async findDepositsByReference(reference: string, since: string): Promise<Deposit[]> { return (await this.open()).findDepositsByReference(reference, since); }
  async currentRate(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number }): Promise<MarketRate> { return (await this.open()).currentRate(a); }
  async currentRateAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate> { return (await this.open()).currentRateAny(a); }

  async createQuote(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<Quote> {
    const bank = this.ctx.bank;
    const q = await (await this.open()).createQuote(a);
    this.routes.set(`quote:${q.quoteId}`, { bank, twin: null });
    return q;
  }
  async createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<AnyQuote> {
    const bank = this.ctx.bank;
    const q = await (await this.open()).createQuoteAny(a);
    this.routes.set(`quote:${q.quoteId}`, { bank, twin: null });
    return q;
  }

  // ---- Conversions: the quote's bank ------------------------------------------------------------------------------

  async createConversion(a: { requestId: string; quote: Quote; approvalSha256: string }): Promise<Conversion> {
    return this.convert(a.requestId, a.quote.quoteId, a.quote.sellCurrency, a.quote.sellAmountCents, (r) => r.createConversion(a));
  }
  async createConversionAny(a: { requestId: string; quote: AnyQuote; approvalSha256: string }): Promise<Conversion> {
    return this.convert(a.requestId, a.quote.quoteId, a.quote.sellCurrency, a.quote.sellAmountCents, (r) => r.createConversionAny(a));
  }
  private async convert(requestId: string, quoteId: string, sell: string, sellCents: number, fn: (r: Rails3) => Promise<Conversion>): Promise<Conversion> {
    const bank = this.bankOfId("quote", quoteId);
    this.routes.set(`req:${requestId}`, { bank, twin: null });
    const r = await this.on(bank);
    const c = bank === "airwallex" ? await this.money(requestId, "conversion", sell, sellCents, () => fn(r)) : await fn(r);
    this.routes.set(`conv:${c.conversionId}`, { bank, twin: null });
    return c;
  }
  async findConversionByRequestId(requestId: string): Promise<Conversion | undefined> {
    return (await this.on(this.routes.get(`req:${requestId}`)?.bank ?? this.ctx.bank)).findConversionByRequestId(requestId);
  }

  // ---- Payees ------------------------------------------------------------------------------------------------------

  async findBeneficiaryByIban(iban: string): Promise<Beneficiary | undefined> { return (await this.open()).findBeneficiaryByIban(iban); }
  async createBeneficiary(b: NewBeneficiary): Promise<Beneficiary> {
    const bank = this.ctx.bank;
    const made = await (await this.open()).createBeneficiary(b);
    const twin = bank === "airwallex" ? (await this.sim.findBeneficiaryByIban(b.iban) ?? await this.sim.createBeneficiary(b)).id : null;
    this.payeeMade(made.id, bank, twin);
    return made;
  }
  async findPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string } | undefined> {
    const { value: found, bank } = await this.orSimulated(`looking up ${b.name}`, (r) => r.findPayoutBeneficiary(b));
    if (found && !this.routes.get(`ben:${found.id}`)) this.payeeMade(found.id, bank, bank === "airwallex" ? await this.simTwin(b) : null);
    // Looked up at the simulated bank after Airwallex failed: the create goes there too.
    if (bank === "simulated" && this.ctx.bank === "airwallex") this.ctx.payeesHere = "simulated";
    return found;
  }
  async createPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string }> {
    const step = (r: Rails3) => r.createPayoutBeneficiary(b);
    const { value: made, bank } = this.ctx.payeesHere === "simulated" ? { value: await step(this.sim), bank: "simulated" as Bank } : await this.orSimulated(`adding ${b.name}`, step);
    this.ctx.payeesHere = null;
    this.payeeMade(made.id, bank, bank === "airwallex" ? await this.simTwin(b) : null);
    return made;
  }
  private async simTwin(b: NewPayoutBeneficiary): Promise<string> {
    return (await this.sim.findPayoutBeneficiary(b) ?? await this.sim.createPayoutBeneficiary(b)).id;
  }

  /** The payee's id at the bank of the action: its own, or its twin at the simulated bank. */
  private payeeAt(bank: Bank, beneficiaryId: string): string {
    const made = this.bankOfId("ben", beneficiaryId);
    if (made === bank) return beneficiaryId;
    if (bank === "simulated") {
      const twin = this.routes.get(`ben:${beneficiaryId}`)?.twin;
      if (twin) return twin;
      throw new ActOff(`the payee ${beneficiaryId} is at the Airwallex sandbox only; it has no twin at the simulated bank`);
    }
    throw new ActOff(`the payee ${beneficiaryId} is at the simulated bank only, not at the Airwallex sandbox`);
  }

  // ---- Payouts: the action's bank, the payee mapped to it ------------------------------------------------------------

  async createTransfer(t: NewTransfer): Promise<Transfer> {
    return this.pay(t.requestId, t.currency, t.amountCents, t.beneficiaryId, (r, beneficiaryId) => r.createTransfer({ ...t, beneficiaryId }));
  }
  async createPayoutTransfer(t: NewPayoutTransfer): Promise<Transfer> {
    return this.pay(t.requestId, t.currency, t.amountCents, t.beneficiaryId, (r, beneficiaryId) => r.createPayoutTransfer({ ...t, beneficiaryId }));
  }
  private async pay(requestId: string, currency: string, cents: number, beneficiaryId: string, fn: (r: Rails3, beneficiaryId: string) => Promise<Transfer>): Promise<Transfer> {
    const bank = this.routes.get(`req:${requestId}`)?.bank ?? this.ctx.bank;
    const payee = this.payeeAt(bank, beneficiaryId);
    this.routes.set(`req:${requestId}`, { bank, twin: null });
    const r = await this.on(bank);
    const tr = bank === "airwallex" ? await this.money(requestId, "transfer", currency, cents, () => fn(r, payee)) : await fn(r, payee);
    this.routes.set(`tr:${tr.id}`, { bank, twin: null });
    // The signed payee, as the ledger knows it, whichever bank's id paid it.
    return { ...tr, beneficiaryId: tr.beneficiaryId == null ? tr.beneficiaryId : beneficiaryId };
  }
  async findTransferByRequestId(requestId: string): Promise<Transfer | undefined> {
    return this.found(requestId, (r) => r.findTransferByRequestId(requestId));
  }
  async findTransferByRequestIdStrict(requestId: string): Promise<Transfer | undefined> {
    return this.found(requestId, (r) => r.findTransferByRequestIdStrict(requestId));
  }
  private async found(requestId: string, fn: (r: Rails3) => Promise<Transfer | undefined>): Promise<Transfer | undefined> {
    const route = this.routes.get(`req:${requestId}`);
    const t = await fn(await this.on(route?.bank ?? this.ctx.bank));
    if (t) this.routes.set(`tr:${t.id}`, { bank: route?.bank ?? this.ctx.bank, twin: null });
    return t && this.signedPayee(t);
  }
  async getTransfer(id: string): Promise<Transfer> {
    return this.signedPayee(await (await this.on(this.bankOfId("tr", id))).getTransfer(id));
  }
  /** A transfer at the simulated bank paid to a twin answers with the payee the CFO signed for. */
  private signedPayee(t: Transfer): Transfer {
    if (!t.beneficiaryId || !SIM_ID.test(t.beneficiaryId)) return t;
    const signed = this.routes.get(`twin:${t.beneficiaryId}`)?.twin;
    return signed ? { ...t, beneficiaryId: signed } : t;
  }

  /** Records a payee made at Airwallex and its twin at the simulated bank, both ways. */
  private payeeMade(id: string, bank: Bank, twin: string | null): void {
    this.routes.set(`ben:${id}`, { bank, twin });
    if (twin) this.routes.set(`twin:${twin}`, { bank: "simulated", twin: id });
  }

  // ---- Sandbox simulations -----------------------------------------------------------------------------------------

  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    return this.signedPayee(await (await this.on(this.bankOfId("tr", id))).transitionTransfer(id, to, failureType));
  }
  async simulateDeposit(a: { globalAccountId: string; amountCents: number; reference: string; payerName: string }): Promise<Deposit> {
    const { value } = await this.orSimulated("the deposit", async (r, bank) => {
      const account = bank === "airwallex" ? a.globalAccountId : await this.sim.usdGlobalAccountId();
      const d = bank === "airwallex" ? await this.money(`dep:${a.reference}`, "deposit", "USD", a.amountCents, () => r.simulateDeposit({ ...a, globalAccountId: account })) : await r.simulateDeposit({ ...a, globalAccountId: account });
      this.routes.set(`dep:${d.id}`, { bank, twin: null });
      return d;
    });
    return value;
  }

  // ---- One batch transfer: Airwallex only, every line spoken for ----------------------------------------------------

  /** Airwallex's batch transfers, for an action at Airwallex; undefined otherwise (the engine then pays line by line). */
  get batches(): BatchTransferRail | undefined {
    if (this.ctx.bank !== "airwallex" || !this.awxBatches) return undefined;
    const b = this.awxBatches;
    const guard = this.guard;
    const open = async () => { const why = await guard.blocked(); if (why) throw new ActOff(why); };
    const routes = this.routes;
    return {
      payingAccount: b.payingAccount ?? null,
      createBatch: async (a) => { await open(); return b.createBatch(a); },
      findBatchByRequestId: async (id) => { await open(); return b.findBatchByRequestId(id); },
      getBatch: async (id) => { await open(); return b.getBatch(id); },
      addItems: async (id: string, items: BatchItemIn[]): Promise<AwxBatch> => {
        await open();
        for (const i of items) {
          if (!ACT_CURRENCIES.has(i.currency)) throw new ActOff(`${i.currency} is not moved at the Airwallex sandbox from Cloud`);
          if (this.bankOfId("ben", i.beneficiaryId) !== "airwallex") throw new ActOff(`the payee ${i.beneficiaryId} is not at the Airwallex sandbox`);
        }
        for (const i of items) {
          await guard.spend({ key: i.requestId, kind: "batch_item", currency: i.currency, cents: i.amountCents });
          routes.set(`req:${i.requestId}`, { bank: "airwallex", twin: null });
        }
        try {
          return await b.addItems(id, items);
        } catch (e) {
          if (refusedOutright(e)) for (const i of items) await guard.release(i.requestId);
          throw e;
        }
      },
      quoteBatch: async (id, v) => { await open(); return b.quoteBatch(id, v); },
      listItems: async (id): Promise<AwxBatchItem[]> => { await open(); return b.listItems(id); },
      submitBatch: async (id) => { await open(); return b.submitBatch(id); },
      deleteBatch: async (id) => {
        await open();
        // Deleted before submit: nothing it held was paid, so its lines are free again.
        const items = await b.listItems(id).catch(() => [] as AwxBatchItem[]);
        await b.deleteBatch(id);
        for (const i of items) if (i.requestId) await guard.release(i.requestId);
      },
    } as BatchTransferRail;
  }
}

/** Whether an error came from the Airwallex side of an action (off, a cap, a refusal, no answer, the gateway). */
export function fromAirwallexSide(e: unknown): boolean {
  return e instanceof ActOff || e instanceof ActCapReached || e instanceof AirwallexError || e instanceof AirwallexAmbiguous || (e as { name?: string })?.name === "GatewayRefused";
}
