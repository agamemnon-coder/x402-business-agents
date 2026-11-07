// The hosted-page checkout for the Airi rail, the default (AIRI_CHECKOUT=hosted): the agent pays on Airwallex's own
// Hosted Payment Page, typing the card from Airi's single-use credential into it the way a shopper would. That is how
// Airi's credential is meant to be used, and it is the route our sandbox allows: on 7 November (vic-1b) the API confirm
// (checkout.ts) was refused with "This account is not enabled for native API access".
//
//   1. Server side, as before: POST /pa/payment_intents/create (checkout.ts). Its answer carries the intent's
//      client_secret, kept in memory for this purchase only.
//   2. Headless Chromium opens a local launch page that loads Airwallex.js and calls
//      payments.redirectToCheckout({ env: "sandbox", intent_id, client_secret, currency, ... }), which sends the
//      browser to the Hosted Payment Page. The SDK builds the page's address; nothing here guesses it.
//      Docs (read 7 November 2026):
//        https://www.airwallex.com/docs/payments/integration-options/web-checkout/hosted-payment-page
//        https://www.airwallex.com/docs/js/payments/hosted-payment-page/   (redirectToCheckout, its props, env)
//        https://github.com/airwallex/airwallex-payment-demo/blob/master/docs/hpp.md   (the CDN script below)
//      The live probe of 7 November (Airwallex's test card 4035501000000008, one PaymentIntent) landed on
//      https://checkout.sandbox.airwallex.com/ with the card fields in the top document: inputs with autocomplete
//      cc-number, cc-exp ("MM / YY"), cc-csc and cc-name, and a "Pay" button. The intent went to SUCCEEDED.
//   3. The card goes only into a page on HPP_ORIGIN (checked before any field is typed into). Then Pay, and the page is
//      watched for its own end: completed, failed, or a 3-D Secure step.
//   4. Then one GET /pa/payment_intents/{id}: Airwallex's state decides, never the page. REQUIRES_CUSTOMER_ACTION
//      (3DS that did not finish by itself) is a decline, THREE_DS_REQUIRED: the sandbox's frictionless 3DS completes
//      on the page by itself; a challenge (a code for the cardholder, which the docs give only for their own test
//      cards) is not something an agent may answer for Max.
//
// Never recorded: no screenshot, trace, video or HAR is taken; the page's address (it holds the client_secret), its
// text and Playwright's own error messages are not logged or returned. Errors carry fixed codes only. The browser is
// closed in `finally`. Playwright is a dev dependency of this repo (it runs from source); it is loaded only here.

import { createServer, type Server } from "node:http";
import type { Browser, Frame, Page } from "playwright";
import { AirwallexAmbiguous } from "../airwallex/client.js";
import { AirwallexBudgetSpent } from "../airwallex/callBudget.js";
import { AirwallexSandboxCheckout, Intent, answerOf, code } from "./checkout.js";
import { CheckoutOutcomeUnknown, type CheckoutAnswer } from "./client.js";
import { CredentialFileError, type CardForCheckout } from "./credential.js";

/** The only origin the card is ever typed into: Airwallex's sandbox Hosted Payment Page (seen in the probe). */
export const HPP_ORIGIN = "https://checkout.sandbox.airwallex.com";
/** Airwallex.js from Airwallex's CDN, as the HPP guide loads it. */
export const SDK_URL = "https://static.airwallex.com/components/sdk/v1/index.js";

export interface HostedIntent { id: string; clientSecret: string; currency: string; countryCode?: string }

/** Sends `page` to the hosted page for this intent. */
export type HostedOpener = (page: Page, intent: HostedIntent) => Promise<void>;

export interface HostedOptions {
  /** Where the card may be typed. Tests point it at a local stub page with the same fields. */
  hppOrigin?: string;
  /** How the page is reached. Default: the Airwallex.js launch page (sdkOpener). */
  open?: HostedOpener;
  /** The browser. Default: chromium.launch(). */
  launch?: () => Promise<Browser>;
  /** How long to wait for the page's own end after Pay (default 45 s). */
  settleMs?: number;
  /** How long a 3DS step may run on its own (frictionless) before it counts as a challenge (default 20 s). */
  threeDsGraceMs?: number;
  /** How long to wait for the page and its fields (default 45 s). */
  loadMs?: number;
  /** The shopper's country for the page (redirectToCheckout's country_code). */
  countryCode?: string;
  /** Name on card when the credential has none. */
  cardholderName?: string;
}

/** The launch page: Airwallex.js from the CDN, then redirectToCheckout (docs above). The secret is passed in by
 *  page.evaluate, never in an address. `sdkUrl` is a parameter for tests only. */
