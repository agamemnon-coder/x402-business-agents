// The product in Dutch (default) and English: one catalogue with every key in both languages, Dutch amounts and dates,
// the register's English data in Dutch, the language a page reads (the person's own, else the company's), and no English
// left in the words of a Dutch page.
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { openDb, type DB } from "../src/db/open.js";
import { CHECKS } from "../src/ap/detail.js";
import type { Asker } from "../src/ap/read.js";
import { DATA_NL, dataText, DEFAULT_LANG, fmtAmount, fmtDay, fmtMoney, I18N_JS, MESSAGES, t } from "../src/ui/i18n.js";
import { detailPage, overviewPage } from "../src/servers/payablesPage.js";
import { payablesApp } from "../src/servers/payables.js";
import { transactionsPage } from "../src/servers/transactionsPage.js";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";
import { scriptBlocks, textOutsideTags, withoutBlocks } from "./support/scriptBlocks.js";

const keys = (o: object) => Object.keys(o).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the catalogue", () => {
  it("has every key in Dutch and English, with the same placeholders, and nothing empty", () => {
    expect(keys(MESSAGES.nl)).toEqual(keys(MESSAGES.en));
    for (const k of Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[]) {
      expect({ k, nl: placeholders(MESSAGES.nl[k]) }).toEqual({ k, nl: placeholders(MESSAGES.en[k]) });
      expect(MESSAGES.nl[k].trim().length, k).toBeGreaterThan(0);
    }
  });

  it("is Dutch by default, and words every check and every status the code has", () => {
    expect(DEFAULT_LANG).toBe("nl");
    for (const c of CHECKS) expect(MESSAGES.nl[`check.${c.key}` as keyof typeof MESSAGES.nl], c.key).toBeTruthy();
    for (const c of CHECKS.flatMap((x) => x.codes)) expect(MESSAGES.nl[`finding.${c}` as keyof typeof MESSAGES.nl], c).toBeTruthy();
    for (const s of ["blocked", "needs_review", "needs_vendor", "waiting_cfo", "ready", "paid", "rejected"]) expect(MESSAGES.nl[`status.${s}` as keyof typeof MESSAGES.nl]).toBeTruthy();
    expect(t("nl", "status.ready")).toBe("Klaar om te betalen");
    expect(t("nl", "status.waiting_cfo")).toBe("Wacht op Face ID van de CFO");
    expect(t("nl", "dt.vat")).toBe("Btw");
    expect(t("nl", "app.payables")).toBe("Crediteuren");
    expect(t("nl", "dt.filed_as", { id: "P-0001" })).toBe("Klaargezet als P-0001: hij wacht op de Face ID van de CFO op de telefoon.");
  });
});

describe("amounts and dates", () => {
  it("writes Dutch amounts with a point for thousands and a comma for cents, and € for euros", () => {
    expect(fmtAmount("nl", "1850.00")).toBe("1.850,00");
    expect(fmtAmount("nl", "1234567.89")).toBe("1.234.567,89");
    expect(fmtAmount("en", "1850.00")).toBe("1,850.00");
    expect(fmtMoney("nl", "EUR", "1850.00")).toBe("€ 1.850,00");
    expect(fmtMoney("nl", "USD", "7480.00")).toBe("USD 7.480,00");
    expect(fmtDay("nl", "2026-11-16")).toBe("16 nov 2026");
    expect(fmtDay("en", "2026-11-16")).toBe("16 Nov 2026");
  });

  it("the pages' own formatting (the client half) writes the same", () => {
    for (const lang of ["nl", "en"] as const) {
      const ctx: Record<string, unknown> = {};
      new Script(`const L=${JSON.stringify({ lang, m: MESSAGES[lang], data: lang === "nl" ? DATA_NL : {} })};${I18N_JS};out={amount:amount('1850.00'),cents:cents(185000),money:ma('EUR','1850.00'),day:day('2026-11-16'),status:statusWords('ready'),desc:data('description','Invoice BTX-3'),f:finding({code:'iban_invalid',detail:'English detail'}),n:tn('n_invoices',2)}`).runInNewContext(ctx);
      const out = ctx.out as Record<string, string>;
      expect(out.amount).toBe(fmtAmount(lang, "1850.00"));
      expect(out.cents).toBe(fmtAmount(lang, "1850.00"));
      expect(out.money).toBe(fmtMoney(lang, "EUR", "1850.00"));
      expect(out.day).toBe(fmtDay(lang, "2026-11-16"));
      expect(out.status).toBe(t(lang, "status.ready"));
      expect(out.desc).toBe(lang === "nl" ? "Factuur BTX-3" : "Invoice BTX-3");
      expect(out.f).toBe(lang === "nl" ? MESSAGES.nl["finding.iban_invalid"] : "English detail");
      expect(out.n).toBe(lang === "nl" ? "2 facturen" : "2 invoices");
    }
  });
});

