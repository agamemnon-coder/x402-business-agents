// Slack and Microsoft Teams approval notifications from the environment (19 Nov, integrations; docs/integrations/README.md).
//
// When a payment waits for the CFO, a channel hears: "Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex
// Textil GmbH", with one link: the invoice's page in Purser Cloud, where the CFO signs in with their passkey and signs
// the exact terms. The webhook URLs come from the environment only (PURSER_SLACK_WEBHOOK_URL, PURSER_TEAMS_WEBHOOK_URL;
// a webhook URL is a credential), are never logged and never appear in a result.
//
// A notification only TELLS. It has no button that acts, no reply word, no code, no token and no link but the passkey
// page's; nothing in it can approve (test/approval-chat.test.ts checks both formats for it). Purser Cloud's own per-company
// alerts (Settings, Alerts; cloud/src/alerts.ts) follow the same rule; this module is for a runner or a single
// company's deployment that keeps its webhook in its environment (scripts/approval-chat.ts).

import { cleanTarget, noLinks } from "../../cloud/src/alerts.js";

export const CHAT_ENV = { slack: "PURSER_SLACK_WEBHOOK_URL", teams: "PURSER_TEAMS_WEBHOOK_URL" } as const;
export type ChatChannel = keyof typeof CHAT_ENV;

/** What a notification says; built from a proposal and its invoice. Nothing in it can approve. */
export interface ApprovalNotice {
  proposal_id: string;
  invoice_id: string;
  /** A decimal amount as the records hold it, like 1309.00. */
  amount: string;
  currency: string;
  payee: string;
  /** The invoice's page in Purser Cloud, where the CFO signs in with their passkey and approves. https only. */
  link: string;
  test_money: boolean;
}

export interface ChatTarget { channel: ChatChannel; url: string }
export interface ChatResult { channel: ChatChannel; ok: boolean; status: number }

/** The configured channels, checked as Purser Cloud checks an alert target (Slack: hooks.slack.com; Teams: its hosts). */
export function chatTargetsFromEnv(env: Record<string, string | undefined> = process.env): ChatTarget[] {
  const out: ChatTarget[] = [];
  for (const channel of Object.keys(CHAT_ENV) as ChatChannel[]) {
    const raw = env[CHAT_ENV[channel]]?.trim();
    if (!raw) continue;
    try {
      out.push({ channel, url: cleanTarget(channel, raw) });
    } catch {
      // The value itself is never repeated: it is a credential.
      throw new Error(`${CHAT_ENV[channel]} is not a ${channel === "slack" ? "Slack incoming webhook (https://hooks.slack.com/...)" : "Microsoft Teams webhook (a Teams workflow's or connector's https URL)"}`);
    }
  }
  return out;
}

/** Words from an invoice as they go into a chat: no links, one line, no markup a chat app acts on, at most `n` characters. */
function plain(s: string, n = 80): string {
  const one = noLinks(s).replace(/[\r\n\t]+/g, " ").replace(/[<>*_~`|[\]&@!#]/g, "").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** 1309.00 → 1,309.00 (from the string: no float on the way). */
export function grouped(amount: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(amount.trim());
  if (!m) return plain(amount, 24);
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[3] ?? ""}`;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

function checked(n: ApprovalNotice): ApprovalNotice {
  if (!ID.test(n.proposal_id) || !ID.test(n.invoice_id)) throw new Error("a proposal and an invoice id like P-0009 and AP-0004");
  if (!/^[A-Z]{3}$/.test(n.currency)) throw new Error("a currency code like EUR");
  const link = new URL(n.link);
  if (link.protocol !== "https:" || link.username || link.password) throw new Error("the approval link must be https, with no credentials in it");
  if (/[?&](token|key|code|secret|session|approve)=/i.test(link.search + link.hash)) throw new Error("the approval link must carry no token or approve parameter");
  return n;
}

/** The notification's headline: "Payment P-0009 needs your signature: EUR 1,309.00, payee Bergtex Textil GmbH". */
export function noticeHeadline(n: ApprovalNotice): string {
  return `${n.test_money ? "[TEST MONEY] " : ""}Payment ${n.proposal_id} needs your signature: ${n.currency} ${grouped(n.amount)}, payee ${plain(n.payee)}`;
}

export const CANNOT_APPROVE = "This message cannot approve anything. Only the CFO's passkey, in Purser Cloud, can.";

/** The notice as plain lines (the Slack fallback text, a log a person reads). */
export function noticeText(n: ApprovalNotice): string {
  const c = checked(n);
  return [noticeHeadline(c), `Invoice ${c.invoice_id}. Open the passkey page to review and sign: ${c.link}`, CANNOT_APPROVE].join("\n");
}

/** Slack (incoming webhook): text and two sections; the only link is the passkey page, as a plain link (no button). */
export function slackMessage(n: ApprovalNotice): Record<string, unknown> {
  const c = checked(n);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    text: noticeText(c),
    unfurl_links: false, unfurl_media: false,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${esc(noticeHeadline(c))}*\nInvoice ${esc(c.invoice_id)}. <${c.link}|Open the passkey page> to review and sign.` } },
      { type: "context", elements: [{ type: "mrkdwn", text: esc(CANNOT_APPROVE) }] },
    ],
  };
}

/** Teams (a workflow's or connector's webhook): an Adaptive Card whose only action opens the passkey page. */
export function teamsMessage(n: ApprovalNotice): Record<string, unknown> {
  const c = checked(n);
  return {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
      body: [
        { type: "TextBlock", text: noticeHeadline(c), weight: "Bolder", wrap: true },
        { type: "TextBlock", text: `Invoice ${c.invoice_id}. Open the passkey page to review and sign.`, wrap: true },
        { type: "TextBlock", text: CANNOT_APPROVE, isSubtle: true, size: "Small", wrap: true },
      ],
      actions: [{ type: "Action.OpenUrl", title: "Open the passkey page", url: c.link }],
    } }],
  };
}

export const messageFor = (channel: ChatChannel, n: ApprovalNotice) => (channel === "slack" ? slackMessage(n) : teamsMessage(n));

/**
 * Sends the notice to every configured channel, once each (no retry: a second post would say it twice). A result says
 * which channel and how it answered, never the URL.
 */
export async function notifyApproval(n: ApprovalNotice, o: { env?: Record<string, string | undefined>; fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}): Promise<ChatResult[]> {
  const targets = chatTargetsFromEnv(o.env ?? process.env);
  const send = o.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
  const out: ChatResult[] = [];
  for (const t of targets) {
    const body = JSON.stringify(messageFor(t.channel, n));
    try {
      const res = await send(t.url, { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(10_000) });
      out.push({ channel: t.channel, ok: res.ok, status: res.status });
    } catch {
      out.push({ channel: t.channel, ok: false, status: 0 });
    }
  }
  return out;
}

/** A proposal waiting for the CFO, from an invoice as GET /v1/engine/invoices lists it; null when nothing waits. */
export function noticeFromInvoice(inv: { id: string; vendor: string; currency: string; total: string; proposal: { id: string; status: string } | null }, origin: string, testMoney = true): ApprovalNotice | null {
  if (!inv.proposal || inv.proposal.status !== "PENDING_APPROVAL") return null;
  return { proposal_id: inv.proposal.id, invoice_id: inv.id, amount: inv.total, currency: inv.currency, payee: inv.vendor,
    link: `${new URL(origin).origin}/#/invoices/${encodeURIComponent(inv.id)}`, test_money: testMoney };
}
