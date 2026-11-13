// Purser Cloud's enterprise pass (13 Nov): the Agents and Tokenisation tabs and Invoices & books. It holds: every agent
// figure comes from the company's own rows (job, model as its runs recorded it, card limits as issued, rails, status,
// decisions with who decided); tokenisation shows only what its records hold, each with the record's own label and
// links; each invoice's bookings are found from the ledger; the routes read only, for the caller's own company; and the
// console's nav has the new tabs, the old Invoices route lands on Books, and the page says what Purser Cloud is.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
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
    expect(tok.label).toBe("prototype · Metal testnet · test money · financier simulated");
    expect(tok.steps.map((s: J) => s.step)).toEqual(["mint", "finance", "settle"]);
    const recorded = new Set((TOKENIZE as unknown as { transactions: { hash: string }[] }).transactions.map((x) => x.hash));
    for (const s of tok.steps as J[]) for (const x of s.txs as J[]) {
      expect(recorded.has(x.hash)).toBe(true);
      expect(x.explorer).toBe(`https://testnet.metalntwx.com/tx/${x.hash}`);
    }
    expect(tok.contract).toBe((TOKENIZE as unknown as { contract: string }).contract);
    expect(tok.record).toMatch(/docs\/runs\/2026-11-12-tokenize\.json$/);
  });

  it("labels the cards and the Visa credential as their records do, and keeps each refusal's own reason", async () => {
    const r = (await get("/v1/tokenisation")).json;
    expect(r.agent_cards.label).toBe("Airwallex sandbox · test money");
    expect(r.agent_cards.cards.map((x: J) => x.last4)).toEqual(["1423", "6203", "6279"]);
    expect(r.visa_credential.label).toMatch(/^live: airi-cli and the Airwallex sandbox \(test money/);
    const p = Object.fromEntries((r.visa_credential.purchases as J[]).map((x) => [x.step, x]));
    expect(p.A.outcome).toBe("succeeded");
    expect(p.G).toMatchObject({ outcome: "refused", reason: expect.stringMatching(/no tap in Airi/) });
    expect(r.visa_credential.credential_deleted).toBe(true);
    // No card number beyond its last four digits leaves the record.
    expect(JSON.stringify(r)).not.toMatch(/\b\d{12,19}\b/);
  });
});

describe("Invoices & books: bookings and an invoice's journal", () => {
  it("finds each invoice's accrual and the payment that settled it, and serves its journal lines", async () => {
    const b = (await get("/v1/books/bookings")).json.bookings as Record<string, number[]>;
    expect(b["AP-0004"]).toEqual([25, 30]);
    expect(b["AP-0005"]).toEqual([31]);
    expect(b["AP-0006"]).toBeUndefined();
    const j = (await get("/v1/books/invoices/AP-0004/journal")).json.items as J[];
    expect(j.map((e) => e.entry_id)).toEqual([25, 30]);
    const lines = j.flatMap((e) => e.lines as J[]);
    expect(lines.reduce((n, l) => n + l.debit_cents - l.credit_cents, 0)).toBe(0);
    expect((await get("/v1/books/invoices/AP-0006/journal")).json.items).toEqual([]);
    // Another company's invoice is not found, as on every route that names an object.
    expect((await get("/v1/books/invoices/AP-0004/journal", A.key)).status).toBe(404);
  });
});

describe("the console", () => {
  const html = consolePage("n0nce", { origin: "https://cloud.test", rpId: "cloud.test", mailDomain: "" });
  it("has the new tabs in order, sends the old Invoices route to Books, and says what Purser Cloud is", () => {
    expect([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1])).toEqual(["overview", "agents", "books", "transactions", "tokenisation", "settings"]);
    expect(html).toContain("if(path==='/invoices'){history.replaceState(null,'','#/books'");
    expect(html).toContain("'/agents':agentsView");
    expect(html).toContain("'/tokenisation':tokensView");
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
});