describe("the register's data in Dutch", () => {
  it("words every description, status, authority and counterparty the register writes; the rail's own words stay", () => {
    const cases: [keyof typeof DATA_NL, string, string][] = [
      ["description", "Invoice BTX-2026-21", "Factuur BTX-2026-21"],
      ["description", "Convert EUR to USD (sold)", "Omwisseling EUR naar USD (verkocht)"],
      ["description", "Convert EUR to USD (bought)", "Omwisseling EUR naar USD (gekocht)"],
      ["description", "Card: Casino", "Kaart: Casino"],
      ["description", "Airi purchase by the support agent", "Airi-aankoop door de support-agent"],
      ["description", "Payment of invoice NW-1", "Betaling van factuur NW-1"],
      ["description", "Payment with no matching invoice", "Betaling zonder passende factuur"],
      ["description", "Stock check sold to a retailer (2)", "Voorraadcheck verkocht aan een winkelier (2)"],
      ["description", "Stock check bought from the warehouse API (1)", "Voorraadcheck gekocht bij de magazijn-API (1)"],
      ["description", "Refund of query 1", "Terugbetaling van verzoek 1"],
      ["description", "Sweep earnings from Metal to Airwallex", "Opbrengst van Metal naar Airwallex overgeboekt"],
      ["description", "Sweep credited at Airwallex (1 USDZ = 1 USD)", "Overboeking bijgeschreven bij Airwallex (1 USDZ = 1 USD)"],
      ["description", "Clearing earnings withdrawn (out of clearing)", "Clearingopbrengst opgenomen (uit clearing)"],
      ["description", "Clearing earnings withdrawn (into the wallet)", "Clearingopbrengst opgenomen (naar de wallet)"],
      ["status", "paid", "betaald"],
      ["status", "declined by Airwallex: MCC_NOT_ALLOWED", "geweigerd door Airwallex: MCC_NOT_ALLOWED"],
      ["status", "received, matched", "ontvangen, matched"],
      ["status", "aborted, not charged", "afgebroken, niets afgeschreven"],
      ["status", "converting, not settled yet", "wordt omgewisseld, nog niet afgewikkeld"],
      ["authority", "the CFO's approval of the exact terms", "de goedkeuring van de CFO op precies deze voorwaarden"],
      ["authority", "the support agent's card limits, set by the CFO's policy", "de kaartlimieten van de support-agent, vastgelegd in het beleid van de CFO"],
      ["counterparty", "own account", "eigen rekening"],
      ["counterparty", "Bergtex Textil GmbH", "Bergtex Textil GmbH"],
    ];
    for (const [field, en, nl] of cases) expect(dataText("nl", field, en)).toBe(nl);
    expect(dataText("en", "description", "Invoice X")).toBe("Invoice X");
  });

  it("covers every description template in the register's code", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/money/register.ts", "utf8");
    const templates = [...src.matchAll(/description: (?:from === "1220" \? )?["`]([^"`]+)["`]/g)].map((m) => m[1]!);
    expect(templates.length).toBeGreaterThan(8);
    for (const tpl of templates) {
      // A template cut off inside a ${…} (its own quotes end the match) is covered by the cases above.
      if (/\$\{[^}]*$/.test(tpl)) continue;
      const sample = tpl.replace(/\$\{[^}]+\}/g, "X");
      expect({ tpl, nl: dataText("nl", "description", sample) !== sample }).toEqual({ tpl, nl: true });
    }
  });
});

