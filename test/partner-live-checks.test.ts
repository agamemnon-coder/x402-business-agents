// The live checks on /visa and /t0 (partner scan, 14 Nov): the browser runs Purser's own code, the same source the
// server runs, its types stripped. Here that browser code runs in a sandbox and must answer as the TypeScript does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { credentialRefusalOf } from "../src/airi/credentialCore.js";
import { closeCheck } from "../src/accounting/closeGate.js";
import { recordedAccounts, T0_POSTED_2026_11_10, T0_READBACK_FILE, entriesOfRecord, type ReadBackRecord } from "../src/accounting/t0Readback.js";
import { browserCode } from "../src/redesign/browserCode.js";
import { cardSceneData, LIVE_CHECK_LABEL, VISA_CARD_SCENE_JS } from "../src/redesign/visaCardScene.js";
import { T0_CLOSE_JS, T0_RUN, t0RunData } from "../src/redesign/t0CloseTile.js";
import { T0_CSP, T0_PAGE, VISA_CSP, VISA_PAGE } from "../src/servers/dashboard.js";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const inBrowser = <T>(file: string, name: string): T => runInNewContext(`${browserCode(file)}\n${name}`, { URL }) as T;
const scriptHash = (html: string) => `'sha256-${createHash("sha256").update(/<script>([\s\S]*?)<\/script>/.exec(html)![1]!, "utf8").digest("base64")}'`;

describe("browserCode", () => {
  it("strips types and exports, and refuses a module that imports a value", () => {
    const js = browserCode("src/airi/credentialCore.ts");
    expect(js).not.toMatch(/^export |: string|interface /m);
    expect(() => browserCode("src/airi/credentialGuard.ts")).toThrow(/imports a value/);
  });
});

describe("/visa: Purser's credential check, run live on the recorded purchase", () => {
  const data = cardSceneData()!;
  const live = inBrowser<typeof credentialRefusalOf>("src/airi/credentialCore.ts", "credentialRefusalOf");

  it("the recorded purchase and the three uses come from the vic-5 record and the merchant list", () => {
    expect(data.purchase).toEqual({ actionId: "P-0002", mandateId: "mdt_nlpdlr7dgho57xw5fpd", cents: 4500, currency: "EUR", merchantUrl: "https://kit11.max-31b.workers.dev/", status: "SETTLED", paid: true });
    expect(data.uses.amount).toEqual({ mandateId: "mdt_nlpdlr7dgho57xw5fpd", amount: "40.00", currency: "EUR" });
    expect(data.uses.again).toEqual({ mandateId: "mdt_nlpdlr7dgho57xw5fpd", amount: "45.00", currency: "EUR" });
    expect(data.uses.merchant.merchantUrl).toBe("https://shop.example/checkout");
  });

  it("each button's use is refused with its own code, the browser copy answering exactly as the TypeScript", () => {
    const want = { amount: "PURSER_CREDENTIAL_AMOUNT_MISMATCH", again: "PURSER_CREDENTIAL_ALREADY_USED", merchant: "PURSER_CREDENTIAL_MERCHANT_MISMATCH" } as const;
    for (const [k, use] of Object.entries(data.uses) as [keyof typeof want, typeof data.uses.amount][]) {
      const ts = credentialRefusalOf(use, undefined, data.purchase);
      expect(ts?.code).toBe(want[k]);
      expect(live(use, undefined, data.purchase)).toEqual(ts);
    }
  });

  it("agrees with the TypeScript on uses the buttons do not try, allowed ones included", () => {
    const open = { ...data.purchase, status: "WAITING_FOR_TAP", paid: false };
    const own = { ...open, actionId: "P-0001", mandateId: "mdt_other" };
    const uses = [
      { mandateId: open.mandateId!, amount: "45.00", currency: "EUR" },
      { mandateId: open.mandateId!, amount: "45.00", currency: "EUR", merchantUrl: "https://kit11.max-31b.workers.dev/pay" },
      { mandateId: open.mandateId!, amount: "45", currency: "EUR" },
      { mandateId: open.mandateId!, amount: "45.00", currency: "USD" },
      { mandateId: open.mandateId!, amount: "45.00", currency: "EUR", merchantUrl: "http://kit11.max-31b.workers.dev/" },
      { mandateId: open.mandateId!, actionId: "P-0001", amount: "45.00", currency: "EUR" },
    ];
    for (const u of uses) for (const [o, l] of [[undefined, open], [own, undefined], [undefined, undefined]] as const) expect(live(u, o, l)).toEqual(credentialRefusalOf(u, o, l));
    expect(credentialRefusalOf(uses[0]!, undefined, open)).toBeNull();
  });

  it("is on /visa: three buttons, hidden until the script runs, the exact label, one script whose hash the policy names", () => {
    expect(VISA_PAGE).toContain('<div id="vcs-try" hidden>');
    for (const b of ["Charge 40.00 instead", "Use it again", "Another merchant"]) expect(text(VISA_PAGE)).toContain(b);
    expect(text(VISA_PAGE)).toContain("Purser's check runs live; the purchase is the recorded sandbox run of 14 Nov; no Airi or Airwallex call.");
    expect(LIVE_CHECK_LABEL).toContain("{day}");
    expect(VISA_PAGE).toContain(VISA_CARD_SCENE_JS);
    expect(VISA_PAGE.match(/<script>/g)).toHaveLength(1);
    expect(VISA_CSP).toContain(`script-src ${scriptHash(VISA_PAGE)}`);
    expect(VISA_CSP).not.toMatch(/connect-src|unsafe/);
  });
});

