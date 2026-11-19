// The security event log's shared rules (ASVS 4.0.3 V7.1.3, V7.1.4, V7.2.1, V7.2.2, V8.1.4, V11.1.8): what an event is,
// what it may carry, and when events raise an alarm. Both Workers use it: Purser Cloud keeps its events in D1
// (cloud/src/securityLog.ts), the site's relay in its Durable Object (worker/src/core.ts). No secret and nothing
// personal beyond ids: an address is cut to its network (/24 for IPv4, /48 for IPv6), a detail keeps short plain values
// only, and a field named like a secret is dropped whatever its value.

/** Every kind of security event. A kind ending in .failure, plus rate.limited and access.denied, counts toward an alarm. */
export const SECURITY_KINDS = [
  "auth.failure", // a key, session or token refused (401)
  "auth.success", // a person signed in another way than a passkey (the demo's guest session)
  "passkey.failure", // a passkey sign-in, step-up or enrolment that did not verify
  "passkey.success", // a passkey sign-in or step-up that verified
  "passkey.enrolled", // a passkey added
  "passkey.removed", // a passkey taken away
  "access.denied", // a caller who is known but may not do this (403)
  "rate.limited", // a request turned away by a limit (429)
  "admin.action", // the platform admin did something
  "admin.auth_failure", // a platform admin credential refused
  "key.created",
  "key.revoked",
  "policy.change", // a security setting, webhook, alert target or approval rule changed
  "access.change", // a person added or erased, an enrolment started, an outside account connected or disconnected
  "data.export", // a bulk read of the company's data: an export, a CSV, a staged export's part
  "webhook.signature_failure", // an inbound webhook whose signature did not check
  "tamper.alarm", // a record that changed after it was signed or pushed, or a runner reporting tampered terms
  "alarm.raised", // a threshold below was crossed in its window
] as const;
export type SecurityKind = (typeof SECURITY_KINDS)[number];

export interface AlarmRule {
  /** The rule's name, in the alarm event and on /health. */
  name: string;
  kinds: SecurityKind[];
  /** Events of these kinds in one fixed window, across all callers, that raise the alarm (once per window). */
  threshold: number;
  windowSec: number;
}

/** The defaults; each Worker may set its own thresholds (cloud: SECURITY_ALARMS; relay: its constructor's option). */
export const DEFAULT_ALARM_RULES: AlarmRule[] = [
  { name: "auth_failures", kinds: ["auth.failure", "passkey.failure", "admin.auth_failure", "webhook.signature_failure"], threshold: 50, windowSec: 600 },
  { name: "access_denied", kinds: ["access.denied"], threshold: 50, windowSec: 600 },
  { name: "rate_limited", kinds: ["rate.limited"], threshold: 200, windowSec: 600 },
  { name: "tamper", kinds: ["tamper.alarm"], threshold: 1, windowSec: 600 },
];

/**
 * Thresholds from a setting such as "auth_failures=20,rate_limited=100,window=300": each named rule's threshold, and
 * one window for all. Unknown names and values that are not positive whole numbers are ignored (the default holds).
 */
export function alarmRules(setting: string | undefined, base: AlarmRule[] = DEFAULT_ALARM_RULES): AlarmRule[] {
  const kv = new Map<string, number>();
  for (const part of (setting ?? "").split(",")) {
    const m = /^\s*([a-z_]+)\s*=\s*(\d{1,7})\s*$/.exec(part);
    if (m && Number(m[2]) > 0) kv.set(m[1]!, Number(m[2]));
  }
  return base.map((r) => ({ ...r, threshold: kv.get(r.name) ?? r.threshold, windowSec: kv.get("window") ?? r.windowSec }));
}

/** An address cut to its network: IPv4 a.b.c.0/24, IPv6 its first three groups ::/48; anything else "unknown". */
export function truncatedIp(ip: string | null | undefined): string {
  const v = (ip ?? "").trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (v4 && v4.slice(1).every((x) => Number(x) <= 255)) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) {
    const [head = "", tail = ""] = v.toLowerCase().split("::");
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const groups = v.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
    if (groups.length === 8 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return `${groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/48`;
  }
  return "unknown";
}

const SECRET_NAME = /(secret|token|authorization|password|cookie|api_?key|signature|assertion|challenge|credential_public|private|session$)/i;
/** Things that look like a key, a signed token, a bearer value, an e-mail address or an IBAN, wherever they appear. */
const SECRET_TEXT = /\b(?:pck|pcs|pak|whsec)_[A-Za-z0-9_-]{6,}|\bpc[a-z]\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?|Bearer\s+\S+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;

/**
 * A detail fit for the log: at most 12 fields, names of plain lowercase words, values short strings, numbers, booleans or
 * null; a field named like a secret is dropped, and a string has anything that looks like a key, token, e-mail address
 * or account number cut out.
 */
export function cleanDetail(detail: Record<string, unknown> = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || (SECRET_NAME.test(k) && !/_id$/.test(k))) continue;
    if (typeof v === "string") out[k] = v.replace(SECRET_TEXT, "[redacted]").slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

/** The fixed window an instant falls in, for a rule. */
export const windowStart = (now: Date, windowSec: number): number => Math.floor(now.getTime() / 1000 / windowSec) * windowSec;
