// Slack and Teams approval notifications from the environment (src/integrations/approvalChat.ts): the message says
// "Payment P-… needs your signature: EUR …, payee …" and links to the passkey page; the payload carries no secret (no
// webhook URL, no key, no terms hash or challenge); and nothing in it can approve (no button that acts, no reply word,
// only an open-URL link to Purser Cloud). The webhook URLs come from the environment, are checked, and never reach a
// result or an error message. With the in-repo cloud: a proposal waiting for the CFO becomes one notice.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Purser } from "../sdk/typescript/src/index.js";
import { CANNOT_APPROVE, CHAT_ENV, chatTargetsFromEnv, grouped, noticeFromInvoice, noticeHeadline, notifyApproval, slackMessage, teamsMessage, type ApprovalNotice } from "../src/integrations/approvalChat.js";
import { ORIGIN } from "./support/cloud.js";
import { integrationsWorld, type IntegrationsWorld } from "./support/integrationsWorld.js";

// Test values, too short to be real webhooks (as test/cloud-alerts.test.ts); not credentials.
const SLACK = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS = "https://acme.webhook.office.com/webhookb2/xyz";
const ENV = { [CHAT_ENV.slack]: SLACK, [CHAT_ENV.teams]: TEAMS };

const notice: ApprovalNotice = { proposal_id: "P-0009", invoice_id: "AP-0005", amount: "1309.00", currency: "EUR", payee: "Bergtex Textil GmbH", link: `${ORIGIN}/#/invoices/AP-0005`, test_money: true };

/** Every string in a payload, and every key. */
const strings = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : [];

