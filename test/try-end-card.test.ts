// The end card, the books effect and the partner lines (src/try/endCard.ts, books.ts, partners.ts) against a real
// visitor's company on the Node engine (test money, a simulated bank): the signature the engine accepted verifies in
// the browser's own code, and a one-cent change after signing does not; P&L and VAT before and after come from the
// ledger's report code over the company's posted lines; expected against the agents shows a mismatch, never hides it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerInvoiceNo } from "../src/ap/ledgerKey.js";
import { ledgerRef } from "../cloud/src/try/extraEngineRoutes.js";
import { booksEffect, booksEffectHtml, quarterOf, T0_ROW } from "../src/try/books.js";
import { compareExpect, decisionOf, END_CARD_VERIFY_JS, END_VERDICT, endCardHtml, endSteps, MONEY_STAYED, seedLinks, STEP_ORDER } from "../src/try/endCard.js";
import { BANNED_PARTNER_WORDS, partnerLine, type Screen } from "../src/try/partners.js";
import { profitAndLossFrom } from "../src/ledger/reports.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

type Verify = (i: unknown) => Promise<{ ok: boolean; verdict: string; checks: { check: string; ok: boolean; detail: string }[] }>;
const verifyTermsSignature = new Function(`${END_CARD_VERIFY_JS}\nreturn verifyTermsSignature;`)() as Verify;

let c: TestCloud;
const set = async (key: string, value: string) => expect((await c.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key, value } })).status).toBe(200);
beforeAll(async () => { c = testCloud({ engine: true, tryIt: {} }); await set("starts", "on"); });
afterAll(() => c.close());

interface Invoice { id: string; status: string; vendor: string; invoice_no: string; total: string; currency: string; doc_sha256: string; read_by: string; findings: { code: string }[] }