export function sdkOpener(sdkUrl: string = SDK_URL, env: "sandbox" = "sandbox"): HostedOpener {
  return async (page, intent) => {
    const html = `<!doctype html><meta charset="utf-8"><title>Purser checkout</title><script src="${sdkUrl}"></script><body></body>`;
    const server: Server = createServer((_q, s) => { s.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); s.end(html); });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
    try {
      const { port } = server.address() as { port: number };
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction("!!(window.AirwallexComponentsSDK && window.AirwallexComponentsSDK.init)", null, { timeout: 30_000 });
      const props = { env, mode: "payment", intent_id: intent.id, client_secret: intent.clientSecret, currency: intent.currency, methods: ["card"], ...(intent.countryCode ? { country_code: intent.countryCode } : {}) };
      // A string, not a closure: the function body reaches the page as written (tsx would otherwise add helpers).
      await page.evaluate(`(async (p) => { const { payments } = await window.AirwallexComponentsSDK.init({ env: p.env, enabledElements: ["payments"] }); payments.redirectToCheckout(p); })(${JSON.stringify(props)})`);
      await page.waitForURL((u) => u.hostname !== "127.0.0.1", { timeout: 30_000 });
    } finally {
      server.close();
    }
  };
}

type PageEnd = "completed" | "failed" | "three_ds" | "no_end";

const END_COMPLETED = /payment (completed|successful)|\bsucceeded\b/i;
const END_FAILED = /declined|payment failed|failed to pay|try again|was not successful/i;
const THREE_DS = /3d ?secure|3ds|threeds|authenticat|challenge|\bacs\b|verification code|one-time (pass)?code|otp/i;

/** What the page shows now: its own end, or a 3DS step. Reads text and frame attributes; returns an enum only. */
async function pageEnd(page: Page): Promise<PageEnd | "three_ds_seen" | null> {
  const seen = await page.evaluate(`(() => {
    const text = (document.body ? document.body.innerText : "");
    const frames = [...document.querySelectorAll("iframe")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 50 && getComputedStyle(e).visibility !== "hidden"; })
      .map((e) => [e.getAttribute("src") || "", e.getAttribute("name") || "", e.getAttribute("id") || "", e.getAttribute("title") || ""].join(" "));
    return { text, frames };
  })()`).catch(() => null) as { text: string; frames: string[] } | null;
  if (!seen) return null;
  if (END_COMPLETED.test(seen.text)) return "completed";
  if (END_FAILED.test(seen.text)) return "failed";
  if (seen.frames.some((f) => THREE_DS.test(f) && !/captcha|recaptcha/i.test(f)) || /3d ?secure|verification code|one-time (pass)?code/i.test(seen.text)) return "three_ds_seen";
  return null;
}

/** The frame on the hosted page's origin that holds the card number field. */
async function cardFrame(page: Page, origin: string, timeoutMs: number): Promise<Frame | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    for (const f of page.frames()) {
      let o: string;
      try { o = new URL(f.url()).origin; } catch { continue; }
      if (o !== origin) continue;
      if (await f.locator('input[autocomplete="cc-number"]').first().isVisible().catch(() => false)) return f;
    }
    if (Date.now() > until) return null;
    await page.waitForTimeout(250);
  }
}

const notSubmitted = (reference: string, code: string, reason: string): CheckoutAnswer => ({ outcome: "NOT_SUBMITTED", reference, code, reason });

export class AirwallexHostedCheckout extends AirwallexSandboxCheckout {
  override readonly kind = "airwallex-sandbox-hosted" as const;
  override readonly label = "Airwallex sandbox Hosted Payment Page, filled by the agent like a shopper (our own test shop; test money)";
  /** Per prepared intent, in memory only: its client_secret and currency, for the one pay() that follows. */
  private readonly secrets = new Map<string, string>();
  private readonly currencies = new Map<string, string>();
  private readonly o: Required<Omit<HostedOptions, "countryCode" | "launch">> & Pick<HostedOptions, "countryCode" | "launch">;

  constructor(api: ConstructorParameters<typeof AirwallexSandboxCheckout>[0], options: HostedOptions = {}, readCard?: ConstructorParameters<typeof AirwallexSandboxCheckout>[1]) {
    super(api, readCard);
    this.o = {
      hppOrigin: options.hppOrigin ?? HPP_ORIGIN, open: options.open ?? sdkOpener(), launch: options.launch, settleMs: options.settleMs ?? 45_000,
      threeDsGraceMs: options.threeDsGraceMs ?? 20_000, loadMs: options.loadMs ?? 45_000, countryCode: options.countryCode, cardholderName: options.cardholderName ?? "Purser Sourcing agent",
    };
  }

  protected override created(id: string, raw: unknown): void {
    const s = (raw as { client_secret?: unknown } | null)?.client_secret;
    if (typeof s === "string" && s.length > 0 && s.length < 4096) this.secrets.set(id, s);
  }

  private async launch(): Promise<Browser> {
    if (this.o.launch) return this.o.launch();
    const { chromium } = await import("playwright");
    return chromium.launch();
  }

