// Approval alerts (13 Nov): when a payment waits for the CFO's Face ID (the approval.needed business event), Purser tells
// the people the company chose, on the channels it chose (Settings, Alerts): WhatsApp (Twilio), e-mail (a provider
// adapter; Resend today), Slack and Microsoft Teams (their incoming webhooks, in the message formats of
// ./connections.ts) and the company's signed webhook (./monitor.ts). Every channel sits behind one Notifier interface.
//
// An alert only TELLS. It carries the amount, the payee, why it waits and a link to the approval page; it carries no
// token, code, reply word or link that approves anything. Approving stays the CFO's passkey (Face ID) in Purser Cloud,
// after signing in there with that passkey (test/cloud-alerts.test.ts checks every channel's message for it).
//
// Each delivery is idempotent (one row per event and target, keyed by both: a replayed push or a second dispatch of
// the same event sends nothing again), retried up to three times when the failure may pass (no answer, 429, 5xx),
// capped per company per hour, and written to the company's security events (the cloud's audit log of access and
// notices) with its status. A phone number or e-mail address appears masked in every log line, event and answer; the
// whole value is kept only to send to (it is never returned by the API).

import { z } from "zod";
import { withinRate } from "./auth.js";
import { chatMessage, type BusinessEvent } from "./connections.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { logEvent } from "./log.js";
import { hookUrl, MonitorRefused, notify, type Outbound } from "./monitor.js";
import type { Sql } from "./store.js";
import { TenantDb, WriteConflict } from "./tenant.js";

