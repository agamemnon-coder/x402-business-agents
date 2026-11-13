// Approval alerts (cloud/src/alerts.ts), with a stand-in for every channel: Twilio's WhatsApp API, the e-mail provider,
// Slack's and Teams' incoming webhooks and the company's signed webhook. Nothing here reaches a real service.
// It holds: when a runner's push files an invoice for the CFO's Face ID, every target the owner chose is told the amount,
// the payee, why it waits and the approval page's link; no message carries anything that approves (no token, code or
// reply word; the link is the console's page, which asks for the passkey); the signed webhook's event is as before (no
// payee's name); each delivery is idempotent (a replayed push or a second dispatch sends nothing again), retried when
// the failure may pass and not when it will not, capped per company per hour, and recorded with its status in the
// company's security events; a phone number or address appears only masked in the API, the events and the logs; and
// a target that does not fit its channel is refused.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertEvent, alertText, ALERTS_PER_HOUR, chatNotifier, cleanTarget, dispatchApprovalAlert, emailNotifier, maskTarget, resendEmail, twilioWhatsApp, webhookNotifier, type ApprovalAlert, type EmailProvider, type SendResult } from "../cloud/src/alerts.js";
import { chatMessage } from "../cloud/src/connections.js";
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
// Made-up targets (a number in a reserved fictional range, example.com, a Slack path of placeholders).
const PHONE = "+31612345678", EMAIL = "cfo@example.com", SLACK = "https://hooks.slack.com/services/T000/B000/XXXX", TEAMS = "https://acme.webhook.office.com/webhookb2/xyz";
const TWILIO = { accountSid: "AC00000000000000000000000000000000", authToken: "test-token-not-a-secret", whatsappFrom: "+14155238886" };
const SID = `SM${"0123456789abcdef".repeat(2)}`;

type Sent = { url: string; headers: Record<string, string>; body: string };
let c: TestCloud, db: DB, dir: string, t: TestTenant, sent: Sent[], mails: { to: string; subject: string; text: string; idempotencyKey: string }[];
/** How each stand-in answers next: per host, a queue of statuses (then 200/201). */
let script: Record<string, number[]> = {};

const stubEmail: EmailProvider = {
  name: "stand-in",
  async send(m) { mails.push(m); const s = script["mail"]?.shift() ?? 200; return { ok: s < 300, status: s, retryable: s >= 500 || s === 429, ...(s < 300 ? { providerRef: `em_${mails.length}` } : {}) }; },
};

beforeEach(async () => {
  c = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "alerts-"));
  db = openDb(":memory:");
  t = await c.tenant("northwind");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  sent = []; mails = []; script = {};
  c.env.outbound = async (url, init) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const host = new URL(url).host;
    const s = script[host]?.shift() ?? (host === "api.twilio.com" ? 201 : 200);
    return new Response(host === "api.twilio.com" && s === 201 ? JSON.stringify({ sid: SID, status: "queued" }) : "{}", { status: s });
  };
  c.env.retryDelayMs = 0;
  c.env.alerts = { twilio: TWILIO, email: stubEmail, testMoney: true };
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

const target = () => ({ url: ORIGIN, key: t.key, fetch: c.fetch });
const add = (channel: string, value: string) => c.req("POST", "/v1/alerts/targets", { key: t.session, body: { channel, target: value } });
async function allTargets() {
  for (const [ch, v] of [["whatsapp", PHONE], ["email", EMAIL], ["slack", SLACK], ["teams", TEAMS]] as const) expect((await add(ch, v)).status).toBe(201);
  await c.req("POST", "/v1/webhook", { key: t.session, body: { url: "https://hooks.example/purser" } });
}
async function fileForCfo(): Promise<string> {
  await pushToCloud(db, target(), NOW);
  const inv = db.prepare("SELECT id FROM ap_invoices ORDER BY id").get() as { id: string };
  db.prepare("UPDATE ap_invoices SET status = 'waiting_cfo', updated_at = ? WHERE id = ?").run("2026-11-08T13:00:00.000Z", inv.id);
  await pushToCloud(db, target(), NOW);
  return inv.id;
}
const to = (host: string) => sent.filter((s) => new URL(s.url).host === host);
const FORBIDDEN = /pck_|pcs\.|pcu\.|pca\.|whsec_|reply (yes|approve)|approve\?|token=|code=/i;

