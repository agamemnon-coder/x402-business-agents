// What must never be in a published file built from the main run's ledger (the companion record, /trace, the month-end
// pack; Max, 6 Nov): IBAN-shaped strings, emails, long base64 or base64url runs, WebAuthn credential or assertion
// material, JWTs, PEM, sk-/key_/bearer tokens, a field named like a credential, a passkey label, a host other than the
// public ones, and any 64-hex or 0x40-hex value that is not a known hash, transaction or address. Returns what it found.
import { readFileSync } from "node:fs";
import { secretsIn } from "../../src/demo/runLedger.js";
import { TRACE_FILE } from "../../src/demo/runTrace.js";
import { EXPLORER_TX } from "../../src/metal/network.js";

const leaves = (v: unknown, key = ""): [string, string][] => Array.isArray(v) ? v.flatMap((x) => leaves(x, key)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => leaves(x, k)) : [[key, String(v)]];

/** The 64-hex values the companion names as hashes or transactions, and the 0x40-hex addresses the main run's record names. */
export function knownHex(): { known64: Set<string>; known40: Set<string> } {
  const known64 = new Set<string>(), known40 = new Set<string>();
  for (const [key, value] of leaves(JSON.parse(readFileSync(TRACE_FILE, "utf8")))) if (/^(tx|rail_id|row_hash|prev_hash|head|mandate_hash|approval_sha256|proof)$/.test(key)) for (const m of value.matchAll(/[0-9a-f]{64}/gi)) known64.add(m[0].toLowerCase());
  const rec = readFileSync("docs/demo/main-run.json", "utf8");
  for (const m of rec.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) known40.add(m[0].toLowerCase());
  // The record's own hashes: of terms, approvals, mandates, the chain's head, transactions (as cfo-view.test.ts reads them).
  for (const [key, value] of leaves(JSON.parse(rec))) if (/(^|_)(tx|hash|sha256|head|mandate)$/i.test(key)) for (const m of value.matchAll(/[0-9a-f]{64}/gi)) known64.add(m[0].toLowerCase());
  return { known64, known40 };
}

const PATTERNS: [string, RegExp][] = [
  ["an IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/],
  ["an email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/],
  ["a JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a PEM block", /-----BEGIN [A-Z ]*-----/],
  ["an API key", /\bsk-(ant-)?[A-Za-z0-9_-]{16,}|\bkey_[A-Za-z0-9]{12,}|\b(pk|rk|sk)_(live|test)_[A-Za-z0-9]{8,}/],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._-]{12,}/i],
  // As a JSON key (a CSV's column names are checked below).
  ["a credential or assertion field", /"(credential_id|credentialId|assertion|assertion_sha256|attestation|attestationObject|clientDataJSON|authenticatorData|signature|public_key|beneficiary_id|iban|passkey|email|email_sha256|token|secret|private_key|view_key|nonce)"\s*:/i],
  ["a passkey label", /\(passkey [A-Za-z0-9_-]+\)/],
];
// The project's own hosts, Alta's explorer and the SVG namespace. Purser Cloud under More is the project's own
// deployment (purser-try, 12 Nov), so its host is one of ours; the Try tab is the site's own /try (TRY_URL).
const HOSTS = ["testnet.metalntwx.com", "kit11.max-31b.workers.dev", "purser-try.max-31b.workers.dev", "www.w3.org"];

export function privateFindings(text: string, o: { known64: Set<string>; known40: Set<string>; record?: boolean }): string[] {
  const found: string[] = [];
  for (const [what, re] of PATTERNS) { const m = re.exec(text); if (m) found.push(`${what}: ${m[0].slice(0, 60)}`); }
  // A CSV's column names (its first lines: the pack's label, then the header).
  for (const line of text.split(/\r?\n/).slice(0, 2)) for (const col of line.split(",")) if (/^(credential_id|assertion|assertion_sha256|attestation|signature|public_key|beneficiary_id|iban|passkey|email|token|secret|private_key|view_key|nonce)$/i.test(col.trim())) found.push(`a credential or assertion column: ${col}`);
  // A record is also held to the record's own check (no relay host, viewer key, token or key); a page names the
  // project's own site in its preview tags.
  if (o.record) found.push(...secretsIn(text));
  for (const h of new Set([...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]!))) if (!HOSTS.includes(h)) found.push(`a host: ${h}`);
  // A long base64 or base64url run (40+): only hex hashes, transactions and addresses (and explorer links) are that long.
  // The explorer's prefix is cut out as plain text (no pattern built from it); the transaction after it is hex.
  for (const m of text.split(EXPLORER_TX).join(" ").matchAll(/[A-Za-z0-9+/_=-]{40,}/g)) if (!/^(0x)?[0-9a-fA-F]+$/.test(m[0].replace(/^[^0-9a-fA-Fx]+/, ""))) found.push(`a long base64 run: ${m[0].slice(0, 60)}`);
  for (const h of new Set([...text.matchAll(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()))) if (!o.known64.has(h)) found.push(`an unknown 64-hex value: ${h}`);
  for (const h of new Set([...text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)].map((m) => m[0].toLowerCase()))) if (!o.known40.has(h)) found.push(`an unknown address: ${h}`);
  return found;
}
