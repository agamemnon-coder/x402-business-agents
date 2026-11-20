// Slack and Teams live notifications (cloud/src/chatHooks.ts), with stand-ins for Slack's and Teams' webhooks: nothing
// here reaches a real service. It holds: each company sets its own URL, checked against an exact allow list (Slack's
// hooks.slack.com/services, Teams Workflows on api.powerplatform.com or logic.azure.com; the retired webhook.office.com
// refused); the three business events reach each live hook in its product's format, linking to Purser Cloud and carrying
// no approve action, no secret and no bank detail; retries, the hourly cap and switching off after twenty failures work
// as the signed webhook's; the URL never comes back from the API; a key cannot set it; and "Send a test" posts once.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatHookUrl, ChatHookRefused, postEvent } from "../cloud/src/chatHooks.js";
import { HOOK_OFF_AFTER } from "../cloud/src/monitor.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
// Made-up URLs in each product's documented shape (placeholders, not real webhooks).
const SLACK = "https://hooks.slack.com/services/T0000TEST/B0000TEST/abcdefghijklmnop";
const TEAMS = "https://default0000test.00.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/0123456789abcdef/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=test-signature-not-real";
const TEAMS_OLD = "https://prod-12.westeurope.logic.azure.com:443/workflows/0123456789abcdef/triggers/manual/paths/invoke?api-version=2016-06-01&sig=test";

type Sent = { url: string; body: string };
let c: TestCloud, db: DB, dir: string, t: TestTenant, other: TestTenant, sent: Sent[];
let script: Record<string, number[]> = {};

beforeEach(async () => {
  c = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "chat-"));
  db = openDb(":memory:");
  t = await c.tenant("northwind");
  other = await c.tenant("southwind");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  sent = []; script = {};
  c.env.outbound = async (url, init) => {
    sent.push({ url, body: String(init.body) });
    const s = script[new URL(url).host]?.shift() ?? 200;
    return new Response(s === 200 ? "ok" : "{}", { status: s });
  };
  c.env.retryDelayMs = 0;
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

const set = (product: string, url: string, key = t.session) => c.req("POST", `/v1/chat-hooks/${product}`, { key, body: { url } });
const target = () => ({ url: ORIGIN, key: t.key, fetch: c.fetch });
const to = (host: string) => sent.filter((s) => new URL(s.url).host === host);
const TEAMS_HOST = new URL(TEAMS).host;
/** No approve action, no secret, no full bank detail. */
const FORBIDDEN = /pck_|pcs\.|pcu\.|pca\.|whsec_|approve\?|\/approve|token=|code=|"Action\.(Submit|Execute|Http)"|"action_id"|[A-Z]{2}\d{2}[A-Z0-9]{11,30}/;

describe("the allow list", () => {
  it("takes Slack's incoming webhooks and Teams Workflows' URLs, in their documented shapes", () => {
    expect(chatHookUrl("slack", SLACK)).toBe(SLACK);
    expect(new URL(chatHookUrl("teams", TEAMS)).host).toBe(TEAMS_HOST);
    expect(new URL(chatHookUrl("teams", TEAMS_OLD)).host).toBe("prod-12.westeurope.logic.azure.com");
  });

  it("refuses anything else, with a sentence that says what fits", () => {
    for (const [p, u] of [
      ["slack", "http://hooks.slack.com/services/T0000TEST/B0000TEST/abcdefghijklmnop"],
      ["slack", "https://hooks.slack.com.evil.example/services/T0000TEST/B0000TEST/abcdefghijklmnop"],
      ["slack", "https://hooks.slack.com/triggers/T0000TEST/123/abc"],
      ["slack", "https://user:pw@hooks.slack.com/services/T0000TEST/B0000TEST/abcdefghijklmnop"],
      ["slack", "https://hooks.slack.com:8443/services/T0000TEST/B0000TEST/abcdefghijklmnop"],
      ["slack", TEAMS],
      ["teams", SLACK],
      ["teams", "https://evil.example/powerautomate/automations/direct/workflows/0123456789abcdef/triggers/manual/paths/invoke"],
      ["teams", "https://x.environment.api.powerplatform.com.evil.example/powerautomate/automations/direct/workflows/0123456789abcdef/triggers/manual/paths/invoke"],
      ["teams", "https://acme.webhook.office.com/webhookb2/xyz"],
      ["teams", "https://127.0.0.1/workflows/x"],
    ] as const) expect(() => chatHookUrl(p, u), `${p} ${u}`).toThrow(ChatHookRefused);
    expect(() => chatHookUrl("teams", "https://acme.webhook.office.com/webhookb2/xyz")).toThrow(/retired/);
  });
});

