// Anonymous feedback on the end card (master list line 350), only because it can be kept light and safe: three choices
// (useful, unclear, broken) and an optional note of at most 200 characters. One D1 row each, with the hour it came in
// and nothing else: no company id, no address, no user agent, no session. Limited per keyed address (the day's salted
// /64, ./start.ts) to 3 an hour and 300 a day for everyone together; never shown back publicly; read only on the
// owner's admin page (./adminPage.ts), escaped. Behind the switch `feedback` (off when missing).
import { bump } from "../auth.js";
import type { Sql } from "../store.js";
import { addressKey, TryRefused } from "./start.js";

export const FEEDBACK_CHOICES = ["useful", "unclear", "broken"] as const;
export type FeedbackChoice = (typeof FEEDBACK_CHOICES)[number];
export const FEEDBACK_NOTE_MAX = 200;
export const FEEDBACK_PER_ADDRESS_HOUR = 3;
export const FEEDBACK_PER_DAY = 300;

export const FEEDBACK_SCHEMA = "CREATE TABLE IF NOT EXISTS try_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, hour TEXT NOT NULL, choice TEXT NOT NULL CHECK (choice IN ('useful', 'unclear', 'broken')), note TEXT)";

const ready = new WeakMap<Sql, Promise<void>>();
function table(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = sql.run(FEEDBACK_SCHEMA).then(() => undefined).catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

/** A note as stored: control characters out, spaces folded, at most 200 characters; empty is none. */
export function cleanNote(note: string | undefined): string | null {
  if (typeof note !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = note.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, FEEDBACK_NOTE_MAX);
  return s ? s : null;
}

export async function leaveFeedback(a: { sql: Sql; ip: string; choice: FeedbackChoice; note?: string; now: Date }): Promise<{ thanks: true }> {
  const { sql, now } = a;
  if (!(FEEDBACK_CHOICES as readonly string[]).includes(a.choice)) throw new TryRefused(400, "bad_request", "Choose useful, unclear or broken.");
  const hour = Math.floor(now.getTime() / 3_600_000) * 3_600;
  const key = await addressKey(sql, a.ip, now);
  if ((await bump(sql, `tryfeedback-addr:${key}`, hour, 1)) > FEEDBACK_PER_ADDRESS_HOUR) throw new TryRefused(429, "limit", "Thank you, we already have your feedback for this hour.");
  if ((await bump(sql, "tryfeedback-day", Math.floor(now.getTime() / 86_400_000) * 86_400, 1)) > FEEDBACK_PER_DAY) throw new TryRefused(429, "limit", "Thank you. Today's feedback box is full.");
  await table(sql);
  await sql.run("INSERT INTO try_feedback (hour, choice, note) VALUES (?, ?, ?)", [now.toISOString().slice(0, 13), a.choice, cleanNote(a.note)]);
  return { thanks: true };
}

/** For the admin page only: the counts by choice and the latest notes (text, to be escaped where shown). */
export async function feedbackSummary(sql: Sql, limit = 20): Promise<{ counts: Record<FeedbackChoice, number>; notes: { hour: string; choice: string; note: string }[] }> {
  await table(sql);
  const rows = await sql.all<{ choice: string; n: number }>("SELECT choice, COUNT(*) AS n FROM try_feedback GROUP BY choice");
  const notes = await sql.all<{ hour: string; choice: string; note: string }>("SELECT hour, choice, note FROM try_feedback WHERE note IS NOT NULL ORDER BY id DESC LIMIT ?", [limit]);
  return { counts: Object.fromEntries(FEEDBACK_CHOICES.map((c) => [c, Number(rows.find((r) => r.choice === c)?.n ?? 0)])) as Record<FeedbackChoice, number>, notes };
}
