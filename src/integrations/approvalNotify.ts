// Approval notifications from the runner to Slack or Microsoft Teams (governance, 26 Nov): when a payment or a policy
// change waits for the CFO, the runner posts to an incoming webhook what waits (the payee, the amount, why) with one deep
// link to the passkey approval page on the relay (/approve/<id>). Face ID stays the only way to approve: a message has
// no button that acts, no reply word, no code or token; its one link opens the page where the CFO signs the exact terms.
//
// - Config from the environment only: PURSER_NOTIFY_SLACK_WEBHOOK, PURSER_NOTIFY_TEAMS_WEBHOOK; off when unset. A
//   webhook URL is a credential: it is never logged, never written to the audit trail and never in a result or an error.
// - Hosts allowed: Slack's hooks.slack.com; Teams' *.webhook.office.com or a Power Automate workflow's host
//   (*.logic.azure.com, *.environment.api.powerplatform.com). Any other URL is refused and that channel stays off.
// - Words from outside Purser (a payee's name, an invoice number, a reason) are made inert: links removed, markup and
//   mention characters removed, one line, cut to length; in Slack they sit in plain_text, which Slack never parses. An
//   account is shown by its last four characters only.
// - Posted once the proposal is recorded and the relay holds it (src/relay/runner.ts, after a sync), once per proposal
//   (notify.sent / notify.failed in the audit trail, which a restarted runner reads), retried at most once. A failure is
//   logged as notify.failed and blocks nothing: the payment keeps waiting for the passkey as before.
// Purser Cloud's own per-company alerts (cloud/src/alerts.ts) and the polling script for a Cloud deployment
// (scripts/approval-chat.ts, src/integrations/approvalChat.ts) follow the same rule; this is the runner's own.

import { audit } from "../audit/log.js";
import { kindTitle } from "../dashboard/snapshot.js";
import type { DB } from "../db/open.js";
import { aloneLimitInForce } from "../policy/aloneLimit.js";
import { fourEyes } from "../policy/fourEyes.js";
import { simulationLine } from "../policy/simulate.js";
import { aloneDecision } from "../policy/withinLimit.js";

export const NOTIFY_ENV = { slack: "PURSER_NOTIFY_SLACK_WEBHOOK", teams: "PURSER_NOTIFY_TEAMS_WEBHOOK" } as const;
export type NotifyChannel = keyof typeof NOTIFY_ENV;
export interface NotifyTarget { channel: NotifyChannel; url: string }
export interface NotifyResult { channel: NotifyChannel; ok: boolean; status: number; attempts: number }
export type NotifyFetch = (url: string, init: RequestInit) => Promise<Response>;

export const NOTIFY_SENT = "notify.sent";
export const NOTIFY_FAILED = "notify.failed";
export const CANNOT_APPROVE = "This message cannot approve anything. Only the CFO's passkey (Face ID), on the approval page, can.";

const TEAMS_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(webhook\.office\.com|logic\.azure\.com|environment\.api\.powerplatform\.com)$/;
const SLACK_PATH = /^\/(services|workflows|triggers)\//;

/** Whether a webhook URL is one this channel may post to; the refusal never repeats the URL (a credential). */
export function checkWebhook(channel: NotifyChannel, raw: string): { ok: true; url: string } | { ok: false; why: string } {
  const what = channel === "slack" ? "a Slack incoming webhook (https://hooks.slack.com/services/...)" : "a Microsoft Teams webhook (https://<tenant>.webhook.office.com/... or a Power Automate workflow's URL)";
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, why: `not ${what}` }; }
  const host = u.hostname.toLowerCase();
  const fine = u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") &&
    (channel === "slack" ? host === "hooks.slack.com" && SLACK_PATH.test(u.pathname) : TEAMS_HOST.test(host));
  return fine ? { ok: true, url: u.toString() } : { ok: false, why: `not ${what}` };
}

