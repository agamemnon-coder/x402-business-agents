// Approval notifications from the runner (src/integrations/approvalNotify.ts): when a payment or a policy change waits for
// the CFO, Purser can post to a Slack or Microsoft Teams incoming webhook saying what waits (payee, amount, why) with one
// deep link to the passkey approval page. Nothing in it approves: no button that acts, only the link. Breaks if a host
// other than Slack's or Teams' is accepted, if a payee's name can inject markup, a link or an @channel, if a long field
// is not cut, if more than an account's last four characters leave, if a webhook URL reaches a log or the audit trail,
// if a failure blocks the runner or is retried more than once, or if a proposal is announced twice.
import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { audit } from "../src/audit/log.js";
import { createProposal, nextProposalId } from "../src/policy/approvals.js";
import { proposePolicyChange } from "../src/executors/policyChange.js";
import { setSystemDefaultAloneLimit } from "../src/policy/aloneLimit.js";
import {
  ApprovalNotifier, approvalNotifierFromEnv, checkWebhook, inert, NOTIFY_ENV, noticeFor, notifyTargetsFromEnv, postNotice, slackPayload, teamsPayload,
  type NotifyTarget, type WaitingNotice,
} from "../src/integrations/approvalNotify.js";
import { RelayRunner } from "../src/relay/runner.js";

// Test values, too short to be real webhooks; not credentials.
const SLACK = "https://hooks.slack.com/services/T000/B000/notareal0secret";
const TEAMS = "https://acme.webhook.office.com/webhookb2/notareal1secret";
const RELAY = "https://kit11.example.workers.dev";
const NOW = new Date("2026-11-26T10:00:00Z");
const EVIL = "<!channel> *x* <https://evil|click>";
const TARGETS: NotifyTarget[] = [{ channel: "slack", url: SLACK }, { channel: "teams", url: TEAMS }];

/** Every string in a payload, keys too. */
const strings = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : [];

function payment(db: DB, o: { payee?: string; amount?: string; kind?: string; extra?: Record<string, unknown> } = {}): string {
  const id = nextProposalId(db);
  const payee = o.payee ?? "Bergtex Textil GmbH";
  const terms = {
    schema: TERMS_SCHEMA, kind: o.kind ?? "supplier_payment", proposal_id: id, expires_at: "2026-12-20T11:00:00Z", amount: o.amount ?? "1309.00", currency: "EUR",
    vendor: payee, beneficiary_name: payee, beneficiary_id: "ben_1", account: "NL91 ABNA •••• 4300", invoice_no: "INV-2026-117", test_money: true, ...o.extra,
  } as Terms;
  createProposal(db, { terms, createdBy: "treasury" }, NOW);
  return id;
}
const link = (id: string) => `${RELAY}/approve/${encodeURIComponent(id)}`;

/** A fetch that answers each call with the next status (or throws for 0), recording the calls. */
function fakeFetch(statuses: number[]) {
  const calls: { url: string; body: string }[] = [];
  const f = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: String(init.body) });
    const s = statuses.shift() ?? 200;
    if (s === 0) throw new Error(`connect ECONNREFUSED to ${url}`);
    return new Response("ok", { status: s });
  };
  return { calls, fetch: f };
}

describe("the webhooks", () => {
  it("come from the environment only; off when unset", () => {
    expect(NOTIFY_ENV).toEqual({ slack: "PURSER_NOTIFY_SLACK_WEBHOOK", teams: "PURSER_NOTIFY_TEAMS_WEBHOOK" });
    expect(notifyTargetsFromEnv({})).toEqual({ targets: [], refused: [] });
    expect(notifyTargetsFromEnv({ [NOTIFY_ENV.slack]: SLACK, [NOTIFY_ENV.teams]: TEAMS }).targets).toEqual(TARGETS);
    expect(approvalNotifierFromEnv({}, { fetch: fakeFetch([]).fetch, link, log: () => undefined })).toBeNull();
  });

  it("allow Slack's hooks.slack.com and Teams' *.webhook.office.com or Power Automate's host; refuse anything else, without repeating it", () => {
    expect(checkWebhook("slack", SLACK)).toEqual({ ok: true, url: SLACK });
    expect(checkWebhook("teams", TEAMS)).toEqual({ ok: true, url: TEAMS });
    expect(checkWebhook("teams", "https://prod-27.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x")).toMatchObject({ ok: true });
    expect(checkWebhook("teams", "https://default1234.ab.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc")).toMatchObject({ ok: true });
    const refused = [
      ["slack", "http://hooks.slack.com/services/T/B/X"], ["slack", "https://hooks.slack.com.evil.example/services/T/B/X"], ["slack", "https://evil.example/hooks.slack.com"],
      ["slack", "https://user:pw@hooks.slack.com/services/T/B/X"], ["slack", "https://hooks.slack.com:8443/services/T/B/X"], ["slack", TEAMS], ["teams", SLACK],
      ["teams", "https://webhook.office.com.evil.example/x"], ["teams", "https://evilwebhook.office.com/x"], ["teams", "https://outlook.office.com/webhook/x"], ["slack", "not a url"],
    ] as const;
    for (const [channel, url] of refused) {
      const r = checkWebhook(channel, url);
      expect(r, `${channel} ${url}`).toMatchObject({ ok: false });
      expect(JSON.stringify(r)).not.toContain(url);
    }
    const env = notifyTargetsFromEnv({ [NOTIFY_ENV.slack]: "https://evil.example/hook-secret-value", [NOTIFY_ENV.teams]: TEAMS });
    expect(env.targets).toEqual([{ channel: "teams", url: TEAMS }]);
    expect(env.refused).toEqual([expect.stringMatching(/^PURSER_NOTIFY_SLACK_WEBHOOK is not a Slack incoming webhook/)]);
    expect(env.refused.join(" ")).not.toContain("hook-secret-value");
  });
});