describe("setting a hook", () => {
  it("is each company's own: set by its signed-in owner, shown by host only, never readable back", async () => {
    expect((await set("slack", SLACK)).status).toBe(200);
    expect((await set("teams", TEAMS)).status).toBe(200);
    const got = await c.req("GET", "/v1/chat-hooks", { key: t.session });
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.json)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(got.json)).not.toContain("sig=");
    expect((got.json.hooks as Record<string, { host: string; status: string }>).slack).toMatchObject({ host: "hooks.slack.com", status: "on" });
    // The other company has none.
    expect((await c.req("GET", "/v1/chat-hooks", { key: other.session })).json.hooks).toEqual({ slack: null, teams: null });
    // Not in the export either.
    expect(JSON.stringify((await c.req("GET", "/v1/export", { key: t.key })).json)).not.toContain("abcdefghijklmnop");
  });

  it("refuses a key (a person's decision) and a URL off the list", async () => {
    expect((await set("slack", SLACK, t.key)).status).toBe(403);
    const bad = await set("slack", "https://example.com/hook");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/hooks\.slack\.com/);
    expect((await set("discord", SLACK)).status).toBe(404);
  });

  it("can be removed by the owner, and then hears nothing", async () => {
    await set("slack", SLACK);
    expect((await c.req("DELETE", "/v1/chat-hooks/slack", { key: t.session })).json).toEqual({ removed: true });
    await postEvent({ sql: c.env.sql, tenantId: t.id, now: NOW, out: c.env.outbound, retryDelayMs: 0, origin: ORIGIN }, { type: "payment.paid", data: { invoice_id: "AP-1", amount: "1.00", currency: "EUR", paid_at: "2026-11-08", link: `${ORIGIN}/#/invoices` } });
    expect(sent).toEqual([]);
  });
});