/** The channels the environment configures, and why any configured one is refused (naming the variable, never its value). */
export function notifyTargetsFromEnv(env: Record<string, string | undefined> = process.env): { targets: NotifyTarget[]; refused: string[] } {
  const targets: NotifyTarget[] = [];
  const refused: string[] = [];
  for (const channel of Object.keys(NOTIFY_ENV) as NotifyChannel[]) {
    const raw = env[NOTIFY_ENV[channel]]?.trim();
    if (!raw) continue;
    const c = checkWebhook(channel, raw);
    if (c.ok) targets.push({ channel, url: c.url });
    else refused.push(`${NOTIFY_ENV[channel]} is ${c.why}; that channel stays off`);
  }
  return { targets, refused };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Words from outside Purser as they go into a chat message: one line, no control or direction characters, no link (a
 * URL, a domain, an e-mail address, a markdown link), no markup a chat app acts on (< > * _ ~ ` | [ ] ! \), no mention
 * (@ becomes a full-width ＠), at most `max` characters.
 */
export function inert(raw: unknown, max = 80): string {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1 (link removed)")
    .replace(/\b(?:https?|ftp|mailto|slack|tel):\/*[^\s<>|)\]]+/gi, "(link removed)")
    .replace(/\bwww\.[^\s<>|)\]]+/gi, "(link removed)")
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "(link removed)")
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b(?:\/[^\s<>|)\]]*)?/gi, "(link removed)")
    .replace(/[<>*_~`|[\]!\\]/g, " ")
    .replace(/@/g, "＠")
    .replace(/\s+/g, " ")
    .trim();
  return clip(s, max);
}

/** 1309.00 → 1,309.00, from the string (no float); anything else made inert. */
function grouped(amount: unknown): string {
  const m = /^(\d+)(\.\d{2})$/.exec(String(amount ?? ""));
  return m ? `${m[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[2]}` : inert(amount, 24);
}

/** What a notification says: built from the proposal on record; nothing in it can approve. */
export interface WaitingNotice {
  kind: "payment" | "policy" | "other";
  proposal_id: string;
  headline: string;
  /** Short lines: payee, amount, account (last four), invoice, why; or each policy change, its reason, the replay. */
  lines: string[];
  /** The passkey approval page for this proposal: https, no query, no fragment (no viewer key, no token). */
  link: string;
  test_money: boolean;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const PAYMENT_KINDS = new Set(["invoice_payment", "supplier_payment"]);
type T = Record<string, unknown>;

/** Why this payment waits for the CFO, in words from the record and the policy. */
function paymentWhy(db: DB, p: { proposal_id: string; kind: string; terms_json: string }, t: T): string {
  const declined = db.prepare("SELECT json_extract(payload_json, '$.why') AS why FROM audit_log WHERE event = 'ap.alone_declined' AND json_extract(payload_json, '$.proposal_id') = ? ORDER BY seq DESC LIMIT 1")
    .get(p.proposal_id) as { why: string | null } | undefined;
  if (declined?.why) return declined.why;
  try { if (fourEyes(db, p)) return "above the four-eyes threshold: two people sign it"; } catch { /* unreadable terms: the page refuses them */ }
  const limit = aloneLimitInForce(db);
  if (!limit) return "no limit to pay alone is signed, so the CFO signs every payment";
  if (aloneDecision(t.amount, t.currency, limit) !== "within") return `${String(t.currency)} ${String(t.amount)} is above the ${limit.currency} ${limit.amount} the agents may pay alone`;
  return "filed for the CFO's signature";
}

/** The last four letters or digits of an account as the terms show it (already masked there), or null. */
function lastFour(t: T): string | null {
  const raw = typeof t.iban_last4 === "string" ? t.iban_last4 : typeof t.account === "string" ? t.account : "";
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "");
  return alnum.length >= 4 ? alnum.slice(-4) : null;
}

