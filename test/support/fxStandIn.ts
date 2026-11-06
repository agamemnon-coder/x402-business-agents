// A stand-in for the Airwallex sandbox's FX quote, for the tests and the local browser checks (no network): labelled
// "stand-in" in the terms, so nothing shows it as Airwallex's. Its rate and amounts are fixed; each quote gets a new id
// and lasts `validityMs` from its clock.
import type { FxQuote, FxSource } from "../../worker/src/fxQuote.js";

export class StandInQuotes implements FxSource {
  calls = 0;
  validityMs = 15 * 60_000;
  failing = false;
  constructor(public now: () => number = () => Date.now()) {}
  quote(a: { buyCurrency: string; sellCurrency: string; buyAmount: string }): Promise<FxQuote> {
    this.calls++;
    if (this.failing) return Promise.reject(new Error("stand-in: no quote"));
    const c = Math.round(Number(a.buyAmount) * 100 * 1.129677);
    return Promise.resolve({
      quote_id: `stand-in-${String(this.calls).padStart(4, "0")}-0000-0000-000000000000`, sell_currency: a.sellCurrency, buy_currency: a.buyCurrency,
      buy_amount: a.buyAmount, sell_amount: `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`, client_rate: "1.129677",
      valid_to_at: new Date(this.now() + this.validityMs).toISOString().replace(/\.\d{3}Z$/, "Z"), source: "stand-in",
    });
  }
}