// The English words a Dutch page must not show (whole words, case-insensitive), from the pages' own vocabulary.
const ENGLISH = /\b(Invoices?|Supplier|Due|Amount|Paid|Blocked|Rejected|Ready to pay|Waits for|Needs a person|Checks?|Timeline|Transactions|Received|Open|Overdue|Nothing|Every|Loading|Reject|Request|Download|Settings|Overview|Books|Sign in|Passed|Total|Subtotal|Reference|Booked|Movement|Approval|Proof|Fees?|Without|Cancel|Close|What|When|Why)\b/i;

/** The words a page shows: its HTML text and every catalogue string its script carries, without code and values. */
function shownText(html: string): string {
  return textOutsideTags(withoutBlocks(html, ["script", "style", "svg"], " "));
}

describe("a Dutch page", () => {
  it("shows no English words in its HTML, and its script carries the Dutch catalogue", () => {
    const pages = { overview: overviewPage("tok", "n", "acme@in.purser.test", "nl"), detail: detailPage("tok", "n", "AP-0001", "nl"), transactions: transactionsPage("tok", "n", "nl") };
    for (const [name, html] of Object.entries(pages)) {
      expect(html, name).toContain('<html lang="nl">');
      const text = shownText(html).replace(/\b(Purser|Face ID|CSV|JSON|English|Airwallex|Metal|AP-0001|acme@in\.purser\.test)\b/g, " ");
      expect({ name, english: ENGLISH.exec(text)?.[0] ?? null }).toEqual({ name, english: null });
      expect(html).toContain('"lang":"nl"');
    }
    // Every Dutch string a page's script may show is free of those English words too (names like Face ID aside).
    for (const [k, v] of Object.entries(MESSAGES.nl)) {
      const text = v.replace(/\b(Purser|Face ID|CSV|JSON|PDF|API|Airwallex|Metal|Airi|IBAN|BIC|SWIFT|CFO|ERP|SHA-256|USDZ|USD|EUR|UTC|English|runner|sync|passkey|passkeys|Global Account|Purser Cloud|Touch ID|Safari|Chrome|Edge|Firefox|git|npm run payables -- supplier-verify|P-256|Check)\b/g, " ");
      expect({ k, english: /\b(Invoice|Supplier|Amount|Paid|Blocked|Rejected|Waits|Received|Overdue|Nothing|Every|Loading|Reject|Settings|Overview|Books|Passed|Total|Booked|Approval|Proof|Without|Cancel|Close|When|the|and|with|for)\b/.exec(text)?.[0] ?? null }).toEqual({ k, english: null });
    }
  });

  it("an English page still reads in English, and every value stays text (the catalogue is JSON, < escaped)", () => {
    const html = overviewPage("tok", "n", null, "en");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<h1>Payables</h1>");
    const blocks = scriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).not.toMatch(/<\/script>[\s\S]*<\/script>/);
  });
});

describe("the language a local page reads", () => {
  let dir: string;
  let db: DB;
  let base: string;
  let close: () => void;
  const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
  beforeEach(async () => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "i18n-"));
    db = openDb(":memory:");
    const server = payablesApp(db, { inbox: { dir, reader: parserOnly }, rail: null }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    close = () => server.close();
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { close(); rmSync(dir, { recursive: true, force: true }); });

  it("is Dutch by default, the company's setting otherwise, and the person's own choice (kept in a cookie) above both", async () => {
    expect(await (await fetch(base + "/")).text()).toContain('<html lang="nl">');
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('ui.language', 'en', '2026-11-09T00:00:00Z')").run();
    expect(await (await fetch(base + "/")).text()).toContain('<html lang="en">');
    const asked = await fetch(base + "/transactions?lang=nl");
    expect(await asked.text()).toContain('<html lang="nl">');
    const cookie = asked.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^purser_lang=nl; Path=\/; .*SameSite=Strict; HttpOnly/);
    expect(await (await fetch(base + "/", { headers: { cookie: "purser_lang=nl" } })).text()).toContain('<html lang="nl">');
    // Anything else in ?lang or the cookie is ignored, never echoed.
    const odd = await (await fetch(base + "/?lang=%3Cscript%3E", { headers: { cookie: "purser_lang=<script>" } })).text();
    expect(odd).toContain('<html lang="en">');
    expect(odd).not.toContain("<script>x");
  });
});