export const ALERT_CHANNELS = ["whatsapp", "email", "slack", "teams", "webhook"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
/** Channels with a target a person enters (the webhook is the company's one signed webhook, set under Webhooks). */
export const TARGET_CHANNELS = ["whatsapp", "email", "slack", "teams"] as const;
export type TargetChannel = (typeof TARGET_CHANNELS)[number];

/** Attempts per delivery, deliveries per company per hour, targets per company. */
export const ALERT_ATTEMPTS = 3;
export const ALERTS_PER_HOUR = 30;
export const MAX_ALERT_TARGETS = 10;

/** What an approval alert says. Built from the company's own rows; nothing in it can approve. */
export interface ApprovalAlert {
  /** The event's idempotency key: the invoice, its proposal and the moment it started to wait. */
  key: string;
  invoice_id: string;
  proposal_id: string | null;
  amount: string;
  currency: string;
  payee: string;
  why: string;
  due_date: string;
  /** The approval page in Purser Cloud: sign in with the passkey there, then approve with Face ID. No token in it. */
  link: string;
  /** Test money (sandbox, testnet, the engine's stand-in bank): every message says so. */
  test_money: boolean;
}

export interface SendResult {
  ok: boolean;
  /** The provider's HTTP status; 0 when nothing answered. */
  status: number;
  /** Whether another attempt may succeed (no answer, 429, 5xx). */
  retryable: boolean;
  /** The provider's id for the message (Twilio's message SID, the e-mail provider's id); never a secret. */
  providerRef?: string;
}

/** One way to tell someone. `target` is the full phone, address or URL; implementations never log it. */
export interface Notifier {
  readonly channel: AlertChannel;
  send(target: string, alert: ApprovalAlert, idempotencyKey: string): Promise<SendResult>;
}

// --- The words -------------------------------------------------------------------------------------------------------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** A payee's name as it goes into a message: one line, no markup a chat app would act on, at most 80 characters. */
const plain = (s: string) => clip(s.replace(/[\r\n\t]+/g, " ").replace(/[<>*_~`|[\]]/g, "").trim(), 80);

/** The alert as plain text (WhatsApp, the e-mail's text part): five short lines. */
export function alertText(a: ApprovalAlert): string {
  return [
    `${a.test_money ? "[TEST MONEY] " : ""}Purser: a payment waits for your Face ID.`,
    `${a.currency} ${a.amount} to ${plain(a.payee)} (invoice ${a.invoice_id}${a.due_date ? `, due ${a.due_date}` : ""}).`,
    `Why: ${clip(a.why, 200)}`,
    `Review it in Purser Cloud: ${a.link}`,
    "This message cannot approve anything. Only your passkey (Face ID), in Purser Cloud, can.",
  ].join("\n");
}

export function alertSubject(a: ApprovalAlert): string {
  return `${a.test_money ? "[TEST MONEY] " : ""}Waiting for your Face ID: ${a.currency} ${a.amount} to ${plain(a.payee)}`;
}

/** The alert as the business event the chat formats already speak (./connections.ts chatMessage), with payee and why. */
export function alertEvent(a: ApprovalAlert): BusinessEvent {
  return { type: "approval.needed", data: { invoice_id: a.invoice_id, amount: a.amount, currency: a.currency, due_date: a.due_date, ...(a.proposal_id ? { proposal_id: a.proposal_id } : {}),
    payee: plain(a.payee), why: clip(a.why, 200), approve_in: a.link, ...(a.test_money ? { test_money: "yes" } : {}) } };
}

// --- Masking ---------------------------------------------------------------------------------------------------------

/** +31612345678 → +31******78; an address → m***@example.com; a webhook URL → its host only. */
export function maskTarget(channel: AlertChannel, target: string): string {
  if (channel === "whatsapp") {
    const d = target.replace(/[^\d+]/g, "");
    return d.length < 6 ? "***" : `${d.slice(0, 3)}${"*".repeat(Math.max(3, d.length - 5))}${d.slice(-2)}`;
  }
  if (channel === "email") {
    const at = target.lastIndexOf("@");
    return at < 1 ? "***" : `${target[0]}***${target.slice(at)}`;
  }
  if (channel === "webhook") return "the signed webhook";
  try { return `${new URL(target).host} (webhook)`; } catch { return "***"; }
}

// --- Targets ---------------------------------------------------------------------------------------------------------

export class AlertRefused extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}

const E164 = /^\+[1-9]\d{7,14}$/;
const TEAMS_HOST = /(^|\.)(webhook\.office\.com|logic\.azure\.com|api\.powerplatform\.com)$/;

/** A target as entered, checked for its channel; refused with a sentence when it does not fit. */
export function cleanTarget(channel: TargetChannel, raw: string): string {
  const v = raw.trim();
  if (channel === "whatsapp") {
    const n = v.replace(/^whatsapp:/i, "").replace(/[\s().-]/g, "");
    if (!E164.test(n)) throw new AlertRefused(400, "a WhatsApp number in international form, like +31612345678");
    return n;
  }
  if (channel === "email") {
    if (!z.string().email().max(200).safeParse(v).success) throw new AlertRefused(400, "an e-mail address, like cfo@example.com");
    return v.toLowerCase();
  }
  let url: string;
  try { url = hookUrl(v); } catch (e) { throw new AlertRefused(400, e instanceof MonitorRefused ? e.message : "not a URL"); }
  const host = new URL(url).hostname;
  if (channel === "slack" && host !== "hooks.slack.com") throw new AlertRefused(400, "a Slack incoming webhook (https://hooks.slack.com/services/...)");
  if (channel === "teams" && !TEAMS_HOST.test(host)) throw new AlertRefused(400, "a Microsoft Teams webhook (a Teams workflow's or connector's https URL)");
  return url;
}

export const NewTarget = z.object({ channel: z.enum(TARGET_CHANNELS), target: z.string().min(3).max(500) }).strict();

export async function addTarget(sql: Sql, tenantId: string, t: z.infer<typeof NewTarget>, by: string, now: Date): Promise<{ id: string; channel: TargetChannel; target: string }> {
  const db = new TenantDb(sql, tenantId);
  const target = cleanTarget(t.channel, t.target);
  const all = await db.select<{ channel: string; target: string }>("alert_targets", {});
  if (all.length >= MAX_ALERT_TARGETS) throw new AlertRefused(409, `a company has at most ${MAX_ALERT_TARGETS} alert targets`);
  if (all.some((x) => x.channel === t.channel && x.target === target)) throw new AlertRefused(409, "this target is already on the list");
  const id = `at_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
  const iso = now.toISOString();
  await db.apply([db.insert("alert_targets", { id, channel: t.channel, target, created_at: iso, created_by: by }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "alert.target_added", actor: by, detail_json: JSON.stringify({ target: id, channel: t.channel, to: maskTarget(t.channel, target) }) })]);
  logEvent("info", "alert.target_added", { tenant: tenantId, channel: t.channel, to: maskTarget(t.channel, target) });
  return { id, channel: t.channel, target: maskTarget(t.channel, target) };
}

export async function removeTarget(sql: Sql, tenantId: string, id: string, by: string, now: Date): Promise<{ removed: true }> {
  const db = new TenantDb(sql, tenantId);
  const row = await db.one<{ channel: TargetChannel; target: string }>("alert_targets", { id });
  if (!row) throw new AlertRefused(404, "no such alert target");
  const iso = now.toISOString();
  await db.apply([db.delete("alert_targets", { id }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: iso, kind: "alert.target_removed", actor: by, detail_json: JSON.stringify({ target: id, channel: row.channel, to: maskTarget(row.channel, row.target) }) })]);
  return { removed: true };
}

/** The company's alert settings for its owners: targets masked, which channels this cloud can send on, the latest deliveries. */
export async function alertSettings(sql: Sql, tenantId: string, providers: AlertProviders | undefined): Promise<Record<string, unknown>> {
  const db = new TenantDb(sql, tenantId);
  const targets = await db.select<{ id: string; channel: TargetChannel; target: string; created_at: string; created_by: string }>("alert_targets", {}, { order: ["created_at", "id"] });
  const hook = await db.one<{ disabled_at: string | null }>("webhooks", { id: "main" });
  const deliveries = await db.select<Record<string, unknown>>("alert_deliveries", {}, { order: ["updated_at", "id"], desc: true, limit: 20 });
  return {
    rule: "An alert only tells: the amount, the payee, why it waits and a link to Purser Cloud. Nothing in it approves; only the CFO's passkey (Face ID) in Purser Cloud does.",
    channels: { whatsapp: Boolean(providers?.twilio), email: Boolean(providers?.email), slack: true, teams: true, webhook: Boolean(hook && !hook.disabled_at) },
    targets: targets.map((t) => ({ id: t.id, channel: t.channel, target: maskTarget(t.channel, t.target), created_at: t.created_at, created_by: t.created_by })),
    deliveries,
  };
}

// --- The providers ---------------------------------------------------------------------------------------------------

/** What this cloud can send with (Worker secrets); a channel without its provider is skipped and the delivery says so. */
export interface AlertProviders {
  /** Twilio's Messages API for WhatsApp: the account, its auth token, and the sender (the sandbox's number in a demo). */
  twilio?: { accountSid: string; authToken: string; whatsappFrom: string };
  /** An e-mail provider adapter. */
  email?: EmailProvider;
  /** Test money only (the default): every alert says [TEST MONEY]. */
  testMoney?: boolean;
}

const statusOf = async (p: Promise<Response>): Promise<{ status: number; body: unknown }> => {
  try {
    const r = await p;
    let body: unknown = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  } catch { return { status: 0, body: null }; }
};
const retryableStatus = (s: number) => s === 0 || s === 429 || s >= 500;
const timeout = (): { signal?: AbortSignal } => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(8000) } : {});

