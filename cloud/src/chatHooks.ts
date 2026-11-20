// Slack and Microsoft Teams live notifications (20 Nov, "connect Purser to anything"): each company pastes its own
// incoming-webhook URL in Settings ("Slack and Teams"), and Purser posts its business events there, in each product's
// own message format (./connections.ts chatMessage: Slack Block Kit, a Teams Adaptive Card):
//   approval.needed  an invoice waits for the CFO's Face ID   (ids, amount, due day; never the payee's bank details)
//   payment.paid     an invoice was paid
//   books.closed     a year-end closing entry reached the ledger
// A message only TELLS. Its one button opens Purser Cloud; nothing in it approves, and it carries no secret, no key and
// no bank detail (test/cloud-chat-hooks.test.ts reads every message for them). Approving stays the CFO's passkey.
//
// Delivery works like the company's signed webhook (./monitor.ts): up to three attempts, an hourly cap per company, and a
// hook that failed twenty events in a row is switched off (disabled_at) until an owner sets it again. The URL is a
// credential (anyone holding it can post to the channel): it is used only to send to, never returned by the API (its
// host only), never exported, and an owner sets or removes it after a fresh passkey check where the company asks for one.
//
// Allowed URLs, checked against Slack's and Microsoft's documentation of 20 Nov 2026 (an exact-pattern allow list on top
// of ./monitor.ts hookUrl: https, port 443, a public host name, no credentials):
//   Slack   https://hooks.slack.com/services/T…/B…/…  (an app's incoming webhook)
//   Teams   https://<env>.<nn>.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/<id>/triggers/manual/paths/invoke?…
//           (the Teams "Workflows" app, "Send webhook alerts to a channel"; the current Power Automate trigger host)
//           https://prod-<nn>.<region>.logic.azure.com/workflows/<id>/triggers/manual/paths/invoke?…  (the older trigger
//           host of the same workflows; Microsoft moved them to api.powerplatform.com from 30 Nov 2025)
// Not allowed: <tenant>.webhook.office.com (Office 365 connector webhooks), which Microsoft retired in May 2026
// (learn.microsoft.com, "Create Incoming Webhooks"): such a URL would accept nothing.

import { z } from "zod";
import { withinRate } from "./auth.js";
import { chatMessage, type BusinessEvent } from "./connections.js";
import { randomToken } from "./crypto.js";
import { logEvent } from "./log.js";
import { HOOK_ATTEMPTS, HOOK_EVENTS_PER_HOUR, HOOK_OFF_AFTER, hookUrl, MonitorRefused, type Outbound } from "./monitor.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export const CHAT_PRODUCTS = ["slack", "teams"] as const;
export type ChatProduct = (typeof CHAT_PRODUCTS)[number];
export const isChatProduct = (s: string): s is ChatProduct => s === "slack" || s === "teams";

/** A hook that does not fit, or is not there. */
export class ChatHookRefused extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

/** Exact host and path shapes per product; anything else is refused with a sentence that says what fits. */
const ALLOWED: Record<ChatProduct, { host: RegExp; path: RegExp }[]> = {
  slack: [{ host: /^hooks\.slack\.com$/, path: /^\/services\/T[A-Z0-9]{2,20}\/B[A-Z0-9]{2,20}\/[A-Za-z0-9]{8,64}$/ }],
  teams: [
    { host: /^[a-z0-9]{1,63}\.[a-z0-9]{1,8}\.environment\.api\.powerplatform\.com$/, path: /^\/powerautomate\/automations\/direct\/workflows\/[A-Za-z0-9]{8,64}\/triggers\/manual\/paths\/invoke$/ },
    { host: /^prod-\d{1,3}\.[a-z0-9]{2,30}\.logic\.azure\.com$/, path: /^\/workflows\/[A-Za-z0-9]{8,64}\/triggers\/manual\/paths\/invoke$/ },
  ],
};

