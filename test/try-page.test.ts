// The hands-on page at /try (cloud/src/tryPage.ts): one page, one script under the console's nonce policy, values put
// on the page only as text, timers only for the three things that need one, the token read from the fragment and then
// removed from the address bar, and every word in cloud/src/tryCopy.ts inside each screen's budget.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleCsp } from "../cloud/src/console.js";
import * as COPY from "../cloud/src/tryCopy.js";
import { SIGN_JS, tryPage } from "../cloud/src/tryPage.js";
import { scriptBlocks, scriptBody, textOutsideTags, withoutBlocks } from "./support/scriptBlocks.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const html = tryPage("n0nce", { origin: ORIGIN, rpId: RP });
const script = (() => {
  const blocks = scriptBlocks(html);
  expect(blocks).toHaveLength(1);
  return scriptBody(blocks[0]!);
})();
/** A word is a run of non-space characters with a letter or a digit in it ("·" and "…" are not words). */
const words = (...s: string[]) => s.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

let c: TestCloud;
beforeEach(() => { c = testCloud({ engine: true }); });
afterEach(() => c.close());

describe("GET /try", () => {
  it("is served with a fresh nonce on its one script and its one stylesheet, under the console's own policy and headers", async () => {
    const a = await c.fetch(`${ORIGIN}/try`);
    const b = await c.fetch(`${ORIGIN}/try`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toMatch(/text\/html/);
    const csp = a.headers.get("content-security-policy")!;
    const n = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(n).not.toBe(/'nonce-([^']+)'/.exec(b.headers.get("content-security-policy")!)![1]);
    expect(csp).toBe(consoleCsp(n));
    const page = await a.text();
    expect(scriptBlocks(page)).toHaveLength(1);
    expect(page).toContain(`<script type="module" nonce="${n}">`);
    expect(page).toContain(`<style nonce="${n}">`);
    // The same headers as the console's page, the policy's nonce aside.
    const cons = await c.fetch(`${ORIGIN}/`);
    const rest = (r: Response) => Object.fromEntries([...r.headers].filter(([k]) => k !== "content-security-policy"));
    expect(rest(a)).toEqual(rest(cons));
  });

  it("loads from a cloud with an engine, and the session the page holds reads that engine", async () => {
    const t = await c.tenant("visitor");
    expect((await c.fetch(`${ORIGIN}/try`)).status).toBe(200);
    expect((await c.fetch(`${ORIGIN}/try`, { method: "HEAD" })).status).toBe(200);
    const inv = await c.req("GET", "/v1/engine/invoices", { key: t.session });
    expect(inv.status).toBe(200);
    expect(inv.json.items).toEqual([]);
    const ev = await c.req("GET", "/v1/engine/events?after=0&limit=200", { key: t.session });
    expect(ev.status).toBe(200);
  });

  it("leaves the console where it was", async () => {
    expect((await c.fetch(`${ORIGIN}/`)).status).toBe(200);
    expect(await (await c.fetch(`${ORIGIN}/`)).text()).toContain("<title>Purser Cloud</title>");
    expect((await c.fetch(`${ORIGIN}/try/other`)).status).toBe(404);
  });
});

