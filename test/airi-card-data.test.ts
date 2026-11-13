// How the Airi rail handles card data (12 Nov), against stand-ins and a scripted Airwallex client: no network, no
// airi-cli. The credential here is made up for the tests: the public test number 4111 1111 1111 1111 with a made-up
// expiry and security code.
//   1. The credential file and its folder are gone after every purchase, however it ends; while the checkout reads it,
//      the folder is its owner's alone, and a file anyone else could read is refused unread.
//   2. No card number, expiry or security code reaches the ledger (any table), the outcome, the operator's console or
//      the passkey sink; the card goes into the checkout's one request and nowhere else.
//   3. The committed run records hold no card number and no security-code pattern: none at all in the Airi rail's own
//      records; elsewhere under docs/runs and docs/demo only a published test number, in the files named below.
//   4. /visa's folded block says plainly what this is not, and its figures are the code's constants.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { VIC_INTENTS_PREFIX, luhnValid } from "../src/airwallex/intentReadback.js";
import { CREDENTIAL_DIR_MODE, CREDENTIAL_FILE_NAME, CREDENTIAL_OTHERS_MASK, CVV_PATTERN, HPP_ORIGIN, SCRUB_DIGITS_FROM } from "../src/airi/cardData.js";
import { AirwallexSandboxCheckout } from "../src/airi/checkout.js";
import { scrubText, type AiriCheckout, type AiriCredentialReceipt, type CheckoutAnswer } from "../src/airi/client.js";
import { readCredentialFile } from "../src/airi/credential.js";
import { HPP_ORIGIN as HOSTED_ORIGIN } from "../src/airi/hostedCheckout.js";
import { TMP_PREFIX, requestAiriPurchase, type AiriDeps, type AiriPurchaseRequest } from "../src/airi/purchase.js";
import { StandInAiriClient } from "../src/airi/standIn.js";
import { openDb, type DB } from "../src/db/open.js";
import { AIRI_RUN_FILE, AIRI_RUN_LOG } from "../src/redesign/airiRun.js";
import { latestRecordFile } from "../src/redesign/airwallexProof.js";
import { CARD_DATA_ID, CARD_DATA_NOT, CARD_DATA_SUMMARY, cardDataFacts, cardDataHtml } from "../src/redesign/cardData.js";
import { visaPage } from "../src/redesign/partners.js";
import { VIC2_RUN_FILE, VIC2_RUN_LOG } from "../src/redesign/vic2Run.js";

const T0 = new Date("2026-11-07T10:00:00Z");
const PAN = "4111111111111111", CVC = "737", MONTH = "12", YEAR = "2031";
const PAN_FORMS = [PAN, "4111 1111 1111 1111", "4111-1111-1111-1111"];
const EXPIRY_FORMS = [`${MONTH}/${YEAR}`, `${MONTH}/${YEAR.slice(2)}`, `${MONTH} / ${YEAR.slice(2)}`, `${YEAR}-${MONTH}`];

/**
 * The card numbers in a text: 13 to 19 digits (alone, or in groups split by single spaces or dashes) that stand on
 * their own and pass the card check digit (Luhn). Digits inside a longer word (a hash, an id with letters) or a
 * decimal are not a number standing on its own; a long id that fails the check digit is an id.
 */
function cardNumbersIn(text: string): string[] {
  return (text.match(/(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w]|\.\d)/g) ?? []).map((run) => run.replace(/[ -]/g, "")).filter((d) => luhnValid(d));
}

/** An Airi stand-in whose credential file looks like the real one: a card number, an expiry and a security code. */
class CardAiri extends StandInAiriClient {
  constructor(private readonly fileMode = 0o600) { super(); }
  override async getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt> {
    this.calls.push({ op: "mandate get-credential", args: ["--mandate-id", mandateId, "--file", file] });
    writeFileSync(file, JSON.stringify({ tokenNumber: PAN, expiryMonth: MONTH, expiryYear: YEAR, cvv: CVC, tokenType: "DPAN" }), { mode: 0o600, flag: "wx" });
    chmodSync(file, this.fileMode);
    return { status: "READY", tokenType: "DPAN", tokenExpiration: "2026-11-07T12:00:00Z" };
  }
}