/** A pasted URL, checked for its product; the normalised URL, or ChatHookRefused with what would fit. */
export function chatHookUrl(product: ChatProduct, raw: string): string {
  let url: string;
  try { url = hookUrl(raw.trim()); } catch (e) { throw new ChatHookRefused(400, e instanceof MonitorRefused ? e.message : "not a URL"); }
  const u = new URL(url);
  if (u.hash) throw new ChatHookRefused(400, "no #fragment in the webhook URL");
  const ok = ALLOWED[product].some((a) => a.host.test(u.hostname.toLowerCase()) && a.path.test(u.pathname));
  if (!ok) {
    if (product === "teams" && /(^|\.)webhook\.office\.com$/.test(u.hostname)) throw new ChatHookRefused(400, "Office 365 connector webhooks (webhook.office.com) were retired by Microsoft in May 2026; make a Teams Workflow (\"Send webhook alerts to a channel\") and paste its URL");
    throw new ChatHookRefused(400, product === "slack"
      ? "a Slack incoming webhook: https://hooks.slack.com/services/T…/B…/…"
      : "a Teams Workflow webhook: https://….environment.api.powerplatform.com/powerautomate/automations/direct/workflows/…/triggers/manual/paths/invoke?…");
  }
  if (product === "slack" && u.search) throw new ChatHookRefused(400, "a Slack incoming webhook has no ?query");
  return u.toString();
}

export const SetChatHook = z.object({ url: z.string().min(20).max(500) }).strict();

interface Row { id: ChatProduct; url: string; created_at: string; created_by: string; consecutive_failures: number; last_attempt_at: string | null; last_status: number | null; disabled_at: string | null }

/** What an owner sees: per product, whether a hook is set (its host only), its delivery state; never the URL itself. */
export async function chatHooks(sql: Sql, tenantId: string): Promise<{ rule: string; events: string[]; hooks: Record<ChatProduct, Record<string, unknown> | null> }> {
  const rows = await new TenantDb(sql, tenantId).select<Row>("chat_hooks", {});
  const view = (p: ChatProduct) => {
    const r = rows.find((x) => x.id === p);
    return r ? { host: new URL(r.url).hostname, created_at: r.created_at, created_by: r.created_by, consecutive_failures: r.consecutive_failures, last_attempt_at: r.last_attempt_at, last_status: r.last_status, disabled_at: r.disabled_at, status: r.disabled_at ? "switched_off" : "on" } : null;
  };
  return {
    rule: "A message only tells: what happened, the amount and a link to Purser Cloud. Nothing in it approves; only the CFO's passkey (Face ID) in Purser Cloud does.",
    events: ["approval.needed", "payment.paid", "books.closed"],
    hooks: { slack: view("slack"), teams: view("teams") },
  };
}

export async function setChatHook(sql: Sql, tenantId: string, product: ChatProduct, raw: string, by: string, now: Date): Promise<Record<string, unknown>> {
  const url = chatHookUrl(product, raw);
  const db = new TenantDb(sql, tenantId);
  const iso = now.toISOString();
  const row = { url, created_at: iso, created_by: by, consecutive_failures: 0, last_attempt_at: null, last_status: null, disabled_at: null };
  const had = await db.one("chat_hooks", { id: product });
  await db.apply([had ? db.update("chat_hooks", { id: product }, row) : db.insert("chat_hooks", { id: product, ...row }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "chat_hook.set", actor: by, detail_json: JSON.stringify({ product, host: new URL(url).hostname }) })]);
  logEvent("info", "chat_hook.set", { tenant: tenantId, product, host: new URL(url).hostname });
  return { product, host: new URL(url).hostname, status: "on" };
}

export async function removeChatHook(sql: Sql, tenantId: string, product: ChatProduct, by: string, now: Date): Promise<{ removed: boolean }> {
  const db = new TenantDb(sql, tenantId);
  if (!(await db.one("chat_hooks", { id: product }))) return { removed: false };
  await db.apply([db.delete("chat_hooks", { id: product }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: now.toISOString(), kind: "chat_hook.removed", actor: by, detail_json: JSON.stringify({ product }) })]);
  return { removed: true };
}

/** The keys an event's data may carry into a chat message: ids, amounts, days and Purser Cloud's own links. */
const SAFE_KEYS = new Set(["invoice_id", "proposal_id", "amount", "currency", "due_date", "paid_at", "year", "entry_id", "posting_date", "link", "approve_in", "note", "test_money"]);

/** The event as it may go to a chat: only the safe keys, and a link only when it is Purser Cloud's own. */
export function chatSafe(e: BusinessEvent, origin: string): BusinessEvent {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data)) {
    if (!SAFE_KEYS.has(k)) continue;
    if ((k === "link" || k === "approve_in") && !v.startsWith(`${origin}/`)) continue;
    data[k] = v.slice(0, 200);
  }
  return { type: e.type, data };
}

const timeout = (): { signal?: AbortSignal } => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(8000) } : {});