describe("the message", () => {
  it("says what waits (payee, amount, why), the account's last four only, and one deep link to the passkey page", () => {
    const db = openDb(":memory:");
    setSystemDefaultAloneLimit(db, "500.00", NOW);
    const id = payment(db);
    const n = noticeFor(db, id, link(id))!;
    expect(n).toMatchObject({ kind: "payment", proposal_id: id, test_money: true, link: `${RELAY}/approve/${id}` });
    expect(n.headline).toBe(`[TEST MONEY] Payment ${id} waits for the CFO's passkey: EUR 1,309.00 to Bergtex Textil GmbH`);
    expect(n.lines).toEqual(["Payee: Bergtex Textil GmbH", "Amount: EUR 1,309.00", "Account: ending 4300", "Invoice: INV-2026-117", "Why: EUR 1309.00 is above the EUR 500.00 the agents may pay alone"]);
    for (const m of [JSON.stringify(slackPayload(n)), JSON.stringify(teamsPayload(n))]) {
      expect(m).toContain("Bergtex Textil GmbH");
      expect(m).toContain("EUR 1,309.00");
      expect(m).toContain(`${RELAY}/approve/${id}`);
      expect(m).toContain("This message cannot approve anything");
      expect(m).not.toMatch(/NL91|ABNA/);
    }
  });

  it("names why from the record: an agent that declined to pay alone, four eyes, no limit", () => {
    const db = openDb(":memory:");
    const plain = payment(db);
    expect(noticeFor(db, plain, link(plain))!.lines.at(-1)).toBe("Why: no limit to pay alone is signed, so the CFO signs every payment");
    const declined = payment(db);
    audit(db, "treasury", "ap.alone_declined", "AP-0001", { invoice_id: "AP-0001", proposal_id: declined, by: "checker", why: "the Checker agent's decision, as code enforced it, is hold, not pay" }, NOW);
    expect(noticeFor(db, declined, link(declined))!.lines.at(-1)).toBe("Why: the Checker agent's decision, as code enforced it, is hold, not pay");
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('approval.four_eyes_eur', '1000.00', ?)").run(NOW.toISOString());
    const big = payment(db);
    expect(noticeFor(db, big, link(big))!.lines.at(-1)).toBe("Why: above the four-eyes threshold: two people sign it");
  });

  it("a policy change: each change, the reason and the simulator's line", () => {
    const db = openDb(":memory:");
    const p = proposePolicyChange(db, { changes: [{ key: "approval.four_eyes_eur", to: "2500.00" }], reason: "two people above 2,500" }, "human", NOW);
    const n = noticeFor(db, p.proposal_id, link(p.proposal_id), NOW)!;
    expect(n.kind).toBe("policy");
    expect(n.headline).toBe(`Policy change ${p.proposal_id} waits for the CFO's passkey`);
    expect(n.lines).toEqual([
      "Payments above this need two people (four eyes): off → 2500.00",
      "Reason: two people above 2,500",
      "If this had been in force since 2026-10-27: there were no supplier payments to replay.",
    ]);
  });

  it("anything else: its title only, no terms (a new supplier's full IBAN never leaves)", () => {
    const db = openDb(":memory:");
    const id = nextProposalId(db);
    createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "payee_add", proposal_id: id, expires_at: "2026-12-20T11:00:00Z", vendor: "Neu GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX" } as Terms, createdBy: "treasury" }, NOW);
    const n = noticeFor(db, id, link(id))!;
    expect(n).toMatchObject({ kind: "other", headline: `New supplier ${id} waits for the CFO's passkey`, lines: [] });
    expect(JSON.stringify([slackPayload(n), teamsPayload(n)])).not.toMatch(/DE89|370400|COBADEFF/);
    expect(noticeFor(db, "P-9999", link("P-9999"))).toBeNull();
  });

  it(`renders a payee named ${EVIL} inert: no mention, no link, no markup`, () => {
    // The link's target is gone; its label stays as plain words.
    expect(inert(EVIL)).toBe("channel x (link removed) click");
    expect(inert("pay @here and @channel now")).toBe("pay ＠here and ＠channel now");
    expect(inert("Acme <@U123> & [click](https://evil.example) evil.example/x\u202eRTL\nsecond line")).toBe("Acme ＠U123 & click (link removed) (link removed) RTL second line");
    const db = openDb(":memory:");
    const id = payment(db, { payee: EVIL });
    const n = noticeFor(db, id, link(id))!;
    for (const payload of [slackPayload(n), teamsPayload(n)]) {
      const all = strings(payload).join("\n");
      // Our own link to the passkey page aside (Slack's <url|label>), nothing in it opens a link or names anyone.
      expect(all.split(`<${link(id)}|`).join("")).not.toMatch(/<!|<@|<https?:|https?:\/\/evil|\*x\*|\|click|@channel|@here/);
      // The only link is the passkey page.
      expect([...all.matchAll(/https?:\/\/[^\s|>"]+/g)].map((m) => m[0])).toEqual(expect.arrayContaining([link(id)]));
      expect([...new Set([...all.matchAll(/https?:\/\/[^\s|>"]+/g)].map((m) => m[0]))].filter((u) => u !== link(id) && !u.startsWith("http://adaptivecards.io/"))).toEqual([]);
    }
    // Slack: the payee's words only in plain_text, where Slack parses no markup or mention.
    const slack = slackPayload(n) as { text: string; blocks: { type: string; text?: { type: string; text: string } }[] };
    for (const b of slack.blocks) if (b.text && b.text.text.includes("channel x")) expect(b.text.type).toBe("plain_text");
    expect(slack.text).not.toMatch(/[<>]/);
  });

  it("cuts long fields", () => {
    const db = openDb(":memory:");
    const id = payment(db, { payee: "Very Long Supplier Name ".repeat(40) });
    const n = noticeFor(db, id, link(id))!;
    const payee = n.lines[0]!.slice("Payee: ".length);
    expect(payee.length).toBeLessThanOrEqual(80);
    expect(payee.endsWith("…")).toBe(true);
    expect(inert("x".repeat(500), 200)).toHaveLength(200);
  });

  it("cannot approve: no Slack button or action, a Teams card whose only action opens the passkey page", () => {
    const db = openDb(":memory:");
    const id = payment(db);
    const n = noticeFor(db, id, link(id))!;
    const s = strings(slackPayload(n));
    expect(s.filter((x) => /^(actions|button|action_id|callback_id|response_url|interactive|value)$/.test(x))).toEqual([]);
    const card = (teamsPayload(n) as { attachments: { content: { actions: unknown[] } }[] }).attachments[0]!.content;
    expect(card.actions).toEqual([{ type: "Action.OpenUrl", title: "Open the passkey approval page", url: link(id) }]);
    expect(strings(teamsPayload(n)).filter((x) => /^Action\.(Submit|Execute|Http|ShowCard|ToggleVisibility)$/.test(x))).toEqual([]);
    expect(() => slackPayload({ ...n, link: "http://kit11.example.workers.dev/approve/P-0001" })).toThrow(/https/);
    expect(() => slackPayload({ ...n, link: `${RELAY}/approve/P-0001#view=abc` })).toThrow(/key/);
  });
});

describe("posting", () => {
  const notice: WaitingNotice = { kind: "payment", proposal_id: "P-0001", headline: "Payment P-0001 waits for the CFO's passkey", lines: ["Payee: X"], link: link("P-0001"), test_money: true };

  it("posts once per channel; a failure is retried once, never more; results name the channel, never the URL", async () => {
    const ok = fakeFetch([200, 200]);
    expect(await postNotice(notice, TARGETS, { fetch: ok.fetch, retryDelayMs: 0 })).toEqual([{ channel: "slack", ok: true, status: 200, attempts: 1 }, { channel: "teams", ok: true, status: 200, attempts: 1 }]);
    expect(ok.calls.map((c) => c.url)).toEqual([SLACK, TEAMS]);
    const flaky = fakeFetch([500, 200, 0, 0]);
    const r = await postNotice(notice, TARGETS, { fetch: flaky.fetch, retryDelayMs: 0 });
    expect(r).toEqual([{ channel: "slack", ok: true, status: 200, attempts: 2 }, { channel: "teams", ok: false, status: 0, attempts: 2 }]);
    expect(flaky.calls).toHaveLength(4);
    expect(JSON.stringify(r)).not.toMatch(/hooks\.slack|webhook\.office|secret/);
  });
});

describe("in the runner", () => {
  /** A relay that accepts every sync. */
  const relayFetch = (async () => new Response(JSON.stringify({ need_state: false, inbox: [], hooks: [] }), { status: 200 })) as unknown as typeof fetch;

  function setup(statuses: number[]) {
    const db = openDb(":memory:");
    const hooks = fakeFetch(statuses);
    const log: string[] = [];
    const notifier = new ApprovalNotifier({ targets: TARGETS, fetch: hooks.fetch, link, log: (l) => log.push(l), retryDelayMs: 0 });
    const runner = new RelayRunner({ db, cfg: { url: RELAY, origin: RELAY, rpId: "kit11.example.workers.dev", token: "t".repeat(64) }, now: () => NOW, fetch: relayFetch, execute: async () => undefined, log: (l) => log.push(l), notify: notifier });
    return { db, hooks, log, runner };
  }
  const secretFree = (db: DB, log: string[]) => {
    const audit = (db.prepare("SELECT event, payload_json FROM audit_log").all() as { event: string; payload_json: string }[]).map((r) => `${r.event} ${r.payload_json}`).join("\n");
    for (const text of [audit, log.join("\n")]) expect(text).not.toMatch(/hooks\.slack\.com|webhook\.office\.com|notareal\dsecret|T000\/B000/);
  };

  it("announces a proposal that waits for the CFO once, after it is recorded, and records that it did (no URL)", async () => {
    const { db, hooks, log, runner } = setup([]);
    const id = payment(db);
    await runner.syncOnce();
    await runner.idle();
    await runner.syncOnce();
    await runner.idle();
    expect(hooks.calls.map((c) => c.url)).toEqual([SLACK, TEAMS]);
    expect(JSON.parse(hooks.calls[0]!.body).text).toContain(`Payment ${id} waits`);
    const rows = db.prepare("SELECT event, subject, payload_json FROM audit_log WHERE event LIKE 'notify.%'").all() as { event: string; subject: string; payload_json: string }[];
    expect(rows.map((r) => [r.event, r.subject, JSON.parse(r.payload_json)])).toEqual([
      ["notify.sent", id, { channel: "slack", status: 200, attempts: 1 }], ["notify.sent", id, { channel: "teams", status: 200, attempts: 1 }],
    ]);
    expect(log.filter((l) => l.startsWith("notify"))).toEqual([`notify   slack ${id} sent`, `notify   teams ${id} sent`]);
    secretFree(db, log);
    // A runner started again on the same ledger does not announce it twice.
    const again = new ApprovalNotifier({ targets: TARGETS, fetch: hooks.fetch, link, log: () => undefined, retryDelayMs: 0 });
    await again.announce(db, [id], NOW);
    expect(hooks.calls).toHaveLength(2);
  });

  it("a failure is logged as notify.failed, retried once, and never blocks the sync or the proposal", async () => {
    const { db, hooks, log, runner } = setup([500, 500, 0, 0]);
    const id = payment(db);
    await expect(runner.syncOnce()).resolves.toMatchObject({ pushed: true });
    await runner.idle();
    expect(hooks.calls).toHaveLength(4);
    expect(log.filter((l) => l.startsWith("notify.failed"))).toEqual([
      `notify.failed slack ${id}: HTTP 500 after 2 attempts; it still waits for the passkey`,
      `notify.failed teams ${id}: no answer after 2 attempts; it still waits for the passkey`,
    ]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'notify.failed' AND subject = ?").get(id) as { n: number }).n).toBe(2);
    expect((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status).toBe("PENDING_APPROVAL");
    // Not tried again on the next sync: at most one retry.
    await runner.syncOnce();
    await runner.idle();
    expect(hooks.calls).toHaveLength(4);
    secretFree(db, log);
  });

  it("a fetch that never settles does not hold up a sync", async () => {
    const db = openDb(":memory:");
    payment(db);
    const notifier = new ApprovalNotifier({ targets: TARGETS, fetch: () => new Promise<Response>(() => undefined), link, log: () => undefined, retryDelayMs: 0 });
    const runner = new RelayRunner({ db, cfg: { url: RELAY, origin: RELAY, rpId: "kit11.example.workers.dev", token: "t".repeat(64) }, now: () => NOW, fetch: relayFetch, execute: async () => undefined, log: () => undefined, notify: notifier });
    await expect(runner.syncOnce()).resolves.toMatchObject({ pushed: true });
  });
});