describe("/t0: the close check, run in the browser on the read-back", () => {
  const rec = JSON.parse(readFileSync(new URL(`../${T0_READBACK_FILE}`, import.meta.url), "utf8")) as ReadBackRecord;
  const live = inBrowser<typeof closeCheck>("src/accounting/closeGate.ts", "closeCheck");
  const d = t0RunData();
  const run = (t0: ReturnType<typeof entriesOfRecord>) => live({ month: "2026-11", t0, ourAccounts: new Map(Object.entries(d.accounts)), ourCount: d.count });

  it("compares with Purser's books as recorded: the same totals and count the server's check uses", () => {
    expect(d).toEqual({ accounts: Object.fromEntries(recordedAccounts()), count: T0_POSTED_2026_11_10, path: "t0-readback.json" });
  });

  it("agrees on the read-back, and a cent more on one entry keeps the month open, naming that entry and its account", () => {
    expect(run(entriesOfRecord(rec))).toMatchObject({ agrees: true, expected: 95, matched: 95, problems: [] });
    const t0 = entriesOfRecord(rec);
    const e = t0[Math.floor(t0.length / 2)]!;
    for (const l of e.lines) l.amount_atoms += 1;
    const c = run(t0);
    expect(c.agrees).toBe(false);
    const p = c.problems.find((x) => x.kind === "account_differs" && x.entries?.includes(e.je_number!));
    expect(e.lines.map((l) => l.account_number)).toContain(p?.account);
    expect(c).toEqual(closeCheck({ month: "2026-11", t0, ourAccounts: recordedAccounts(), ourCount: T0_POSTED_2026_11_10 }));
  });

  it("is on /t0: the button and toggle hidden until the script runs, one script, and a policy that lets it fetch its own origin", () => {
    expect(T0_PAGE).toContain('<div id="t0c-run" hidden>');
    for (const w of [T0_RUN.button, T0_RUN.toggle]) expect(text(T0_PAGE)).toContain(w);
    expect(T0_PAGE).toContain(T0_CLOSE_JS);
    expect(T0_CLOSE_JS).toContain("Month stays open: ");
    expect(T0_PAGE.match(/<script>/g)).toHaveLength(1);
    expect(T0_CSP).toContain(`script-src ${scriptHash(T0_PAGE)}`);
    expect(T0_CSP).toContain("connect-src 'self'");
  });
});