describe("a visitor's whole run, then the end card", () => {
  let s: string;
  let phone: FakeAuthenticator;
  let upload: { kind: string; invoice: Invoice };
  let proposal: { id: string; terms_sha256: string; challenge: string };
  let terms: { terms: Record<string, string>; canonical: string; terms_sha256: string };
  let approval: { response: Record<string, string> } & Record<string, unknown>;
  let paid: Record<string, unknown>;

  beforeAll(async () => {
    s = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "203.0.113.70" } })).json.session as string;
    upload = (await c.req("POST", "/v1/engine/samples/clean", { key: s })).json as unknown as typeof upload;
    phone = new FakeAuthenticator();
    const st = await c.req("POST", "/v1/engine/passkey/start", { key: s });
    await c.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: st.json.code, credential: phone.register({ challenge: st.json.challenge as string, origin: ORIGIN, rpId: RP }) } });
    proposal = (await c.req("POST", `/v1/engine/invoices/${upload.invoice.id}/pay`, { key: s })).json.proposal as typeof proposal;
    approval = phone.sign({ challenge: proposal.challenge, origin: ORIGIN, rpId: RP, counter: 1 }) as unknown as typeof approval;
    expect((await c.req("POST", `/v1/engine/proposals/${proposal.id}/approve`, { key: s, body: { terms_sha256: proposal.terms_sha256, credential: approval } })).json).toMatchObject({ held: true });
    terms = (await c.req("GET", `/v1/engine/proposals/${proposal.id}/terms`, { key: s })).json as unknown as typeof terms;
    paid = (await c.req("POST", `/v1/engine/proposals/${proposal.id}/pay`, { key: s, body: { terms: terms.terms, credential: approval } })).json;
    expect(paid).toMatchObject({ outcome: "paid" });
  });

  const assertion = () => ({ authenticatorData: approval.response.authenticatorData, clientDataJSON: approval.response.clientDataJSON, signature: approval.response.signature });

  it("Verify yourself: the signature the engine accepted matches these terms, in the browser's own code", async () => {
    const r = await verifyTermsSignature({ terms: terms.terms, assertion: assertion(), public_key: phone.publicJwk });
    expect(r.verdict).toBe(END_VERDICT.ok);
    expect(r.checks.map((x) => x.check)).toEqual(["terms hash", "challenge", "assertion", "user verified", "signature"]);
    expect(r.checks[0]!.detail).toContain(terms.terms_sha256);
    // The canonical text the engine shows gives the same answer.
    expect((await verifyTermsSignature({ canonical: terms.canonical, assertion: assertion(), public_key: phone.publicJwk })).ok).toBe(true);
  });

  it("one cent changed after signing does not match", async () => {
    const cent = { ...terms.terms, amount: (Number(terms.terms.amount) + 0.01).toFixed(2) };
    const r = await verifyTermsSignature({ terms: cent, assertion: assertion(), public_key: phone.publicJwk });
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe(END_VERDICT.bad);
    expect(r.checks.find((x) => x.check === "challenge")).toMatchObject({ ok: false, detail: "the passkey signed another hash, not this one" });
  });

  it("another passkey's key, a broken signature or a number in the terms do not match", async () => {
    expect((await verifyTermsSignature({ terms: terms.terms, assertion: assertion(), public_key: new FakeAuthenticator().publicJwk })).ok).toBe(false);
    expect((await verifyTermsSignature({ terms: terms.terms, assertion: { ...assertion(), signature: "AAAA" }, public_key: phone.publicJwk })).ok).toBe(false);
    expect((await verifyTermsSignature({ terms: { ...terms.terms, amount: 1850 }, assertion: assertion(), public_key: phone.publicJwk })).ok).toBe(false);
  });

  it("lists what the visitor did, in order, with the ids behind a fold", () => {
    const steps = endSteps({ invoice: upload.invoice, decision: decisionOf(upload), proposal, pay: paid as never });
    expect(steps.map((x) => x.step)).toEqual(STEP_ORDER);
    expect(steps[0]).toMatchObject({ id: upload.invoice.id });
    expect(steps[2]).toMatchObject({ id: proposal.terms_sha256 });
    expect(steps[3]!.text).toBe(`Paid on the simulated bank (test money), ${(paid.settled as { transfer_status: string }).transfer_status}`);
    const html = endCardHtml({ steps, comparison: compareExpect({ action: "pay", reason: "a clean invoice from a supplier on file" }, decisionOf(upload)), seed: 42 });
    expect(html.indexOf("<details>")).toBeGreaterThan(html.indexOf("Verify yourself"));
    expect(html.slice(0, html.indexOf("<details>"))).not.toContain(proposal.terms_sha256);
    expect(html).toContain("They matched.");
    expect(html).not.toContain(MONEY_STAYED);
    expect(html).toContain('href="/try#seed=42">Replay this scenario');
  });

  it("books: P&L and VAT before and after, from the ledger's report code over the company's posted lines; and the labelled T0 row", async () => {
    const path = `/v1/try/books/effect?invoice_no=${encodeURIComponent(upload.invoice.invoice_no)}&vendor=${encodeURIComponent(upload.invoice.vendor)}`;
    expect((await c.req("GET", path, { key: s })).status).toBe(404);
    await set("books_effect", "on");
    const r = await c.req("GET", path, { key: s });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const e = r.json.effect as NonNullable<ReturnType<typeof booksEffect>>;
    expect(e.entries.length).toBeGreaterThanOrEqual(1);
    // The expense rose by the invoice's net amount; nothing before it had any expense in this fresh company.
    expect(e.pnl.after.expense_cents - e.pnl.before.expense_cents).toBeGreaterThan(0);
    expect(e.pnl.after.result_cents).toBe(e.pnl.after.revenue_cents - e.pnl.after.expense_cents);
    expect(e.quarter).toBe(quarterOf(c.clock.now.toISOString().slice(0, 10)));
    expect(r.json.t0).toEqual(T0_ROW);
    expect(T0_ROW.text).toMatch(/not sent from this test company/);
    expect(T0_ROW.text).toMatch(/recorded run/);
    const html = booksEffectHtml(e);
    expect(html).toContain("computed from the ledger");
    expect(html).toContain("docs/runs/2026-11-10-t0-journal-sandbox.md");
    // Another company's session reaches its own books only: nothing of this invoice there.
    const other = (await c.req("POST", "/v1/try/start", { body: {}, headers: { "cf-connecting-ip": "203.0.113.71" } })).json.session as string;
    expect((await c.req("GET", path, { key: other })).json.effect).toBeNull();
  });
});

describe("the books effect itself", () => {
  const line = (entry_id: number, account: string, debit: number, credit: number, doc_ref: string | null = null, posting_date = "2026-11-12") =>
    ({ entry_id, posting_date, account, currency: "EUR", debit_cents: debit, credit_cents: credit, vat_code: null, vat_cents: null, party: null, doc_ref, due_date: null });
  it("splits at the invoice's first entry and is the report code's own figures", () => {
    const lines = [line(1, "4000", 0, 10_000), line(1, "1100", 10_000, 0), line(2, "7000", 5_000, 0), line(2, "2100", 0, 5_000, "INV-1 · A"), line(3, "2100", 5_000, 0, "INV-1 · A"), line(3, "1100", 0, 5_000)];
    const e = booksEffect(lines, ["INV-1 · A"], "2026-11-12")!;
    expect(e.entries).toEqual([2, 3]);
    const year = { from: "2026-01-01", to: "2026-12-31" };
    expect(e.pnl.before).toMatchObject({ revenue_cents: profitAndLossFrom(lines.slice(0, 2), year).EUR!.revenue_cents, expense_cents: 0 });
    expect(e.pnl.after).toMatchObject({ expense_cents: 5_000, result_cents: 5_000 });
    expect(booksEffect(lines, ["OTHER"], "2026-11-12")).toBeNull();
  });
  it("uses the inbox's own payables reference", () => {
    expect(ledgerRef(" BTX-1 ", "Bergtex Textil GmbH ")).toBe(ledgerInvoiceNo(" BTX-1 ", "Bergtex Textil GmbH "));
  });
});

