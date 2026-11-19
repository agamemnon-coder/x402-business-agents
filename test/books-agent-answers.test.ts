// The books agent's answer checked by code (src/agents/booksCore.ts): every figure must come from a search it ran or a
// line it was shown, with the exact amount and currency; the text may carry no other amount; an answer that cannot
// answer carries no figures or amounts. After the last refused try nothing is accepted; a second answer is refused.
import { describe, expect, it } from "vitest";
import { answerBooksTool, BOOKS_MAX_ANSWERS, type BookLine, type BooksCase, type BooksState } from "../src/agents/booksCore.js";

const line = (o: Partial<BookLine>): BookLine => ({ entry_id: 1, line_no: 1, posting_date: "2026-11-03", description: "Fabric BTX-1", account: "5000", debit_cents: 150_000, credit_cents: 0, currency: "EUR", party: "Bergtex", doc_ref: "BTX-1", memo: null, ...o } as BookLine);
const c: BooksCase = {
  question: "What did we spend on fabric in November?", today: "2026-11-19",
  chart: [{ account: "5000", name: "Stock purchases", type: "expense" }, { account: "1200", name: "Bank", type: "asset" }],
  lines: [line({}), line({ entry_id: 1, line_no: 2, account: "1200", debit_cents: 0, credit_cents: 150_000, memo: "paid" }), line({ entry_id: 2, line_no: 1, debit_cents: 20_000, currency: "USD", doc_ref: null, party: null })],
};
const fresh = (): BooksState => ({ searches: new Map(), seen: new Set(), answer: null, attempts: 0 });
const find = (s: BooksState, input: Record<string, unknown> = {}) => answerBooksTool(c, s, { name: "find_lines", input: { accounts: ["5000"], party: null, from: "2026-11-01", to: "2026-11-30", text: null, ...input } });
const answer = (s: BooksState, a: Record<string, unknown>) => answerBooksTool(c, s, { name: "answer", input: { text: "x", figures: [], cannot_answer: false, ...a } });

describe("the books agent's tools", () => {
  it("the chart, and a search with its totals per currency, or no lines", () => {
    expect(answerBooksTool(c, fresh(), { name: "chart", input: {} }).text).toBe("5000 | Stock purchases | expense\n1200 | Bank | asset");
    const s = fresh();
    const text = find(s).text;
    expect(text).toMatch(/^Q1: 2 lines\. /);
    expect(text).toContain("EUR: debits 1500.00, credits 0.00, net 1500.00 (1 lines)");
    expect(text).toContain("USD: debits 200.00");
    expect(text).toMatch(/- E2\.L1 \| 2026-11-03 \| 5000 \| - \| - \| debit 200\.00 USD/);
    expect(find(s, { accounts: ["1200"] }).text).toMatch(/credit 1500\.00 EUR \| "Fabric BTX-1 \/ paid"/);
    expect(find(s, { accounts: ["9"] }).text).toMatch(/: no lines match\.$/);
    expect(answerBooksTool(c, s, { name: "post_entry", input: {} })).toEqual({ text: "There is no tool called post_entry.", blocked: "unknown tool" });
  });

  it("accepts an answer whose every figure checks out, once", () => {
    const s = fresh();
    find(s);
    const ok = answer(s, { text: "Fabric cost EUR 1500.00 in November.", figures: [{ label: "fabric", amount: "1500.00", currency: "eur", source: "Q1", measure: "debit" }, { label: "line", amount: "1500.00", currency: "EUR", source: "E1.L1", measure: "line" }] });
    expect(ok).toEqual({ text: "Accepted: code checked every figure.", final: true });
    expect(s.answer!.figures[0]!.currency).toBe("EUR");
    expect(answer(s, { text: "again" })).toMatchObject({ blocked: "answered", final: true });
  });

  it("refuses each wrong figure with its reason", () => {
    const s = fresh();
    find(s);
    const r = answer(s, { text: "It was 1500.00 or 99.99.", figures: [
      { label: "a", amount: "1,500.00", currency: "EUR", source: "Q1", measure: "debit" },
      { label: "b", amount: "10.00", currency: "EUR", source: "E9.L9", measure: "line" },
      { label: "c", amount: "1.00", currency: "EUR", source: "E1.L1", measure: "line" },
      { label: "d", amount: "1.00", currency: "EUR", source: "Q7", measure: "net" },
      { label: "e", amount: "1.00", currency: "GBP", source: "Q1", measure: "net" },
      { label: "f", amount: "1.00", currency: "EUR", source: "Q1", measure: "credit" },
    ] });
    expect(r.blocked).toBe("figure check");
    for (const why of [
      'figure "a": amount 1,500.00 is not written like 1234.56',
      'figure "b": E9.L9 is not a line you were shown',
      'figure "c": line E1.L1 is 1500.00 EUR, not 1.00 EUR',
      'figure "d": Q7 is not one of your searches',
      'figure "e": Q1 has no lines in GBP',
      'figure "f": the credit of Q1 in EUR is 0.00, not 1.00',
      "the text has amounts that are not among your figures: 1500.00, 99.99",
    ]) expect(r.text).toContain(why);
    expect(r.text).toMatch(/ Fix it and answer again\.$/);
  });

  it("an answer that cannot answer carries no figures or amounts; an empty or figureless answer is refused; tries run out", () => {
    const s = fresh();
    expect(answer(s, { text: "The ledger cannot say; 12.00 maybe.", cannot_answer: true, figures: [{ label: "x", amount: "12.00", currency: "EUR", source: "Q1", measure: "net" }] }).text)
      .toMatch(/an answer that cannot answer carries no figures; an answer that cannot answer carries no amounts, but the text has 12\.00/);
    const t = fresh();
    let last = answer(t, { text: "   " });
    expect(last.text).toMatch(/the answer is empty; an answer needs at least one figure/);
    for (let i = 1; i < BOOKS_MAX_ANSWERS; i++) last = answer(t, { text: "no figures" });
    expect(last).toMatchObject({ final: true, text: expect.stringMatching(/No tries left\.$/) });
    expect(t.answer).toBeNull();
    const u = fresh();
    expect(answer(u, { text: "The ledger holds no fabric purchases.", cannot_answer: true })).toMatchObject({ final: true });
  });
});
