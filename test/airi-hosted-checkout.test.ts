// The hosted-page checkout (src/airi/hostedCheckout.ts) in real headless Chromium, against a LOCAL stub page with the
// hosted page's field structure (seen in the 7 November probe: inputs by autocomplete cc-number, cc-exp, cc-csc,
// cc-name, and a Pay button) and a scripted Airwallex client. Nothing reaches Airwallex: the browser's only proxy is a
// dead port, so any request off this machine fails. The card is the public test number 4111 1111 1111 1111.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AirwallexAmbiguous } from "../src/airwallex/client.js";
import { CheckoutOutcomeUnknown } from "../src/airi/client.js";
import { checkoutFromEnv } from "../src/airi/deps.js";
import { AirwallexHostedCheckout, HPP_ORIGIN, sdkOpener, type HostedOptions } from "../src/airi/hostedCheckout.js";

const PAN = "4111111111111111";
const CVC = "737";
const SECRET = "cs_test_secret_not_for_logs";

type Mode = "succeed" | "decline" | "challenge" | "frictionless" | "nothing" | "no-fields";
interface Stub { origin: string; mode: Mode; submitted: Record<string, string>[]; typed: number; sdkCalls: Record<string, unknown>[]; server: Server }

const body = (q: IncomingMessage) => new Promise<string>((ok) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => ok(b)); });

function page(mode: Mode): string {
  const fields = mode === "no-fields" ? "<p>Select payment method</p>" : `
    <label>Card information</label>
    <input id="cardnumber" name="cardnumber" autocomplete="cc-number" inputmode="numeric" placeholder="1234 1234 1234 1234" aria-label="Credit or debit card number">
    <input name="expiry" autocomplete="cc-exp" inputmode="numeric" placeholder="MM / YY" aria-label="Credit or debit card expiration date">
    <input name="cvc" autocomplete="cc-csc" inputmode="numeric" placeholder="CVC" aria-label="Credit or debit card CVC/CVV/CID">
    <label>Name on card</label><input name="name" autocomplete="cc-name">
    <button type="button" id="pay">Pay</button>`;
  return `<!doctype html><meta charset="utf-8"><title>Stub hosted payment page</title><body>
    <h2>Order summary</h2><p>Total to pay 12.00 EUR</p>${fields}<div id="out"></div>
    <script>
      document.querySelectorAll("input").forEach((i) => i.addEventListener("input", () => fetch("/typed", { method: "POST" })));
      const pay = document.getElementById("pay");
      if (pay) pay.addEventListener("click", async () => {
        const v = (a) => document.querySelector('input[autocomplete="' + a + '"]').value;
        const r = await fetch("/submit", { method: "POST", body: JSON.stringify({ number: v("cc-number"), expiry: v("cc-exp"), cvc: v("cc-csc"), name: v("cc-name") }) });
        const mode = await r.text();
        const out = document.getElementById("out");
        const acs = () => { const f = document.createElement("iframe"); f.name = "threeds-challenge"; f.title = "3D Secure authentication"; f.width = "400"; f.height = "300"; f.src = "about:blank"; document.body.appendChild(f); return f; };
        if (mode === "succeed") out.textContent = "Payment completed. Your order is now being processed.";
        if (mode === "decline") out.textContent = "Your card was declined. Please try again.";
        if (mode === "challenge") acs();
        if (mode === "frictionless") { const f = acs(); setTimeout(() => { f.remove(); out.textContent = "Payment completed"; }, 800); }
      });
    </script></body>`;
}

async function stub(): Promise<Stub> {
  const s: Stub = { origin: "", mode: "succeed", submitted: [], typed: 0, sdkCalls: [], server: null as unknown as Server };
  s.server = createServer(async (q, r) => {
    const send = (type: string, text: string) => { r.writeHead(200, { "content-type": type }); r.end(text); };
    if (q.url === "/hpp") return send("text/html", page(s.mode));
    if (q.url === "/typed") { s.typed++; return send("text/plain", "ok"); }
    if (q.url === "/submit") { s.submitted.push(JSON.parse(await body(q)) as Record<string, string>); return send("text/plain", s.mode); }
    if (q.url === "/sdk-called") { s.sdkCalls.push(JSON.parse(await body(q)) as Record<string, unknown>); return send("text/plain", "ok"); }
    if (q.url === "/sdk.js") {
      // A stand-in for Airwallex.js: records init and redirectToCheckout's props, then goes to the stub page (on
      // "localhost", another host than the 127.0.0.1 launch page, as the real one leaves for Airwallex's host).
      return send("text/javascript", `const SDK_SRC = document.currentScript.src; window.AirwallexComponentsSDK = { init: async (o) => ({ payments: { redirectToCheckout: (p) => {
        const home = new URL(document.currentScript ? document.currentScript.src : SDK_SRC).origin;
        fetch(home + "/sdk-called", { method: "POST", mode: "no-cors", body: JSON.stringify({ init: o, props: p }) }).then(() => { location.href = home + "/hpp"; });
      } } }) };`);
    }
    r.writeHead(404); r.end();
  });
  await new Promise<void>((ok) => s.server.listen(0, "127.0.0.1", () => ok()));
  s.origin = `http://localhost:${(s.server.address() as { port: number }).port}`;
  return s;
}