/** The notice for a proposal that waits for the CFO, from the ledger; null when there is none waiting by that id. */
export function noticeFor(db: DB, proposalId: string, link: string, now = new Date()): WaitingNotice | null {
  if (!ID.test(proposalId)) return null;
  const p = db.prepare("SELECT proposal_id, kind, terms_json, status FROM proposals WHERE proposal_id = ?").get(proposalId) as { proposal_id: string; kind: string; terms_json: string; status: string } | undefined;
  if (!p || p.status !== "PENDING_APPROVAL") return null;
  let t: T;
  try { t = JSON.parse(p.terms_json) as T; } catch { t = {}; }
  const test = t.test_money === true;
  const base = { proposal_id: p.proposal_id, link, test_money: test };
  const tag = test ? "[TEST MONEY] " : "";
  if (PAYMENT_KINDS.has(p.kind)) {
    const payee = inert(t.beneficiary_name ?? t.vendor, 80);
    const amount = `${inert(t.currency, 3)} ${grouped(t.amount)}`;
    const four = lastFour(t);
    return {
      ...base, kind: "payment",
      headline: `${tag}Payment ${p.proposal_id} waits for the CFO's passkey: ${amount} to ${payee}`,
      lines: [`Payee: ${payee}`, `Amount: ${amount}`, ...(four ? [`Account: ending ${four}`] : []), ...(t.invoice_no ? [`Invoice: ${inert(t.invoice_no, 60)}`] : []), `Why: ${inert(paymentWhy(db, p, t), 200)}`],
    };
  }
  if (p.kind === "policy_change") {
    const changes = Array.isArray(t.changes) ? (t.changes as T[]) : [];
    const shown = changes.slice(0, 5).map((c) => `${inert(c.label ?? c.key, 80)}: ${inert(c.from, 40) || "off"} → ${inert(c.to, 40) || "off"}`);
    const sim = simulationLine(db, p.terms_json, now);
    return {
      ...base, kind: "policy",
      headline: `${tag}Policy change ${p.proposal_id} waits for the CFO's passkey`,
      lines: [...shown, ...(changes.length > 5 ? [`and ${changes.length - 5} more`] : []), ...(t.reason ? [`Reason: ${inert(t.reason, 200)}`] : []), ...(sim ? [inert(sim, 300)] : [])],
    };
  }
  // Anything else (a new supplier, changed bank details, a batch, a card): its title only. Its terms (a full IBAN among
  // them) stay on the approval page.
  return { ...base, kind: "other", headline: `${tag}${kindTitle(p.kind)} ${p.proposal_id} waits for the CFO's passkey`, lines: [] };
}

function checkedLink(n: WaitingNotice): string {
  const u = new URL(n.link);
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("the approval link must be https, with no credentials in it");
  if (u.search || u.hash) throw new Error("the approval link must carry no viewer key or token: no query, no fragment");
  return u.toString();
}

/** Slack's mrkdwn needs &, < and > escaped; nothing from outside Purser reaches mrkdwn except through inert(). */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Slack (an incoming webhook): the notice in plain_text blocks, the link in our own words; no button, no action. */
export function slackPayload(n: WaitingNotice): Record<string, unknown> {
  const link = checkedLink(n);
  return {
    text: esc([n.headline, ...n.lines, `Review and sign on the passkey approval page: ${link}`, CANNOT_APPROVE].join("\n")),
    unfurl_links: false, unfurl_media: false,
    blocks: [
      { type: "section", text: { type: "plain_text", text: clip(n.headline, 3000), emoji: false } },
      ...(n.lines.length ? [{ type: "section", text: { type: "plain_text", text: clip(n.lines.join("\n"), 3000), emoji: false } }] : []),
      { type: "section", text: { type: "mrkdwn", text: `<${link}|Open the passkey approval page> to review the exact terms and sign them with Face ID.` } },
      { type: "context", elements: [{ type: "plain_text", text: CANNOT_APPROVE, emoji: false }] },
    ],
  };
}

