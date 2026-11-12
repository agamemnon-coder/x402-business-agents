// The virtual phones of the drivers in this folder (thursday-dry.ts, test-controller.ts): a Chromium context at phone
// size with its own virtual WebAuthn authenticator (CDP, user verification on), which plays a passkey. A test identity,
// never a person's device: every driver that uses one says so in what it prints. Not product code, not part of npm test.
//
//   phone   a phone: its page, its DevTools session and its authenticator
//   enrol   opens an enrolment window, creates the passkey on the phone and confirms its fingerprint (thursday-dry)
//   sign    opens a proposal's approval view on a phone and approves (or rejects) with the passkey
// The parts of `enrol` are exported too (openViewer, createPasskey): test-controller.ts creates its passkey with them
// and leaves the confirmation to the operator.
//
// The viewer link holds the viewer key: it is opened, never printed. A browser error can quote the address it failed
// on, so every message that leaves this module goes through hideViewKey.

import type { DB } from "../../../src/db/open.js";
import { confirmPasskey, openEnrolment, pendingPasskeys } from "../../../src/passkey/ledger.js";

// Playwright is not a dependency of this repo; it comes with the environment (Chromium pre-installed).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;
/** Chromium's DevTools session of one phone; its WebAuthn domain drives the virtual authenticator. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Cdp { send(method: string, params?: Record<string, unknown>): Promise<any> }
export interface Phone { page: Page; cdp: Cdp; authenticatorId: string }

export interface PhoneWorld {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser: { newContext(options: Record<string, unknown>): Promise<any> };
  /** The relay's address, as the runner prints it. */
  url: string;
  /** The viewer link the runner prints (it unlocks the pages and pins the runner's key). Never printed here. */
  viewer: () => string;
  db: () => DB;
  say: (line: string) => void;
  check: (ok: boolean, what: string) => boolean;
  /** A screenshot of a page under a name; a driver that keeps none passes a function that does nothing. */
  shot: (page: Page, name: string) => Promise<unknown>;
  /** Page errors, per phone, for the driver's own report. */
  errors: string[];
  sleep: (ms: number) => Promise<unknown>;
}

/** The viewer key never reaches a log: the link's fragment is cut from any text. */
export const hideViewKey = (s: string) => s.replace(/#view=[^\s"']+/g, "#view=…");

/** The verdicts the phone's page ends on, as src/approve/client.ts words them. */
export const FINAL_VERDICTS = ["Approved", "Done", "1 of 2 approvals", "Rejected", "Refused", "Too late", "Already decided", "Approved, but execution stopped"];

export function virtualPhones(w: PhoneWorld) {
  /** A phone: its own context (a private tab), its own virtual authenticator with user verification. */
  async function phone(name: string): Promise<Phone> {
    const context = await w.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on("pageerror", (e: Error) => w.errors.push(`${name}: ${hideViewKey(e.message)}`));
    const cdp = (await context.newCDPSession(page)) as Cdp;
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })) as { authenticatorId: string };
    return { page, cdp, authenticatorId };
  }

  /** Opens the viewer link on a phone, once per context: the pages show nothing without it. An error never quotes the link. */
  async function openViewer(p: Pick<Phone, "page">): Promise<void> {
    try {
      await p.page.goto(w.viewer());
    } catch (e) {
      throw new Error(`the viewer link could not be opened: ${hideViewKey((e as Error).message).slice(0, 200)}`);
    }
  }

  /** Types an enrolment code on the phone's enrol page and creates the passkey; returns the fingerprint the page shows. */
  async function createPasskey(p: Pick<Phone, "page">, code: string): Promise<string> {
    await openViewer(p);
    await p.page.goto(`${w.url}/enrol`);
    await p.page.fill("#code", code.toLowerCase());
    await p.page.click("button.confirm");
    await p.page.waitForFunction(() => document.querySelector(".verdict-head")?.textContent === "Confirm on the runner", null, { timeout: 60_000 });
    return /Fingerprint ([0-9A-F]{4}(?:-[0-9A-F]{4}){3})/.exec((await p.page.textContent(".verdict-what")) ?? "")?.[1] ?? "";
  }

  /** Enrols a phone's passkey (the window opened here, as the runbook's enrol command does) and confirms its fingerprint. */
  async function enrol(p: Pick<Phone, "page">, person: string | null): Promise<string> {
    const { code } = openEnrolment(w.db(), { rpId: new URL(w.url).hostname, origin: w.url, ...(person ? { addPerson: person } : {}) });
    // The runner takes a new enrolment window to the relay at its next sync: type the code once that has happened.
    await w.sleep(10_000);
    const shown = await createPasskey(p, code);
    w.check(pendingPasskeys(w.db()).some((x) => x.fingerprint === shown), `enrol ${person ?? "test-cfo"} (virtual test passkey): fingerprint ${shown} waits on the runner`);
    confirmPasskey(w.db(), shown);
    return shown;
  }

  /**
   * Opens a proposal's approval view on a phone, chooses an option (alternatives only), and approves or rejects with
   * the passkey once the button has armed. Returns the page's verdict and what the view said before the press.
   * `beforePress` runs with the view open and the button armed: a driver's last check, which stops it by throwing.
   */
  async function sign(p: Pick<Phone, "page">, id: string, o: { option?: "A" | "B"; tag: string; reject?: boolean; beforePress?: (text: string) => void | Promise<void> }): Promise<{ verdict: string; text: string }> {
    const page = p.page;
    const button = o.reject ? "#reject" : "#approve";
    const body = async () => ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    await page.goto(`${w.url}/approve/${id}`);
    try {
      await page.waitForSelector(button, { timeout: 120_000 });
    } catch (e) {
      await w.shot(page, `${o.tag}-no-proposal`);
      w.say(`  the phone shows: ${(await body()).slice(0, 300)}`);
      throw e;
    }
    if (!o.reject && o.option) await page.locator(".choices button.option", { hasText: `Option ${o.option}` }).first().tap();
    // A double tap must not land on a button: it arms a moment after the view opens (3 s against Opus's advice).
    await page.waitForFunction((q: string) => !(document.querySelector(q) as HTMLButtonElement | null)?.disabled, button, { timeout: 5000 });
    const text = await body();
    await w.shot(page, `${o.tag}-confirm`);
    if (o.beforePress) await o.beforePress(text);
    await page.click(button);
    try {
      await page.waitForFunction((f: string[]) => f.includes(document.querySelector(".verdict-head")?.textContent ?? ""), FINAL_VERDICTS, { timeout: 180_000 });
    } catch (e) {
      await w.shot(page, `${o.tag}-no-verdict`);
      w.say(`  the phone shows: ${(await body()).slice(-400)}`);
      throw e;
    }
    await w.shot(page, `${o.tag}-verdict`);
    const verdict = (await page.textContent(".verdict-head")) ?? "";
    w.say(`  ${o.tag}: ${id} → "${verdict}"`);
    return { verdict, text };
  }

  return { phone, openViewer, createPasskey, enrol, sign };
}
