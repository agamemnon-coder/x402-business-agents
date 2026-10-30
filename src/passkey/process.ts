// What the runner does with each submission the relay hands it (tier 2 item 5). Nothing here trusts the relay:
// a body is hostile input until parsed, every signature is verified against the pinned public key, and only then
// does decide() run, in one transaction with the counter update and the stored signature.

import { loosens } from "../policy/rules.js";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { canonicalTerms, rejectionSha256, termsHash, type Terms } from "../lib/terms.js";
import { checkChanges, type PolicyChangeTerms } from "../executors/policyChange.js";
import { approvedAlternative, createProposal, decide, expireDue, type ProposalRow } from "../policy/approvals.js";
import { codeSha256, openWindow, passkeyById, pendPasskey } from "./ledger.js";
import { assertionSha256, verifyApprovalSignature, verifyEnrolmentResponse } from "./webauthn.js";

/** One submission as the relay queued it. Only `ticket` and `body` are used; the body is checked from scratch. */
export interface InboxItem {
  ticket: string;
  kind: "assertion" | "registration" | "policy" | "policy_text" | "ask";
  proposal_id: string | null;
  body: string;
  received_at: string;
}

const B64URL = z.string().regex(/^[A-Za-z0-9_-]+$/);
const CREDENTIAL = {
  id: B64URL.max(1024),
  rawId: B64URL.max(1024),
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
};
const AssertionBody = z.object({
  proposal_id: z.string().regex(/^(P-\d{4,}|C-[0-9a-f]{8})$/),
  terms_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Absent means approve (the phone pages before rejections never sent it). */
  decision: z.enum(["APPROVED", "REJECTED"]).default("APPROVED"),
  credential: z.object({
    ...CREDENTIAL,
    response: z.object({
      clientDataJSON: B64URL.max(8192), authenticatorData: B64URL.max(8192), signature: B64URL.max(2048), userHandle: B64URL.max(512).optional(),
    }),
  }),
});
const RegistrationBody = z.object({
  code: z.string().max(32),
  credential: z.object({
    ...CREDENTIAL,
    response: z.object({
      clientDataJSON: B64URL.max(8192), attestationObject: B64URL.max(16384), transports: z.array(z.string().max(32)).max(8).optional(),
    }),
  }),
});