describe("the page", () => {
  it("has no inline handlers, no javascript: links and no style attributes, and its script parses", () => {
    const markup = withoutBlocks(html, ["script", "style"]);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(() => new Script(`(async()=>{${script}})`)).not.toThrow();
  });

  it("puts values on the page only as text: no innerHTML or any other HTML sink, no eval", () => {
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });

  it("never says stand-in", () => {
    expect(html).not.toMatch(/stand-in/i);
    for (const group of Object.values(COPY)) expect(JSON.stringify(group)).not.toMatch(/stand-in/i);
  });

  it("uses a timer only for polling, the session's renewal and the running time of an open Claude call", () => {
    const uses = [...script.matchAll(/(\w*)\s*=\s*(setTimeout|setInterval|requestAnimationFrame)\s*\(|(setTimeout|setInterval|requestAnimationFrame)\s*\(/g)];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const u of uses) expect(u[1], u[0]).toMatch(/^(pollTimer|renewTimer|askTimer)$/);
    expect(script).toMatch(/pollTimer=setTimeout\(/);
    expect(script).toMatch(/renewTimer=setTimeout\(/);
    expect(script).toMatch(/askTimer=setInterval\(/);
    expect(script).not.toMatch(/requestAnimationFrame/);
  });

  it("reads the token from the fragment, takes it out of the address bar, and sends it only in the start request's body", () => {
    const read = script.indexOf("location.hash");
    const drop = script.indexOf("history.replaceState(");
    expect(read).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(read);
    expect(script).toMatch(/#\(\[ej\]\)=/);
    expect(script).toMatch(/'\/v1\/try\/start',TOKEN\?\{token:TOKEN\}:\{\}/);
    // The token goes nowhere else: no URL is built from it.
    expect(script.replace("const TOKEN=", "").replace("TOKEN?{token:TOKEN}:{}", "")).not.toContain("TOKEN");
  });

  it("has no words outside the copy: the markup's own text is the brand", () => {
    expect(textOutsideTags(withoutBlocks(html, ["script", "style", "title"])).trim().split(/\s+/)).toEqual(["P", "Purser"]);
    expect(readFileSync(new URL("../cloud/src/tryPage.ts", import.meta.url), "utf8")).not.toMatch(/ui\/i18n/);
  });
});

describe("the copy", () => {
  it("keeps every screen at 45 visible words or fewer outside the live panel and the invoice, in each of its states", () => {
    for (const [screen, states] of Object.entries(COPY.VISIBLE)) {
      for (const [i, state] of states.entries()) {
        // After the start: the band and the current step's name (screens without the band show no steps either).
        const band = ["start", "gone", "ended"].includes(screen) ? [] : [COPY.BAND.line, COPY.BAND.claudeCode, COPY.STEPS.names[screen] ?? ""];
        const n = words(COPY.CHROME.brand, ...band, ...state);
        const cap = COPY.OVER_BUDGET[`${screen} ${i}`];
        if (cap === undefined) expect(n, `${screen} state ${i}`).toBeLessThanOrEqual(45);
        else expect(n, `${screen} state ${i} (over budget, allowed at its own count)`).toBe(cap);
      }
    }
  });

  it("counts every string of a screen in at least one of its states", () => {
    const groups: Record<string, Record<string, string>> = { start: COPY.START, invoice: COPY.INVOICE, work: COPY.WORK, approve: COPY.APPROVE, pay: COPY.PAY, books: COPY.BOOKS, gone: COPY.GONE, ended: COPY.ENDED };
    expect(Object.keys(COPY.VISIBLE).sort()).toEqual(Object.keys(groups).sort());
    for (const [screen, group] of Object.entries(groups)) {
      const seen = new Set(COPY.VISIBLE[screen as keyof typeof COPY.VISIBLE].flat());
      // A {method} line is counted with a method filled in; PAY's sandbox line shows only when the rail is on (one more line,
      // 4 words), the executor's note sits in its fold, and the verdict is counted with its one-cent sentence.
      for (const [k, v] of Object.entries(group)) if (!["sandbox", "executorNote", "vAmount", "vPayee", "vAccount", "vOther"].includes(k)) expect(seen.has(v) || [...seen].some((x) => v.includes("{method}") && x === v.replace("{method}", COPY.METHOD.other)), `${screen}.${k}`).toBe(true);
    }
    expect(Object.keys(COPY.OVER_BUDGET)).toEqual(["pay 7"]);
  });

  it("holds screens 3 and 4 to the words of lanes/page.md B2", () => {
    expect(`${COPY.APPROVE.signs} ${COPY.APPROVE.saves}`).toBe("Your passkey signs exactly these terms. This saves a test passkey for {host} on this device; you can delete it afterwards.");
    expect(COPY.APPROVE.create).toBe("Create your approval passkey");
    expect(COPY.APPROVE.approve).toBe("Approve {amount} with {method}");
    expect(COPY.APPROVE.approved).toBe("Approved. Nothing is paid yet.");
    expect(COPY.APPROVE.next).toBe("Pay it with your signature");
    expect(COPY.APPROVE.cancelled).toBe("Nothing was signed. Try again when you are ready.");
    expect(COPY.APPROVE.noPasskey).toBe("This device cannot make a passkey here. Open this page in Safari or Chrome on your phone.");
    expect(COPY.APPROVE.fileAgain).toBe("File it again");
    expect(COPY.APPROVE.terms).toBe("Show the exact terms");
    expect(Object.values(COPY.METHOD)).toEqual(["Face ID", "Touch ID", "fingerprint", "Windows Hello", "your passkey"]);
    expect(COPY.PAY.heading).toBe("Pay it with your signature.");
    expect(COPY.PAY.line).toBe("Your signature covers exactly these terms. Change one and try to pay, or pay them as signed.");
    expect(COPY.PAY.button).toBe("Pay with my signature");
    expect(COPY.PAY.stamp).toBe("Refused by Purser");
    expect(COPY.PAY.executor).toBe("Purser's payment check: refused (the terms do not match what was approved)");
    expect(COPY.PAY.executorNote).toBe("asked with your changed terms; nothing was kept");
    expect(COPY.PAY.roundTrip).toBe("Round trip {n} ms, measured in your browser");
    expect(COPY.PAY.transfers).toBe("Transfers made: {n}");
    expect(COPY.PAY.raw).toBe("Raw answer");
    expect(COPY.PAY.putBack).toBe("Put back what you signed");
    expect(COPY.PAY.paidOnce).toBe("These are the terms you signed. They were paid once.");
    expect(COPY.PAY.retry).toBe("Try the payment again");
    expect(`${COPY.PAY.vAmountCent} ${COPY.PAY.vCover}`).toBe("You changed the amount by one cent. Your signature does not cover that.");
    // The page never says the server proved Face ID: the method is only ever the device's word in the button.
    for (const g of [COPY.APPROVE, COPY.PAY, COPY.BOOKS]) for (const v of Object.values(g)) expect(v).not.toMatch(/Face ID|verified by|\bproved\b|proven/i);
  });

  it("says what the visitor uses in the band, and what reads the invoice from the start answer's mode", () => {
    expect(COPY.BAND.line).toBe("Your test company · test money · simulated bank");
    expect(COPY.BAND.claudeLive).toBe("Claude reads live");
    expect(COPY.BAND.claudeCode).toBe("Purser's code reads today");
    expect(COPY.START.heading).toBe("Run a company's payables with Purser.");
    expect(COPY.START.button).toBe("Start with a test company");
    expect(COPY.GONE.heading).toBe("Your test company was deleted after 24 hours.");
    expect(COPY.GONE.button).toBe("Start again");
    expect(COPY.INVOICE.ibanHint).toBe("Change the IBAN and see what Purser does");
    expect(script).toContain("mode.claude==='live'");
  });
});

// The page's pure helpers for signing and paying (SIGN_JS), run here as the page runs them.
interface Kit {
  b64u(b: ArrayBuffer | Uint8Array): string;
  fromB64u(s: string): Uint8Array;
  registrationOf(c: unknown): unknown;
  signedOf(c: unknown): unknown;
  hashDiff(a: string, b: string): { a: [string, boolean][]; b: [string, boolean][] };
  normAmount(raw: string, like: string): string | null;
  payBody(terms: Record<string, unknown>, v: { amount: string; beneficiary_name: string; iban_last4: string }, credential: unknown): unknown;
  changedFields(signed: Record<string, unknown>, sent: Record<string, unknown>, changed: unknown): string[];
  verdict(W: typeof COPY.PAY, signed: Record<string, unknown>, sent: Record<string, unknown>, changed: unknown): string;
  methodOf(M: typeof COPY.METHOD, ua: string): string;
}
const kit = new Function(`${SIGN_JS}\nreturn signKit;`)() as Kit;
const buf = (...b: number[]) => new Uint8Array(b).buffer;

describe("signing and paying, in the page's own script", () => {
  it("is in the page as it is tested here", () => {
    expect(script).toContain(SIGN_JS.trim());
  });

  it("serialises a passkey's signature and a new passkey as @simplewebauthn/server reads them (src/approve/client.ts)", () => {
    const signed = { id: "AQID", rawId: buf(1, 2, 3), type: "public-key", authenticatorAttachment: "platform", getClientExtensionResults: () => ({}),
      response: { clientDataJSON: buf(123, 125), authenticatorData: buf(0, 255, 254), signature: buf(48, 69), userHandle: buf(117) } };
    expect(kit.signedOf(signed)).toEqual({ id: "AQID", rawId: "AQID", type: "public-key",
      response: { clientDataJSON: "e30", authenticatorData: "AP_-", signature: "MEU", userHandle: "dQ" }, clientExtensionResults: {}, authenticatorAttachment: "platform" });
    const noHandle = { ...signed, authenticatorAttachment: null, response: { ...signed.response, userHandle: null } };
    expect(kit.signedOf(noHandle)).toEqual({ id: "AQID", rawId: "AQID", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AP_-", signature: "MEU" }, clientExtensionResults: {} });
    const made = { id: "BA", rawId: buf(4), type: "public-key", getClientExtensionResults: () => ({ credProps: { rk: false } }),
      response: { clientDataJSON: buf(123, 125), attestationObject: buf(163, 99), getTransports: () => ["internal"] } };
    expect(kit.registrationOf(made)).toEqual({ id: "BA", rawId: "BA", type: "public-key", response: { clientDataJSON: "e30", attestationObject: "o2M", transports: ["internal"] }, clientExtensionResults: { credProps: { rk: false } } });
    expect([...kit.fromB64u("AP_-")]).toEqual([0, 255, 254]);
  });

  it("marks every character where the signed and the sent hash differ", () => {
    expect(kit.hashDiff("abcdef", "abXdeY")).toEqual({ a: [["ab", false], ["c", true], ["de", false], ["f", true]], b: [["ab", false], ["X", true], ["de", false], ["Y", true]] });
    expect(kit.hashDiff("ab", "ab")).toEqual({ a: [["ab", false]], b: [["ab", false]] });
    expect(kit.hashDiff("ab", "abc")).toEqual({ a: [["ab", false]], b: [["ab", false], ["c", true]] });
    expect(kit.hashDiff("", "")).toEqual({ a: [], b: [] });
  });

  it("writes an amount typed with a comma or a dot in the terms' own format, and refuses one that is not an amount", () => {
    expect(kit.normAmount("1850,01", "1850.00")).toBe("1850.01");
    expect(kit.normAmount(" 1850.1 ", "1850.00")).toBe("1850.10");
    expect(kit.normAmount("1850", "1850.00")).toBe("1850.00");
    expect(kit.normAmount("01850.00", "1850.00")).toBe("1850.00");
    expect(kit.normAmount("1.850,00", "1850.00")).toBeNull();
    expect(kit.normAmount("1850.001", "1850.00")).toBeNull();
    expect(kit.normAmount("-5", "1850.00")).toBeNull();
    expect(kit.normAmount("", "1850.00")).toBeNull();
  });

  it("sends the pay route exactly the stored terms with the three fields' values written in, and the kept credential: nothing else", () => {
    const terms = { schema: "kit11.approval-terms/v1", amount: "1850.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000", currency: "EUR", nested: { a: "1" } };
    const cred = { id: "AQID", response: {} };
    const body = kit.payBody(terms, { amount: "1850.01", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000" }, cred) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["terms", "credential"]);
    expect(body).toEqual({ terms: { ...terms, amount: "1850.01" }, credential: cred });
    expect(terms.amount).toBe("1850.00");
    // The page's one pay request is built by payBody, from the fields, with the kept credential.
    expect([...script.matchAll(/'\/pay',(\w+)\)/g)].map((m) => m[1])).toEqual(["body"]);
    expect(script).toContain("const v=values();");
    expect(script).toContain("const body=payBody(T.terms,v,cred);");
    // The credential goes to approve and to pay only (the new passkey's registration goes to finish).
    const sends = [...script.matchAll(/credential:([A-Za-z.()]+)/g)].map((m) => m[1]);
    expect(sends.sort()).toEqual(["credential", "registrationOf(made)", "signed"].sort()); // credential: payBody's own, with the kept one
    expect(script).toMatch(/'\/approve',\{terms_sha256:[^,]+,credential:signed\}/);
  });

  it("says what changed from the signed and the sent values, whatever shape the route's changed has", () => {
    const signed = { amount: "1850.00", beneficiary_name: "Bergtex Textil GmbH", iban_last4: "3000" };
    const cent = { ...signed, amount: "1850.01" };
    for (const changed of [["amount"], [{ field: "amount", from: "1850.00", to: "1850.01" }], undefined, null]) {
      expect(kit.changedFields(signed, cent, changed)).toEqual(["amount"]);
      expect(kit.verdict(COPY.PAY, signed, cent, changed)).toBe("You changed the amount by one cent. Your signature does not cover that.");
    }
    expect(kit.verdict(COPY.PAY, signed, { ...signed, amount: "1849.99" }, ["amount"])).toBe("You changed the amount by one cent. Your signature does not cover that.");
    expect(kit.verdict(COPY.PAY, signed, { ...signed, amount: "9850.00" }, ["amount"])).toBe("You changed the amount from 1850.00 to 9850.00. Your signature does not cover that.");
    expect(kit.verdict(COPY.PAY, signed, { ...signed, beneficiary_name: "Mallory", iban_last4: "6666" }, ["beneficiary_name", "iban_last4"]))
      .toBe("You changed the payee. You changed the account ending. Your signature does not cover that.");
    expect(kit.verdict(COPY.PAY, signed, signed, ["reference"])).toBe("The terms you sent are not the ones you signed. Your signature does not cover that.");
  });

  it("names the device's passkey by a simple guess from the platform, else says your passkey", () => {
    const m = (ua: string) => kit.methodOf(COPY.METHOD, ua);
    expect(m("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("Face ID");
    expect(m("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15")).toBe("Touch ID");
    expect(m("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile")).toBe("fingerprint");
    expect(m("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0")).toBe("Windows Hello");
    expect(m("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/130.0")).toBe("your passkey");
  });

  it("draws the icons as SVG elements made one by one, never from markup", () => {
    expect(script).toContain("createElementNS('http://www.w3.org/2000/svg'");
    expect(script).not.toMatch(/innerHTML|DOMParser|createContextualFragment/);
  });
});
