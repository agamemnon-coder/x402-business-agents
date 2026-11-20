// Approval alerts (cloud/src/alerts.ts), the edges test/cloud-alerts.test.ts leaves: the words of an alert with live
// money and no due date, each target masked even when it is short or malformed, targets that do not fit their channel,
// the providers' answers (Twilio and Resend: no answer, a 5xx, a body that is not JSON, an id kept or not), a chat
// target Purser never calls (a metadata host) not called, and Twilio's sender with or without its prefix.
import { describe, expect, it } from "vitest";
import { alertEvent, alertSubject, alertText, chatNotifier, cleanTarget, maskTarget, resendEmail, twilioWhatsApp, type ApprovalAlert } from "../cloud/src/alerts.js";

const alert = (o: Partial<ApprovalAlert> = {}): ApprovalAlert => ({ key: "k1", invoice_id: "AP-1", proposal_id: null, amount: "1850.00", currency: "EUR", payee: "Bergtex Textil GmbH", why: "above the limit", due_date: "", link: "https://cloud.test/#/invoices/AP-1", test_money: false, ...o });
const answer = (status: number, body: string) => async () => new Response(body, { status });

describe("an alert's words", () => {
  it("with live money there is no [TEST MONEY]; without a due date none is said", () => {
    const a = alert();
    expect(alertText(a)).not.toContain("[TEST MONEY]");
    expect(alertText(a)).toContain("EUR 1850.00 to Bergtex Textil GmbH (invoice AP-1).");
    expect(alertSubject(a)).toBe("Waiting for your Face ID: EUR 1850.00 to Bergtex Textil GmbH");
    expect(alertText(alert({ test_money: true, due_date: "2026-11-30" }))).toMatch(/^\[TEST MONEY\] Purser[\s\S]*, due 2026-11-30\)\./);
    expect(JSON.stringify(alertEvent(a))).not.toContain("test_money");
    expect(JSON.stringify(alertEvent(alert({ test_money: true })))).toContain('"test_money":"yes"');
  });
});

describe("targets", () => {
  it("are masked even when short or malformed", () => {
    expect(maskTarget("whatsapp", "+31612345678")).toBe("+31*******78");
    expect(maskTarget("whatsapp", "+123")).toBe("***");
    expect(maskTarget("email", "cfo@example.com")).toBe("c***@example.com");
    expect(maskTarget("email", "@example.com")).toBe("***");
    expect(maskTarget("slack", "https://hooks.slack.com/services/T/B/x")).toBe("hooks.slack.com (webhook)");
    expect(maskTarget("teams", "not a url")).toBe("***");
    expect(maskTarget("webhook", "")).toBe("the signed webhook");
  });
  it("that do not fit their channel are refused with what would fit", () => {
    expect(cleanTarget("whatsapp", " whatsapp:+31 (6) 1234-5678 ")).toBe("+31612345678");
    expect(() => cleanTarget("whatsapp", "0612345678")).toThrow(/international form/);
    expect(cleanTarget("email", "CFO@Example.com")).toBe("cfo@example.com");
    expect(() => cleanTarget("email", "not an address")).toThrow(/an e-mail address/);
    expect(() => cleanTarget("slack", "https://example.com/hook")).toThrow(/Slack incoming webhook/);
    expect(() => cleanTarget("teams", "https://hooks.slack.com/services/T/B/x")).toThrow(/Microsoft Teams webhook/);
    expect(() => cleanTarget("slack", "nothing like a url")).toThrow();
  });
});

describe("the providers' answers", () => {
  const cfg = { accountSid: "AC123", authToken: "tok", whatsappFrom: "+14155238886" };
  it("Twilio: the sender gets its whatsapp: prefix once; its SID is kept only in Twilio's form", async () => {
    const seen: string[] = [];
    const ok = await twilioWhatsApp(cfg, async (_u, init) => { seen.push(String(init.body)); return new Response(JSON.stringify({ sid: `SM${"a".repeat(32)}` }), { status: 201 }); }).send("+31612345678", alert(), "k");
    expect(ok).toEqual({ ok: true, status: 201, retryable: false, providerRef: `SM${"a".repeat(32)}` });
    expect(new URLSearchParams(seen[0]).get("From")).toBe("whatsapp:+14155238886");
    const prefixed = await twilioWhatsApp({ ...cfg, whatsappFrom: "whatsapp:+1415" }, async (_u, init) => { seen.push(String(init.body)); return new Response(JSON.stringify({ sid: "odd" }), { status: 200 }); }).send("+31612345678", alert(), "k");
    expect(prefixed).toEqual({ ok: true, status: 200, retryable: false });
    expect(new URLSearchParams(seen[1]).get("From")).toBe("whatsapp:+1415");
  });
  it("Twilio and Resend: no answer and a 5xx may be retried, a 4xx not; a body that is not JSON is no id", async () => {
    const throwing = async () => { throw new Error("socket"); };
    expect(await twilioWhatsApp(cfg, throwing).send("+3161", alert(), "k")).toEqual({ ok: false, status: 0, retryable: true });
    expect(await twilioWhatsApp(cfg, answer(503, "down")).send("+3161", alert(), "k")).toEqual({ ok: false, status: 503, retryable: true });
    const email = (out: Parameters<typeof resendEmail>[1]) => resendEmail({ apiKey: "re_x", from: "alerts@cloud.test" }, out);
    expect(await email(answer(422, "{}")).send({ to: "a@b.c", subject: "s", text: "t", idempotencyKey: "k" })).toEqual({ ok: false, status: 422, retryable: false });
    expect(await email(answer(429, "slow down")).send({ to: "a@b.c", subject: "s", text: "t", idempotencyKey: "k" })).toEqual({ ok: false, status: 429, retryable: true });
    expect(await email(answer(200, "not json")).send({ to: "a@b.c", subject: "s", text: "t", idempotencyKey: "k" })).toEqual({ ok: true, status: 200, retryable: false });
    expect(await email(answer(200, JSON.stringify({ id: "x".repeat(100) }))).send({ to: "a@b.c", subject: "s", text: "t", idempotencyKey: "k" })).toEqual({ ok: true, status: 200, retryable: false, providerRef: "x".repeat(80) });
  });
  it("a chat target Purser never calls (a cloud metadata host) is not called", async () => {
    let called = 0;
    const r = await chatNotifier("slack", async () => { called++; return new Response("ok"); }).send("https://metadata.google.internal/computeMetadata/v1/", alert(), "k");
    expect(r).toEqual({ ok: false, status: 0, retryable: false });
    expect(called).toBe(0);
    expect(await chatNotifier("teams", answer(500, "")).send("https://prod.westeurope.logic.azure.com/workflows/x", alert(), "k")).toMatchObject({ ok: false, status: 500, retryable: true });
  });
});
