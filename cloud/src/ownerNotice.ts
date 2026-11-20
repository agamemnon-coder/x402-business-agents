// A change to who can sign in or approve, told to every owner of the company (outside audit, finding 1.3: "make
// credential additions, revocations and recovery externally observable and alert all owners"). One function, used by
// every place that adds, removes or replaces a passkey, an approval key or a security key, and by each step of an owner
// recovery:
//   - a security event in the company's log (GET /v1/security/events, which every owner reads), naming the owners told;
//   - an event to the company's signed alert webhook, when one is set (./monitor.ts notify);
//   - an e-mail to each owner who has an address, through the alert e-mail provider when one is set (./alerts.ts), each
//     with its own idempotency key; not only to whoever made the change.
// It tells; it never approves or undoes anything, and it carries no link, token or code (a notice someone forges could
// otherwise lead an owner to a page of theirs). Telling never fails the request it is about: a failure is logged.
import type { AlertProviders } from "./alerts.js";
import { maskTarget } from "./alerts.js";
import { randomToken } from "./crypto.js";
import { logEvent } from "./log.js";
import { notify, type Outbound } from "./monitor.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

export interface OwnerNoticeEnv { sql: Sql; outbound?: Outbound | undefined; retryDelayMs?: number | undefined; alerts?: AlertProviders | undefined }

/** What happened, in the words of the e-mail's subject (a kind not listed reads "A security setting changed"). */
export const NOTICE_WORDS: Record<string, string> = {
  "passkey.enrolled": "A passkey was added",
  "passkey.removed": "A passkey was removed",
  "approval_key.added": "An approval key was added",
  "approval_key.replaced": "An approval key was replaced",
  "approval_key.removed": "An approval key was removed",
  "approval_key.refused": "A new approval key was refused",
  "approval.refused_cooling_off": "An approval by a key in its cooling-off was refused",
  "security_key.added": "A security key was added",
  "recovery.requested": "An owner recovery was requested",
  "recovery.issued": "An owner recovery key was issued",
  "recovery.completed": "An owner recovery was completed",
  "key.created": "An API key was created",
  "key.revoked": "An API key was revoked",
};

export interface NoticeResult { event_id: string | null; owners: string[]; emails: { owner: string; to: string; status: "sent" | "failed" }[] }

/**
 * Tells every owner of `tenantId` about `kind`: the company's security event (unless `event: false`, when the caller
 * wrote it in its own transaction), the webhook event `hook`, and one e-mail per owner with an address.
 */
export async function tellEveryOwner(env: OwnerNoticeEnv, tenantId: string, n: { kind: string; actor: string; detail: Record<string, string | null>; hook: string; event?: boolean }, now: Date): Promise<NoticeResult> {
  const out: NoticeResult = { event_id: null, owners: [], emails: [] };
  try {
    const t = new TenantDb(env.sql, tenantId);
    const owners = (await t.select<{ id: string; email: string | null; erased_at: string | null }>("users", { role: "owner" }, { order: ["id"] })).filter((o) => !o.erased_at);
    out.owners = owners.map((o) => o.id);
    const iso = now.toISOString();
    if (n.event !== false) {
      out.event_id = `se_${randomToken(9).replace(/[^A-Za-z0-9]/g, "x")}`;
      await t.apply([t.insert("security_events", { id: out.event_id, at: iso, kind: n.kind, actor: n.actor, detail_json: JSON.stringify({ ...n.detail, owners_told: out.owners.join(" ") }) })]);
    }
    const data = Object.fromEntries(Object.entries({ ...n.detail, by: n.actor, at: iso, owners_told: String(out.owners.length) }).map(([k, v]) => [k, v ?? ""]));
    await notify(env.sql, tenantId, n.hook, data, now, env.outbound, env.retryDelayMs);
    const email = env.alerts?.email;
    if (email) {
      const words = NOTICE_WORDS[n.kind] ?? "A security setting changed";
      const facts = Object.entries(n.detail).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");
      const text = `${words} in your company on Purser Cloud, at ${iso.slice(0, 16).replace("T", " ")} UTC, by ${n.actor}.\n${facts}\n\nEvery owner of the company gets this notice. If you did not expect it, sign in to Purser Cloud and look at Settings: remove the passkey or key there. A new or recovered approval key approves nothing before its cooling-off ends.\nThis notice approves nothing and carries no link.`;
      for (const o of owners) {
        if (!o.email) continue;
        const key = `${out.event_id ?? `${n.kind}:${iso}`}:${o.id}`;
        let ok = false;
        try { ok = (await email.send({ to: o.email, subject: `[Purser] ${words}`, text, idempotencyKey: key })).ok; } catch { ok = false; }
        out.emails.push({ owner: o.id, to: maskTarget("email", o.email), status: ok ? "sent" : "failed" });
        logEvent(ok ? "info" : "warn", "security_notice_email", { kind: n.kind, owner: o.id, to: maskTarget("email", o.email), status: ok ? "sent" : "failed" }, now);
      }
    }
  } catch (e) {
    // The security log has the request's event already; only telling the owners failed.
    logEvent("error", "security_tell_owners_failed", { kind: n.kind, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, now);
  }
  return out;
}
