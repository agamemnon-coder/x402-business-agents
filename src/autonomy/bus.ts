// D19: the world and the agents' messages, in the ledger. The demo changes the world (a price notice, a dispute, an
// invoice, a decline, money in) by publishing an event; code that meets something an agent should know (a refusal on
// chain) publishes one too. Agents talk to each other only through messages here; no code passes one agent's words to
// another. Each agent reads from its own cursor, so nothing is handled twice.

import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { redactSecrets } from "../lib/redact.js";

export type AgentName = "sourcing" | "support" | "treasury";
export const AGENT_NAMES: AgentName[] = ["sourcing", "support", "treasury"];

export interface WorldEvent { id: number; kind: string; for_agent: string | null; payload: Record<string, unknown>; created_at: string }
export interface AgentMessage { id: number; from_agent: string; to_agent: string; text: string; created_at: string }

/** Publishes a world event, for one agent or (null) for all. */
export function publish(db: DB, kind: string, payload: Record<string, unknown>, forAgent: AgentName | null = null, by: Actor = "system", now = new Date()): number {
  const id = Number(db.prepare("INSERT INTO world_events (kind, for_agent, payload_json, created_at) VALUES (?, ?, ?, ?)").run(kind, forAgent, JSON.stringify(payload), now.toISOString()).lastInsertRowid);
  audit(db, by, "world.event", String(id), { kind, for_agent: forAgent, payload: payload as never }, now);
  return id;
}

/** One agent's message to another, at most 600 characters, redacted; logged in the audit chain as the agent's. */
/** `by`: who wrote it, Claude (the agent's send_message tool) or code (a fallback); the page labels it so. */
export function sendMessage(db: DB, from: AgentName, to: AgentName, text: string, now = new Date(), by: "claude" | "code" = "code"): number {
  if (from === to) throw new Error("an agent does not message itself");
  const clean = redactSecrets(text.trim()).slice(0, 600);
  const id = Number(db.prepare("INSERT INTO agent_messages (from_agent, to_agent, text, created_at) VALUES (?, ?, ?, ?)").run(from, to, clean, now.toISOString()).lastInsertRowid);
  audit(db, from, "agent.message", String(id), { from, to, text: clean, by }, now);
  return id;
}

/** What this agent has not read yet. */
export function pending(db: DB, agent: AgentName): { events: WorldEvent[]; messages: AgentMessage[]; lastTickAt: string | null } {
  const c = (db.prepare("SELECT last_event_id, last_message_id, last_tick_at FROM agent_cursors WHERE agent = ?").get(agent) as { last_event_id: number; last_message_id: number; last_tick_at: string | null } | undefined) ?? { last_event_id: 0, last_message_id: 0, last_tick_at: null };
  const events = (db.prepare("SELECT id, kind, for_agent, payload_json, created_at FROM world_events WHERE id > ? AND (for_agent IS NULL OR for_agent = ?) ORDER BY id").all(c.last_event_id, agent) as { id: number; kind: string; for_agent: string | null; payload_json: string; created_at: string }[])
    .map((e) => ({ id: e.id, kind: e.kind, for_agent: e.for_agent, payload: JSON.parse(e.payload_json) as Record<string, unknown>, created_at: e.created_at }));
  const messages = db.prepare("SELECT id, from_agent, to_agent, text, created_at FROM agent_messages WHERE id > ? AND to_agent = ? ORDER BY id").all(c.last_message_id, agent) as AgentMessage[];
  return { events, messages, lastTickAt: c.last_tick_at };
}

/** Marks everything up to these ids as read, and the time of this wake. */
export function advance(db: DB, agent: AgentName, upTo: { eventId: number; messageId: number }, now = new Date()): void {
  db.prepare(`INSERT INTO agent_cursors (agent, last_event_id, last_message_id, last_tick_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(agent) DO UPDATE SET last_event_id = MAX(last_event_id, excluded.last_event_id), last_message_id = MAX(last_message_id, excluded.last_message_id), last_tick_at = excluded.last_tick_at`)
    .run(agent, upTo.eventId, upTo.messageId, now.toISOString());
}
