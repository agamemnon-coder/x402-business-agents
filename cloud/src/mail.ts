// Inbound e-mail: Cloudflare Email Routing hands every message for <tenant-slug>@<domain> to the Worker. The cloud
// stores the raw message (R2) and queues it; the company's Purser runner pulls it, files its PDF attachments through
// the inbox (src/ap/inbox.ts, ingestEmail) and marks it done. An unknown address is refused at the door.

import { bump } from "./auth.js";
import { sha256Hex } from "./crypto.js";
import type { Blobs, Sql } from "./store.js";
import { TenantDb, WriteConflict } from "./tenant.js";

/** The parts of Cloudflare's ForwardableEmailMessage used here. */
export interface InboundEmail {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array> | Uint8Array;
  readonly rawSize: number;
  setReject(reason: string): void;
}

export const MAX_MAIL_BYTES = 25 * 1024 * 1024;
/** What one company's address takes in a day (UTC): anyone on the internet can send mail to it. */
export const MAIL_QUOTA = { messagesPerDay: 500, bytesPerDay: 500 * 1024 * 1024 };

export function mailBlobKey(tenantId: string, sha: string): string { return `t/${tenantId}/mail/${sha}.eml`; }

async function bytesOf(raw: InboundEmail["raw"]): Promise<Uint8Array> {
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(await new Response(raw).arrayBuffer());
}

/** The tenant an address belongs to: <slug>@<domain>, or <slug>+anything@<domain> (plus-addressing). */
export function slugOf(address: string, domain: string): string | null {
  const m = /^([a-z0-9][a-z0-9-]{1,40})(?:\+[^@]*)?@(.+)$/i.exec(address.trim());
  if (!m || m[2]!.toLowerCase() !== domain.toLowerCase()) return null;
  return m[1]!.toLowerCase();
}

export async function receiveEmail(sql: Sql, blobs: Blobs, msg: InboundEmail, opts: { domain: string; now: Date; quota?: { messagesPerDay: number; bytesPerDay: number } }): Promise<{ queued: boolean; reason?: string; id?: string }> {
  const refuse = (reason: string) => { msg.setReject(reason); return { queued: false, reason }; };
  if (!opts.domain) return refuse("this address does not take mail");
  const slug = slugOf(msg.to, opts.domain);
  if (!slug) return refuse("unknown address");
  const tenant = await sql.first<{ id: string; closed_at: string | null }>("SELECT id, closed_at FROM tenants WHERE slug = ?", [slug]);
  if (!tenant || tenant.closed_at) return refuse("unknown address");
  if (msg.rawSize > MAX_MAIL_BYTES) return refuse("message too large (25 MB at most)");
  const bytes = await bytesOf(msg.raw);
  if (bytes.length > MAX_MAIL_BYTES) return refuse("message too large (25 MB at most)");
  const sha = await sha256Hex(bytes);
  const db = new TenantDb(sql, tenant.id);
  const id = `m_${sha.slice(0, 24)}`;
  // The same message twice (a resend, a retry) is queued once.
  if (await db.one("inbound_mail", { id })) return { queued: false, reason: "already received", id };
  // The company's daily quota, in messages and bytes: past it, mail is refused until the next day.
  const quota = opts.quota ?? MAIL_QUOTA;
  const day = Math.floor(opts.now.getTime() / 86_400_000) * 86_400;
  // Counted first, then checked (red team round 4: checked first and counted after, sixty deliveries at once all saw
  // the same "used" and got in); a delivery that is refused or turns out to be a duplicate gives its count back.
  const giveBack = async () => { await bump(sql, `mail:${tenant.id}`, day, -1); await bump(sql, `mailbytes:${tenant.id}`, day, -bytes.length); };
  const n = await bump(sql, `mail:${tenant.id}`, day, 1);
  const b = await bump(sql, `mailbytes:${tenant.id}`, day, bytes.length);
  if (n > quota.messagesPerDay || b > quota.bytesPerDay) {
    await giveBack();
    return refuse("this address's daily quota is used up; try again tomorrow");
  }
  const key = mailBlobKey(tenant.id, sha);
  // The bytes first (same message, same key: a second delivery writes the same bytes), then the row. Two deliveries
  // of one message at once both pass the check above; the row's primary key lets one of them in, and the other is
  // "already received", not an error the sender would retry. The quota counts the one that was queued.
  try {
    await blobs.put(key, bytes, { kind: "email" });
    await db.apply([db.insert("inbound_mail", { id, blob_key: key, sha256: sha, size: bytes.length, received_at: opts.now.toISOString(), status: "queued", note: null })]);
  } catch (e) {
    await giveBack();
    if (e instanceof WriteConflict) return { queued: false, reason: "already received", id };
    throw e;
  }
  return { queued: true, id };
}
