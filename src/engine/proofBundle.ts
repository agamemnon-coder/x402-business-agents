// The proof bundle of one /try payment (src/proof/bundle.ts says what it holds and what checks it), made by the engine
// from what it already has at the pay route: the stored terms, the credential the browser sent, the company's
// passkey (its public key and rpId), the decision, and the ledger. Only a test company's (the hands-on demo's).

import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { DB } from "../db/open.js";
import { ledgerRows, type LedgerEntry } from "../ledger/core.js";
import { canonicalTerms, termsHash, type Terms } from "../lib/terms.js";
import type { PasskeyRow } from "../passkey/ledger.js";
import { PROOF_FORMAT, type ProofBundle, type ProofLedgerEntry } from "../proof/bundle.js";

const B64U = /^[A-Za-z0-9_-]{1,8192}$/;
/** At most this many of the invoice's entries travel in the file. */
const ENTRIES_MAX = 12;

export const PROOF_NOTE = "A /try test company: test money only, nothing real moved. Check this file on /verify or with npm run verify-bundle -- <file>.";

/** The credential's four fields, when it has their shape; nothing else from it travels (no user handle). */
function assertionOf(credential: unknown): ProofBundle["assertion"] | null {
  const c = credential as { id?: unknown; response?: { authenticatorData?: unknown; clientDataJSON?: unknown; signature?: unknown } } | null;
  const r = c && typeof c === "object" ? c.response : undefined;
  const f = [c?.id, r?.authenticatorData, r?.clientDataJSON, r?.signature];
  if (!f.every((x) => typeof x === "string" && B64U.test(x))) return null;
  return { credential_id: f[0] as string, authenticatorData: f[1] as string, clientDataJSON: f[2] as string, signature: f[3] as string };
}

/** COSE's alg (key 3) of the stored key: -7 is ES256, -257 RS256. */
function coseAlg(cose: string): number | null {
  try {
    const m = isoCBOR.decodeFirst<Map<number, unknown>>(new Uint8Array(Buffer.from(cose, "base64url")));
    const alg = m instanceof Map ? m.get(3) : undefined;
    return typeof alg === "number" ? alg : null;
  } catch {
    return null;
  }
}

/**
 * The payment's own entries, matched on exact keys (never a substring): the invoice's (ap-accrual|<id>, ap-…|<id>), the
 * transfer's (transfer|<the signed transfer_request_id>|…) and its conversion's (fx|<conversion id>|…).
 */
function paymentEntries(rows: LedgerEntry[], m: { invoiceId: string | null; transferRequestId: string | null; conversionId: string | null }): ProofLedgerEntry[] {
  const mine = (key: string | null) => {
    if (!key) return false;
    const [kind, id] = key.split("|");
    if (kind?.startsWith("ap-")) return !!m.invoiceId && id === m.invoiceId;
    if (kind === "transfer") return !!m.transferRequestId && id === m.transferRequestId;
    if (kind === "fx") return !!m.conversionId && id === m.conversionId;
    return false;
  };
  return rows.filter((e) => mine(e.source_key)).slice(-ENTRIES_MAX) as ProofLedgerEntry[];
}

export interface ProofInput {
  proposalId: string;
  stored: Record<string, unknown>;
  sent: Record<string, unknown>;
  credential: unknown;
  passkey: PasskeyRow | null;
  decision: ProofBundle["decision"];
  now: Date;
}

/** The bundle, or null when there is nothing a reader could check (no passkey, or a credential of another shape). */
export function proofBundle(db: DB, p: ProofInput): ProofBundle | null {
  const assertion = assertionOf(p.credential);
  if (!assertion || !p.passkey) return null;
  const canonical = canonicalTerms(p.stored as unknown as Terms);
  const sha = termsHash(p.stored as unknown as Terms);
  const invoice = db.prepare("SELECT id FROM ap_invoices WHERE proposal_id = ?").get(p.proposalId) as { id: string } | undefined;
  const rows = ledgerRows(db);
  const conv = (p.stored as { conversion?: { request_id?: unknown } | null }).conversion;
  const conversionId = conv && typeof conv.request_id === "string"
    ? (db.prepare("SELECT conversion_id FROM fx_conversions WHERE request_id = ?").get(conv.request_id) as { conversion_id: string } | undefined)?.conversion_id ?? null : null;
  const transferRequestId = typeof p.stored.transfer_request_id === "string" ? p.stored.transfer_request_id : null;
  const asked = sha === termsHash(p.sent as unknown as Terms) ? undefined
    : { terms: p.sent, canonical: canonicalTerms(p.sent as unknown as Terms), sha256: termsHash(p.sent as unknown as Terms) };
  return {
    format: PROOF_FORMAT, note: PROOF_NOTE, made_at: p.now.toISOString(), proposal_id: p.proposalId,
    terms: p.stored, canonical, terms_sha256: sha, rp_id: p.passkey.rp_id, origin: p.passkey.origin, assertion,
    public_key: { format: "cose", cose: p.passkey.public_key, alg: coseAlg(p.passkey.public_key) },
    decision: p.decision,
    ...(asked ? { asked } : {}),
    ledger: { entries: paymentEntries(rows, { invoiceId: invoice?.id ?? null, transferRequestId, conversionId }), head: rows.length ? rows[rows.length - 1]!.entry_hash : null, count: rows.length },
  };
}