function credFile(): string {
  const f = join(mkdtempSync(join(tmpdir(), "airi-hosted-test-")), "credential.json");
  writeFileSync(f, JSON.stringify({ tokenNumber: PAN, expiryMonth: "12", expiryYear: "2030", cvv: CVC, tokenType: "DPAN" }), { mode: 0o600 });
  chmodSync(f, 0o600);
  return f;
}

type Call = { method: string; path: string };
/** The scripted Airwallex: create gives a client_secret; the GET reads what the stub page's "server" was given. */
function api(s: Stub, opts: { getThrows?: Error } = {}) {
  const calls: Call[] = [];
  const state = () => {
    if (!s.submitted.length) return { id: "int_1", status: "REQUIRES_PAYMENT_METHOD" };
    if (s.mode === "succeed" || s.mode === "frictionless") return { id: "int_1", status: "SUCCEEDED", latest_payment_attempt: { status: "CAPTURE_REQUESTED" } };
    if (s.mode === "decline") return { id: "int_1", status: "REQUIRES_PAYMENT_METHOD", latest_payment_attempt: { status: "FAILED", failure_code: "issuer_declined" } };
    if (s.mode === "challenge") return { id: "int_1", status: "REQUIRES_CUSTOMER_ACTION", latest_payment_attempt: { status: "AUTHENTICATION_REDIRECTED" } };
    return { id: "int_1", status: "PENDING" };
  };
  return {
    calls,
    call: async <T>(method: "GET" | "POST", path: string): Promise<T> => {
      calls.push({ method, path });
      if (method === "POST") return { id: "int_1", status: "REQUIRES_PAYMENT_METHOD", client_secret: SECRET } as T;
      if (opts.getThrows) throw opts.getThrows;
      return state() as T;
    },
  };
}

const browsers: Browser[] = [];
/** Real Chromium, its only proxy a dead port: this machine (localhost) is reachable, nothing else is. */
const launch = async () => { const b = await chromium.launch({ args: ["--proxy-server=http://127.0.0.1:9"] }); browsers.push(b); return b; };
const order = { ref: "airi-x1", amount: "12.00", currency: "EUR", description: "vic-1 A" };

let s: Stub;
beforeAll(async () => { s = await stub(); });
afterAll(async () => { s.server.close(); for (const b of browsers) await b.close().catch(() => undefined); });

async function run(mode: Mode, o: HostedOptions & { getThrows?: Error } = {}) {
  s.mode = mode; s.submitted = []; s.typed = 0; s.sdkCalls = [];
  const a = api(s, { getThrows: o.getThrows });
  const co = new AirwallexHostedCheckout(a, { hppOrigin: s.origin, open: async (p) => { await p.goto(`${s.origin}/hpp`); }, launch, settleMs: 8_000, threeDsGraceMs: 1_500, loadMs: 3_000, ...o });
  expect(await co.prepare(order)).toEqual({ reference: "int_1" });
  const out = await co.pay("int_1", "airi-x1", credFile()).catch((e: unknown) => e);
  return { out, a, browser: browsers.at(-1)! };
}
const never = (v: unknown, ...secrets: string[]) => { const t = JSON.stringify(v ?? null) + String((v as Error)?.message ?? "") + String((v as Error)?.stack ?? ""); for (const x of secrets) expect(t).not.toContain(x); };