type Call = { method: string; path: string; body?: unknown };
/** A scripted Airwallex client; the checkout around it notes the credential file it was handed and that folder's mode. */
function checkout(confirm: (c: Call) => unknown) {
  const calls: Call[] = [];
  const api = { call: async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    calls.push({ method, path, body });
    if (path.endsWith("/create")) return { id: "int_test1", status: "REQUIRES_PAYMENT_METHOD" } as T;
    return confirm({ method, path, body }) as T;
  } };
  const seen: { file: string; dirMode: number; inDir: string[] }[] = [];
  class Watching extends AirwallexSandboxCheckout {
    override async pay(reference: string, ref: string, file: string): Promise<CheckoutAnswer> {
      seen.push({ file, dirMode: statSync(dirname(file)).mode & 0o777, inDir: readdirSync(dirname(file)) });
      return super.pay(reference, ref, file);
    }
  }
  return { co: new Watching(api) as AiriCheckout, calls, seen };
}

function seed(db: DB) {
  const set = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v, T0.toISOString());
  set("approval.airi_alone", "20.00"); set("approval.airi_alone_per_day", "3"); set("airi.merchant.northwind-sandbox", "allowed");
}
const req = (): AiriPurchaseRequest => ({ agent: "sourcing", paymentMethodId: "standin-pm-1", merchantName: "Northwind test shop", merchantUrl: "https://kit11.max-31b.workers.dev/", merchantCountry: "NL", amount: "12.00", currency: "EUR", items: [{ name: "Trail map pack", unitPrice: "12.00", quantity: "1" }], description: "order 1" });

/** Every row of every table of the ledger, as one text. */
function ledgerText(db: DB): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => JSON.stringify({ table: t, rows: db.prepare(`SELECT * FROM "${t}"`).all() })).join("\n");
}
/** Every value anywhere in a text of JSON lines, a JSON text held in a string included. */
function values(text: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") { out.push(v); try { const inner: unknown = JSON.parse(v); if (inner && typeof inner === "object") walk(inner); } catch { /* a plain string */ } }
    else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const line of text.split("\n")) { try { walk(JSON.parse(line)); } catch { out.push(line); } }
  return out;
}
/** No trace of the made-up card in a text: its number in any grouping, any card number, a security-code pattern, its expiry, or its code or expiry year as a value of their own. */
function expectNoCard(what: string, text: string) {
  for (const form of [...PAN_FORMS, ...EXPIRY_FORMS]) expect({ what, form, found: text.includes(form) }).toEqual({ what, form, found: false });
  expect({ what, cards: cardNumbersIn(text) }).toEqual({ what, cards: [] });
  expect({ what, cvv: text.match(CVV_PATTERN) }).toEqual({ what, cvv: null });
  expect({ what, asValue: values(text).filter((v) => v === CVC || v === YEAR || v.replace(/\D/g, "") === PAN) }).toEqual({ what, asValue: [] });
}

let tmpRoot: string;
beforeEach(() => { tmpRoot = mkdtempSync(join(tmpdir(), "airi-card-test-")); });
// Each test has checked by then that the credential is gone; the folders the purchases made are removed after it.
afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** One purchase within the limit, paid through `co` with the card-like credential; everything a person or a record could see. */
async function purchase(co: AiriCheckout, airi = new CardAiri()) {
  const db = openDb(":memory:");
  seed(db);
  const said: string[] = [], shown: string[] = [];
  const deps: AiriDeps = { airi, checkout: co, tmpRoot, say: (l) => said.push(l), showPasskeyUrl: (url, info) => shown.push(JSON.stringify({ url, info })), sleep: async () => {} };
  const out = await requestAiriPurchase(db, deps, req(), T0);
  return { db, out, said, shown };
}