describe("the message", () => {
  it('says "Payment P-… needs your signature: EUR …, payee …" with the passkey page\'s link', () => {
    expect(noticeHeadline(notice)).toBe("[TEST MONEY] Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex Textil GmbH");
    expect(noticeHeadline({ ...notice, test_money: false })).toBe("Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex Textil GmbH");
    const slack = JSON.stringify(slackMessage(notice)), teams = JSON.stringify(teamsMessage(notice));
    for (const m of [slack, teams]) {
      expect(m).toContain("Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex Textil GmbH");
      expect(m).toContain(`${ORIGIN}/#/invoices/AP-0005`);
      expect(m).toContain("Open the passkey page");
      expect(m).toContain(CANNOT_APPROVE);
    }
    expect(grouped("1234567.5")).toBe("1,234,567.5");
    expect(grouped("12.00")).toBe("12.00");
  });

  it("carries no secret: no webhook URL, no key, no terms hash or challenge, no token in the link", () => {
    for (const m of [slackMessage(notice), teamsMessage(notice)]) {
      const text = JSON.stringify(m);
      expect(text).not.toContain("hooks.slack.com");
      expect(text).not.toContain("webhook.office.com");
      expect(text).not.toMatch(/pck_|pcs\.|pca\.|Bearer|secret|[0-9a-f]{64}|challenge/i);
    }
    expect(() => slackMessage({ ...notice, link: `${ORIGIN}/#/invoices/AP-0005?token=abc` })).toThrow(/no token/);
    expect(() => slackMessage({ ...notice, link: `${ORIGIN}/approve?approve=1` })).toThrow(/no token or approve/);
    expect(() => teamsMessage({ ...notice, link: "http://cloud.test/#/invoices/AP-0005" })).toThrow(/https/);
  });

  it("cannot approve: no Slack button or action, a Teams card whose only action opens the passkey page", () => {
    const slack = slackMessage(notice) as { blocks: { type: string }[] };
    expect(slack.blocks.map((b) => b.type)).toEqual(["section", "context"]);
    const s = strings(slack);
    expect(s.filter((x) => /^(actions|button|action_id|callback_id|response_url|interactive)$/.test(x))).toEqual([]);
    const card = (teamsMessage(notice) as { attachments: { content: { actions: { type: string; url: string }[] } }[] }).attachments[0]!.content;
    expect(card.actions).toEqual([{ type: "Action.OpenUrl", title: "Open the passkey page", url: `${ORIGIN}/#/invoices/AP-0005` }]);
    const t = strings(teamsMessage(notice));
    expect(t.filter((x) => /^Action\.(Submit|Execute|Http|ShowCard|ToggleVisibility)$/.test(x))).toEqual([]);
    // No word a chat reply could use to approve, and no link but the passkey page.
    for (const m of [s, t]) {
      expect(m.join(" ")).not.toMatch(/\b(reply|type|react)\b[^.]{0,30}\bapprove\b|\bapprove (it|now|here)\b/i);
      expect(m.join(" ").match(/https?:\/\/[^\s|>"]+/g)?.filter((u) => !u.startsWith(`${ORIGIN}/#/invoices/`) && !u.startsWith("http://adaptivecards.io/")) ?? []).toEqual([]);
    }
  });

  it("strips links and markup an invoice's payee name could carry", () => {
    const evil = { ...notice, payee: "Evil <https://phish.example/approve|Approve now> *bold* @channel evil.example" };
    const text = JSON.stringify(slackMessage(evil));
    expect(text).not.toMatch(/phish\.example|evil\.example|@channel|<https:\/\/phish/);
  });
});

describe("the webhooks", () => {
  it("come from the environment only, are checked, and never appear in an error", () => {
    expect(chatTargetsFromEnv({})).toEqual([]);
    expect(chatTargetsFromEnv(ENV).map((t) => t.channel)).toEqual(["slack", "teams"]);
    const bad = "https://hooks.slack.evil.example/services/x";
    let said = "";
    try { chatTargetsFromEnv({ [CHAT_ENV.slack]: bad }); } catch (e) { said = (e as Error).message; }
    expect(said).toMatch(/PURSER_SLACK_WEBHOOK_URL is not a Slack incoming webhook/);
    expect(said).not.toContain("evil");
    expect(() => chatTargetsFromEnv({ [CHAT_ENV.teams]: "http://example.webhook.office.com/x" })).toThrow(/PURSER_TEAMS_WEBHOOK_URL/);
  });

  it("are posted to once each, and a result names the channel and status, never the URL", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const results = await notifyApproval(notice, { env: ENV, fetch: async (url, init) => { calls.push({ url, init }); return new Response("ok", { status: url === SLACK ? 200 : 502 }); } });
    expect(calls.map((x) => x.url)).toEqual([SLACK, TEAMS]);
    expect(calls.every((x) => x.init.method === "POST" && x.init.redirect === "error")).toBe(true);
    expect(results).toEqual([{ channel: "slack", ok: true, status: 200 }, { channel: "teams", ok: false, status: 502 }]);
    expect(JSON.stringify(results)).not.toMatch(/https?:/);
    const down = await notifyApproval(notice, { env: { [CHAT_ENV.slack]: SLACK }, fetch: async () => { throw new Error(`refused ${SLACK}`); } });
    expect(down).toEqual([{ channel: "slack", ok: false, status: 0 }]);
  });
});

describe("with Purser Cloud", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-11-10T09:00:00Z")); });
  afterAll(() => { vi.useRealTimers(); });
  let w: IntegrationsWorld;
  beforeAll(async () => { w = await integrationsWorld(); }, 60_000);
  afterAll(() => w.c.close());

  it("turns a proposal that waits for the CFO into one notice, read with a read key", async () => {
    const propose = new Purser({ baseUrl: ORIGIN, apiKey: w.proposeKey, fetch: w.c.fetch });
    const read = new Purser({ baseUrl: ORIGIN, apiKey: w.readKey, fetch: w.c.fetch });
    expect((await read.listPayableInvoices()).map((i) => noticeFromInvoice(i, ORIGIN))).toEqual([null]);
    const { proposal } = await propose.proposePayment("AP-0001");
    const notices = (await read.listPayableInvoices()).map((i) => noticeFromInvoice(i, ORIGIN)).filter((n) => n);
    expect(notices).toEqual([{ proposal_id: proposal.id, invoice_id: "AP-0001", amount: "1850.00", currency: "EUR", payee: "Bergtex Textil GmbH", link: `${ORIGIN}/#/invoices/AP-0001`, test_money: true }]);
    expect(noticeHeadline(notices[0]!)).toBe("[TEST MONEY] Payment P-0001 needs your signature: EUR 1,850.00, payee Bergtex Textil GmbH");
  });
});