function parse<T>(schema: z.ZodType<T>, body: string): T | null {
  try {
    const r = schema.safeParse(JSON.parse(body));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export interface AssertionOutcome {
  /** cosigned: the first of two people's approvals (E1, four eyes); the proposal waits for a second person. */
  status: "approved" | "cosigned" | "rejected" | "too_late" | "already" | "refused";
  proposalId: string | null;
  message: string;
  /** For "already": the verdict the phone should see, the first outcome of this very signature if it was handled. */
  ack?: "approved" | "cosigned" | "rejected" | "executed" | "failed" | "too_late" | "already";
}

const DECIDED = new Set(["APPROVED", "EXECUTING", "EXECUTED", "FAILED"]);

/** A passkey approval: verified against the proposal's own hash, then decide() with method passkey. */
export async function processAssertion(db: DB, item: InboxItem, now = new Date()): Promise<AssertionOutcome> {
  // Anyone can post to the relay, so a submission whose signature was not verified never reaches the hash-chained
  // audit log (it would let strangers fill it, with their own text). The phone still gets the reason.
  const refuse = (proposalId: string | null, reason: string): AssertionOutcome => ({ status: "refused", proposalId, message: reason });
  // Refusals that say something about the ledger or about a verified signature are audited, in our own words.
  const refuseAudited = (proposalId: string, reason: string, credentialId?: string): AssertionOutcome => {
    audit(db, "system", "passkey.refused", proposalId, { reason, ticket: item.ticket, credential: credentialId ? credentialId.slice(0, 8) : null }, now);
    return refuse(proposalId, reason);
  };
  const body = parse(AssertionBody, item.body);
  if (!body) return refuse(null, "malformed submission");
  const response = body.credential as AuthenticationResponseJSON;
  const sha = assertionSha256(response);
  const getProposal = (id: string) => db.prepare("SELECT * FROM proposals WHERE proposal_id = ?").get(id) as ProposalRow | undefined;

  const seen = db.prepare("SELECT proposal_id, outcome FROM passkey_assertions WHERE assertion_sha256 = ?").get(sha) as { proposal_id: string; outcome: string } | undefined;
  if (seen) {
    // Handled before (a restart, a resend): report what came of it; nothing runs again.
    const now_ = getProposal(seen.proposal_id)?.status;
    const ack = seen.outcome === "TOO_LATE" ? "too_late" : seen.outcome === "REJECTED" ? "rejected"
      : now_ === "EXECUTED" ? "executed" : now_ === "FAILED" ? "failed" : now_ === "PENDING_APPROVAL" ? "cosigned" : "approved";
    return { status: "already", ack, proposalId: seen.proposal_id, message: `this signature was already handled: ${seen.proposal_id} is ${now_}` };
  }

  const p = getProposal(body.proposal_id);
  if (!p) return refuse(null, `no proposal ${body.proposal_id}`);
  if (body.decision === "REJECTED") return processRejection(db, item, p, response, sha, now);
  if (DECIDED.has(p.status)) return { status: "already", proposalId: p.proposal_id, message: `${p.proposal_id} is already ${p.status}` };
  // An EXPIRED proposal still gets its signature checked, so a late approval is recorded as too late (F1).
  if (p.status !== "PENDING_APPROVAL" && p.status !== "EXPIRED") return refuse(p.proposal_id, `${p.proposal_id} is ${p.status}, not waiting for approval`);
  let intact: boolean;
  try {
    intact = termsHash(JSON.parse(p.terms_json) as Terms) === p.terms_sha256;
  } catch {
    intact = false;
  }
  if (!intact) return refuseAudited(p.proposal_id, `the stored terms of ${p.proposal_id} no longer match their hash`);
  const alternative = approvedAlternative(db, p);
  if (alternative) return refuse(p.proposal_id, `another option, ${alternative}, was already approved`);

  const pk = passkeyById(db, response.id);
  if (!pk) return refuse(p.proposal_id, "this passkey is not enrolled");
  if (pk.status !== "ACTIVE") return refuse(p.proposal_id, "this passkey was revoked");
  const v = await verifyApprovalSignature(response, p.terms_sha256, pk);
  if (!v.ok) return refuse(p.proposal_id, v.reason);

  const approver = `${pk.label} (passkey ${pk.credential_id.slice(0, 8)})`;
  const passkey = { credentialId: pk.credential_id, assertionSha256: sha };
  try {
    return db.transaction((): AssertionOutcome => {
      // Counters only move forward (passkeys that always report 0 stay at 0).
      db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND counter <= ?").run(v.newCounter, pk.credential_id, v.newCounter);
      const current = getProposal(p.proposal_id)!;
      let result: "APPROVED" | "COSIGNED" | "EXPIRED";
      if (current.status === "EXPIRED") {
        audit(db, "human", "approval.too_late", p.proposal_id,
          { terms_sha256: p.terms_sha256, approver, method: "passkey", expires_at: p.expires_at, passkey: { credential_id: pk.credential_id, assertion_sha256: sha } }, now);
        result = "EXPIRED";
      } else {
        const r = decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver, method: "passkey", signedSha256: p.terms_sha256, passkey }, now);
        result = r === "APPROVED" ? "APPROVED" : r === "PENDING_APPROVAL" ? "COSIGNED" : "EXPIRED";
      }
      db.prepare(
        `INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(sha, p.proposal_id, pk.credential_id, p.terms_sha256, JSON.stringify(response), v.newCounter, result === "EXPIRED" ? "TOO_LATE" : "APPROVED", now.toISOString());
      if (result === "COSIGNED") return { status: "cosigned", proposalId: p.proposal_id, message: `${p.proposal_id}: 1 of 2 approvals (${pk.label}); a second person must approve it with their own passkey` };
      return result === "APPROVED"
        ? { status: "approved", proposalId: p.proposal_id, message: `${p.proposal_id} approved with ${approver}` }
        : { status: "too_late", proposalId: p.proposal_id, message: `${p.proposal_id} expired at ${p.expires_at}; nothing was approved` };
    }).immediate();
  } catch (e) {
    return refuseAudited(p.proposal_id, (e as Error).message.slice(0, 240), response.id);
  }
}

/**
 * A passkey rejection. Rejecting is always safe, so the stored terms need not still match their hash and another
 * option may already be approved; only the signature matters, over rejectionSha256(terms hash), which no approval
 * signature can ever match. A late or repeated rejection changes nothing.
 */
async function processRejection(db: DB, item: InboxItem, p: ProposalRow, response: AuthenticationResponseJSON, sha: string, now: Date): Promise<AssertionOutcome> {
  const refuse = (reason: string): AssertionOutcome => ({ status: "refused", proposalId: p.proposal_id, message: reason });
  expireDue(db, now);
  const current = (db.prepare("SELECT status, expires_at FROM proposals WHERE proposal_id = ?").get(p.proposal_id) as { status: string; expires_at: string });
  if (current.status === "EXPIRED") return { status: "already", proposalId: p.proposal_id, message: `${p.proposal_id} expired at ${current.expires_at}; nothing to reject` };
  if (current.status !== "PENDING_APPROVAL") return { status: "already", proposalId: p.proposal_id, message: `${p.proposal_id} is already ${current.status}; nothing to reject` };

  const pk = passkeyById(db, response.id);
  if (!pk) return refuse("this passkey is not enrolled");
  if (pk.status !== "ACTIVE") return refuse("this passkey was revoked");
  const signed = rejectionSha256(p.terms_sha256);
  const v = await verifyApprovalSignature(response, signed, pk);
  if (!v.ok) return refuse(v.reason);

  const approver = `${pk.label} (passkey ${pk.credential_id.slice(0, 8)})`;
  try {
    return db.transaction((): AssertionOutcome => {
      db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND counter <= ?").run(v.newCounter, pk.credential_id, v.newCounter);
      decide(db, { proposalId: p.proposal_id, decision: "REJECTED", typedPrefix: p.terms_sha256.slice(0, 8), approver, method: "passkey", signedSha256: signed,
        passkey: { credentialId: pk.credential_id, assertionSha256: sha } }, now);
      db.prepare(
        `INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)`,
      ).run(sha, p.proposal_id, pk.credential_id, p.terms_sha256, JSON.stringify(response), v.newCounter, now.toISOString());
      return { status: "rejected", proposalId: p.proposal_id, message: `${p.proposal_id} rejected with ${approver}; nothing will be paid` };
    }).immediate();
  } catch (e) {
    audit(db, "system", "passkey.refused", p.proposal_id, { reason: (e as Error).message.slice(0, 240), ticket: item.ticket, credential: pk.credential_id.slice(0, 8) }, now);
    return refuse((e as Error).message.slice(0, 240));
  }
}

const PolicyBody = z.object({ canonical: z.string().max(8192), terms_sha256: z.string().regex(/^[0-9a-f]{64}$/), credential: AssertionBody.shape.credential });
const POLICY_ID = /^C-[0-9a-f]{8}$/;
const POLICY_MAX_TTL_MS = 15 * 60 * 1000;

/**
 * A CFO policy change made on the phone: the page wrote the terms and the passkey signed their hash. The runner
 * checks the terms against the current policy and verifies the signature first; only then does the change become a
 * proposal, approved by that same signature (method passkey). Nothing unsigned ever becomes a proposal.
 */
export async function processPolicyRequest(db: DB, item: InboxItem, now = new Date()): Promise<AssertionOutcome> {
  const refuse = (reason: string): AssertionOutcome => ({ status: "refused", proposalId: null, message: reason });
  const body = parse(PolicyBody, item.body);
  if (!body) return refuse("malformed submission");
  let terms: PolicyChangeTerms;
  try {
    terms = JSON.parse(body.canonical) as PolicyChangeTerms;
    if (canonicalTerms(terms) !== body.canonical || termsHash(terms) !== body.terms_sha256) return refuse("the terms do not hash to the signed hash");
  } catch {
    return refuse("malformed submission");
  }
  if (terms.kind !== "policy_change" || !Array.isArray(terms.changes) || typeof terms.reason !== "string" || terms.reason.length > 500) return refuse("malformed submission");
  if (!POLICY_ID.test(terms.proposal_id)) return refuse("a policy change made on the phone has an id like C-0a1b2c3d");
  const left = Date.parse(terms.expires_at) - now.getTime();
  if (!(left > 0) || left > POLICY_MAX_TTL_MS) return refuse("a policy change must expire within 15 minutes");
  const response = body.credential as AuthenticationResponseJSON;
  const asAssertion: InboxItem = { ...item, kind: "assertion", proposal_id: terms.proposal_id, body: JSON.stringify({ proposal_id: terms.proposal_id, terms_sha256: body.terms_sha256, credential: response }) };
  const existing = db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(terms.proposal_id) as { terms_sha256: string } | undefined;
  // A resend of the same signed change is answered like any repeated approval; another change may not reuse the id.
  if (existing) return existing.terms_sha256 === body.terms_sha256 ? processAssertion(db, asAssertion, now) : refuse(`${terms.proposal_id} already exists`);
  try {
    checkChanges(db, terms.changes);
  } catch (e) {
    return refuse((e as Error).message);
  }
  // The phone's page comes from the relay; a compromised one could slip a loosening into any Face ID prompt. So the
  // phone may only tighten; loosening is proposed on the runner and approved like any proposal (review N2).
  const looser = (terms.changes as { key: string; label?: string; from: string; to: string }[]).filter(loosens);
  if (looser.length) {
    return refuse(`the phone can only tighten the CFO policy; ${looser.map((c) => c.label ?? c.key).join(", ")} would loosen it. Propose that on the runner (npm run policy -- set …) and approve it with Face ID`);
  }
  const pk = passkeyById(db, response.id);
  if (!pk || pk.status !== "ACTIVE") return refuse("this passkey is not the enrolled one");
  const v = await verifyApprovalSignature(response, body.terms_sha256, pk);
  if (!v.ok) return refuse(v.reason);
  createProposal(db, { terms, createdBy: "human" }, now);
  return processAssertion(db, asAssertion, now);
}

export interface RegistrationOutcome {
  status: "enrolled" | "pending" | "refused";
  message: string;
  credentialId: string | null;
}

/** A new passkey: the window must be open, the code right, and the passkey created against the window. */
export async function processRegistration(db: DB, item: InboxItem, opts: { label: string }, now = new Date()): Promise<RegistrationOutcome> {
  // Only a submission with the right code is audited (it came from whoever holds the code), in our own words.
  const refuse = (reason: string): RegistrationOutcome => ({ status: "refused", message: reason, credentialId: null });
  const refuseAudited = (reason: string, detail = reason): RegistrationOutcome => {
    audit(db, "system", "passkey.enrol_refused", null, { reason, ticket: item.ticket }, now);
    return refuse(detail);
  };
  const body = parse(RegistrationBody, item.body);
  if (!body) return refuse("malformed submission");
  const response = body.credential as RegistrationResponseJSON;
  const pinned = passkeyById(db, response.id);
  if (pinned?.status === "ACTIVE") return { status: "enrolled", message: `passkey ${response.id.slice(0, 8)} is enrolled for ${pinned.label}`, credentialId: pinned.credential_id };
  const waiting = db.prepare("SELECT fingerprint FROM passkey_pending WHERE credential_id = ?").get(response.id) as { fingerprint: string } | undefined;
  if (waiting) return { status: "pending", message: `passkey created, fingerprint ${waiting.fingerprint}; it counts once the runner confirms that fingerprint`, credentialId: response.id };
  const w = openWindow(db, now);
  if (!w) return refuse("no enrolment window is open; ask for a new code");
  // The relay checked the code too; the runner does not rely on that.
  if (codeSha256(body.code) !== w.code_sha256) return refuse("wrong enrolment code");
  const v = await verifyEnrolmentResponse(response, w);
  if (!v.ok) return refuseAudited("the new passkey did not verify against the enrolment window", v.reason);
  if (v.credentialId !== response.id) return refuseAudited("the credential id does not match the new passkey");
  let fingerprint: string;
  try {
    fingerprint = pendPasskey(db, {
      window: w, credentialId: v.credentialId, publicKey: v.publicKey, counter: v.counter, transports: v.transports,
      aaguid: v.aaguid, registrationJson: JSON.stringify(response), label: w.label ?? opts.label,
    }, now);
  } catch (e) {
    return refuseAudited((e as Error).message.slice(0, 240));
  }
  // Not pinned yet: the person on the runner confirms the fingerprint the phone shows (security review M3).
  return { status: "pending", message: `passkey created, fingerprint ${fingerprint}; it counts once the runner confirms that fingerprint`, credentialId: v.credentialId };
}
