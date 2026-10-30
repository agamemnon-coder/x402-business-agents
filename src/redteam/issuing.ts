// In-memory stand-in for Airwallex Issuing, for the unit tests and the red team's throwaway world (never a live run).
// It declines like the sandbox did on 2026-10-29: over the per-transaction or the monthly limit gives FAILED with
// LIMIT_EXCEEDED, and an inactive card gives CARD_INACTIVE. Live, Airwallex itself enforces these.

import type { Card, CardControls, CardLimits, Cardholder, CardTransaction, IssuingRail, IssuingSim } from "../airwallex/issuing.js";

export class FakeIssuing implements IssuingRail, IssuingSim {
  holders: Cardholder[] = [];
  cards: Card[] = [];
  txs: CardTransaction[] = [];
  calls: string[] = [];
  n = 0;
  clock = () => Date.now();

  async findCardholderByEmail(email: string) { this.calls.push("findCardholder"); return this.holders.find((h) => h.email === email); }
  async createCardholder(a: { email: string; firstName: string; lastName: string }) {
    this.calls.push("createCardholder");
    const h = { id: `ch_${++this.n}`, email: a.email, status: "READY" };
    this.holders.push(h);
    return { ...h };
  }
  async findCard(cardholderId: string, nickname: string) {
    this.calls.push("findCard");
    const c = this.cards.find((x) => x.cardholderId === cardholderId && x.nickname === nickname);
    return c && structuredClone(c);
  }
  async createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits; controls?: CardControls }) {
    this.calls.push("createCard");
    const n = ++this.n;
    const controls: CardControls = a.controls ? { mccs: [...a.controls.mccs].sort(), currencies: [...a.controls.currencies].sort(), activeTo: a.controls.activeTo, ...(a.controls.singleUse ? { singleUse: true } : {}) } : { mccs: [], currencies: [], activeTo: null };
    const c: Card = { cardId: `card_${n}`, cardholderId: a.cardholderId, last4: String(4000 + n), status: "ACTIVE", nickname: a.nickname, limits: { ...a.limits }, controls };
    this.cards.push(c);
    return structuredClone(c);
  }
  async getCard(cardId: string) { this.calls.push("getCard"); return structuredClone(this.card(cardId)); }
  async setCardLimits(cardId: string, limits: CardLimits) {
    this.calls.push("setCardLimits");
    this.card(cardId).limits = { ...limits };
    return structuredClone(this.card(cardId));
  }
  async setCardControls(cardId: string, controls: Pick<CardControls, "mccs" | "currencies">) {
    this.calls.push("setCardControls");
    const c = this.card(cardId);
    c.controls = { mccs: [...controls.mccs].sort(), currencies: [...controls.currencies].sort(), activeTo: c.controls?.activeTo ?? null, ...(c.controls?.singleUse ? { singleUse: true } : {}) };
    return structuredClone(c);
  }
  async setCardStatus(cardId: string, status: "ACTIVE" | "INACTIVE") {
    this.calls.push("setCardStatus");
    this.card(cardId).status = status;
    return structuredClone(this.card(cardId));
  }
  async listCardTransactions(cardId: string) { this.calls.push("listTx"); return this.txs.filter((t) => t.cardId === cardId).map((t) => ({ ...t })).reverse(); }
  async simulateCardCharge(a: { cardId: string; amountCents: number; currency: "EUR"; merchant: string; mcc: string }) {
    this.calls.push("charge");
    const card = this.card(a.cardId);
    const month = new Date(this.clock()).toISOString().slice(0, 7);
    const spent = this.txs.filter((t) => t.cardId === a.cardId && t.approved && t.occurredAt.startsWith(month)).reduce((s, t) => s + t.amountCents, 0);
    const inactive = card.status !== "ACTIVE";
    // Empty lists allow everything, as at Airwallex (the sandbox declined these two codes on 2026-10-30).
    const category = !!card.controls?.mccs.length && !card.controls.mccs.includes(a.mcc);
    const currency = !!card.controls?.currencies.length && !card.controls.currencies.includes(a.currency);
    const limit = !card.limits || a.amountCents > card.limits.perTxCents || spent + a.amountCents > card.limits.monthlyCents;
    // Airwallex allows one successful debit on a single-use card. SINGLE_USE_SPENT is this fake's own word until the
    // sandbox shows the reason it gives.
    const spentOnce = !!card.controls?.singleUse && this.txs.some((t) => t.cardId === a.cardId && t.approved);
    const reason = inactive ? "CARD_INACTIVE" : spentOnce ? "SINGLE_USE_SPENT" : category ? "MERCHANT_CATEGORY_NOT_ALLOWED" : currency ? "CURRENCY_NOT_ALLOWED" : limit ? "LIMIT_EXCEEDED" : null;
    const over = reason !== null;
    const t: CardTransaction = {
      transactionId: `tx_${++this.n}`, cardId: a.cardId, amountCents: a.amountCents, currency: a.currency,
      status: over ? "FAILED" : "PENDING", approved: !over, failureReason: reason,
      merchant: a.merchant, mcc: a.mcc, type: "AUTHORIZATION", occurredAt: new Date(this.clock()).toISOString(),
    };
    this.txs.push(t);
    return { ...t };
  }
  private card(id: string): Card {
    const c = this.cards.find((x) => x.cardId === id);
    if (!c) throw new Error(`no card ${id}`);
    return c;
  }
}
