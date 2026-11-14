// The live Airwallex events feed (14 Nov): what Airwallex sends Purser, shown as it arrives. Purser sends (a quote, a
// transfer); Airwallex answers with a webhook to /hooks/airwallex (./core.ts), signed with the webhook secret. Only an
// event whose signature verified reaches this feed, and only four fields of it are kept: the event type, the Airwallex
// object id, when Airwallex says it happened, and when it arrived. Never the body: no amounts, names, card numbers,
// account details or anything else Airwallex put in it. The last AWX_EVENTS_KEPT are kept; the oldest go first.
// Anyone may read the feed (GET AWX_EVENTS_PATH): it holds nothing that is not already public in the demo.

import type { Sql } from "./core.js";

/** The feed, public and read-only. Purser Cloud reads the same answer through the AwxRead entrypoint (./index.ts). */
export const AWX_EVENTS_PATH = "/awx-live/events.json";
/** How many events are kept. */
export const AWX_EVENTS_KEPT = 50;

/** One stored event: these fields and nothing else. */
export interface AwxEventRow {
  event_id: string;
  type: string;
  object_id: string | null;
  occurred_at: string | null;
  received_at: string;
  signature_verified: true;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const TYPE = /^[a-z][a-z0-9_]{0,40}(\.[a-z0-9_]{1,40}){0,5}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The four fields kept from a verified event, each checked for shape; null when the event has no usable id or type.
 * Called only after the signature verified (./core.ts hook).
 */
export function sanitizeAwxEvent(v: unknown, receivedAt: Date): AwxEventRow | null {
  if (!isObj(v)) return null;
  const eventId = typeof v.id === "string" && ID.test(v.id) ? v.id : null;
  const type = typeof v.name === "string" && v.name.length <= 64 && TYPE.test(v.name) ? v.name : null;
  if (!eventId || !type) return null;
  const data = isObj(v.data) ? v.data : null;
  const obj = data && isObj(data.object) ? data.object : data;
  const objectId = obj && typeof obj.id === "string" && ID.test(obj.id) ? obj.id : null;
  const t = typeof v.created_at === "string" && v.created_at.length <= 40 ? Date.parse(v.created_at) : NaN;
  return { event_id: eventId, type, object_id: objectId, occurred_at: Number.isNaN(t) ? null : new Date(t).toISOString(), received_at: receivedAt.toISOString(), signature_verified: true };
}

/** What the event is about, in two or three words, from its type ("payout.transfer.paid": "Transfer"). */
export function awxEventTopic(type: string): string {
  const topics: [RegExp, string][] = [
    [/^payout\.transfer\b|^transfer\b/, "Transfer"], [/^conversion\b|^fx\b/, "Conversion"], [/^issuing\./, "Agent card"],
    [/^deposit\b|^global_account\b/, "Money in"], [/^balance\b/, "Balance"], [/^payout\.beneficiary\b|^beneficiary\b/, "Payee"],
    [/^payment_/, "Payment"], [/^account\b/, "Account"],
  ];
  return topics.find(([re]) => re.test(type))?.[1] ?? "Other";
}

/** The feed's answer: newest first, with the last event's time, or "none yet" said plainly. */
export interface AwxEventsAnswer {
  source: "airwallex-webhooks";
  sandbox: true;
  kept: number;
  events: (AwxEventRow & { topic: string })[];
  last_event_at: string | null;
  /** Whether this site can verify Airwallex's signature at all (the webhook secret is set). */
  receiving: boolean;
  read_at: string;
}

export class AwxEventFeed {
  constructor(private readonly sql: Sql) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS awx_events (event_id TEXT PRIMARY KEY, type TEXT NOT NULL, object_id TEXT,
      occurred_at TEXT, received_at TEXT NOT NULL)`);
  }

  /** Keeps one verified event (its four fields); a repeat of the same event id is kept once. True when it was kept. */
  record(verifiedEvent: unknown, receivedAt: Date): boolean {
    const row = sanitizeAwxEvent(verifiedEvent, receivedAt);
    if (!row) return false;
    this.sql.exec("INSERT INTO awx_events (event_id, type, object_id, occurred_at, received_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING",
      row.event_id, row.type, row.object_id, row.occurred_at, row.received_at);
    this.sql.exec("DELETE FROM awx_events WHERE event_id IN (SELECT event_id FROM awx_events ORDER BY received_at DESC, event_id DESC LIMIT -1 OFFSET ?)", AWX_EVENTS_KEPT);
    return true;
  }

  list(now: Date, receiving: boolean): AwxEventsAnswer {
    const rows = this.sql.exec("SELECT event_id, type, object_id, occurred_at, received_at FROM awx_events ORDER BY received_at DESC, event_id DESC LIMIT ?", AWX_EVENTS_KEPT).toArray() as unknown as Omit<AwxEventRow, "signature_verified">[];
    const events = rows.map((r) => ({ ...r, signature_verified: true as const, topic: awxEventTopic(r.type) }));
    return { source: "airwallex-webhooks", sandbox: true, kept: AWX_EVENTS_KEPT, events, last_event_at: events[0]?.received_at ?? null, receiving, read_at: now.toISOString() };
  }
}