  override async pay(reference: string, ref: string, credentialFile: string): Promise<CheckoutAnswer> {
    void ref;
    let card: CardForCheckout | null;
    try {
      card = this.readCard(credentialFile);
    } catch (e) {
      return notSubmitted(reference, "CREDENTIAL_UNREADABLE", e instanceof CredentialFileError ? e.message : "the credential file could not be read");
    }
    const secret = this.secrets.get(reference);
    const currency = this.currencies.get(reference);
    if (!secret || !currency) return notSubmitted(reference, "HPP_NO_CLIENT_SECRET", "the PaymentIntent's client_secret is not at hand (only the process that created it holds it); the card was not sent");

    let submitted = false;
    let end: PageEnd = "no_end";
    let browser: Browser | null = null;
    try {
      try {
        browser = await this.launch();
        // A plain context: no trace, no video, no HAR; nothing of the page is kept.
        const context = await browser.newContext();
        const page = await context.newPage();
        await this.o.open(page, { id: reference, clientSecret: secret, currency, countryCode: this.o.countryCode });
        const frame = await cardFrame(page, this.o.hppOrigin, this.o.loadMs);
        if (!frame) return notSubmitted(reference, new URL(page.url()).origin === this.o.hppOrigin ? "HPP_FIELDS_NOT_FOUND" : "HPP_WRONG_ORIGIN", "the hosted payment page did not show its card fields on Airwallex's origin; the card was not typed");
        const field = (ac: string) => frame.locator(`input[autocomplete="${ac}"]`).first();
        await field("cc-number").fill(card.number);
        await field("cc-exp").fill(`${card.expiryMonth} / ${card.expiryYear.slice(2)}`);
        await field("cc-csc").fill(card.cvc);
        if (await field("cc-name").isVisible().catch(() => false)) await field("cc-name").fill(card.name ?? this.o.cardholderName);
        card = null;
        // Checked again just before the card leaves: the frame must still be on the hosted page's origin.
        if (new URL(frame.url()).origin !== this.o.hppOrigin) return notSubmitted(reference, "HPP_WRONG_ORIGIN", "the hosted payment page left Airwallex's origin before Pay; nothing was submitted");
        submitted = true;
        await frame.getByRole("button", { name: /^\s*pay\b/i }).first().click({ timeout: 10_000 });
        end = await this.watch(page);
      } catch {
        // Playwright's message is not kept: it can quote the page. Before Pay nothing left; after, the GET decides.
        if (!submitted) return notSubmitted(reference, "HPP_UNAVAILABLE", "the hosted payment page could not be opened or filled; the card was not submitted");
      }
    } finally {
      this.secrets.delete(reference);
      this.currencies.delete(reference);
      await browser?.close().catch(() => undefined);
    }
    return this.outcome(reference, end);
  }

  override async prepare(order: { ref: string; amount: string; currency: string; description: string }): ReturnType<AirwallexSandboxCheckout["prepare"]> {
    const r = await super.prepare(order);
    if (!("outcome" in r)) this.currencies.set(r.reference, order.currency);
    return r;
  }

  /** Waits for the page's own end after Pay. A 3DS step gets threeDsGraceMs to finish by itself. */
  private async watch(page: Page): Promise<PageEnd> {
    const until = Date.now() + this.o.settleMs;
    let threeDsSince: number | null = null;
    while (Date.now() < until) {
      const s = await pageEnd(page);
      if (s === "completed" || s === "failed") return s;
      if (s === "three_ds_seen") {
        threeDsSince ??= Date.now();
        if (Date.now() - threeDsSince > this.o.threeDsGraceMs) return "three_ds";
      } else threeDsSince = null;
      await page.waitForTimeout(500);
    }
    return threeDsSince !== null ? "three_ds" : "no_end";
  }

  /** One GET: Airwallex's own state of the intent is the outcome. */
  private async outcome(reference: string, end: PageEnd): Promise<CheckoutAnswer> {
    let raw: unknown;
    try {
      raw = await this.api.call("GET", `/pa/payment_intents/${encodeURIComponent(reference)}`);
    } catch (e) {
      if (e instanceof AirwallexBudgetSpent) throw new CheckoutOutcomeUnknown(reference, "the card was submitted on the hosted page, but the call budget is spent so its outcome was not read; outcome unknown");
      throw new CheckoutOutcomeUnknown(reference, e instanceof AirwallexAmbiguous ? "Airwallex did not answer the PaymentIntent read after the hosted page; outcome unknown" : "the PaymentIntent read after the hosted page failed; outcome unknown");
    }
    const i = Intent.safeParse(raw);
    if (!i.success) throw new CheckoutOutcomeUnknown(reference, "Airwallex's PaymentIntent answer was not in the expected shape; outcome unknown");
    if (i.data.status === "REQUIRES_CUSTOMER_ACTION") return { outcome: "DECLINED", reference, code: "THREE_DS_REQUIRED" };
    const a = answerOf(i.data);
    if (a?.outcome === "NOT_SUBMITTED") {
      return notSubmitted(reference, "HPP_NOT_SUBMITTED", `the hosted page did not submit the card (page: ${end === "failed" ? "it showed an error" : end === "three_ds" ? "a 3DS step" : end === "completed" ? "it said completed" : "no end shown"}); the PaymentIntent has no payment attempt`);
    }
    if (!a) throw new CheckoutOutcomeUnknown(reference, `the PaymentIntent is ${code(i.data.status) ?? "in an unknown state"} after the hosted page; outcome not final yet`);
    return a;
  }
}
