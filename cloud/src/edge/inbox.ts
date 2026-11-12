// Inbound invoices by e-mail, through a Cloudflare Queue (developers.cloudflare.com/queues): where the cloud runs the
// company's engine, a supplier's e-mail to <slug>@<MAIL_DOMAIN> is filed into that engine without anyone waiting on it.
//
//   e-mail ──► the Worker's email handler: stored as it always was (cloud/src/mail.ts, inbound_mail 'queued'),
//              then one message { tenant_id, mail_id } on INBOX_QUEUE; the sender's delivery never waits on the engine
//   INBOX_QUEUE ──► the Worker's queue handler (fileMail): the stored e-mail through the engine's own inbox (each
//              PDF attached is filed, read and checked), and the inbound_mail row marked done or refused, with a note
//
// Never twice: only a row still 'queued' is filed and it is marked once (the update takes it from 'queued'); and should
// a message come again after the engine took the e-mail but before the row was marked, the engine's inbox answers
// duplicate_document for each PDF it already holds (by its SHA-256), so nothing is filed twice.
//
// Retries: a failure that is not the inbox's own refusal (the engine did not answer, the store was away) is retried
// by the queue, later each time, MAIL_ATTEMPTS times in all; then the row is marked refused with the reason, which is
// the dead-letter state a person sees (GET /v1/mail lists queued mail; the row keeps its note). The queue's own
// dead-letter queue (cloud/wrangler.jsonc) only holds what this code could not even mark.
//
// Off unless bound: without INBOX_QUEUE, or without the engine, mail waits for the company's runner as before.
// Test money only, like the engine. A hands-on visitor's company (t_try_) takes no mail.
import { logEvent, redact } from "../log.js";
import type { Blobs, Sql } from "../store.js";
import type { EngineApi } from "../engine/api.js";
import { slugOf } from "../mail.js";
import { TenantDb } from "../tenant.js";

export interface MailJob { tenant_id: string; mail_id: string }
/** The Queue binding's producer side, as used here. */
export interface MailQueue { send(body: MailJob): Promise<unknown> }
/** One message as the queue handler gets it. */
export interface QueuedMessage { body: unknown; attempts: number; ack(): void; retry(o?: { delaySeconds?: number }): void }

/** Attempts in all before the row is marked refused (the consumer's max_retries in cloud/wrangler.jsonc is higher). */
export const MAIL_ATTEMPTS = 5;
const ID = /^[A-Za-z0-9_-]{1,120}$/;

/** After the e-mail handler stored a message: one message on the queue for the company it was for. */
export async function enqueueMail(sql: Sql, queue: MailQueue, a: { to: string; domain: string; mailId: string }): Promise<boolean> {
  const slug = slugOf(a.to, a.domain);
  const tenant = slug ? await sql.first<{ id: string }>("SELECT id FROM tenants WHERE slug = ? AND closed_at IS NULL", [slug]) : null;
  if (!tenant || tenant.id.startsWith("t_try_")) return false;
  await queue.send({ tenant_id: tenant.id, mail_id: a.mailId });
  return true;
}

/**
 * The daily job: e-mail still queued an hour after it came is put on the queue again (a send that failed after the
 * e-mail was stored, a message the queue lost). Safe: a row that is no longer queued is left alone by fileMail.
 */
export async function requeueWaitingMail(sql: Sql, queue: MailQueue, now: Date, max = 200): Promise<number> {
  const rows = await sql.all<{ tenant_id: string; id: string }>(
    `SELECT m.tenant_id, m.id FROM inbound_mail m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.status = 'queued' AND m.received_at < ? AND t.closed_at IS NULL AND m.tenant_id NOT LIKE 't\\_try\\_%' ESCAPE '\\'
     ORDER BY m.received_at LIMIT ?`, [new Date(now.getTime() - 3_600_000).toISOString(), max]);
  for (const r of rows) await queue.send({ tenant_id: r.tenant_id, mail_id: r.id });
  return rows.length;
}

export type Filed = { outcome: "filed" | "refused" | "skipped"; note: string } | { outcome: "retry"; note: string };

/** One queued e-mail into the company's engine; the answer says whether the queue should try it again. */
export async function fileMail(env: { sql: Sql; blobs: Blobs; engine: (tenantId: string) => EngineApi }, body: unknown, attempts: number): Promise<Filed> {
  const job = body as Partial<MailJob> | null;
  if (!job || typeof job.tenant_id !== "string" || typeof job.mail_id !== "string" || !ID.test(job.tenant_id) || !ID.test(job.mail_id)) return { outcome: "skipped", note: "not a message of this queue" };
  if (job.tenant_id.startsWith("t_try_")) return { outcome: "skipped", note: "a hands-on company takes no mail" };
  const db = new TenantDb(env.sql, job.tenant_id);
  const row = await db.one<{ status: string; blob_key: string }>("inbound_mail", { id: job.mail_id });
  if (!row || row.status !== "queued") return { outcome: "skipped", note: row ? `already ${row.status}` : "no such e-mail" };
  const mark = async (status: "done" | "refused", note: string): Promise<void> => {
    await db.change(db.update("inbound_mail", { id: job.mail_id!, status: "queued" }, { status, note: note.slice(0, 500) }));
  };
  try {
    const bytes = await env.blobs.get(row.blob_key);
    if (!bytes) {
      await mark("refused", "the stored e-mail is gone; nothing was filed");
      return { outcome: "refused", note: "the stored e-mail is gone" };
    }
    const out = await env.engine(job.tenant_id).upload({ bytes, filename: `${job.mail_id}.eml`, mime: "message/rfc822" });
    const note = `filed by the cloud's engine (${out.kind})`;
    await mark("done", note);
    return { outcome: "filed", note };
  } catch (e) {
    const said = redact(e instanceof Error ? e.message : String(e)).slice(0, 400);
    // The inbox's own refusal ("...; nothing was filed") does not change on a retry.
    if (/nothing was filed$/.test(said) || attempts >= MAIL_ATTEMPTS) {
      const note = /nothing was filed$/.test(said) ? said : `not filed after ${attempts} attempts: ${said}`;
      try { await mark("refused", note); } catch { return { outcome: "retry", note: said }; }
      logEvent("warn", "inbox_mail_refused", { tenant: job.tenant_id, mail: job.mail_id, attempts });
      return { outcome: "refused", note };
    }
    return { outcome: "retry", note: said };
  }
}

/** The Worker's queue handler: each message filed, acknowledged, or retried later (30 s, then 60 s, ...). */
export async function consumeMail(env: { sql: Sql; blobs: Blobs; engine: (tenantId: string) => EngineApi }, messages: readonly QueuedMessage[]): Promise<void> {
  for (const m of messages) {
    let out: Filed;
    try { out = await fileMail(env, m.body, m.attempts); } catch (e) { out = { outcome: "retry", note: e instanceof Error ? e.message : String(e) }; }
    if (out.outcome === "retry") m.retry({ delaySeconds: Math.min(30 * Math.max(1, m.attempts), 600) });
    else m.ack();
  }
}
