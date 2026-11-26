// A card's limit goes UP at Airwallex only on a verified passkey signature over the exact new limit (security hardening,
// 19 November). Before, Purser pushed whatever the policy table said with its own key, so whoever controlled Purser's
// decision code or wrote the database file could raise a card's limit with nobody's signature (an open risk in
// docs/zero-trust.md). Now, at the moment a limit would go up, the card sync (src/policy/cards.ts) asks here:
//   - the last change of that limit on record (the policy.changed entry policy changes write) names a policy_change
//     proposal that sets it to exactly this value; and
//   - that proposal's stored terms hash to their hash and to the hash on its approval; and
//   - a stored passkey signature over that hash verifies against an enrolled passkey's public key, here, now
//     (the same check `npm run verify` makes), not merely an approval row that says "passkey".
// Without a change on record, one of our own agents' cards may go up to the limit in the code (CARDS), no higher.
// Lowering is never asked about: it stays free (the phone can only tighten, an Airwallex-side lowering stands).
// The same check guards the card's other controls (26 November): wider hours (Purser's own control), a new merchant
// category or a new currency (Airwallex's) reach the card only as signed (cardControlRefusal, allowedCardHours,
// allowedCardControls); narrower ones are free.
// Before any passkey is enrolled (local development, where every approval is by typed hash prefix, as `npm run verify`
// reports it), the approval on record for the exact terms is what there is, and it is what is checked.
// What this does not close (docs/security/2026-11-19-hardening.md): someone who writes the database file AND enrols a
// passkey of their own in it, and anyone with Airwallex web-app or API-key access, who can change the card directly.

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { CARDS, type Agent } from "../config/policy.js";
import type { CardControls, CardLimits } from "../airwallex/issuing.js";
import { canonicalList, cardHoursWithin, cardHoursWords, listOf, listWithin } from "./cardHours.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { approvalHashOf } from "../metal/ownersExecute.js";
import { passkeyById } from "../passkey/ledger.js";
import { sealRefusal } from "../passkey/seal.js";
import { assertionSha256, verifyApprovalSignature } from "../passkey/webauthn.js";

export type LimitPart = "per_tx" | "monthly";
const PARTS: readonly { part: LimitPart; field: "perTxCents" | "monthlyCents" }[] = [{ part: "per_tx", field: "perTxCents" }, { part: "monthly", field: "monthlyCents" }];

interface ProposalRow { proposal_id: string; kind: string; terms_json: string; terms_sha256: string }

/** Why the stored approval of `p` is not a verified signature over its exact terms, or null when it is. */
async function signatureRefusal(db: DB, p: ProposalRow): Promise<string | null> {
  let recomputed: string;
  try {
    recomputed = termsHash(JSON.parse(p.terms_json) as Terms);
  } catch {
    return `the stored terms of ${p.proposal_id} cannot be read`;
  }
  if (recomputed !== p.terms_sha256) return `the stored terms of ${p.proposal_id} no longer hash to their hash`;
  const a = db.prepare("SELECT approved_sha256, decision FROM approvals WHERE proposal_id = ?").get(p.proposal_id) as { approved_sha256: string; decision: string } | undefined;
  if (!a || a.decision !== "APPROVED" || a.approved_sha256 !== recomputed) return `${p.proposal_id} has no approval of its exact terms on record`;
  // Before any passkey is enrolled, approvals are by typed hash prefix (local development); the approval is all there is.
  if ((db.prepare("SELECT COUNT(*) AS n FROM passkeys").get() as { n: number }).n === 0) return null;
  let signed: string;
  try {
    signed = approvalHashOf(p);
  } catch (e) {
    return (e as Error).message;
  }
  const stored = db.prepare("SELECT assertion_sha256, credential_id, terms_sha256, assertion_json, verified_at FROM passkey_assertions WHERE proposal_id = ? AND outcome = 'APPROVED' ORDER BY verified_at").all(p.proposal_id) as
    { assertion_sha256: string; credential_id: string; terms_sha256: string; assertion_json: string; verified_at: string }[];
  for (const s of stored) {
    const pk = passkeyById(db, s.credential_id);
    if (!pk || s.terms_sha256 !== recomputed || Date.parse(pk.enrolled_at) > Date.parse(s.verified_at) || sealRefusal(db, pk)) continue;
    let response: AuthenticationResponseJSON;
    try {
      response = JSON.parse(s.assertion_json) as AuthenticationResponseJSON;
    } catch {
      continue;
    }
    if (response.id !== pk.credential_id || assertionSha256(response) !== s.assertion_sha256) continue;
    if ((await verifyApprovalSignature(response, signed, pk, 0)).ok) return null;
  }
  return `${p.proposal_id} has no passkey signature that verifies over its terms`;
}

/**
 * Why `agent`'s card may not go up to `cents` for `part`, or null when that exact value is signed (or, with no change
 * on record, within the limit in the code for one of our own agents). Reads the ledger and verifies signatures only.
 */
export async function cardRaiseRefusal(db: DB, agent: string, part: LimitPart, cents: number): Promise<string | null> {
  const own = (CARDS as Record<string, (typeof CARDS)[Agent] | undefined>)[agent];
  const coded = own ? (part === "per_tx" ? own.perTxCents : own.monthlyCents) : null;
  return cardControlRefusal(db, `card.${agent}.${part}`, fromCents(cents), coded !== null && cents <= coded, (to) => /^\d+\.\d{2}$/.test(to) && toCents(to) === cents);
}

export interface RaiseRefused { key: string; part: LimitPart; wanted: string; kept: string; reason: string; proposal_id: string | null }

/**
 * The limits the card may be given now: per limit, the policy's value when it is no higher than what the card has
 * (`has`; null for none at all, which nothing is higher than) or when that raise is signed; else what the card has.
 */
