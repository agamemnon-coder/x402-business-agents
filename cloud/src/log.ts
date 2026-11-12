// The cloud's logs: one JSON object per line (Workers Logs indexes the fields), and nothing in them that is a secret or
// personal: fields named like a secret are dropped to "[redacted]", account numbers keep their last four characters,
// API keys and session tokens in free text are cut, and e-mail addresses are reduced to their domain.

type Level = "info" | "warn" | "error";

const SECRET_NAME = /(secret|token|authorization|password|cookie|api_key|^key$|signature)/i;
const ACCOUNT_NAME = /^(iban|account|account_number|bank_account)$/i;
/** An IBAN, with or without its groups of four (two letters, two digits, 11–30 more letters, digits and spaces). */
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
/** Purser's own keys and session tokens (pck_…, pcs_…), whsec_ webhook secrets, and a Bearer value. */
const TOKEN = /\b(?:pck|pcs|whsec)_[A-Za-z0-9_-]{6,}|Bearer\s+\S+/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

const last4 = (s: string) => `…${s.replace(/\s+/g, "").slice(-4)}`;

/** A text with every account number, key, token and e-mail address taken out. */
export function redact(s: string): string {
  return s.replace(TOKEN, "[redacted]").replace(IBAN, (m) => last4(m)).replace(EMAIL, (_m, domain: string) => `…@${domain}`);
}

function clean(v: unknown, name: string, depth: number): unknown {
  if (SECRET_NAME.test(name) && !/_id$/i.test(name)) return "[redacted]";
  if (typeof v === "string") return ACCOUNT_NAME.test(name) ? last4(v) : redact(v);
  if (v === null || typeof v !== "object") return v;
  if (depth > 4) return "[nested]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, name, depth + 1));
  if (v instanceof Error) return redact(v.message).slice(0, 300);
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clean(x, k, depth + 1)]));
}

/** One log line: { ts, level, event, ...fields }, every field cleaned. */
export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}, now = new Date()): void {
  const line = JSON.stringify({ ts: now.toISOString(), level, event, ...(clean(fields, "", 0) as Record<string, unknown>) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}
