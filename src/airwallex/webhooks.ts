// Airwallex webhook subscriptions (K2, awards item 5): the relay's /hooks/airwallex gets Airwallex's events as they
// happen. The create call is the only place the signing secret appears; the caller stores it and never prints it.
// Airwallex cannot add events to a subscription (update changes only its url), so more events mean a new one.

import { randomUUID } from "node:crypto";
import type { Airwallex } from "./client.js";

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  version: string;
}

/** Where the runner keeps Airwallex's webhook signing secret, in the keys dir (the relay has its own copy). */
export const WEBHOOK_SECRET_FILE = "airwallex-webhook-secret";

/**
 * Card transaction events in both of Airwallex's shapes (a card transaction event, and the older transaction); each
 * is recorded once by its card transaction id. Accepted under API version 2025-11-11 (checked against the sandbox
 * on 2026-10-29: it names the events it does not support).
 */
export const CARD_EVENTS = [
  "issuing.card_transaction_event.success", "issuing.card_transaction_event.failed", "issuing.transaction.succeeded", "issuing.transaction.failed",
];

export async function listWebhooks(api: Airwallex): Promise<Webhook[]> {
  const out: Webhook[] = [];
  for (let page = 0; page < 10; page++) {
    const r = await api.call<{ has_more?: boolean; items: Webhook[] }>("GET", "/webhooks", undefined, { page: String(page), page_size: "100" });
    out.push(...r.items.map((w) => ({ id: w.id, url: w.url, events: w.events, version: w.version })));
    if (!r.has_more) break;
  }
  return out;
}

export async function createWebhook(api: Airwallex, a: { url: string; events: string[]; version: string }): Promise<Webhook & { secret: string }> {
  const w = await api.call<Webhook & { secret?: string }>("POST", "/webhooks/create", { request_id: randomUUID(), url: a.url, events: a.events, version: a.version });
  if (!w.secret) throw new Error("Airwallex created the webhook but returned no secret");
  return { id: w.id, url: w.url, events: w.events, version: w.version, secret: w.secret };
}

export async function deleteWebhook(api: Airwallex, id: string): Promise<void> {
  await api.call("POST", `/webhooks/${encodeURIComponent(id)}/delete`, {});
}