describe("the events, in each product's format", () => {
  it("posts approval.needed from a runner's push to Slack and Teams, linking to Purser Cloud, approving nothing", async () => {
    await set("slack", SLACK);
    await set("teams", TEAMS);
    await pushToCloud(db, target(), NOW);
    const inv = db.prepare("SELECT id FROM ap_invoices ORDER BY id").get() as { id: string };
    db.prepare("UPDATE ap_invoices SET status = 'waiting_cfo', updated_at = ? WHERE id = ?").run("2026-11-08T13:00:00.000Z", inv.id);
    await pushToCloud(db, target(), NOW);
    const slack = JSON.parse(to("hooks.slack.com")[0]!.body) as { text: string; blocks: { type: string; elements?: { type: string; url?: string }[] }[] };
    expect(slack.text).toMatch(/Waiting for the CFO's Face ID/);
    expect(slack.text).toContain(inv.id);
    expect(slack.blocks.find((b) => b.type === "actions")!.elements!.map((e) => [e.type, e.url])).toEqual([["button", `${ORIGIN}/#/invoices`]]);
    const teams = JSON.parse(to(TEAMS_HOST)[0]!.body) as { type: string; attachments: { contentType: string; content: { actions: { type: string; url: string }[] } }[] };
    expect(teams.type).toBe("message");
    expect(teams.attachments[0]!.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(teams.attachments[0]!.content.actions).toEqual([{ type: "Action.OpenUrl", title: "Review in Purser Cloud", url: `${ORIGIN}/#/invoices` }]);
    const everything = sent.map((s) => s.body).join("\n");
    expect(everything).not.toMatch(FORBIDDEN);
    // No payee's name either: the chat hears the event as the signed webhook does (ids, amounts, days).
    expect(everything).not.toMatch(/Bergtex/);
  });

  it("posts payment.paid and books.closed, keeping only safe fields and Purser's own links", async () => {
    await set("slack", SLACK);
    const env = { sql: c.env.sql, tenantId: t.id, now: NOW, out: c.env.outbound, retryDelayMs: 0, origin: ORIGIN };
    await postEvent(env, { type: "payment.paid", data: { invoice_id: "AP-0007", amount: "99.00", currency: "EUR", paid_at: "2026-11-08", link: `${ORIGIN}/#/invoices`, iban: "NL91ABNA0417164300", secret: "whsec_x" } });
    await postEvent(env, { type: "books.closed", data: { year: "2025", entry_id: "41", posting_date: "2025-12-31", entry_hash: "ab".repeat(32), link: "https://evil.example/phish" } });
    const [paid, closed] = to("hooks.slack.com").map((s) => JSON.parse(s.body) as { text: string; blocks: { type: string }[] });
    expect(paid!.text).toBe("Payment paid: Invoice AP-0007 was paid: EUR 99.00.");
    expect(closed!.text).toContain("Books closed for 2025");
    // A link that is not Purser Cloud's own is dropped, and with it the button.
    expect(closed!.blocks.some((b) => b.type === "actions")).toBe(false);
    expect(sent.map((s) => s.body).join("\n")).not.toMatch(FORBIDDEN);
  });
});

describe("delivery, like the signed webhook", () => {
  const env = () => ({ sql: c.env.sql, tenantId: t.id, now: NOW, out: c.env.outbound, retryDelayMs: 0, origin: ORIGIN });
  const paid = { type: "payment.paid" as const, data: { invoice_id: "AP-1", amount: "1.00", currency: "EUR", paid_at: "2026-11-08", link: `${ORIGIN}/#/invoices` } };

  it("retries a passing failure up to three times, and not a refusal", async () => {
    await set("slack", SLACK);
    script["hooks.slack.com"] = [503, 503, 200];
    expect(await postEvent(env(), paid)).toEqual([{ product: "slack", status: 200 }]);
    expect(sent).toHaveLength(3);
    sent = [];
    script["hooks.slack.com"] = [404];
    expect(await postEvent(env(), paid)).toEqual([{ product: "slack", status: 404 }]);
    expect(sent).toHaveLength(1);
  });

  it("switches a hook off after twenty failed events in a row; a working test switches it back on", async () => {
    await set("slack", SLACK);
    for (let i = 0; i < HOOK_OFF_AFTER; i++) { script["hooks.slack.com"] = [410]; await postEvent(env(), paid); }
    const hooks = (await c.req("GET", "/v1/chat-hooks", { key: t.session })).json.hooks as Record<string, { status: string; consecutive_failures: number }>;
    expect(hooks.slack).toMatchObject({ status: "switched_off", consecutive_failures: HOOK_OFF_AFTER });
    sent = [];
    expect(await postEvent(env(), paid)).toEqual([]);
    expect(sent).toEqual([]);
    const test = await c.req("POST", "/v1/chat-hooks/slack/test", { key: t.session });
    expect(test.json).toEqual({ product: "slack", delivered: true, status: 200 });
    expect(JSON.parse(sent[0]!.body).text).toMatch(/Nothing posted here can approve a payment/);
    expect(((await c.req("GET", "/v1/chat-hooks", { key: t.session })).json.hooks as Record<string, { status: string }>).slack!.status).toBe("on");
  });

  it("answers a test for a hook that is not set with 404", async () => {
    expect((await c.req("POST", "/v1/chat-hooks/teams/test", { key: t.session })).status).toBe(404);
  });
});