async function post(out: Outbound, url: string, body: unknown, retryDelayMs: number): Promise<number> {
  let status = 0;
  for (let attempt = 1; attempt <= HOOK_ATTEMPTS; attempt++) {
    try { status = (await out(url, { method: "POST", redirect: "manual", ...timeout(), headers: { "content-type": "application/json", "user-agent": "PurserCloud-Chat/1" }, body: JSON.stringify(body) })).status; } catch { status = 0; }
    if (status >= 200 && status < 300) break;
    // A 4xx other than 429 will not pass by itself (a deleted webhook, a malformed card): no second attempt.
    if (status >= 400 && status < 500 && status !== 429) break;
    if (attempt < HOOK_ATTEMPTS && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  return status;
}

async function record(db: TenantDb, r: Row, status: number, now: Date): Promise<boolean> {
  const ok = status >= 200 && status < 300;
  const failures = ok ? 0 : r.consecutive_failures + 1;
  await db.apply([db.update("chat_hooks", { id: r.id }, { consecutive_failures: failures, last_attempt_at: now.toISOString(), last_status: status, ...(failures >= HOOK_OFF_AFTER ? { disabled_at: now.toISOString() } : {}) })]);
  return ok;
}

export interface ChatEnv { sql: Sql; tenantId: string; now: Date; out: Outbound | undefined; retryDelayMs: number; origin: string }

/**
 * One business event to each of the company's live chat hooks, in that product's format. Never throws for a channel's
 * failure: it is counted on the hook (and switches it off after twenty in a row), and the event's work goes on.
 */
export async function postEvent(env: ChatEnv, e: BusinessEvent): Promise<{ product: ChatProduct; status: number }[]> {
  if (!env.out) return [];
  const db = new TenantDb(env.sql, env.tenantId);
  const rows = (await db.select<Row>("chat_hooks", {})).filter((r) => !r.disabled_at);
  const done: { product: ChatProduct; status: number }[] = [];
  for (const r of rows) {
    if (!(await withinRate(env.sql, `chat:${env.tenantId}`, env.now, { windowSec: 3600, max: HOOK_EVENTS_PER_HOUR }))) {
      logEvent("warn", "chat_hook.capped", { tenant: env.tenantId, product: r.id, type: e.type });
      continue;
    }
    const status = await post(env.out, r.url, chatMessage(chatSafe(e, env.origin), r.id), env.retryDelayMs);
    const ok = await record(db, r, status, env.now);
    logEvent(ok ? "info" : "warn", "chat_hook.delivery", { tenant: env.tenantId, product: r.id, type: e.type, status, failures: ok ? 0 : r.consecutive_failures + 1 });
    done.push({ product: r.id, status });
  }
  return done;
}

/** The owner's "Send a test": one plain message to that product's hook, so they see it arrive. Recorded like an event. */
export async function testChatHook(env: ChatEnv, product: ChatProduct): Promise<{ product: ChatProduct; delivered: boolean; status: number }> {
  const db = new TenantDb(env.sql, env.tenantId);
  const r = await db.one<Row>("chat_hooks", { id: product });
  if (!r) throw new ChatHookRefused(404, `no ${product === "slack" ? "Slack" : "Teams"} webhook is set`);
  if (!env.out) throw new ChatHookRefused(409, "this cloud sends no outbound requests");
  const words = "Purser is connected to this channel. You will see approval.needed, payment.paid and books.closed here. Nothing posted here can approve a payment: only the CFO's passkey (Face ID), in Purser Cloud, can.";
  const body = product === "slack"
    ? { text: words, blocks: [{ type: "section", text: { type: "mrkdwn", text: words } }, { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Purser Cloud" }, url: `${env.origin}/#/overview` }] }] }
    : { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.5",
      body: [{ type: "TextBlock", text: "Purser test message", weight: "Bolder", wrap: true }, { type: "TextBlock", text: words, wrap: true }], actions: [{ type: "Action.OpenUrl", title: "Open Purser Cloud", url: `${env.origin}/#/overview` }] } }] };
  const status = await post(env.out, r.url, body, env.retryDelayMs);
  const delivered = await record(db, r, status, env.now);
  // A test that works switches a hook that was off back on: the owner just saw it arrive.
  if (delivered && r.disabled_at) await db.apply([db.update("chat_hooks", { id: product }, { disabled_at: null })]);
  return { product, delivered, status };
}
