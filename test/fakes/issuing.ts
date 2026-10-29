// In-memory stand-in for Airwallex Issuing, for unit tests only. It declines like the sandbox did on 2026-10-29:
// over the per-transaction or the monthly limit gives FAILED with LIMIT_EXCEEDED.

import type { Card, CardLimits, Cardholder, CardTransaction, IssuingRail, IssuingSim } from "../../src/airwallex/issuing.js";

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
  async createCard(a: { cardholderId: string; nickname: string; createdBy: string; limits: CardLimits }) {
    this.calls.push("createCard");
    const n = ++this.n;
    const c: Card = { cardId: `card_${n}`, cardholderId: a.cardholderId, last4: String(4000 + n), status: "ACTIVE", nickname: a.nickname, limits: { ...a.limits } };
    this.cards.push(c);
    return structuredClone(c);
  }
  async getCard(cardId: string) { this.calls.push("getCard"); return structuredClone(this.card(cardId)); }
  async setCardLimits(cardId: string, limits: CardLimits) {
    this.calls.push("setCardLimits");
    this.card(cardId).limits = { ...limits };
    return structuredClone(this.card(cardId));
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
    const over = inactive || !card.limits || a.amountCents > card.limits.perTxCents || spent + a.amountCents > card.limits.monthlyCents;
    const t: CardTransaction = {
      transactionId: `tx_${++this.n}`, cardId: a.cardId, amountCents: a.amountCents, currency: a.currency,
      status: over ? "FAILED" : "PENDING", approved: !over, failureReason: inactive ? "CARD_INACTIVE" : over ? "LIMIT_EXCEEDED" : null,
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