describe("an approval alert on every channel", () => {
  it("tells each target the amount, payee, why and the approval page, and nothing in it approves", async () => {
    await allTargets();
    const id = await fileForCfo();
    const link = `${ORIGIN}/#/invoices/${id}`;
    // WhatsApp through Twilio's Messages API: basic auth, form fields, the sandbox sender.
    const [wa] = to("api.twilio.com");
    expect(wa!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.accountSid}/Messages.json`);
    expect(wa!.headers.authorization).toBe(`Basic ${Buffer.from(`${TWILIO.accountSid}:${TWILIO.authToken}`).toString("base64")}`);
    const form = new URLSearchParams(wa!.body);
    expect(form.get("To")).toBe(`whatsapp:${PHONE}`);
    expect(form.get("From")).toBe("whatsapp:+14155238886");
    const text = form.get("Body")!;
    expect(text).toMatch(/^\[TEST MONEY\] Purser: a payment waits for your Face ID\./);
    expect(text).toContain("EUR 1850.00 to Bergtex Textil GmbH");
    expect(text).toMatch(/Why: .+/);
    expect(text).toContain(link);
    expect(text).toContain("This message cannot approve anything");
    // E-mail through the provider adapter, with the delivery's id as its idempotency key.
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(EMAIL);
    expect(mails[0]!.subject).toContain("Bergtex");
    expect(mails[0]!.idempotencyKey).toMatch(/^ad_[0-9a-f]{32}$/);
    // Slack (Block Kit) and Teams (an Adaptive Card), in the formats connections.ts already speaks.
    const slack = JSON.parse(to("hooks.slack.com")[0]!.body) as { text: string; blocks: { type: string; elements?: { url?: string }[] }[] };
    expect(slack.text).toContain("Bergtex");
    expect(slack.blocks.find((b) => b.type === "actions")!.elements![0]!.url).toBe(link);
    const teams = JSON.parse(to("acme.webhook.office.com")[0]!.body) as { attachments: { content: { actions: { url: string }[]; body: { text: string }[] } }[] };
    expect(teams.attachments[0]!.content.actions[0]!.url).toBe(link);
    expect(teams.attachments[0]!.content.body.map((b) => b.text).join(" ")).toContain("Bergtex");
    // The signed webhook: the event as before, ids and amounts only, no payee's name.
    const hook = JSON.parse(to("hooks.example")[0]!.body) as { type: string; data: Record<string, string> };
    expect(hook.type).toBe("approval.needed");
    expect(JSON.stringify(hook)).not.toMatch(/Bergtex/);
    // Nothing that approves: no token, no code, no reply word; the only link is the console's page, without a query.
    const everything = [...sent.map((s) => s.body), ...mails.map((m) => m.text + m.subject)].join("\n");
    expect(everything).not.toMatch(FORBIDDEN);
    const urls = [...everything.matchAll(/https:\/\/[^\s"\\)]+/g)].map((m) => m[0]).filter((u) => !u.includes("adaptivecards.io"));
    // (the signed webhook's event keeps its existing approve_in, the invoices page).
    expect(new Set(urls)).toEqual(new Set([link, `${ORIGIN}/#/invoices`]));
  });

  it("records every delivery in the security events, with the target masked, and keeps it out of the logs", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); });
    vi.spyOn(console, "warn").mockImplementation((...a) => { lines.push(a.join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...a) => { lines.push(a.join(" ")); });
    await allTargets();
    await fileForCfo();
    const ev = (await c.req("GET", "/v1/security/events", { key: t.session })).json.items as { kind: string; detail: Record<string, unknown> }[];
    const deliveries = ev.filter((e) => e.kind === "alert.delivery");
    expect(deliveries.map((d) => [d.detail.channel, d.detail.status]).sort()).toEqual([["email", "sent"], ["slack", "sent"], ["teams", "sent"], ["webhook", "sent"], ["whatsapp", "sent"]]);
    expect(deliveries.find((d) => d.detail.channel === "whatsapp")!.detail).toMatchObject({ to: "+31*******78", provider_ref: SID, attempts: 1 });
    expect(deliveries.find((d) => d.detail.channel === "email")!.detail.to).toBe("c***@example.com");
    // The settings show masked targets and the latest deliveries; never a whole number, address or webhook path.
    const settings = (await c.req("GET", "/v1/alerts", { key: t.session })).json;
    const shown = JSON.stringify([settings, ev]);
    for (const secret of [PHONE, EMAIL, "/services/T000", "webhookb2"]) {
      expect(shown).not.toContain(secret);
      expect(lines.join("\n")).not.toContain(secret);
    }
    expect(settings.channels).toEqual({ whatsapp: true, email: true, slack: true, teams: true, webhook: true });
  });

  it("sends each event to each target once: a replayed push or a second dispatch sends nothing again", async () => {
    await add("whatsapp", PHONE);
    const id = await fileForCfo();
    await pushToCloud(db, target(), NOW);
    expect(to("api.twilio.com")).toHaveLength(1);
    const again = await dispatchApprovalAlert({ sql: c.env.sql, tenantId: t.id, now: NOW, out: c.env.outbound, providers: c.env.alerts, retryDelayMs: 0, origin: ORIGIN },
      { invoice_id: id, amount: "1309.00", currency: "EUR", due_date: "2026-11-23" });
    expect(again).toEqual([{ channel: "whatsapp", target: "+31*******78", status: "duplicate", attempts: 0 }]);
    expect(to("api.twilio.com")).toHaveLength(1);
  });

  it("retries a failure that may pass (503, 429, no answer) up to three times, and not one that will not (400)", async () => {
    await add("whatsapp", PHONE);
    await add("email", EMAIL);
    script["api.twilio.com"] = [503, 429];
    script["mail"] = [400];
    await fileForCfo();
    expect(to("api.twilio.com")).toHaveLength(3);
    expect(mails).toHaveLength(1);
    const d = (await c.req("GET", "/v1/alerts", { key: t.session })).json.deliveries as { channel: string; status: string; attempts: number; http_status: number }[];
    expect(d.find((x) => x.channel === "whatsapp")).toMatchObject({ status: "sent", attempts: 3, http_status: 201 });
    expect(d.find((x) => x.channel === "email")).toMatchObject({ status: "failed", attempts: 1, http_status: 400 });
  });

  it("caps deliveries per company per hour", async () => {
    await add("slack", SLACK);
    const { withinRate } = await import("../cloud/src/auth.js");
    for (let i = 0; i < ALERTS_PER_HOUR; i++) await withinRate(c.env.sql, `alerts:${t.id}`, NOW, { windowSec: 3600, max: ALERTS_PER_HOUR });
    await fileForCfo();
    expect(to("hooks.slack.com")).toHaveLength(0);
    const d = (await c.req("GET", "/v1/alerts", { key: t.session })).json.deliveries as { status: string }[];
    expect(d.map((x) => x.status)).toEqual(["capped"]);
  });

  it("records no_provider for WhatsApp or e-mail when the cloud has no Twilio or e-mail provider", async () => {
    c.env.alerts = {};
    await add("whatsapp", PHONE);
    await add("email", EMAIL);
    await fileForCfo();
    expect(sent).toHaveLength(0);
    const s = (await c.req("GET", "/v1/alerts", { key: t.session })).json as { channels: Record<string, boolean>; deliveries: { status: string }[] };
    expect(s.channels.whatsapp).toBe(false);
    expect(s.deliveries.map((x) => x.status)).toEqual(["no_provider", "no_provider"]);
  });
});

