// The hands-on page at /try (cloud/src/tryPage.ts): one page, one script under the console's nonce policy, values put
// on the page only as text, timers only for the three things that need one, the token read from the fragment and then
// removed from the address bar, and every word in cloud/src/tryCopy.ts inside each screen's budget.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleCsp } from "../cloud/src/console.js";
import * as COPY from "../cloud/src/tryCopy.js";
import { BOOKS_JS, PROOF_URL, RUNS_URL, SIGN_JS, tryPage } from "../cloud/src/tryPage.js";
import { AMOUNT_JS, normaliseAmount } from "../cloud/src/try/amount.js";
import { liveRuns } from "../src/redesign/runs.js";
import { ICONS } from "../src/ui/icons.js";
import { icon } from "../src/redesign/ui.js";
import { siteHeader } from "../cloud/src/siteHeader.js";
import { SCENE_CSS, sceneSvg } from "../cloud/src/scene.js";
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

  it("warms the company's engine right after the start answers, and starts a company only on the start button's click", () => {
    // One start request in the whole script, inside the start button's click handler: never on load or on hover.
    expect(script.match(/\/v1\/try\/start/g)).toHaveLength(1);
    expect(script).not.toMatch(/mouseover|mouseenter|pointerenter|pointerover|focusin/);
    const click = script.indexOf("b.addEventListener('click',async()=>{\n    b.disabled=true;label(C.start.starting,false);");
    expect(click).toBeGreaterThan(-1);
    expect(script.indexOf("'/v1/try/start'")).toBeGreaterThan(click);
    // Then, not awaited, before screen 1: the engine's status and the samples, in parallel; screen 1 takes the samples' answer.
    expect(script).toMatch(/WARM\.engine=api\('GET','\/v1\/engine'\);WARM\.samples=api\('GET','\/v1\/engine\/samples'\);show\('invoice'\)/);
    expect(script).toMatch(/const samples=WARM\.samples\|\|api\('GET','\/v1\/engine\/samples'\);WARM\.samples=null;/);
  });

  it("shows the invoice card's skeleton and who is reading while the request is in flight, with no value of the outcome", () => {
    expect(script).toMatch(/function skeleton\(/);
    const sk = script.slice(script.indexOf("function skeleton("), script.indexOf("\n}", script.indexOf("function skeleton(")));
    // The five row labels and empty placeholders only.
    for (const k of ["vendor", "number", "total", "due", "status"]) expect(sk).toContain(`C.fields.${k}`);
    expect(sk).not.toMatch(/\binv\.|r\.json|invoice_no|status_words/);
    expect(sk).toContain("C.work.reading");
    expect(sk).toContain("C.work.readingCode");
    // The count is the open-call timer's: askOpen on an asking row, askClose on the reader's next row.
    expect(sk).toMatch(/askOpen\(/);
    expect(sk).toMatch(/askClose\(/);
  });

  it("reads the amount with the one shared helper on screen 1, says a calm hint under the field, and sends only the normalised value", () => {
    const inv = script.slice(script.indexOf("screen('invoice'"), script.indexOf("// 2 At work"));
    expect(inv).toMatch(/normAmount\(amt\.value\)/);
    expect(inv).toMatch(/amt\.addEventListener\('blur'/);
    expect(inv).toMatch(/amount:v,/);
    expect(inv).not.toMatch(/amt\.setCustomValidity\(|amt\.reportValidity\(/);
    expect(inv).toContain("C.invoice.amountBad");
    // Past the demo's cap (5000.00, the simulated bank's USD floor) or under 1.00: the same calm hint, with the cap's
    // words above it, and nothing sent (amtRead answers null).
    expect(inv).toMatch(/Number\(v\)>5000\|\|Number\(v\)<1/);
    expect(inv).toContain("C.invoice.amountCap");
  });

  it("keeps the main button off on write your own until the suppliers are in, the supplier and IBAN as a skeleton meanwhile", () => {
    const inv = script.slice(script.indexOf("screen('invoice'"), script.indexOf("// 2 At work"));
    // The one place that sets the button: off while writing and the suppliers are not in.
    expect(inv).toMatch(/const gate=\(\)=>\{send\.disabled=writing&&!ready;/);
    expect(inv).toMatch(/const choose=\(w\)=>\{[^}]*gate\(\)\}/);
    expect(inv).toContain("classList.toggle('loading',!ready)");
    // A failed read: calm words with a retry, never the red box.
    expect(inv).toContain("C.invoice.suppliersFailed");
    expect(inv).toContain("C.invoice.retry");
    expect(inv).not.toMatch(/msg\.replaceChildren\(el\('p','note'/);
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

  it("has no words outside the copy: the markup's own text is the brand and the start's trust line (the illustration aside)", () => {
    // 12 Nov: the site's header (cloud/src/siteHeader.ts) is the site's navigation, its words the site's: its brand word
    // stays counted here, its menu is held by test/site-header-shared.test.ts.
    const own = html.replace(siteHeader("try"), `<header>${COPY.CHROME.brand}</header>`);
    expect(own).not.toBe(html);
    expect(textOutsideTags(withoutBlocks(own, ["script", "style", "title", "svg"])).trim().split(/\s+/)).toEqual(`${COPY.CHROME.brand} ${COPY.START.trust}`.split(" "));
    expect(readFileSync(new URL("../cloud/src/tryPage.ts", import.meta.url), "utf8")).not.toMatch(/ui\/i18n/);
  });
});

describe("the frame and the start", () => {
  it("brands the page with the console's feather lockup, not a letter mark", () => {
    // 12 Nov (owner): the site's own header, brand and menu (cloud/src/siteHeader.ts), its feather drawn on the server.
    expect(html).toContain(siteHeader("try"));
    expect(html).toContain(`<span class="mk">${icon("feather", 17)}</span><span class="nm">${COPY.CHROME.brand}</span>`);
    expect(html).not.toMatch(/class="mk">P</);
    expect(script).not.toContain("$('.brand .mk').append(");
    const ic = JSON.parse(/const IC=(\{.*?\});\n/.exec(script)![1]!) as Record<string, unknown>;
    expect(ic.feather).toEqual(ICONS.feather);
  });

  it("shows the illustration in the page as it is built, with its CSS and its reduced-motion rule in the page's one nonce style", () => {
    expect(html).toContain(`<div class="hero">${sceneSvg()}</div>`);
    expect(html).toContain(SCENE_CSS);
    expect(html).toContain("@media (prefers-reduced-motion: reduce) { .scene, .scene * { animation: none !important; } }");
    expect(html.match(/<style/g)).toHaveLength(1);
  });

  it("keeps the start's words: the product line, the button, test money deleted after 24 h, and the trust line", () => {
    expect(COPY.START.fine).toBe("Test money · deleted after 24 h");
    expect(COPY.START.text).toContain("Purser's real engine");
    expect(COPY.START.trust).toBe("Works with Airwallex · Metal · Visa Intelligent Commerce · Claude (sandbox and testnet runs)");
    expect(COPY.VISIBLE.start.every((state) => state.includes(COPY.START.fine) && state.includes(COPY.START.trust))).toBe(true);
  });
});

describe("screen 6's proof link", () => {
  it("goes to the site's /proof (src/redesign/proof.ts) on the homepage's origin", () => {
    const home = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { homepage: string }).homepage;
    expect(PROOF_URL).toBe(`${home}/proof`);
    expect(script).toContain(`const PROOF=${JSON.stringify(PROOF_URL)};`);
  });
});

describe("the copy", () => {
  it("says who reads on screen 2 while the request is in flight, and how to write an amount on screen 1", () => {
    expect(COPY.WORK.reading).toBe("Claude is reading…");
    expect(COPY.WORK.readingCode).toBe("Purser's code is reading…");
    expect(COPY.INVOICE.amountBad).toBe("Write an amount such as 1,850.00 or 10k.");
    expect(COPY.INVOICE.amountCap).toBe("Demo invoices go up to EUR 5,000.");
    expect(COPY.INVOICE.suppliersFailed).toBe("Suppliers not loaded.");
    expect(COPY.INVOICE.retry).toBe("Retry");
  });


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
    const groups: Record<string, Record<string, string>> = { start: COPY.START, invoice: COPY.INVOICE, work: COPY.WORK, approve: COPY.APPROVE, pay: COPY.PAY, books: COPY.BOOKS, company: COPY.COMPANY, gone: COPY.GONE, ended: COPY.ENDED };
    expect(Object.keys(COPY.VISIBLE).sort()).toEqual(Object.keys(groups).sort());
    for (const [screen, group] of Object.entries(groups)) {
      const seen = new Set(COPY.VISIBLE[screen as keyof typeof COPY.VISIBLE].flat());
      // A {method} line is counted with a method filled in; PAY's sandbox line shows only when the rail is on (one more line,
      // 4 words), the executor's note sits in its fold, and the verdict is counted with its one-cent sentence. Screen 6's
    // "recorded {date}" labels the runs inside the "Recorded real runs" fold; "What you just did" names the three icons for screen readers only.
      for (const [k, v] of Object.entries(group)) if (!["sandbox", "executorNote", "vAmount", "vPayee", "vAccount", "vOther", "recorded", "did"].includes(k)) expect(seen.has(v) || [...seen].some((x) => v.includes("{method}") && x === v.replace("{method}", COPY.METHOD.other)), `${screen}.${k}`).toBe(true);
    }
    expect(Object.keys(COPY.OVER_BUDGET)).toEqual(["pay 7", "invoice 4", "invoice 5"]);
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

  it("holds screens 5 and 6 to the words of lanes/page.md B3, and never says that Purser retries by itself", () => {
    expect(COPY.BOOKS.heading).toBe("Paid, booked, filed.");
    expect(COPY.BOOKS.paid).toBe("Paid on the simulated bank · test money");
    expect(COPY.BOOKS.booked).toBe("Booked in Purser's ledger");
    expect(COPY.BOOKS.filed).toBe("Filed in the archive");
    expect(COPY.BOOKS.retry).toBe("Try the payment again");
    expect(COPY.BOOKS.next).toBe("See your company");
    expect(COPY.COMPANY.download).toBe("Download your company (SyncBatch)");
    expect(COPY.COMPANY.line).toBe("Purser Cloud's own sync format: your test company's invoices with their documents, payments, ledger and audit log.");
    expect(COPY.COMPANY.again).toBe("Start again");
    expect(COPY.COMPANY.runs).toBe("Recorded real runs");
    expect(COPY.COMPANY.recorded).toBe("recorded {date}");
    for (const group of Object.values(COPY)) expect(JSON.stringify(group)).not.toMatch(/retr(y|ies) (by itself|automatically|later)|will (re)?try|tries again by itself/i);
    // Money on screen 5 is on the simulated bank, with test money; never real money.
    for (const v of [...Object.values(COPY.BOOKS), ...Object.values(COPY.COMPANY)]) expect(v).not.toMatch(/real money/i);
  });
});

describe("the recorded runs on screen 6", () => {
  it("links only to runs that exist on the site's /runs, each labelled with the date that file gives it", () => {
    const rows = liveRuns();
    expect(COPY.RECORDED.map((r) => r.key)).toEqual(["awx-1", "connected-1", "t0-1"]);
    for (const r of COPY.RECORDED) {
      const row = rows.find((x) => x.key === r.key);
      expect(row, r.key).toBeDefined();
      expect(r.date, r.key).toBe(row!.date);
    }
    // Every /runs# link the page can draw names one of these keys, on the site's own origin (package.json homepage).
    const homepage = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { homepage: string }).homepage;
    expect(RUNS_URL).toBe(`${homepage}/runs`);
    const linked = [...html.matchAll(/runs#([\w-]+)/g)].map((m) => m[1]);
    for (const k of linked) expect(rows.some((x) => x.key === k), `linked key ${k}`).toBe(true);
    expect(script).toContain("RUNS+'#'+r.key");
    expect(script).toContain(JSON.stringify(COPY.RECORDED).slice(1, 40));
  });
});

describe("screens 5 and 6 in the page's script", () => {
  it("downloads a file of the archive with the session, as a blob URL, and revokes it after", () => {
    expect(script).toContain("'/v1/engine/vault/file?path='+encodeURIComponent(");
    expect(script).toContain("URL.createObjectURL(");
    expect(script).toContain("URL.revokeObjectURL(");
    expect(script).toContain("'/v1/engine/export'");
  });

  it("tries the payment again only on the visitor's button, through the engine's retry route built on the proposal's id", () => {
    expect([...script.matchAll(/'\/retry'/g)]).toHaveLength(2);
    expect(script).toMatch(/api\('POST','\/v1\/engine\/proposals\/'\+encodeURIComponent\(pid\)\+'\/retry'\)/);
  });

  it("reads the books only from the read model, once the engine fed it", () => {
    expect(script).toContain("s.fed===false");
    for (const p of ["/v1/payments", "/v1/transactions", "/v1/ledger/entries", "/v1/engine/vault"]) expect(script).toContain(`'${p}'`);
  });
});

// The page's pure helpers for screen 5 (BOOKS_JS): this invoice's payment, journal lines and files, run here as the page
// runs them.
interface Pay { id: string; invoice_no: string; status: string; amount: string; currency: string; updated_at: string; fee_actual?: string | null }
interface BooksKit {
  seg(s: string): string;
  paymentOf(i: unknown, ps: unknown[], txs: unknown[]): Pay | null;
  isPaid(p: unknown): boolean;
  feeOf(p: unknown, tx: unknown): { currency: string; amount: string } | null;
  txOf(p: unknown, txs: unknown[]): unknown;
  entriesOf(i: unknown, p: unknown, txs: unknown[], es: unknown[]): { entry_id: number }[];
  balance(es: unknown[]): { even: boolean; lines: number };
  headOf(es: unknown[]): { entry_id: number; entry_hash: string } | null;
  filesOf(i: unknown, files: unknown[], invoices: unknown[]): { original: { path: string } | null; receipts: { path: string }[] };
  money(currency: string, amount: string): string;
  fromCents(n: number): string;
}
const books = new Function(`${BOOKS_JS}\nreturn booksKit;`)() as BooksKit;
const inv = (o: Record<string, unknown> = {}) => ({ id: "AP-0001", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", currency: "EUR", total: "1850.00", status: "paid", doc_sha256: "a".repeat(64), ...o });
const pay = (o: Partial<Pay> = {}): Pay => ({ id: "req-1", invoice_no: "BTX-1 · Bergtex Textil GmbH", status: "PAID", amount: "1850.00", currency: "EUR", updated_at: "2026-11-12T10:00:00Z", fee_actual: "EUR 0.50", ...o });
const tx = (paymentId: string, apId: string | null, entryIds: number[] = []) => ({ id: `transfer:${paymentId}`, invoice: { ap_id: apId }, booking: { entry_ids: entryIds }, fee: { amount: "0.50", currency: "EUR" } });
const line = (account: string, d: number, c: number) => ({ account, debit_cents: d, credit_cents: c, currency: "EUR" });
const entry = (entry_id: number, source_key: string | null, lines: unknown[], reverses: number | null = null) => ({ entry_id, source_key, reverses, lines, entry_hash: `h${entry_id}`, posting_date: "2026-11-12", description: `entry ${entry_id}` });

describe("this invoice's payment, lines and files, in the page's own script", () => {
  it("is in the page as it is tested here", () => {
    expect(script).toContain(BOOKS_JS.trim());
  });

  it("finds the payment by the transactions register's invoice id first, else a single PAID payment of the same amount", () => {
    expect(books.paymentOf(inv(), [pay()], [tx("req-1", "AP-0001")])?.id).toBe("req-1");
    // Without the register: the one PAID payment of this invoice's amount.
    expect(books.paymentOf(inv(), [pay()], [])?.id).toBe("req-1");
    expect(books.paymentOf(inv(), [pay({ amount: "1850.01" })], [])).toBeNull();
    expect(books.paymentOf(inv(), [pay({ currency: "USD" })], [])).toBeNull();
    expect(books.feeOf(pay(), null)).toEqual({ currency: "EUR", amount: "0.50" });
    expect(books.feeOf(pay({ fee_actual: null }), tx("req-1", "AP-0001"))).toEqual({ currency: "EUR", amount: "0.50" });
    expect(books.feeOf(pay({ fee_actual: null }), null)).toBeNull();
  });

  it("never shows a FAILED payment as paid", () => {
    const failed = pay({ status: "FAILED", fee_actual: null });
    // Linked by the register: it is this invoice's payment, and it is not paid.
    const p = books.paymentOf(inv(), [failed], [tx("req-1", "AP-0001")]);
    expect(p?.status).toBe("FAILED");
    expect(books.isPaid(p)).toBe(false);
    // Not linked: a FAILED payment of the same amount is no proof of anything.
    expect(books.paymentOf(inv(), [failed], [])).toBeNull();
    // A FAILED attempt and a PAID one for the invoice: the PAID one, though the FAILED one is newer.
    const both = books.paymentOf(inv(), [pay({ id: "req-2", status: "FAILED", updated_at: "2026-11-12T11:00:00Z" }), pay()], [tx("req-1", "AP-0001"), tx("req-2", "AP-0001")]);
    expect(both?.id).toBe("req-1");
    expect(books.isPaid(both)).toBe(true);
    expect(books.isPaid(pay({ status: "paid" }))).toBe(true);
  });

  it("tells two invoices that share a number and a supplier apart: their payments, their lines and their receipts", () => {
    const a = inv(), b = inv({ id: "AP-0002", doc_sha256: "b".repeat(64) });
    const ps = [pay(), pay({ id: "req-2", updated_at: "2026-11-12T11:00:00Z" })];
    const txs = [tx("req-1", "AP-0001", [3]), tx("req-2", "AP-0002", [4])];
    expect(books.paymentOf(a, ps, txs)?.id).toBe("req-1");
    expect(books.paymentOf(b, ps, txs)?.id).toBe("req-2");
    // Without the register two PAID payments of one amount are not told apart: nothing is shown as this one's.
    expect(books.paymentOf(a, ps, [])).toBeNull();
    const es = [entry(1, "ap-accrual|AP-0001", [line("4000", 185000, 0), line("1600", 0, 185000)]), entry(2, "ap-accrual|AP-0002@v2", [line("4000", 185000, 0), line("1600", 0, 185000)]),
      entry(3, "pay:1", [line("1600", 185000, 0), line("1200", 0, 185000)]), entry(4, "pay:2", [line("1600", 185000, 0), line("1200", 0, 185000)])];
    expect(books.entriesOf(a, books.paymentOf(a, ps, txs), txs, es).map((e) => e.entry_id)).toEqual([1, 3]);
    expect(books.entriesOf(b, books.paymentOf(b, ps, txs), txs, es).map((e) => e.entry_id)).toEqual([2, 4]);
    // The archive names the second receipt with the invoice's own id beside it.
    const dir = "Test company/2026/2026-Q4/Betalingen/";
    const files = [{ path: `${dir}2026-11-12 Bergtex Textil GmbH BTX-1.pdf`, kind: "receipt", sha256: "r1" }, { path: `${dir}2026-11-12 Bergtex Textil GmbH BTX-1 (AP-0002).pdf`, kind: "receipt", sha256: "r2" },
      { path: "Test company/2026/2026-Q4/Inkoop/a.pdf", kind: "invoice", sha256: "a".repeat(64) }, { path: "Test company/2026/2026-Q4/Inkoop/b.pdf", kind: "invoice", sha256: "b".repeat(64) }];
    const both = [a, b];
    expect(books.filesOf(a, files, both)).toEqual({ original: files[2], receipts: [files[0]] });
    expect(books.filesOf(b, files, both)).toEqual({ original: files[3], receipts: [files[1]] });
    // Before the second receipt is filed, the first one's plain name is not taken for the second invoice's.
    expect(books.filesOf(b, [files[0]!, files[2]!, files[3]!], both).receipts).toEqual([]);
  });

  it("finds a B.V. supplier's receipt by the archive's cleaning of the whole name, a correction beside it too", () => {
    const i = inv({ vendor: "Hollandia Logistiek B.V.", invoice_no: "HL/2026:118" });
    expect(books.seg("2026-11-12 Hollandia Logistiek B.V. HL/2026:118.pdf")).toBe("2026-11-12 Hollandia Logistiek B.V. HL 2026 118.pdf");
    const dir = "Test company/2026/2026-Q4/Betalingen/";
    const files = [
      { path: `${dir}2026-11-12 Hollandia Logistiek B.V. HL 2026 118.pdf`, kind: "receipt", sha256: "r1" },
      { path: `${dir}2026-11-13 Hollandia Logistiek B.V. HL 2026 118 (correctie).pdf`, kind: "receipt", sha256: "r2" },
      // Cleaned piece by piece (the supplier's trailing dot dropped): not the archive's name, so not this receipt.
      { path: `${dir}2026-11-12 Hollandia Logistiek B.V HL 2026 118.pdf`, kind: "receipt", sha256: "r3" },
      { path: `${dir}2026-11-12 Hollandia Logistiek B.V. HL 2026 118 (AP-0009).pdf`, kind: "receipt", sha256: "r4" },
      { path: `${dir}not-a-date Hollandia Logistiek B.V. HL 2026 118.pdf`, kind: "receipt", sha256: "r5" },
      { path: "Test company/2026/2026-Q4/Inkoop/x.pdf", kind: "invoice", sha256: "f".repeat(64) },
    ];
    expect(books.filesOf(i, files, [i]).receipts.map((f) => f.path)).toEqual([files[0]!.path, files[1]!.path]);
    expect(books.filesOf(i, files, [i]).original).toBeNull();
  });

  it("takes this invoice's lines: its accrual in any version, the payment's entries and what reverses them; debits equal credits from the lines", () => {
    const i = inv();
    const p = pay();
    const txs = [tx("req-1", "AP-0001", [5])];
    const es = [entry(1, "ap-accrual|AP-0001", [line("4000", 155462, 0), line("1520", 29538, 0), line("1600", 0, 185000)]),
      entry(2, "ap-accrual|AP-00010", [line("4000", 100, 0), line("1600", 0, 100)]), entry(3, "ap-accrual|AP-0001@v2", [line("4000", 100, 0), line("1600", 0, 100)]),
      entry(4, null, [line("4000", 0, 100), line("1600", 100, 0)], 3), entry(5, "pay", [line("1600", 185000, 0), line("1200", 0, 185000)]), entry(6, "other", [line("4000", 1, 0), line("1600", 0, 1)])];
    const mine = books.entriesOf(i, p, txs, es);
    expect(mine.map((e) => e.entry_id)).toEqual([1, 3, 4, 5]);
    expect(books.balance(mine)).toEqual({ even: true, lines: 9 });
    expect(books.balance([entry(9, null, [line("4000", 100, 0), line("1600", 0, 99)])])).toEqual({ even: false, lines: 2 });
    expect(books.balance([])).toEqual({ even: false, lines: 0 });
    // The ledger chain's head: the newest entry of the whole ledger, whatever order the pages came in.
    expect(books.headOf([es[5], es[0], es[4]])).toEqual(es[5]);
    expect(books.headOf([])).toBeNull();
    expect(books.money("EUR", "1850.00")).toBe("EUR 1,850.00");
    expect(books.money("EUR", "1234567.5")).toBe("EUR 1,234,567.50");
    expect(books.fromCents(185000)).toBe("1850.00");
    expect(books.fromCents(5)).toBe("0.05");
  });
});

// The page's pure helpers for signing and paying (SIGN_JS), run here as the page runs them.
interface Kit {
  b64u(b: ArrayBuffer | Uint8Array): string;
  fromB64u(s: string): Uint8Array;
  registrationOf(c: unknown): unknown;
  signedOf(c: unknown): unknown;
  hashDiff(a: string, b: string): { a: [string, boolean][]; b: [string, boolean][] };
  normAmount(raw: string, like?: string): string | null;
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
    expect(kit.normAmount("1.850,00", "1850.00")).toBe("1850.00");
    expect(kit.normAmount("1850.001", "1850.00")).toBeNull();
    expect(kit.normAmount("1850.00", "1850.00")).toBe("1850.00");
    expect(kit.normAmount("-5", "1850.00")).toBeNull();
    expect(kit.normAmount("", "1850.00")).toBeNull();
  });

  it("reads the lead's amounts: one separator before exactly three digits is thousands, before one or two it is decimals", () => {
    for (const [raw, want] of [["1850", "1850.00"], ["1850,5", "1850.50"], ["1850,00", "1850.00"], ["1.850,00", "1850.00"], ["1,850.00", "1850.00"],
      ["10k", "10000.00"], ["10.000", "10000.00"], ["10,000", "10000.00"], ["€ 10.000,00", "10000.00"]] as const) {
      expect(kit.normAmount(raw), raw).toBe(want);
      expect(normaliseAmount(raw), raw).toBe(want);
    }
  });

  it("is one implementation: the page carries normaliseAmount's own source (cloud/src/try/amount.ts), with no helper of a bundler", () => {
    expect(SIGN_JS).toContain(AMOUNT_JS);
    expect(script).toContain(AMOUNT_JS);
    expect(AMOUNT_JS).not.toMatch(/__name|__defProp|cov_|\?\?|\?\./);
    for (const raw of ["10k", "1,5k", "€ 10.000,00", "EUR 10,000.00", "1850.5", "abc", "-5", "0", "1850.001"]) {
      expect(kit.normAmount(raw), raw).toBe(normaliseAmount(raw));
      expect(kit.normAmount(raw, "1850.00"), raw).toBe(normaliseAmount(raw, "1850.00"));
    }
  });

  it("reads the amounts people write (screen 1's write your own): two decimals with a dot, or null", () => {
    const cases: [string, string][] = [
      ["10k", "10000.00"], ["10K", "10000.00"], ["1.5k", "1500.00"], ["1,5k", "1500.00"], ["10.000", "10000.00"], ["10,000", "10000.00"],
      ["10000", "10000.00"], ["€ 10.000,00", "10000.00"], ["€10000", "10000.00"], ["EUR 10,000.00", "10000.00"], ["eur 10.000", "10000.00"],
      ["1.850,01", "1850.01"], ["1850,01", "1850.01"], ["1850.5", "1850.50"], ["1,850.00", "1850.00"], ["1.234.567,89", "1234567.89"],
      ["0,5", "0.50"], ["120.50", "120.50"], [" 1 850,01 ", "1850.01"], ["10000 €", "10000.00"], ["1850 EUR", "1850.00"],
    ];
    for (const [raw, want] of cases) expect(kit.normAmount(raw), raw).toBe(want);
    for (const raw of ["", " ", "-5", "-10k", "0", "0.00", "0k", "abc", "12a", "10kk", "k", "1850.001", "1.85.0", "1,234.567,89", "1.5,2", "10.", ".5", "€", "1e3", "10m", "$10"])
      expect(kit.normAmount(raw), raw).toBeNull();
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