export async function allowedCardLimits(db: DB, agent: string, has: CardLimits | null, want: CardLimits): Promise<{ limits: CardLimits; refused: RaiseRefused[] }> {
  const limits: CardLimits = { ...want };
  const refused: RaiseRefused[] = [];
  for (const { part, field } of PARTS) {
    if (!has || want[field] <= has[field]) continue;
    const why = await cardRaiseRefusal(db, agent, part, want[field]);
    if (!why) continue;
    limits[field] = has[field];
    const key = `card.${agent}.${part}`;
    refused.push({ key, part, wanted: fromCents(want[field]), kept: fromCents(has[field]), reason: why, proposal_id: lastProposalOf(db, key) });
  }
  return { limits, refused };
}

/**
 * Why `key` may not be set to `value` on the card, or null when that exact value is signed: the last change of the key
 * on record names a policy_change that sets it to exactly this value (`same`), and its passkey signature verifies.
 * With no change on record, only a value within what the code gives the card (`withinCode`) passes. A raised limit,
 * wider hours, a new merchant category or currency all go through here.
 */
export async function cardControlRefusal(db: DB, key: string, value: string, withinCode: boolean, same: (to: string) => boolean): Promise<string | null> {
  const last = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'policy.changed' AND subject = ? ORDER BY seq DESC LIMIT 1").get(key) as { payload_json: string } | undefined;
  if (!last) return withinCode ? null : `no signed change sets ${key} to ${value}`;
  const proposalId = String((JSON.parse(last.payload_json) as { proposal_id?: unknown }).proposal_id ?? "");
  const p = db.prepare("SELECT proposal_id, kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as ProposalRow | undefined;
  if (!p || p.kind !== "policy_change") return `the last change of ${key} names no policy change on record`;
  let to: string | undefined;
  try {
    to = (JSON.parse(p.terms_json) as { changes?: { key: string; to: string }[] }).changes?.find((c) => c.key === key)?.to;
  } catch {
    to = undefined;
  }
  if (typeof to !== "string" || !same(to)) return `the last change of ${key} (${p.proposal_id}) sets ${to ?? "nothing"}, not ${value}`;
  return signatureRefusal(db, p);
}

const lastProposalOf = (db: DB, key: string): string | null =>
  (db.prepare("SELECT json_extract(payload_json, '$.proposal_id') AS id FROM audit_log WHERE event = 'policy.changed' AND subject = ? ORDER BY seq DESC LIMIT 1").get(key) as { id: string | null } | undefined)?.id ?? null;

/**
 * The hours the card may be given now: the policy's when they are within what the card has (`has`, cards.hours; ""
 * is any time) or when that widening is signed; else what the card has. Hours are Purser's control, not Airwallex's.
 * The code gives a card no hours (any time), so with no change on record any hours are within it.
 */
export async function allowedCardHours(db: DB, agent: string, has: string, want: string): Promise<{ hours: string; refused: Refused[] }> {
  const key = `card.${agent}.hours`;
  const why = cardHoursWithin(want, has) ? null : await cardControlRefusal(db, key, want, true, (to) => cardHoursWords(to) === cardHoursWords(want));
  return why ? { hours: has, refused: [{ key, wanted: cardHoursWords(want), kept: cardHoursWords(has), reason: why, proposal_id: lastProposalOf(db, key) }] } : { hours: want, refused: [] };
}

/**
 * The merchant categories and currencies the card may be given now (Airwallex controls): per list, the policy's when
 * every entry is already on the card at Airwallex (`has`; an empty list there allows any) or the addition is signed;
 * else what the card has. `code` is what the code gives the card (agentCardControls), which needs no signature.
 */
export async function allowedCardControls(db: DB, agent: string, has: Pick<CardControls, "mccs" | "currencies"> | null | undefined, want: CardControls, code: Pick<CardControls, "mccs" | "currencies">): Promise<{ controls: CardControls; refused: Refused[] }> {
  const controls: CardControls = { ...want };
  const refused: Refused[] = [];
  for (const part of ["mccs", "currencies"] as const) {
    const had = (has?.[part] ?? []).join(","), wanted = want[part].join(","), key = `card.${agent}.${part}`;
    const why = !had || listWithin(wanted, had) ? null : await cardControlRefusal(db, key, wanted, listWithin(wanted, code[part].join(",")), (to) => canonicalList(to) === canonicalList(wanted));
    if (!why) continue;
    controls[part] = listOf(had).sort();
    refused.push({ key, wanted, kept: had, reason: why, proposal_id: lastProposalOf(db, key) });
  }
  return { controls, refused };
}

/** A refused loosening of a card control: kept as the card has it (recorded by recordRaiseRefusals as card.loosening_refused). */
export interface Refused { key: string; wanted: string; kept: string; reason: string; proposal_id: string | null }

/** Records each refused raise once: the same refusal again (the runner's check every few seconds) is not written twice. */
export function recordRaiseRefusals(db: DB, agent: string, refused: readonly Refused[], now: Date, event: "card.raise_refused" | "card.loosening_refused" = "card.raise_refused"): void {
  for (const r of refused) {
    const last = db.prepare("SELECT payload_json FROM audit_log WHERE event = ? AND subject = ? AND json_extract(payload_json, '$.key') = ? ORDER BY seq DESC LIMIT 1").get(event, agent, r.key) as { payload_json: string } | undefined;
    const prev = last ? JSON.parse(last.payload_json) as Partial<Refused> : null;
    if (prev && prev.wanted === r.wanted && prev.kept === r.kept && prev.reason === r.reason) continue;
    audit(db, "system", event, agent, { agent, key: r.key, wanted: r.wanted, kept: r.kept, reason: r.reason, proposal_id: r.proposal_id }, now);
  }
}