describe("expected against the agents", () => {
  it("shows a wrong agent answer with the right one, and why the money stayed", () => {
    const m = compareExpect({ action: "refuse", reason: "the bank account changed" }, { action: "pay", why: "the checks passed" });
    expect(m.match).toBe(false);
    expect(m.line).toContain("Right answer: Refuse it (the bank account changed). The agents: Pay it after your signature (the checks passed). They did not match.");
    expect(m.stayed).toBe("The money stayed: nothing moves without your signature.");
    expect(endCardHtml({ steps: [], comparison: m, seed: null })).toContain(MONEY_STAYED);
  });
  it("reads the engine's answers into the same three words", () => {
    expect(decisionOf({ kind: "duplicate_document", invoice: null }).action).toBe("refuse");
    expect(decisionOf({ kind: "invoice", invoice: { status: "blocked", findings: [{ code: "possible_fraud" }] } })).toEqual({ action: "refuse", why: "possible_fraud" });
    expect(decisionOf({ kind: "invoice", invoice: { status: "needs_vendor", findings: [{ code: "new_supplier" }] } }).action).toBe("ask");
    expect(decisionOf({ kind: "invoice", invoice: { status: "ready", findings: [] } }).action).toBe("pay");
  });
  it("seeds are numbers, with a replay and a new one", () => {
    expect(seedLinks(7)).toEqual({ replay: "/try#seed=7", another: "/try#seed=new" });
  });
});

describe("the partner line per screen", () => {
  it("names only what ran for this visitor, in plain words", () => {
    expect(partnerLine("at_work", { read_by: "claude:claude-sonnet-5-5" })!.text).toBe("Claude claude-sonnet-5-5 read this invoice; Purser's code checked it.");
    expect(partnerLine("at_work", { read_by: "parser" })!.text).toBe("Purser's code read this invoice (Claude not used).");
    expect(partnerLine("at_work", {})).toBeNull();
    expect(partnerLine("pay", { pay: { outcome: "paid", sandbox_calls: 0 } })!.text).toBe("Paid on the simulated bank (test money).");
    expect(partnerLine("pay", { pay: { outcome: "paid", sandbox_calls: 2 } })!.text).toMatch(/Airwallex sandbox \(test money\)/);
    expect(partnerLine("pay", { pay: { outcome: "refused", sandbox_calls: 0 } })!.text).not.toMatch(/Airwallex/);
    expect(partnerLine("books", {})).toEqual({ text: T0_ROW.text, href: T0_ROW.href });
  });
  it("never says endorsed, certified or approved by", () => {
    const facts = [{}, { read_by: "parser" }, { read_by: "claude-scan:claude-haiku-5-5" }, { pay: { outcome: "paid", sandbox_calls: 1 } }, { pay: { outcome: "refused", sandbox_calls: 0 } }];
    for (const screen of ["invoice", "at_work", "approve", "pay", "books", "company"] as Screen[]) {
      for (const f of facts) expect(partnerLine(screen, f)?.text ?? "").not.toMatch(BANNED_PARTNER_WORDS);
    }
    for (const text of [T0_ROW.text, MONEY_STAYED, END_VERDICT.ok, END_VERDICT.bad]) expect(text).not.toMatch(BANNED_PARTNER_WORDS);
    expect("approved by Visa").toMatch(BANNED_PARTNER_WORDS);
  });
});

describe("the 30-second tour", () => {
  it("has at most four short steps, the why first, and every one skippable", async () => {
    const { TOUR_STEPS, tourHtml, TOUR_JS } = await import("../src/try/tour.js");
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(4);
    expect(TOUR_STEPS[0]!.text).toBe("Limits in a prompt can be talked out of. Signatures can't.");
    const words = TOUR_STEPS.map((s) => `${s.title} ${s.text}`).join(" ").split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(65);
    expect(tourHtml()).toContain('id="tour-skip"');
    expect(tourHtml()).toMatch(/<aside[^>]* hidden>/);
    expect(TOUR_JS).toMatch(/try \{ return localStorage\.getItem/);
    expect(TOUR_JS).toMatch(/try \{ localStorage\.setItem/);
    for (const s of TOUR_STEPS) expect(`${s.title} ${s.text}`).not.toMatch(BANNED_PARTNER_WORDS);
  });
});