describe("the Airi credential: gone after use, and in no record", () => {
  const scenarios: [string, (c: Call) => unknown, string][] = [
    ["paid", () => ({ id: "int_test1", status: "SUCCEEDED" }), "succeeded"],
    ["declined by Airwallex, whose error echoes the card", (c) => { throw new AirwallexError(400, "card_declined", { message: `declined: ${PAN} cvv ${CVC} exp ${MONTH}/${YEAR}` }, c.path); }, "refused"],
    ["no answer from Airwallex, the error quoting the card", (c) => { throw new AirwallexAmbiguous(c.path, new Error(`socket hang up after sending ${PAN} cvc ${CVC}`)); }, "unconfirmed"],
    ["a failure before an answer, its message quoting the card", () => { throw new Error(`boom ${PAN_FORMS[1]} cvv: ${CVC} exp ${MONTH}/${YEAR.slice(2)}`); }, "unconfirmed"],
    ["an answer in another shape, echoing the card", () => ({ unexpected: PAN, cvc: CVC }), "unconfirmed"],
  ];

  it.each(scenarios)("%s: the file and its folder are removed, and no card data is left anywhere", async (_name, confirm, status) => {
    const { co, calls, seen } = checkout(confirm);
    const { db, out, said, shown } = await purchase(co);
    expect(out.status).toBe(status);
    // The checkout was handed one file, alone in a fresh folder that only its owner could open.
    expect(seen).toHaveLength(1);
    const file = seen[0]!.file, dir = dirname(file);
    expect(file).toBe(join(dir, CREDENTIAL_FILE_NAME));
    expect(dir.startsWith(join(tmpRoot, TMP_PREFIX))).toBe(true);
    expect(seen[0]!.inDir).toEqual([CREDENTIAL_FILE_NAME]);
    expect(seen[0]!.dirMode.toString(8)).toBe(CREDENTIAL_DIR_MODE.toString(8));
    // The card went into the checkout's one request, and into no other.
    const confirmCall = calls.find((c) => c.path.endsWith("/confirm"))!;
    expect((confirmCall.body as { payment_method: { card: { number: string; cvc: string } } }).payment_method.card).toMatchObject({ number: PAN, cvc: CVC });
    expectNoCard("the other requests", calls.filter((c) => c !== confirmCall).map((c) => JSON.stringify(c)).join("\n"));
    // Gone: the file, its folder, and any other credential folder.
    expect(existsSync(file)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(tmpRoot)).toEqual([]);
    // Nothing of the card in the ledger, the outcome, the console or what the passkey sink was given.
    const ledger = ledgerText(db);
    expect(ledger).toContain("airi.credential_received");
    expectNoCard("the ledger", ledger);
    expectNoCard("the outcome", JSON.stringify(out));
    expectNoCard("the console", said.join("\n"));
    expectNoCard("the passkey sink", shown.join("\n"));
    // Where the credential was is not kept either.
    expect(ledger).not.toContain(tmpRoot);
    expect(ledger).not.toContain(CREDENTIAL_FILE_NAME);
  });

  it.each([["0644", 0o644], ["0640", 0o640], ["0604", 0o604], ["0660", 0o660]] as const)("a credential file with mode %s is refused unread, the card is not sent, and the file is removed all the same", async (_label, mode) => {
    expect(mode & CREDENTIAL_OTHERS_MASK).not.toBe(0);
    const { co, calls, seen } = checkout(() => ({ id: "int_test1", status: "SUCCEEDED" }));
    const { db, out } = await purchase(co, new CardAiri(mode));
    expect(out).toMatchObject({ status: "refused", by: "checkout", code: "CREDENTIAL_UNREADABLE" });
    expect(calls.some((c) => c.path.endsWith("/confirm"))).toBe(false);
    expect(existsSync(seen[0]!.file)).toBe(false);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(() => readCredentialFile(seen[0]!.file)).toThrow(/could not be opened/);
    expectNoCard("the ledger", ledgerText(db));
  });

  it("the detector knows a card number from an id, a hash and a decimal", () => {
    expect(cardNumbersIn(`paid with ${PAN_FORMS[1]}, ${PAN_FORMS[2]} and ${PAN}.`)).toEqual([PAN, PAN, PAN]);
    // One digit off fails the check digit: an id, not a card number.
    expect(cardNumbersIn(`id ${PAN.slice(0, -1)}2`)).toEqual([]);
    // Inside a longer word or a decimal it is not a number standing on its own.
    expect(cardNumbersIn(`hash 8d${PAN}e6, id int_${PAN}, cost 0.${PAN}`)).toEqual([]);
    expect(`cvv ${CVC}, CVC: ${CVC}, security code ${CVC}`.match(CVV_PATTERN)).toHaveLength(3);
  });

  it("text kept from Airi or a checkout loses a run of 12 digits or more, and a security code after its word", () => {
    expect(SCRUB_DIGITS_FROM).toBe(12);
    const run = "1".repeat(SCRUB_DIGITS_FROM);
    expect(scrubText(`ref ${run} end`)).not.toContain(run);
    expect(scrubText(`ref ${run} end`)).toContain("[digits]");
    expect(scrubText(`ref ${run.slice(1)} end`)).toBe(`ref ${run.slice(1)} end`);
    // Every such run, as /visa says (12 Nov): of any length, and next to a letter or an underscore too. Before, a run
    // of 20 digits or a card number glued to a word came through unchanged.
    expect(scrubText("id 12345678901234567890 x")).toBe("id [digits] x");
    expect(scrubText(`token ${"7".repeat(40)}.`)).toBe("token [digits].");
    for (const glued of ["ref_4111111111111111", "a4111111111111111b", "pan_4111111111111111", "pan:4111-1111-1111-1111;", "4111 1111 1111 1111x", "x4111 1111 1111 1111"]) {
      expect({ glued, out: /\d{4}/.test(scrubText(glued)) }).toEqual({ glued, out: false });
      expect(scrubText(glued)).toContain("[digits]");
    }
    // What stays: a time, an amount, a short id, an Airwallex id, a hash's first characters.
    for (const kept of ["2026-11-07T13:56:57.873Z", "2026-11-07 13:56:57", "EUR 45.00", "P-0002", "int_sgpvzc9hjhnxvpblt2r", "airi-mw6gw810-4f53f4f0", "terms 8bbfffc9…", "provider code 00, auth 539054"]) expect(scrubText(kept)).toBe(kept);
    expect(scrubText(`declined: ${PAN_FORMS[1]} cvv ${CVC}`)).not.toMatch(/\d{3}/);
    expect(scrubText(`cvv ${CVC}`)).toBe("cvv [digits]");
  });

  it("the hosted checkout types the card into one origin only, and takes no screenshot, trace, video or HAR", () => {
    expect(HOSTED_ORIGIN).toBe(HPP_ORIGIN);
    expect(new URL(HPP_ORIGIN).host).toBe("checkout.sandbox.airwallex.com");
    // test/airi-hosted-checkout.test.ts runs the page against a stub; here the source is held to what /visa says.
    const src = readFileSync(new URL("../src/airi/hostedCheckout.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.screenshot\(|\.tracing\b|recordVideo|recordHar|\.pdf\(|\.content\(\)/);
    expect(src).toMatch(/browser\?\.close\(\)/);
  });
});

describe("the committed run records", () => {
  const airi = [AIRI_RUN_FILE, AIRI_RUN_LOG, VIC2_RUN_FILE, VIC2_RUN_LOG, latestRecordFile(VIC_INTENTS_PREFIX)!];
  /** A published test number, where a document names it; never a credential Airi issued. */
  const PUBLISHED: Record<string, string[]> = {
    // Airwallex's documented success test card, named in the hosted-page probe's plan and in the sandbox log of 10 Nov.
    "docs/runs/2026-11-10-payment-acceptance-sandbox.md": ["4035501000000008"],
    "docs/runs/vic-1-plan.md": ["4035501000000008"],
  };
  /**
   * Ids that pass the card check digit by chance and are named as something else in the record (12 Nov, merge of
   * main: the Moneybird sandbox run's invoice id OD-77, its `external_id` in Moneybird; 18 digits, not a card number).
   */
  const NOT_A_CARD: Record<string, string[]> = {
    "docs/runs/2026-11-12-moneybird-sandbox.json": ["503594084810622802"],
    "docs/runs/2026-11-12-moneybird-sandbox.md": ["503594084810622802"],
  };
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const all = ["docs/runs", "docs/demo"].flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url)).filter((n) => /\.(json|md|jsonl|txt|csv)$/.test(n)).map((n) => `${d}/${n}`));

  it.each(airi)("%s (the Airi rail's own) holds no card number and no security-code pattern", (f) => {
    const t = read(f);
    expect(t.length).toBeGreaterThan(100);
    expect(all).toContain(f);
    expect({ f, cards: cardNumbersIn(t) }).toEqual({ f, cards: [] });
    expect({ f, cvv: t.match(CVV_PATTERN) }).toEqual({ f, cvv: null });
    for (const form of PAN_FORMS) expect({ f, form, found: t.includes(form) }).toEqual({ f, form, found: false });
  });

  it("every record under docs/runs and docs/demo: no security-code pattern, and no card number but a published test number where a document names it", () => {
    expect(all.length).toBeGreaterThan(50);
    // Each id let through is in its record, and in the Moneybird run's record it is a Moneybird `external_id`.
    for (const [f, ids] of Object.entries(NOT_A_CARD)) for (const id of ids) expect({ f, id, named: f.endsWith(".json") ? read(f).includes(`"external_id": "${id}"`) : read(f).includes(`\`${id}\``) }).toEqual({ f, id, named: true });
    const found = all.flatMap((f) => { const t = read(f); const cards = [...new Set(cardNumbersIn(t))].filter((c) => !(NOT_A_CARD[f] ?? []).includes(c)); return cards.length || t.match(CVV_PATTERN) ? [{ f, cards, cvv: t.match(CVV_PATTERN) }] : []; });
    expect(found).toEqual(Object.entries(PUBLISHED).map(([f, cards]) => ({ f, cards, cvv: null })));
  });
});