/** WhatsApp through Twilio's Messages API (POST /2010-04-01/Accounts/{sid}/Messages.json, form encoded, basic auth). */
export function twilioWhatsApp(cfg: NonNullable<AlertProviders["twilio"]>, out: Outbound): Notifier {
  return {
    channel: "whatsapp",
    async send(target, alert) {
      const form = new URLSearchParams({ From: cfg.whatsappFrom.startsWith("whatsapp:") ? cfg.whatsappFrom : `whatsapp:${cfg.whatsappFrom}`, To: `whatsapp:${target}`, Body: alertText(alert) });
      const r = await statusOf(out(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
        method: "POST", redirect: "manual", ...timeout(),
        headers: { authorization: `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`, "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }));
      const sid = (r.body as { sid?: unknown } | null)?.sid;
      const ok = r.status === 201 || r.status === 200;
      return { ok, status: r.status, retryable: !ok && retryableStatus(r.status), ...(ok && typeof sid === "string" && /^[A-Z]{2}[0-9a-f]{32}$/.test(sid) ? { providerRef: sid } : {}) };
    },
  };
}

/** An e-mail provider: one message, with an idempotency key the provider keeps (a retry is not a second e-mail). */
export interface EmailProvider {
  readonly name: string;
  send(m: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<SendResult>;
}

/** Resend's API (POST https://api.resend.com/emails, bearer key, Idempotency-Key header). */
export function resendEmail(cfg: { apiKey: string; from: string }, out: Outbound): EmailProvider {
  return {
    name: "resend",
    async send(m) {
      const r = await statusOf(out("https://api.resend.com/emails", {
        method: "POST", redirect: "manual", ...timeout(),
        headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
        body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text }),
      }));
      const id = (r.body as { id?: unknown } | null)?.id;
      const ok = r.status >= 200 && r.status < 300;
      return { ok, status: r.status, retryable: !ok && retryableStatus(r.status), ...(ok && typeof id === "string" ? { providerRef: id.slice(0, 80) } : {}) };
    },
  };
}

export function emailNotifier(p: EmailProvider): Notifier {
  return { channel: "email", send: (to, alert, idempotencyKey) => p.send({ to, subject: alertSubject(alert), text: alertText(alert), idempotencyKey }) };
}

/** Slack's or Teams' incoming webhook, in the formats of ./connections.ts (Block Kit, an Adaptive Card). */
export function chatNotifier(to: "slack" | "teams", out: Outbound): Notifier {
  return {
    channel: to,
    async send(url, alert) {
      const r = await statusOf(out(url, { method: "POST", redirect: "manual", ...timeout(), headers: { "content-type": "application/json" }, body: JSON.stringify(chatMessage(alertEvent(alert), to)) }));
      const ok = r.status >= 200 && r.status < 300;
      return { ok, status: r.status, retryable: !ok && retryableStatus(r.status) };
    },
  };
}

/**
 * The company's signed webhook (./monitor.ts): the approval.needed event exactly as before (ids, amounts and days; no
 * payee's name), signed with the webhook's secret. It retries itself, so this channel is never retried here.
 */
export function webhookNotifier(sql: Sql, tenantId: string, data: Record<string, string>, now: Date, out: Outbound | undefined, retryDelayMs: number): Notifier {
  return {
    channel: "webhook",
    async send() {
      const ok = await notify(sql, tenantId, "approval.needed", data, now, out, retryDelayMs);
      return { ok, status: ok ? 200 : 0, retryable: false };
    },
  };
}

// --- Dispatch --------------------------------------------------------------------------------------------------------

export type DeliveryStatus = "sent" | "failed" | "capped" | "no_provider" | "duplicate";
export interface Delivery { channel: AlertChannel; target: string; status: DeliveryStatus; attempts: number; providerRef?: string }

/** The alert for an invoice that now waits for the CFO, from the company's own rows (the payee is the invoice's supplier). */
export async function approvalAlertOf(db: TenantDb, data: Record<string, string>, origin: string, testMoney: boolean): Promise<ApprovalAlert | null> {
  const inv = await db.one<{ vendor: string; updated_at: string; body_json: string }>("invoices", { id: data.invoice_id ?? "" });
  if (!inv) return null;
  const body = JSON.parse(inv.body_json) as { review_note?: unknown; approval_reason?: unknown };
  // Why it waits: the runner's own reason when it sends one, else the second sentence of its review note (what the
  // checks found), else the rule itself.
  const note = typeof body.review_note === "string" ? body.review_note : "";
  const fromNote = note.includes(". ") ? note.slice(note.indexOf(". ") + 2).trim() : "";
  const why = typeof body.approval_reason === "string" && body.approval_reason.trim() ? body.approval_reason.trim() : fromNote || "Purser holds this payment until the CFO approves it with Face ID.";
  return {
    key: `approval.needed|${data.invoice_id}|${data.proposal_id ?? ""}|${inv.updated_at}`,
    invoice_id: data.invoice_id!, proposal_id: data.proposal_id ?? null, amount: data.amount ?? "", currency: data.currency ?? "", payee: inv.vendor || "the supplier",
    why, due_date: data.due_date ?? "", link: `${origin}/#/invoices/${encodeURIComponent(data.invoice_id!)}`, test_money: testMoney,
  };
}

export interface DispatchEnv { sql: Sql; tenantId: string; now: Date; out: Outbound | undefined; providers: AlertProviders | undefined; retryDelayMs: number; origin: string }

/**
 * An approval.needed event to every channel the company chose, and to its signed webhook (unchanged). One delivery per
 * target: idempotent, retried, capped per company per hour, recorded with its status. Never throws for a channel's
 * failure: a failed alert is recorded, and the payment simply keeps waiting for the CFO.
 */
export async function dispatchApprovalAlert(env: DispatchEnv, data: Record<string, string>): Promise<Delivery[]> {
  const db = new TenantDb(env.sql, env.tenantId);
  const testMoney = env.providers?.testMoney ?? true;
  const alert = await approvalAlertOf(db, data, env.origin, testMoney);
  const out: Delivery[] = [];
  const targets: { id: string; channel: AlertChannel; target: string }[] = [
    ...(await db.select<{ id: string; channel: TargetChannel; target: string }>("alert_targets", {}, { order: ["created_at", "id"] })),
  ];
  const hook = await db.one<{ disabled_at: string | null }>("webhooks", { id: "main" });
  if (hook && !hook.disabled_at) targets.push({ id: "webhook", channel: "webhook", target: "" });
  if (!alert) {
    // The invoice is not in the cloud (it should be: the push that raised the event wrote it): only the webhook hears it.
    if (hook && !hook.disabled_at) out.push({ channel: "webhook", target: maskTarget("webhook", ""), status: (await notify(env.sql, env.tenantId, "approval.needed", data, env.now, env.out, env.retryDelayMs)) ? "sent" : "failed", attempts: 1 });
    return out;
  }
  for (const t of targets) {
    const n = notifierFor(t.channel, env, data);
    out.push(await deliverOne(env, db, alert, t, n));
  }
  return out;
}

function notifierFor(channel: AlertChannel, env: DispatchEnv, data: Record<string, string>): Notifier | null {
  if (!env.out) return null;
  if (channel === "whatsapp") return env.providers?.twilio ? twilioWhatsApp(env.providers.twilio, env.out) : null;
  if (channel === "email") return env.providers?.email ? emailNotifier(env.providers.email) : null;
  if (channel === "slack" || channel === "teams") return chatNotifier(channel, env.out);
  return webhookNotifier(env.sql, env.tenantId, data, env.now, env.out, env.retryDelayMs);
}

async function deliverOne(env: DispatchEnv, db: TenantDb, alert: ApprovalAlert, t: { id: string; channel: AlertChannel; target: string }, n: Notifier | null): Promise<Delivery> {
  const masked = maskTarget(t.channel, t.target);
  const id = `ad_${(await sha256Hex(`${env.tenantId}|${alert.key}|${t.id}`)).slice(0, 32)}`;
  const iso = env.now.toISOString();
  // Claimed first: the same event for the same target a second time (a replay, two dispatches at once) finds the row.
  try {
    await db.apply([db.insert("alert_deliveries", { id, event_key: alert.key, invoice_id: alert.invoice_id, channel: t.channel, target_id: t.id, target_mask: masked, status: "sending", attempts: 0, http_status: null, provider_ref: null, created_at: iso, updated_at: iso })]);
  } catch (e) {
    if (e instanceof WriteConflict) return { channel: t.channel, target: masked, status: "duplicate", attempts: 0 };
    throw e;
  }
  let status: DeliveryStatus, attempts = 0, last: SendResult = { ok: false, status: 0, retryable: false };
  if (!n) status = "no_provider";
  else if (!(await withinRate(env.sql, `alerts:${env.tenantId}`, env.now, { windowSec: 3600, max: ALERTS_PER_HOUR }))) status = "capped";
  else {
    const tries = t.channel === "webhook" ? 1 : ALERT_ATTEMPTS;
    for (attempts = 1; attempts <= tries; attempts++) {
      try { last = await n.send(t.target, alert, id); } catch { last = { ok: false, status: 0, retryable: true }; }
      if (last.ok || !last.retryable) break;
      if (attempts < tries && env.retryDelayMs > 0) await new Promise((r) => setTimeout(r, env.retryDelayMs * attempts));
    }
    attempts = Math.min(attempts, tries);
    status = last.ok ? "sent" : "failed";
  }
  const done = env.now.toISOString();
  await db.apply([
    db.update("alert_deliveries", { id }, { status, attempts, http_status: last.status || null, provider_ref: last.providerRef ?? null, updated_at: done }),
    db.insert("security_events", { id: `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`, at: done, kind: "alert.delivery", actor: "purser",
      detail_json: JSON.stringify({ event: "approval.needed", invoice: alert.invoice_id, channel: t.channel, to: masked, status, attempts, ...(last.status ? { http_status: last.status } : {}), ...(last.providerRef ? { provider_ref: last.providerRef } : {}) }) }),
  ]);
  logEvent(status === "sent" ? "info" : "warn", "alert.delivery", { tenant: env.tenantId, invoice: alert.invoice_id, channel: t.channel, to: masked, status, attempts, http_status: last.status });
  return { channel: t.channel, target: masked, status, attempts, ...(last.providerRef ? { providerRef: last.providerRef } : {}) };
}