describe("AirwallexHostedCheckout (stub page, real Chromium)", { timeout: 60_000 }, () => {
  it("types the card into the hosted page like a shopper, presses Pay, then reads the PaymentIntent once: SUCCEEDED", async () => {
    const { out, a, browser } = await run("succeed");
    expect(out).toEqual({ outcome: "SUCCEEDED", reference: "int_1", code: "SUCCEEDED" });
    expect(s.submitted).toEqual([{ number: PAN, expiry: "12 / 30", cvc: CVC, name: "Purser Sourcing agent" }]);
    expect(a.calls).toEqual([{ method: "POST", path: "/pa/payment_intents/create" }, { method: "GET", path: "/pa/payment_intents/int_1" }]);
    expect(browser.isConnected()).toBe(false);
    never(out, PAN, CVC, SECRET);
  });

  it("a decline is Airwallex's own code, from the GET, not the page's words", async () => {
    const { out, browser } = await run("decline");
    expect(out).toEqual({ outcome: "DECLINED", reference: "int_1", code: "issuer_declined" });
    expect(browser.isConnected()).toBe(false);
  });

  it("3DS that does not finish by itself is a decline, THREE_DS_REQUIRED; nothing is typed into the challenge", async () => {
    const { out } = await run("challenge");
    expect(out).toEqual({ outcome: "DECLINED", reference: "int_1", code: "THREE_DS_REQUIRED" });
  });

  it("frictionless 3DS finishes on the page by itself: SUCCEEDED", async () => {
    const { out } = await run("frictionless");
    expect(out).toMatchObject({ outcome: "SUCCEEDED" });
  });

  it("never types the card into a page on another origin", async () => {
    const { out, a, browser } = await run("succeed", { hppOrigin: HPP_ORIGIN });
    expect(out).toMatchObject({ outcome: "NOT_SUBMITTED", code: "HPP_WRONG_ORIGIN" });
    expect(s.typed).toBe(0);
    expect(s.submitted).toEqual([]);
    expect(a.calls.map((c) => c.method)).toEqual(["POST"]);
    expect(browser.isConnected()).toBe(false);
  });

  it("no card fields: NOT_SUBMITTED, no GET, browser closed", async () => {
    const { out, a, browser } = await run("no-fields");
    expect(out).toMatchObject({ outcome: "NOT_SUBMITTED", code: "HPP_FIELDS_NOT_FOUND" });
    expect(a.calls.map((c) => c.method)).toEqual(["POST"]);
    expect(browser.isConnected()).toBe(false);
  });

  it("the page could not be opened: NOT_SUBMITTED, and Playwright's message (which can quote the page) is not kept", async () => {
    const { out, browser } = await run("succeed", { open: async () => { throw new Error(`net::ERR at ${PAN} ${SECRET}`); } });
    expect(out).toEqual({ outcome: "NOT_SUBMITTED", reference: "int_1", code: "HPP_UNAVAILABLE", reason: "the hosted payment page could not be opened or filled; the card was not submitted" });
    never(out, PAN, SECRET);
    expect(browser.isConnected()).toBe(false);
  });

  it("Pay pressed but the page shows no end and the GET fails: outcome unknown, carrying no card or secret", async () => {
    const { out } = await run("nothing", { settleMs: 1_000, getThrows: new AirwallexAmbiguous("/pa/payment_intents/int_1", new Error(`reset ${PAN} ${CVC} ${SECRET}`)) });
    expect(out).toBeInstanceOf(CheckoutOutcomeUnknown);
    never(out, PAN, CVC, SECRET);
    expect((out as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("a page that never submitted (no payment attempt) is NOT_SUBMITTED, so the mandate is cancelled, not reported", async () => {
    s.mode = "nothing";
    const a = api(s);
    const co = new AirwallexHostedCheckout(a, { hppOrigin: s.origin, open: async (p) => { await p.goto(`${s.origin}/hpp`); await p.route("**/submit", (r) => r.abort()); }, launch, settleMs: 1_000, loadMs: 3_000 });
    await co.prepare(order);
    s.submitted = [];
    expect(await co.pay("int_1", "airi-x1", credFile())).toMatchObject({ outcome: "NOT_SUBMITTED", code: "HPP_NOT_SUBMITTED" });
  });

  it("the default opener: Airwallex.js's redirectToCheckout with the intent, its client_secret and env sandbox (a stand-in SDK here)", async () => {
    const { out } = await run("succeed", { open: sdkOpener(`${s.origin}/sdk.js`) });
    expect(out).toMatchObject({ outcome: "SUCCEEDED" });
    expect(s.sdkCalls).toEqual([{ init: { env: "sandbox", enabledElements: ["payments"] }, props: { env: "sandbox", mode: "payment", intent_id: "int_1", client_secret: SECRET, currency: "EUR", methods: ["card"] } }]);
  });

  it("without the create's client_secret (another process made the intent), the card is not sent", async () => {
    const co = new AirwallexHostedCheckout(api(s), { launch });
    expect(await co.pay("int_9", "airi-x1", credFile())).toMatchObject({ outcome: "NOT_SUBMITTED", code: "HPP_NO_CLIENT_SECRET" });
  });
});

describe("AIRI_CHECKOUT", () => {
  const fake = { call: async () => ({}) } as unknown as Parameters<typeof checkoutFromEnv>[0];
  it("selects the hosted page by default, the API confirm on request, and refuses anything else", () => {
    expect(checkoutFromEnv(fake, {}).kind).toBe("airwallex-sandbox-hosted");
    expect(checkoutFromEnv(fake, { AIRI_CHECKOUT: "hosted" }).kind).toBe("airwallex-sandbox-hosted");
    expect(checkoutFromEnv(fake, { AIRI_CHECKOUT: "api" }).kind).toBe("airwallex-sandbox");
    expect(() => checkoutFromEnv(fake, { AIRI_CHECKOUT: "native" })).toThrow(/hosted or api/);
  });
});
