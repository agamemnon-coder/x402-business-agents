// What the runner does with each submission the relay hands it (tier 2 item 5). Nothing here trusts the relay:
// a body is hostile input until parsed, every signature is verified against the pinned public key, and only then
// does decide() run, in one transaction with the counter update and the stored signature.

import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { approvedAlternative, decide, type ProposalRow } from "../policy/approvals.js";
import { codeSha256, openWindow, passkeyById, recordPasskey } from "./ledger.js";
import { assertionSha256, verifyApprovalSignature, verifyEnrolmentResponse } from "./webauthn.js";

/** One submission as the relay queued it. Only `ticket` and `body` are used; the body is checked from scratch. */
export interface InboxItem {
  ticket: string;
  kind: "assertion" | "registration";
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
  proposal_id: z.string().regex(/^P-\d{4,}$/),
  terms_sha256: z.string().regex(/^[0-9a-f]{64}$/),
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
  status: "approved" | "too_late" | "already" | "refused";
  proposalId: string | null;
  message: string;
  /** For "already": the verdict the phone should see, the first outcome of this very signature if it was handled. */
  ack?: "approved" | "executed" | "failed" | "too_late" | "already";
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
    const ack = seen.outcome === "TOO_LATE" ? "too_late" : now_ === "EXECUTED" ? "executed" : now_ === "FAILED" ? "failed" : "approved";
    return { status: "already", ack, proposalId: seen.proposal_id, message: `this signature was already handled: ${seen.proposal_id} is ${now_}` };
  }

  const p = getProposal(body.proposal_id);
  if (!p) return refuse(null, `no proposal ${body.proposal_id}`);
  if (DECIDED.has(p.status)) return { status: "already", proposalId: p.proposal_id, message: `${p.proposal_id} is already ${p.status}` };
  // An EXPIRED proposal still gets its signature checked, so a late approval is recorded as too late (F1).
  if (p.status !== "PENDING_APPROVAL" && p.status !== "EXPIRED") return refuse(p.proposal_id, `${p.proposal_id} is ${p.status}, not waiting for approval`);
  let intact = false;
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
      let result: "APPROVED" | "EXPIRED";
      if (current.status === "EXPIRED") {
        audit(db, "human", "approval.too_late", p.proposal_id,
          { terms_sha256: p.terms_sha256, approver, method: "passkey", expires_at: p.expires_at, passkey: { credential_id: pk.credential_id, assertion_sha256: sha } }, now);
        result = "EXPIRED";
      } else {
        const r = decide(db, { proposalId: p.proposal_id, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver, method: "passkey", signedSha256: p.terms_sha256, passkey }, now);
        result = r === "APPROVED" ? "APPROVED" : "EXPIRED";
      }
      db.prepare(
        `INSERT INTO passkey_assertions (assertion_sha256, proposal_id, credential_id, terms_sha256, assertion_json, counter, outcome, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(sha, p.proposal_id, pk.credential_id, p.terms_sha256, JSON.stringify(response), v.newCounter, result === "APPROVED" ? "APPROVED" : "TOO_LATE", now.toISOString());
      return result === "APPROVED"
        ? { status: "approved", proposalId: p.proposal_id, message: `${p.proposal_id} approved with ${approver}` }
        : { status: "too_late", proposalId: p.proposal_id, message: `${p.proposal_id} expired at ${p.expires_at}; nothing was approved` };
    }).immediate();
  } catch (e) {
    return refuseAudited(p.proposal_id, (e as Error).message.slice(0, 240), response.id);
  }
}

export interface RegistrationOutcome {
  status: "enrolled" | "refused";
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
  const w = openWindow(db, now);
  if (!w) return refuse("no enrolment window is open; ask for a new code");
  // The relay checked the code too; the runner does not rely on that.
  if (codeSha256(body.code) !== w.code_sha256) return refuse("wrong enrolment code");
  const v = await verifyEnrolmentResponse(response, w);
  if (!v.ok) return refuseAudited("the new passkey did not verify against the enrolment window", v.reason);
  if (v.credentialId !== response.id) return refuseAudited("the credential id does not match the new passkey");
  try {
    recordPasskey(db, {
      window: w, credentialId: v.credentialId, publicKey: v.publicKey, counter: v.counter, transports: v.transports,
      aaguid: v.aaguid, registrationJson: JSON.stringify(response), label: opts.label,
    }, now);
  } catch (e) {
    return refuseAudited((e as Error).message.slice(0, 240));
  }
  return { status: "enrolled", message: `passkey ${v.credentialId.slice(0, 8)} enrolled for ${opts.label}; approvals now need it`, credentialId: v.credentialId };
}