describe("\"Card data\" on /visa", () => {
  const html = visaPage();
  const block = new RegExp(`<details class="fold" id="${CARD_DATA_ID}">[\\s\\S]*?</details>`).exec(html)?.[0] ?? "";
  const text = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  it("is one folded row under the Airi runs, above the TAP section, and its line already says what this is not", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/<details[^>]* open/);
    expect(text(/<summary>([\s\S]*?)<\/summary>/.exec(block)![1]!)).toBe(CARD_DATA_SUMMARY);
    expect(CARD_DATA_SUMMARY).toBe("Card data: not a network-tokenised checkout, no PCI attestation");
    expect(html.indexOf(`id="${CARD_DATA_ID}"`)).toBeGreaterThan(html.indexOf('id="vic-rules"'));
    expect(html.indexOf(`id="${CARD_DATA_ID}"`)).toBeLessThan(html.indexOf('id="visa-tap"'));
    expect(cardDataHtml()).toBe(block);
  });

  it("states plainly: not a network-tokenised checkout; a headless browser types Airi's Visa credential; no PCI attestation", () => {
    const t = text(block);
    expect(CARD_DATA_NOT).toEqual([
      "This is not a network-tokenised checkout.",
      "In a sandbox test run, a headless browser types Airi's Visa credential into Airwallex's hosted card page, as Airi's instructions say: like a normal card. How that credential relates to a Visa network token is not documented.",
      "There is no PCI attestation.",
    ]);
    // The three, word for word and in this order, open the block.
    expect(t.startsWith(`${CARD_DATA_SUMMARY} ${CARD_DATA_NOT.join(" ")}`)).toBe(true);
    // Nothing that reads as a sign-off, and no partner's blessing.
    expect(t).not.toMatch(/PCI[- ](DSS[- ])?complian|complies with PCI|PCI[- ]certif|certified|endorsed|approved by|out of (PCI )?scope|secure\b(?! sign)/i);
    expect(t).toContain("Sandbox and a test card only.");
  });

  it("reads its figures from the code's constants, and links the code and the test that hold them", () => {
    const t = text(block);
    expect(t).toContain(`mode 0${CREDENTIAL_DIR_MODE.toString(8)}`);
    expect(t).toContain(new URL(HPP_ORIGIN).host);
    expect(t).toContain(`${SCRUB_DIGITS_FROM} or more digits`);
    for (const f of ["src/airi/credential.ts", "src/airi/hostedCheckout.ts", "src/airi/purchase.ts", "test/airi-card-data.test.ts"]) {
      expect(existsSync(new URL(`../${f}`, import.meta.url))).toBe(true);
      expect(block).toContain(`href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/${f}"`);
    }
    // No number in the block but those two constants.
    expect((t.match(/\d+/g) ?? []).sort()).toEqual([`0${CREDENTIAL_DIR_MODE.toString(8)}`, String(SCRUB_DIGITS_FROM)].sort());
  });

  it("is said in docs/claims.md with the same words and figures, and with what is not claimed", () => {
    const row = readFileSync(new URL("../docs/claims.md", import.meta.url), "utf8").split("\n").find((l) => l.startsWith(`| "${CARD_DATA_SUMMARY}"`))!;
    expect(row).toBeDefined();
    expect(row).toContain(`"${CARD_DATA_NOT.join(" ")}"`);
    for (const want of [`mode 0${CREDENTIAL_DIR_MODE.toString(8)}`, new URL(HPP_ORIGIN).host, `${SCRUB_DIGITS_FROM} or more digits`, "Sandbox and a test card only.", "Not claimed: PCI DSS compliance", `\`#${CARD_DATA_ID}\``, "src/airi/cardData.ts", "test/airi-card-data.test.ts"]) expect({ want, said: row.includes(want) }).toEqual({ want, said: true });
    // What the block says the code does is in the row too: each fact's opening clause, whatever its first letter's case.
    for (const fact of cardDataFacts()) expect({ fact, said: row.toLowerCase().includes(fact.split(/[.(]/)[0]!.trim().toLowerCase()) }).toEqual({ fact, said: true });
  });
});