describe("alert targets", () => {
  it("are refused when they do not fit their channel", async () => {
    for (const [ch, v] of [["whatsapp", "0612345678"], ["whatsapp", "+31 6 12"], ["email", "not-an-address"], ["slack", "https://evil.example/services/x"], ["slack", "http://hooks.slack.com/services/x"],
      ["teams", "https://hooks.slack.com/services/x"], ["teams", "https://10.0.0.1/hook"]] as const) {
      const r = await add(ch, v);
      expect(r.status, `${ch} ${v}`).toBe(400);
    }
    expect(cleanTarget("whatsapp", "whatsapp:+31 (6) 1234-5678")).toBe(PHONE);
    expect((await add("whatsapp", PHONE)).json).toMatchObject({ channel: "whatsapp", target: "+31*******78" });
    expect((await add("whatsapp", PHONE)).status).toBe(409);
  });

  it("are removed by a signed-in owner, and the removal is recorded", async () => {
    const a = await add("email", EMAIL);
    expect((await c.req("DELETE", `/v1/alerts/targets/${a.json.id as string}`, { key: t.session })).status).toBe(200);
    expect((await c.req("DELETE", `/v1/alerts/targets/${a.json.id as string}`, { key: t.session })).status).toBe(404);
    const kinds = ((await c.req("GET", "/v1/security/events", { key: t.session })).json.items as { kind: string }[]).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["alert.target_added", "alert.target_removed"]));
  });

  it("stay out of the company's export (a webhook URL is a credential)", async () => {
    await add("slack", SLACK);
    const ex = JSON.stringify((await c.req("GET", "/v1/export", { key: t.key })).json);
    expect(ex).not.toContain("/services/T000");
    expect(ex).toContain("alert_targets");
  });
});

