// "What Purser did with it" (cloud/src/try/books.ts): the last step before the visitor's company. Its words stay
// within the budget, each account line is named by its role from the chart, debits = credits is said only when the
// lines agree, and the next steps are the three agreed links. The page carries the screen (one hook in tryPage.ts).
import { describe, expect, it } from "vitest";
import { ACCOUNTS_FOR_PAGE, CLOUD_URL, DID, DID_KIT_JS, LIVE_RUNS_URL, roleOf, SECURITY_URL } from "../cloud/src/try/books.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { EXPENSE_ACCOUNTS } from "../src/ap/read.js";

const EXP = Object.keys(EXPENSE_ACCOUNTS)[0]!;

type Kit = { folderOf(p: string): string; lines(es: unknown[], acc: unknown): { kind: string; lines: { account: string; role: string | null; debit: number; credit: number }[] }[]; even(es: unknown[]): boolean };
const didKit = new Function(`${DID_KIT_JS}\nreturn didKit;`)() as Kit;

const accrual = { entry_id: 7, source_key: "ap-accrual|inv_1", description: "Bergtex invoice BTX-1 (received)", lines: [
  { account: EXP, currency: "EUR", debit_cents: 155_462, credit_cents: 0 }, { account: "1510", currency: "EUR", debit_cents: 29_538, credit_cents: 0 }, { account: "2100", currency: "EUR", debit_cents: 0, credit_cents: 185_000 }] };
const payment = { entry_id: 8, source_key: "transfer|x", description: "Payment BTX-1", lines: [{ account: "2100", currency: "EUR", debit_cents: 185_000, credit_cents: 0 }, { account: "1200", currency: "EUR", debit_cents: 0, credit_cents: 185_000 }] };

describe("what Purser did with it", () => {
  it("keeps its words within 45, labels the test company and the simulated bank, and asks for no partner or contact", () => {
    const words = [DID.heading, DID.label, DID.filed, DID.booked, DID.matched, DID.balanced, DID.debit, DID.credit, DID.invoice, DID.payment, ...Object.values(DID.roles), DID.notIn, DID.cloud, DID.runs, DID.safe, DID.company]
      .join(" ").split(/\s+/).filter((w) => /\w/.test(w)).length;
    expect(words).toBeLessThanOrEqual(45);
    expect(DID.label).toMatch(/test company/i);
    expect(DID.label).toMatch(/simulated bank/i);
    expect(JSON.stringify(DID)).not.toMatch(/design partner|contact us/i);
    // Purser Cloud is its guest dashboard, absolute: on kit11 (through the relay) "/" is the site's home (owner, 13 Nov).
    expect([CLOUD_URL, LIVE_RUNS_URL, SECURITY_URL]).toEqual(["https://purser-try.max-31b.workers.dev/#/guest", "https://kit11.max-31b.workers.dev/runs", "https://kit11.max-31b.workers.dev/security"]);
  });

  it("names the lines by the chart: expense, VAT and creditors for the invoice; creditors and bank for the payment", () => {
    expect([roleOf(EXP), roleOf("1510"), roleOf("2100"), roleOf("1200"), roleOf("3100")]).toEqual(["expense", "vat", "creditors", "bank", null]);
    const out = didKit.lines([payment, accrual], ACCOUNTS_FOR_PAGE);
    expect(out.map((e) => e.kind)).toEqual(["invoice", "payment"]);
    expect(out[0]!.lines.map((l) => l.role)).toEqual(["expense", "vat", "creditors"]);
    expect(out[1]!.lines.map((l) => l.role)).toEqual(["creditors", "bank"]);
    expect(didKit.folderOf("2026/11/Bergtex/BTX-1.pdf")).toBe("2026/11/Bergtex/");
  });

  it("says debits = credits only when the lines agree", () => {
    expect(didKit.even([accrual, payment])).toBe(true);
    expect(didKit.even([{ ...payment, lines: [payment.lines[0]] }])).toBe(false);
    expect(didKit.even([])).toBe(false);
  });

  it("is on the page between screen 5 and screen 6, with motion off under reduced motion", () => {
    const html = tryPage("n", { origin: "https://x.test", rpId: "x.test" });
    expect(html).toContain("screen('did'");
    expect(html).toContain("show('did')");
    expect(html).toMatch(/prefers-reduced-motion: reduce\)[^}]*\{\s*\.did-step/);
  });
});

describe("the paid screen's way on (owner, 13 Nov)", () => {
  it("links \"Open Purser Cloud\" to the guest dashboard, and the console opens #/guest as the demo company", async () => {
    const { tryPage } = await import("../cloud/src/tryPage.js");
    const html = tryPage("n", { origin: "https://purser-try.max-31b.workers.dev", rpId: "purser-try.max-31b.workers.dev" });
    expect(html).toContain("cloud.href=DIDURL.cloud");
    expect(html).toContain(`"cloud":"${CLOUD_URL}"`);
    const { consolePage } = await import("../cloud/src/console.js");
    const con = consolePage("n", { origin: "https://purser-try.max-31b.workers.dev", rpId: "purser-try.max-31b.workers.dev", mailDomain: "example.invalid" });
    expect(con).toContain("if(path==='/guest')");
    expect(con).toContain("api('/v1/auth/guest',{method:'POST',token:'-'})");
  });
});
