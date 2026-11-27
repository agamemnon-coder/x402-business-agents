// Purser Cloud's enterprise pass (13 Nov): the Agents and Tokenisation tabs and Invoices & books. It holds: every agent
// figure comes from the company's own rows (job, model as its runs recorded it, card limits as issued, rails, status,
// decisions with who decided); tokenisation shows only what its records hold, each with the record's own label and
// links; each invoice's bookings are found from the ledger; the routes read only, for the caller's own company; and the
// console's nav has the new tabs, the old Invoices route lands on Books, and the page says what Purser Cloud is.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { feedLine } from "../cloud/src/dashboard.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import TOKENIZE from "../docs/runs/2026-11-12-tokenize.json" with { type: "json" };

let c: TestCloud, guest: string, A: TestTenant;
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const get = async (p: string, key = guest) => (await c.req("GET", p, { key })) as { status: number; json: J };

beforeAll(async () => {
  c = testCloud({});
  guest = (await c.req("POST", "/v1/auth/guest", { key: null })).json.session as string;
  A = await c.tenant("northwind");
});
afterAll(() => c.close());

describe("GET /v1/agents", () => {
  it("lists the demo company's agents from its own records, with model, limits, rails, status and decisions", async () => {
    const r = await get("/v1/agents");
    expect(r.status).toBe(200);
    const by = Object.fromEntries((r.json.agents as J[]).map((a) => [a.id, a]));
    expect(Object.keys(by)).toEqual(["sourcing", "support", "treasury"]);
    expect(by.sourcing).toMatchObject({ name: "Sourcing agent", role: "Sourcing", models: ["claude-haiku-5-5"], status: "active", card: { last4: "4002", per_purchase: "30.00", per_month: "100.00", currency: "EUR" }, rails: ["Airwallex card"], declined: 1 });
    expect(by.treasury.models).toEqual(["claude-sonnet-5-5"]);
    expect(by.sourcing.may_not).toContain("Raise its own limit");
    // A decision code made with no model says so; nothing calls it Claude's.
    const fb = (by.sourcing.decisions as J[]).find((d) => /fallback/.test(d.text))!;
    expect(fb.decided_by).toMatch(/^Purser's code/);
    expect(JSON.stringify(r.json.agents)).not.toMatch(/"decided_by":"Claude/);
    expect(r.json.controls).toMatch(/CFO's decision, signed with Face ID/);
  });

  // 14 Nov (Agents a CFO reads in five seconds): spent this month against the monthly limit, and each decision's outcome.
  it("says what each card spent in the records' month, and what each decision came to", async () => {
    const by = Object.fromEntries(((await get("/v1/agents")).json.agents as J[]).map((a) => [a.id, a]));
    expect(by.sourcing.card).toMatchObject({ month: "2026-11", spent_month: "0.00" });
    expect(by.support.card).toMatchObject({ month: "2026-11", spent_month: "38.00" });
    expect(by.treasury.card).toMatchObject({ month: "2026-11", spent_month: "15.00" });
    const out = (a: J) => (a.decisions as J[]).map((d) => [d.outcome, d.text]);
    expect(out(by.sourcing)).toContainEqual(["paid", "Paid 19.99 EUR at Packwise on its own card, within its limit"]);
    expect(out(by.sourcing)).toContainEqual(["declined", "Airwallex declined 45.00 EUR at Packwise: over the card's limit"]);
    expect(out(by.sourcing).filter(([o]) => o === "asked").length).toBeGreaterThanOrEqual(1);
    expect(out(by.treasury)).toContainEqual(["asked", "AP-0005 filed for the CFO's Face ID"]);
  });

  it("is empty for a company whose records name no agent, and reads only the caller's company", async () => {
    expect((await get("/v1/agents", A.key)).json.agents).toEqual([]);
    expect((await c.req("GET", "/v1/agents", { key: null })).status).toBe(401);
    expect((await c.req("POST", "/v1/agents", { key: guest })).status).toBe(405);
  });
});

describe("GET /v1/tokenisation", () => {
  it("shows the invoice token's mint, finance and settle steps from the run record, with its label and explorer links", async () => {
    const r = (await get("/v1/tokenisation")).json;
    const tok = r.invoice_token;
    // 14 Nov: the record says "Metal testnet"; the console names the network Alta (Metal renamed itself).
    expect(tok.label).toBe("prototype · Alta testnet · test money · financier simulated");
    expect(tok.steps.map((s: J) => s.step)).toEqual(["mint", "finance", "settle"]);
    const recorded = new Set((TOKENIZE as unknown as { transactions: { hash: string }[] }).transactions.map((x) => x.hash));
    for (const s of tok.steps as J[]) for (const x of s.txs as J[]) {
      expect(recorded.has(x.hash)).toBe(true);
      expect(x.explorer).toBe(`https://testnet.metalntwx.com/tx/${x.hash}`);
    }
    expect(tok.contract).toBe((TOKENIZE as unknown as { contract: string }).contract);
    expect(tok.record).toMatch(/docs\/runs\/2026-11-12-tokenize\.json$/);
  });

  // 14 Nov (Max: "an intensive upgrade"): the token's life in five stages and its key facts, all from the record.
  it("gives the token's five stages, each with the record's own transactions, and the face value and discount as numbers", async () => {
    const tok = (await get("/v1/tokenisation")).json.invoice_token;
    expect((tok.stages as J[]).map((s) => [s.key, (s.txs as J[]).map((x) => x.key), s.on_chain])).toEqual([
      ["minted", ["deploy", "mint"], true], ["offered", ["offer"], true], ["financed", ["financier-approve", "accept"], true], ["approved", ["payer-approve"], true], ["settled", ["settle"], true]]);
    expect(tok.stages[4].at).toBe("2026-11-12T14:09:13.843Z");
    expect(tok.facts).toEqual({ face_value: { amount: "2.40", unit: "*USDZ", scaled_by: 100 }, discount: { percent: 2, price: "2.35" } });
    expect(tok.invoice).toMatchObject({ invoice_no: "SLL-2026-11", amount: "240.00", currency: "EUR" });
    expect(tok.verified).toBe(true);
  });
  it("gives each sandbox card's limits as numbers, as Airwallex's controls hold them", async () => {
    const cards = (await get("/v1/tokenisation")).json.agent_cards.cards as J[];
    expect(cards.map((c) => c.limit_values)).toEqual([{ currency: "EUR", per_purchase: "46.00", monthly: "100.00" }, { currency: "EUR", per_purchase: "60.00", monthly: "150.00" }, { currency: "EUR", per_purchase: "25.00", monthly: "50.00" }]);
  });

  it("labels the cards and the Visa credential as their records do, and keeps each refusal's own reason", async () => {
    const r = (await get("/v1/tokenisation")).json;
    expect(r.agent_cards.label).toBe("Airwallex sandbox · test money");
    expect(r.agent_cards.cards.map((x: J) => x.last4)).toEqual(["1423", "6203", "6279"]);
    expect(r.visa_credential.label).toMatch(/^live: airi-cli and the Airwallex sandbox \(test money/);
    const p = Object.fromEntries((r.visa_credential.purchases as J[]).map((x) => [x.step, x]));
    // 14 Nov: the latest run, vic-5 (its record's own steps and outcomes).
    expect(r.visa_credential.run).toBe("vic-5");
    expect(r.visa_credential.record).toMatch(/docs\/runs\/2026-11-14-vic-5\.json$/);
    expect(p.B.outcome).toBe("succeeded");
    expect(p.C).toMatchObject({ outcome: "refused", reason: expect.stringMatching(/above the hard cap/) });
    expect(r.visa_credential.credential_deleted).toBe(true);
    // No card number beyond its last four digits leaves the record.
    expect(JSON.stringify(r)).not.toMatch(/\b\d{12,19}\b/);
  });
});

describe("Invoices & books: bookings and an invoice's journal", () => {
  it("finds each invoice's accrual and the payment that settled it, and serves its journal lines", async () => {
    const b = (await get("/v1/books/bookings")).json.bookings as Record<string, number[]>;
    expect(b["AP-0004"]).toEqual([45, 47]);
    expect(b["AP-0005"]).toEqual([50]);
    // Waiting for its new supplier, it is owed already: accrued, nothing paid (the CFO review, 14 Nov).
    expect(b["AP-0006"]).toEqual([52]);
    const j = (await get("/v1/books/invoices/AP-0004/journal")).json.items as J[];
    expect(j.map((e) => e.entry_id)).toEqual([45, 47]);
    // The receipt is booked before its payment (jury, 13 Nov).
    expect(j.map((e) => e.posting_date)).toEqual([...j.map((e) => e.posting_date)].sort());
    const lines = j.flatMap((e) => e.lines as J[]);
    expect(lines.reduce((n, l) => n + l.debit_cents - l.credit_cents, 0)).toBe(0);
    // AP-0006 (waiting for its supplier): its accrual only, which owes the supplier the invoice's total.
    expect(((await get("/v1/books/invoices/AP-0006/journal")).json.items as J[]).map((e) => e.entry_id)).toEqual([52]);
    // Another company's invoice is not found, as on every route that names an object.
    expect((await get("/v1/books/invoices/AP-0004/journal", A.key)).status).toBe(404);
  });
});

// Judge scan, 14 Nov: "Balanced" said of figures that did not add up (this year's result was left out).
describe("the demo company's balance sheet", () => {
  const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
  it("balances: assets equal liabilities plus equity plus this year's result, per currency", async () => {
    const b = (await get("/v1/reports/balance")).json.by_currency as Record<string, { assets_cents: number; liabilities_cents: number; equity_cents: number; result_cents: number; balanced: boolean }>;
    expect(Object.keys(b).length).toBeGreaterThan(0);
    for (const v of Object.values(b)) {
      expect(v.assets_cents).toBe(v.liabilities_cents + v.equity_cents + v.result_cents);
      expect(v.balanced).toBe(true);
    }
    expect(b.EUR!.result_cents).not.toBe(0);
  });
  it("is shown with the result, and 'Balanced' only when the shown figures add up", () => {
    expect(html).toContain("row('cs.books.result',v.result_cents,'k4')");
    expect(html).toContain("sides.balanced&&v.balanced?");
    expect(html).toContain("const sheetSides=(v)=>{const right=(v.liabilities_cents||0)+(v.equity_cents||0)+(v.result_cents||0)");
  });
  it("dates the opening balances before the run's first entry", async () => {
    const es = [] as { posting_date: string; source_key: string | null }[];
    let cursor = "";
    for (let n = 0; n < 20; n++) { const r = (await get(`/v1/ledger/entries?limit=200${cursor ? `&cursor=${cursor}` : ""}`)).json; es.push(...(r.items as typeof es)); cursor = (r.next_cursor as string | null) ?? ""; if (!cursor) break; }
    const opening = es.filter((e) => String(e.source_key).startsWith("opening|")), rest = es.filter((e) => !String(e.source_key).startsWith("opening|"));
    expect(opening.length).toBeGreaterThan(0);
    const firstMove = rest.map((e) => e.posting_date).sort()[0]!;
    for (const o of opening) expect(o.posting_date < firstMove).toBe(true);
  });
  // QA, 14 Nov: the Books tab offers the books as one PDF, through the browser's print (no PDF code in the Worker).
  it("offers the books as a PDF through the browser's print, with every journal entry", () => {
    expect(html).toContain("pdfBtn.onclick=()=>{if(typeof drawAll==='function')drawAll();setTimeout(()=>window.print(),50)}");
    expect(html).toContain("drawAll=()=>drawJournal(all.length)");
    expect(html).not.toContain("/v1/books/statement.pdf");
  });
  it("lists every ledger entry in the journal, by date, newest first", () => {
    expect(html).toContain("const all=await everyPage('/v1/ledger/entries')");
    expect(html).toContain("const byDateNewest=(es)=>es.slice().sort((a,b)=>String(b.posting_date).localeCompare(String(a.posting_date))||b.entry_id-a.entry_id)");
  });
});

describe("the console", () => {
  const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
  // 14 Nov (Max: "make it just Invoices"): Invoices has its own tab again and the books have theirs.
  it("has the tabs in order, Invoices and Books apart, and says what Purser Cloud is", () => {
    // 22 Nov: in their groups (cloud/src/consoleShell.ts): Overview; Money; Agents and tokens; payment rails; Settings.
    expect([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1])).toEqual(["overview", "invoices", "receivables", "cash", "transactions", "books", "agents", "tokenisation", "airwallex", "claude", "connections", "settings"]);
    // 21 Nov: the Claude tab (hidden until Claude is connected) sits in the Connected group beside Airwallex.
    expect([...html.matchAll(/data-sg="([a-z]+)"/g)].map((m) => m[1])).toEqual(["money", "agents", "rails"]);
    expect([...html.matchAll(/data-group="([a-z]+)"/g)].map((m) => m[1])).toEqual(["overview", "money", "agents", "rails", "settings"]);
    expect(html).toContain("'/invoices':invoicesView,'/books':booksView");
    expect(html).toContain("'/agents':agentsView");
    expect(html).toContain("'/tokenisation':tokensView");
    expect(html).toContain("'/connections':connectionsView");
    expect(html).toContain("Purser Cloud is where a company runs Purser: its agents, their limits, its payables and books, and every approval.");
  });
  it("keeps the live run's sandbox cards apart from the demo company's simulated ones (judge check, 13 Nov)", () => {
    expect(MESSAGES.en["cs.tok.cards"]).toBe("Agents' cards in the Airwallex sandbox (live run, 6 Nov)");
    expect(MESSAGES.en["cs.tok.cards_note"]).toBe("Real sandbox cards from the live run; the demo company's cards on Agents are simulated.");
    expect(html).toContain("el('p','',el('b','',t('cs.tok.cards_note')))");
  });
  it("adds no inline script beyond the one with the page's nonce, and no write call for agents", () => {
    expect([...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0])).toEqual([`<script type="module" nonce="n0nce">`]);
    expect(html).not.toMatch(/\/v1\/agents\/[^'"]*\/(pause|revoke)/);
  });
  it("names a VAT code in words where Purser knows it, keeps the account, and says the runner sent the last update (jury, 13 Nov)", () => {
    expect(MESSAGES.en["cs.vat.PF_DE19"]).toBe("German 19%, reclaimed from Germany");
    expect(MESSAGES.nl["cs.vat.PF_DE19"]).toBeTruthy();
    expect(html).toContain("l.account+(ACCT[l.account]?' '+ACCT[l.account]:'')+(l.vat_code?' · '+vatWord(l.vat_code):'')");
    // The account's name from the chart beside its number (the CFO review, 14 Nov).
    expect(html).toMatch(/const ACCT=\{[^}]*"2100":"Accounts payable"/);
    expect(html).not.toContain("l.vat_code?' · '+l.vat_code");
    expect(MESSAGES.en["cs.last_update"]).toBe("Last update from the runner");
  });
  // 26 Nov (the console redesign): the Overview's own header names the company and the day its figures stand at; the
  // "Purser Cloud is…" box (the older Overview's, no longer drawn) is gone with it, so the phone header stays short.
  it("says on the Overview's header whose figures they are and as of when, with no 'Purser Cloud is…' box", () => {
    expect(html).not.toContain("whatCloud(");
    expect(html).toContain("const hero=head(t('cs.nav.overview'),sw('as_of',{name:m.tenant.name||'',day:dday(new Date(now).toISOString())}),m.demo?[ovNet()]:null)");
  });
  it("labels the demo's fallback decisions as a simulated month, from its own count (jury, 13 Nov)", async () => {
    expect((await get("/v1/dashboard")).json.agents).toEqual({ decisions: 33, by_fallback: 8 });
    // 14 Nov (judge scan): it names whose month it is, so it is not read against the 3 Nov main run's 24 of 24 by Claude.
    expect(MESSAGES.en["cs.dash.decisions_fallback_demo"]).toBe("{a} by the agents · {n} by code when no model answered, in the demo company's simulated month (not the 3 Nov main run)");
    expect(MESSAGES.en["cs.dash.decisions_fallback_demo"]).not.toMatch(/Claude/);
    // 14 Nov: it is the Decisions timeline's subtitle now; each row has an icon for who acted (the rail is Airwallex).
    const feed = (await get("/v1/dashboard")).json.feed as J[];
    expect(feed.find((f) => f.who === "Purser (Airwallex)")?.by).toBe("rail");
    expect(feedLine({ seq: 1, ts: "2026-10-15T10:00:00Z", actor: "sourcing", event: "card.charge_declined", subject: "tx_9", payload_json: JSON.stringify({ amount: "45.00", currency: "EUR", merchant: "Packwise", reason: "LIMIT_EXCEEDED" }) })?.by).toBe("rail");
    expect(feed.find((f) => f.who === "The CFO")?.by).toBe("cfo");
  });
});

describe("headers (jury, 13 Nov)", () => {
  it("the console may not be framed; the PDF viewer only by the console itself", async () => {
    expect((await c.fetch(`${ORIGIN}/`)).headers.get("x-frame-options")).toBe("DENY");
    expect((await c.fetch(`${ORIGIN}/try`)).headers.get("x-frame-options")).toBe("DENY");
    const pdf = await c.fetch(`${ORIGIN}/pdfview`);
    expect(pdf.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(pdf.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });
  it("every /v1 JSON answer, an error included, carries nosniff and HSTS", async () => {
    for (const r of [await c.fetch(`${ORIGIN}/v1/agents`, { headers: { authorization: `Bearer ${guest}` } }), await c.fetch(`${ORIGIN}/v1/agents`), await c.fetch(`${ORIGIN}/v1/nope`)]) {
      expect(r.headers.get("content-type")).toMatch(/^application\/json/);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    }
  });
});