/** Teams (a webhook or Power Automate workflow): an Adaptive Card whose only action opens the passkey approval page. */
export function teamsPayload(n: WaitingNotice): Record<string, unknown> {
  const link = checkedLink(n);
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: n.headline, weight: "Bolder", wrap: true },
        ...n.lines.map((l) => ({ type: "TextBlock", text: l, wrap: true, spacing: "Small" })),
        { type: "TextBlock", text: "Open the passkey approval page to review the exact terms and sign them with Face ID.", wrap: true },
        { type: "TextBlock", text: CANNOT_APPROVE, isSubtle: true, size: "Small", wrap: true },
      ],
      actions: [{ type: "Action.OpenUrl", title: "Open the passkey approval page", url: link }],
    } }],
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Posts the notice to each channel: one try, and at most one retry when it fails. A result names the channel, never the URL. */
export async function postNotice(n: WaitingNotice, targets: NotifyTarget[], o: { fetch: NotifyFetch; retryDelayMs?: number }): Promise<NotifyResult[]> {
  const out: NotifyResult[] = [];
  for (const t of targets) {
    const body = JSON.stringify(t.channel === "slack" ? slackPayload(n) : teamsPayload(n));
    let status = 0, attempts = 0;
    while (attempts < 2) {
      attempts += 1;
      try {
        const res = await o.fetch(t.url, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(10_000) });
        status = res.status;
        if (res.ok) break;
      } catch {
        status = 0;
      }
      if (attempts < 2) await sleep(o.retryDelayMs ?? 2000);
    }
    out.push({ channel: t.channel, ok: status >= 200 && status < 300, status, attempts });
  }
  return out;
}

export interface NotifierOptions {
  targets: NotifyTarget[];
  fetch: NotifyFetch;
  /** The passkey approval page for a proposal (the relay's /approve/<id>). */
  link: (proposalId: string) => string;
  log: (line: string) => void;
  retryDelayMs?: number;
}

/**
 * Announces each proposal that waits for the CFO, once: the runner hands it the waiting proposals after each sync
 * (src/relay/runner.ts). Never throws; every outcome is a log line and a notify.sent or notify.failed audit row with the
 * channel, the HTTP status and the attempts (no URL, no message text).
 */
export class ApprovalNotifier {
  private readonly told = new Set<string>();
  private seeded = false;

  constructor(private readonly o: NotifierOptions) {}

  async announce(db: DB, proposalIds: string[], now = new Date()): Promise<void> {
    try {
      if (!this.seeded) {
        for (const r of db.prepare("SELECT DISTINCT subject FROM audit_log WHERE event IN (?, ?)").all(NOTIFY_SENT, NOTIFY_FAILED) as { subject: string }[]) this.told.add(r.subject);
        this.seeded = true;
      }
      // Claimed before the first await, so a sync that comes while this one posts never announces the same one again.
      const fresh = proposalIds.filter((id) => !this.told.has(id));
      for (const id of fresh) this.told.add(id);
      for (const id of fresh) {
        const notice = noticeFor(db, id, this.o.link(id), now);
        if (!notice) continue;
        for (const r of await postNotice(notice, this.o.targets, { fetch: this.o.fetch, ...(this.o.retryDelayMs !== undefined ? { retryDelayMs: this.o.retryDelayMs } : {}) })) {
          audit(db, "system", r.ok ? NOTIFY_SENT : NOTIFY_FAILED, id, { channel: r.channel, status: r.status, attempts: r.attempts }, now);
          this.o.log(r.ok ? `notify   ${r.channel} ${id} sent`
            : `${NOTIFY_FAILED} ${r.channel} ${id}: ${r.status ? `HTTP ${r.status}` : "no answer"} after ${r.attempts} attempts; it still waits for the passkey`);
        }
      }
    } catch (e) {
      // Words of our own only: an error here could carry a URL, so its message is not repeated.
      this.o.log(`${NOTIFY_FAILED} the notification could not be built or recorded (${(e as Error).name}); nothing waits on it`);
    }
  }
}

/** The runner's notifier from the environment, or null when no channel is configured (or each one is refused). */
export function approvalNotifierFromEnv(env: Record<string, string | undefined>, o: Omit<NotifierOptions, "targets">): ApprovalNotifier | null {
  const { targets, refused } = notifyTargetsFromEnv(env);
  for (const r of refused) o.log(`notify   ${r}`);
  return targets.length ? new ApprovalNotifier({ ...o, targets }) : null;
}