describe("the console's language", () => {
  let c: TestCloud;
  let ten: { id: string; key: string; owner: string };
  beforeEach(async () => { c = testCloud(); ten = await c.tenant("acme"); });
  afterEach(() => c.close());
  const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

  it("is the company's (Dutch by default, owners change it), and a signed-in person may choose their own", async () => {
    expect((await c.req("GET", "/v1/me", { key: ten.key })).json).toMatchObject({ language: "nl", tenant: { language: "nl" } });
    expect((await c.req("POST", "/v1/company", { key: ten.key, body: { language: "en" } })).json).toMatchObject({ language: "en" });
    expect((await c.req("GET", "/v1/me", { key: ten.key })).json).toMatchObject({ language: "en" });
    expect((await c.req("POST", "/v1/company", { key: ten.key, body: { language: "de" } })).status).toBe(400);
    expect((await c.req("POST", "/v1/company", { key: ten.key, body: {} })).status).toBe(400);
    const reader = (await c.req("POST", "/v1/keys", { key: ten.key, body: { name: "r", scopes: ["read"] } })).json.api_key as string;
    expect((await c.req("POST", "/v1/company", { key: reader, body: { language: "nl" } })).status).toBe(403);
    // A key is not a person: it has no language of its own.
    expect((await c.req("POST", "/v1/me/language", { key: ten.key, body: { language: "nl" } })).status).toBe(400);

    // A CFO signs in and chooses Dutch for themself; the company stays English.
    const u = await c.req("POST", "/v1/users", { key: ten.key, body: { display_name: "The CFO", role: "cfo" } });
    const pk = softPasskey();
    const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
    const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
    const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
    const e = await c.req("POST", `/v1/users/${u.json.id as string}/enrolment`, { key: ten.key });
    const ea = pk.assert("0x00", { challenge: e.json.token as string, origin: ORIGIN, rpId: RP });
    await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id, x, y,
      assertion: { authenticatorData: b64u(ea.authenticatorData), clientDataJSON: b64u(ea.clientDataJSON), signature: b64u(ea.signature) } } });
    const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
    const a = pk.assert("0x00", { challenge: ch.challenge, origin: ORIGIN, rpId: RP });
    const session = (await c.req("POST", "/v1/auth/login", { body: { tenant: "acme", challenge_id: ch.challenge_id, credential_id, assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } })).json.session as string;
    expect((await c.req("POST", "/v1/me/language", { key: session, body: { language: "nl" }, headers: { origin: ORIGIN } })).json).toEqual({ language: "nl" });
    expect((await c.req("GET", "/v1/me", { key: session })).json).toMatchObject({ language: "nl", tenant: { language: "en" }, user: { language: "nl" } });
    expect((await c.req("POST", "/v1/me/language", { key: session, body: { language: null }, headers: { origin: ORIGIN } })).json).toEqual({ language: null });
    expect((await c.req("GET", "/v1/me", { key: session })).json).toMatchObject({ language: "en" });
  });

  // 12 Nov (console polish): the console now paints in English and turns Dutch only on a person's explicit choice
  // (test/cloud-console.test.ts tests that rule); this test pinned the Dutch first paint and now pins the English one.
  it("serves the console with both catalogues, English first, and no Dutch words in its HTML", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
    expect(html).toContain('<html lang="en">');
    const text = shownText(html).replace(/\b(Purser Cloud|Purser|Face ID|Airwallex)\b/g, " ");
    expect(/\b(Overzicht|Facturen|Boekhouding|Instellingen|Testgeld|alleen|betalingen)\b/.exec(text)?.[0] ?? null).toBeNull();
    expect(html).toContain('"nl":{');
    expect(html).toContain('"en":{');
  });
});