describe("each notifier against its stand-in", () => {
  const alert: ApprovalAlert = { key: "k1", invoice_id: "AP-0005", proposal_id: "P-0009", amount: "1309.00", currency: "EUR", payee: "Bergtex *Textil* <GmbH>\nline two", why: "The checks found nothing irregular.", due_date: "2026-11-23", link: `${ORIGIN}/#/invoices/AP-0005`, test_money: true };
  const record = (status: number, json: unknown = {}) => {
    const calls: Sent[] = [];
    const out = async (url: string, init: RequestInit) => { calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response(JSON.stringify(json), { status }); };
    return { calls, out };
  };

  it("Twilio WhatsApp: the message SID on 201; a 401 is final", async () => {
    const ok = record(201, { sid: SID });
    expect(await twilioWhatsApp(TWILIO, ok.out).send(PHONE, alert, "id1")).toEqual<SendResult>({ ok: true, status: 201, retryable: false, providerRef: SID });
    const no = record(401, { code: 20003 });
    expect(await twilioWhatsApp(TWILIO, no.out).send(PHONE, alert, "id1")).toEqual<SendResult>({ ok: false, status: 401, retryable: false });
    const down = { out: async () => { throw new Error("offline"); } };
    expect((await twilioWhatsApp(TWILIO, down.out).send(PHONE, alert, "id1")).retryable).toBe(true);
  });

  it("e-mail (Resend's API): bearer key, the idempotency key in its header", async () => {
    const r = record(200, { id: "re_123" });
    const res = await emailNotifier(resendEmail({ apiKey: "re_test_not_a_secret", from: "Purser <alerts@example.com>" }, r.out)).send(EMAIL, alert, "ad_same");
    expect(res).toEqual({ ok: true, status: 200, retryable: false, providerRef: "re_123" });
    expect(r.calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(r.calls[0]!.headers["idempotency-key"]).toBe("ad_same");
    expect(JSON.parse(r.calls[0]!.body)).toMatchObject({ to: [EMAIL], subject: expect.stringContaining("[TEST MONEY]") });
  });

  it("Slack and Teams: the chat formats, with the payee made plain (no markup, one line)", async () => {
    for (const ch of ["slack", "teams"] as const) {
      const r = record(200);
      expect((await chatNotifier(ch, r.out).send(ch === "slack" ? SLACK : TEAMS, alert, "x")).ok).toBe(true);
      expect(r.calls[0]!.body).toBe(JSON.stringify(chatMessage(alertEvent(alert), ch)));
      expect(r.calls[0]!.body).toContain("Bergtex Textil GmbH line two");
    }
    expect(alertText(alert).split("\n")).toHaveLength(5);
  });

  it("the signed webhook: through monitor.ts, not retried here", async () => {
    const r = record(500);
    const n = webhookNotifier(c.env.sql, t.id, { invoice_id: "AP-0005" }, NOW, r.out, 0);
    expect(await n.send("", alert, "x")).toEqual({ ok: false, status: 0, retryable: false });
    expect(r.calls).toHaveLength(0); // no webhook set for this company: nothing is sent
  });

  it("masks every kind of target", () => {
    expect(maskTarget("whatsapp", PHONE)).toBe("+31*******78");
    expect(maskTarget("email", EMAIL)).toBe("c***@example.com");
    expect(maskTarget("slack", SLACK)).toBe("hooks.slack.com (webhook)");
    expect(maskTarget("webhook", "")).toBe("the signed webhook");
  });
});
