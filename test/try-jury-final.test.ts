// Jury, 17 Nov: the last small fixes on /try, each from the engine's own data. "Don't sign" is gone once signed (the
// browser half is test/browser/judge-try.check.ts); each Claude call says what its agent decided and why; the fee and the
// FX amount say why they are what they are.
import { describe, expect, it } from "vitest";
import { callSaid, presentExtra } from "../cloud/src/try/presentMode.js";
import { BOOKS, FX_CARD } from "../cloud/src/tryCopy.js";
import { tryPage } from "../cloud/src/tryPage.js";

const cfg = { origin: "https://x.test", rpId: "x.test" };
const html = tryPage("n0nce", cfg);
const slice = (from: string, to: string) => { const a = html.indexOf(from); return html.slice(a, html.indexOf(to, a)); };

describe("/try's \"Don't sign\" once signed (jury, 17 Nov)", () => {
  it("is hidden for real: the hidden attribute wins over .btn's display, and the tap that signs disables it", () => {
    expect(html).toContain(".acts.sign .btn[hidden] { display: none !important; }");
    const approve = slice("async function approve(){", "\n  }");
    expect(approve).toContain("notNow.hidden=true;notNow.disabled=true;");
    expect(html).toContain("notNow.addEventListener('click',()=>{if(notNow.hidden||notNow.disabled)return;show('invoice')})");
    expect(slice("function stage(again){", "\n  }")).toContain("notNow.hidden=false;notNow.disabled=false;");
  });
});

describe("each Claude call's own line: what its agent decided and why (jury, 17 Nov)", () => {
  const req = "req_abcdef123456";
  it("reads the agent's decision events, matched by request id, at most 120 characters", () => {
    expect(callSaid("ap.checker_decided", { action: "pay", reason: "Supplier and IBAN are on file and it was not paid before.", request_id: req }))
      .toEqual({ req, said: "pay: Supplier and IBAN are on file and it was not paid before." });
    expect(callSaid("ap.payer_proposed", { rail: "SWIFT", pay_on: "2026-11-17", reason: "Pay today from EUR.", request_id: req })?.said).toBe("SWIFT · 2026-11-17: Pay today from EUR.");
    expect(callSaid("ap.coded", { account: "7000", reason: "Fabric for resale.", request_id: req })?.said).toBe("book to 7000: Fabric for resale.");
    const long = callSaid("ap.checker_decided", { action: "ask_cfo", reason: "x".repeat(300), request_id: req })!.said;
    expect(long.length).toBe(120);
    expect(long.endsWith("…")).toBe(true);
    expect(long.startsWith("ask cfo: ")).toBe(true);
  });

  it("says nothing without a reason, a request id, or for another event", () => {
    expect(callSaid("ap.checker_decided", { action: "pay", request_id: req })).toBeNull();
    expect(callSaid("ap.checker_decided", { action: "pay", reason: "ok" })).toBeNull();
    expect(callSaid("agent.run", { reason: "ok", request_id: req })).toBeNull();
    expect(callSaid("ap.checker_decided", { action: 5, reason: "Fine.", request_id: req })?.said).toBe("Fine.");
  });

  it("is the page's own function, as text, and the list sets it as text", () => {
    for (const kind of [undefined, "public"] as const) {
      const { script } = presentExtra(kind);
      expect(script).not.toContain("__CALL_SAID__");
      expect(script).toContain(`const callSaid=${callSaid.toString()};`);
      expect(() => new Function(script)).not.toThrow();
      expect(script).toContain("mk('span','w',String(c.said||SAID.get(c.req)))");
      expect(script).not.toContain("innerHTML");
    }
    const page = new Function(`return ${callSaid.toString()}`)() as typeof callSaid;
    expect(page("ap.checker_decided", { action: "hold", reason: "<b>New IBAN.</b>", request_id: req })).toEqual(callSaid("ap.checker_decided", { action: "hold", reason: "<b>New IBAN.</b>", request_id: req }));
  });
});

describe("why the fee and the FX amount (jury, 17 Nov)", () => {
  it("says where the fee comes from", () => {
    expect(BOOKS.feeWhy).toBe("international transfer fee: the simulated bank's flat SWIFT fee, taken from what the Airwallex sandbox charged");
  });

  // fxWhy from the page's own script, with its two helpers.
  const fxWhy = new Function("X", "t", "cv", `const fill=(s,v)=>s.replace(/\\{(\\w+)\\}/g,(_,k)=>String(v[k]??''));const cash=(c,a)=>c+' '+a;${slice("function fxWhy(X,t,cv){", "\nfunction fxCard(")};return fxWhy(X,t,cv);`) as (X: unknown, t: unknown, cv: unknown) => string;
  // The terms of an offline /try run of the EUR 1,850.00 sample (17 Nov), as the proof file has them.
  const terms = { amount: "1850.00", currency: "EUR", fee_max: "20.00", balances_before: { eur_available: "34866.60", usd_available: "25000.00" }, floors: { eur_floor: "25000.00", eur_obligations: "8500.00", usd_floor: "20000.00" } };
  const cv = { buy_currency: "EUR", buy_amount: "503.40", sell_currency: "USD", sell_amount: "546.19" };

  it("shows the shortfall in the signed terms' own figures when they add up to the amount bought", () => {
    expect(fxWhy(FX_CARD, terms, cv)).toBe("Why this amount: EUR free above the cash floor is EUR 1366.60 (EUR 34866.60 available, less the EUR 25000.00 floor and EUR 8500.00 spoken for). This payment needs EUR 1870.00 with its fee reserve of EUR 20.00, so it is short by EUR 503.40, and only that is bought.");
  });

  it("falls back to the rule in words when they do not add up, never a figure of its own", () => {
    expect(fxWhy(FX_CARD, terms, { ...cv, buy_amount: "500.00" })).toBe("Why this amount: it is the shortfall. EUR free above the cash floor, after bills and payouts in flight, covers the rest of this payment and its fee reserve (at most EUR 20.00); only what is missing is bought.");
    expect(fxWhy(FX_CARD, { ...terms, floors: {} }, cv)).toContain("it is the shortfall");
  });
});
