// The eIDAS evidence export (option, off by default: src/eidas/flag.ts). One signed approval as a JWS JSON
// Serialization (RFC 7515 clause 7.2.1) in the layout of ETSI TS 119 182-1 V1.2.1 (JAdES), and its offline verifier.
//
// What the file holds. The payload is the approval's evidence, canonical JSON (RFC 8785): the canonical terms and their
// SHA-256, each passkey's WebAuthn assertion with its public key, rpId and origin, the CFO policy version it was
// signed under, and the times. Optional: an RFC 3161 time-stamp on the payload, and one or more JAdES signatures.
//
// The tiers, said plainly (docs/legal/eidas-qes.md):
//   - The passkey assertion is an electronic signature (eIDAS art. 3(10)) over the terms hash. It is not a JWS
//     signature and cannot be made one: WebAuthn signs authenticatorData ‖ SHA-256(clientDataJSON), never a JWS
//     signing input. So it rides inside the payload, and the verifier checks it by WebAuthn's own rules, with the very
//     function the runner uses (src/passkey/webauthn.ts). Whether it also meets art. 26 (advanced) depends on how the
//     key is tied to the CFO; it is never a qualified electronic signature.
//   - With no QES, `signatures` is empty: the file is evidence in JAdES layout, not a JAdES signature.
//   - With the QES adapter (src/eidas/csc.ts), signatures[0] is a JAdES baseline signature over the payload (B-B: alg,
//     x5c, x5t#S256, iat, srCms "ProofOfApproval"; B-T when a sigTst time-stamp is added). It is a QES only if the
//     certificate is a qualified certificate from a QTSP and the key sits in a QSCD: the verifier reads what the
//     certificate claims (QC statements, ETSI EN 319 412-5) and says that the EU Trusted List is not checked offline.
//     Status: built and tested against a mock CSC server; needs a QTSP account to run live.

import { createHash, verify as cryptoVerify, X509Certificate } from "node:crypto";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import type { DB } from "../db/open.js";
import { approvalHashOf, OWNERS_EXECUTE } from "../metal/ownersExecute.js";
import type { PasskeyRow } from "../passkey/ledger.js";
import { verifyApprovalSignature } from "../passkey/webauthn.js";
import type { ProofBundle } from "../proof/bundle.js";
import type { QesAdapter } from "./csc.js";
import { children, OID, oidOf, readOne } from "./der.js";
import { requireEidas } from "./flag.js";
import { verifyTimestampToken } from "./tsa.js";

export const EVIDENCE_FORMAT = "purser.approval-evidence/v1";
export const JADES_EXPORT_FORMAT = "purser.jades-export/v1";
/** The file's name as the CLI writes it next to its source. */
export const JADES_SUFFIX = ".jades.json";
/** The commitment type of a JAdES signature here (ETSI EN 319 132-1 / TS 119 172-1): proof of approval. */
export const PROOF_OF_APPROVAL = "http://uri.etsi.org/01903/v1.2.2#ProofOfApproval";

/** Fixed text in every file; the verifier holds it to these words, so the file cannot say more about itself. */
export const EXPORT_NOTE =
  "Purser approval evidence in JAdES layout (ETSI TS 119 182-1). The passkey assertion in the payload is an electronic signature over the terms hash, not a qualified electronic signature. A JAdES signature, when present, is a QES only if its certificate is qualified and issued by a QTSP on the EU Trusted List. Test money only. Not legal advice.";

/** What a valid file proves, and what it does not: printed by `npm run verify-eidas` under VALID. */
export const EIDAS_MEANS = [
  "Proves: each passkey in the file signed exactly these terms (their SHA-256), with user verification, for this site (its rpId and origin).",
  "That passkey signature is an electronic signature (eIDAS art. 3(10)); it may meet the advanced requirements of art. 26 depending on how the key is tied to the CFO. It is not a qualified electronic signature.",
  "A JAdES signature, if any: it verifies with the certificate inside the file. Whether that certificate is qualified, and its issuer a QTSP on the EU Trusted List, is not checked offline.",
  "A time-stamp, if any: it verifies with the TSA certificate inside the token; whether the TSA is qualified (art. 42) is not checked offline.",
  "Not legal advice. A test company: test money only.",
] as const;

export interface PasskeySignatureEvidence {
  credential_id: string;
  rp_id: string;
  origin: string;
  /** COSE, base64url; alg -7 is ES256, -257 RS256. */
  public_key: { format: "cose"; cose: string; alg: number | null };
  /** The hash the passkey signed (its challenge): the terms hash, or for an owners' execution the on-chain digest. */
  signed_sha256: string;
  assertion: { authenticatorData: string; clientDataJSON: string; signature: string };
  /** When the runner (or /try's engine) verified the signature. */
  signed_at: string;
}

export interface SignedApproval {
  proposal_id: string;
  terms: Record<string, Json>;
  canonical: string;
  terms_sha256: string;
  /** The CFO policy version the approval was signed under, and its hash (src/policy/versions.ts); null if none recorded. */
  policy: { version: number; sha256: string | null } | null;
  passkeys: PasskeySignatureEvidence[];
  source: "runner-ledger" | "try-proof-bundle";
}

export interface ApprovalEvidence extends SignedApproval {
  format: typeof EVIDENCE_FORMAT;
  decision: "APPROVED";
  exported_at: string;
}

export interface TstContainer { tstTokens: { val: string }[] }
export interface JadesSignature { protected: string; header?: { etsiU: { sigTst: TstContainer }[] }; signature: string }
export interface JadesExport {
  payload: string;
  signatures: JadesSignature[];
  purser: { format: typeof JADES_EXPORT_FORMAT; note: string; payloadTst?: TstContainer };
}

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest();
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
/** A base64url string that is the one encoding of its bytes (no padding, no stray bits): a changed character always shows. */
const isB64u = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]*$/.test(s) && Buffer.from(s, "base64url").toString("base64url") === s;
const isB64 = (s: unknown): s is string => typeof s === "string" && s.length > 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && Buffer.from(s, "base64").toString("base64") === s;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keysAre = (v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> =>
  isObj(v) && required.every((k) => k in v) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const noNumbers = (v: unknown): boolean => typeof v !== "number" && (Array.isArray(v) ? v.every(noNumbers) : isObj(v) ? Object.values(v).every(noNumbers) : true);

function coseAlg(cose: string): number | null {
  try {
    const m = isoCBOR.decodeFirst<Map<number, unknown>>(new Uint8Array(Buffer.from(cose, "base64url")));
    const a = m.get(3);
    return typeof a === "number" ? a : null;
  } catch {
    return null;
  }
}

/** The hash a passkey signs to approve these terms: the terms hash, except an owners' execution (its on-chain digest). */
function approvalHash(terms: Record<string, unknown>, canonical: string, termsSha256: string): string {
  const kind = typeof terms.kind === "string" ? terms.kind : "";
  return kind === OWNERS_EXECUTE ? approvalHashOf({ kind, terms_json: canonical, terms_sha256: termsSha256 }) : termsSha256;
}

/** A passkey approval from the runner's ledger: the proposal, its approval, the stored assertions and the pinned keys. */
export function approvalFromLedger(db: DB, proposalId: string): SignedApproval {
  const a = db.prepare("SELECT decision, approved_sha256, approver, method, policy_version FROM approvals WHERE proposal_id = ?").get(proposalId) as
    { decision: string; approved_sha256: string; approver: string; method: string; policy_version: number | null } | undefined;
  if (!a || a.decision !== "APPROVED" || a.method !== "passkey") throw new Error(`${proposalId} has no passkey approval`);
  const p = db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string; terms_json: string; terms_sha256: string };
  const terms = JSON.parse(p.terms_json) as Record<string, Json>;
  const canonical = jcs(terms);
  if (sha256(canonical).toString("hex") !== p.terms_sha256 || p.terms_sha256 !== a.approved_sha256) throw new Error(`${proposalId}: the stored terms do not hash to the approved hash`);
  const signed = approvalHash(terms, canonical, p.terms_sha256);
  const needs = a.approver.split(" + ").length;
  const rows = (db.prepare("SELECT credential_id, terms_sha256, assertion_json, verified_at FROM passkey_assertions WHERE proposal_id = ? AND outcome = 'APPROVED' ORDER BY verified_at").all(proposalId) as
    { credential_id: string; terms_sha256: string; assertion_json: string; verified_at: string }[]).slice(0, needs);
  if (rows.length < needs) throw new Error(`${proposalId}: ${rows.length} stored signature(s), the approval needs ${needs}`);
  const passkeys = rows.map((s): PasskeySignatureEvidence => {
    const pk = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(s.credential_id) as PasskeyRow | undefined;
    if (!pk) throw new Error(`${proposalId}: signed by an unknown passkey`);
    const r = JSON.parse(s.assertion_json) as AuthenticationResponseJSON;
    return {
      credential_id: pk.credential_id, rp_id: pk.rp_id, origin: pk.origin,
      public_key: { format: "cose", cose: pk.public_key, alg: coseAlg(pk.public_key) },
      signed_sha256: signed,
      assertion: { authenticatorData: r.response.authenticatorData, clientDataJSON: r.response.clientDataJSON, signature: r.response.signature },
      signed_at: s.verified_at,
    };
  });
  const pv = a.policy_version === null ? null : (db.prepare("SELECT sha256 FROM policy_versions WHERE version = ?").get(a.policy_version) as { sha256: string } | undefined);
  return {
    proposal_id: proposalId, terms, canonical, terms_sha256: p.terms_sha256,
    policy: a.policy_version === null ? null : { version: a.policy_version, sha256: pv?.sha256 ?? null },
    passkeys, source: "runner-ledger",
  };
}

/** A paid /try proof bundle (src/proof/bundle.ts): one passkey's approval of the terms it paid. A refusal is not one. */
export function approvalFromProofBundle(b: ProofBundle): SignedApproval {
  if (b.decision?.outcome !== "paid") throw new Error("only a paid bundle holds a signed approval of its terms");
  const terms = b.terms as Record<string, Json>;
  return {
    proposal_id: b.proposal_id, terms, canonical: b.canonical, terms_sha256: b.terms_sha256, policy: null,
    passkeys: [{
      credential_id: b.assertion.credential_id, rp_id: b.rp_id, origin: b.origin, public_key: b.public_key, signed_sha256: b.terms_sha256,
      assertion: { authenticatorData: b.assertion.authenticatorData, clientDataJSON: b.assertion.clientDataJSON, signature: b.assertion.signature },
      signed_at: b.made_at,
    }],
    source: "try-proof-bundle",
  };
}

export interface ExportOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  /** Returns an RFC 3161 token on a SHA-256 (src/eidas/tsa.ts requestTimestamp, or a stand-in). */
  stamp?: (digest: Buffer) => Promise<Buffer>;
  /** Adds a JAdES signature by a QES adapter (src/eidas/csc.ts). */
  qes?: QesAdapter;
}

/** Exports one signed approval. Needs the flag (PURSER_EIDAS=on); checks the file it made before handing it back. */
export async function exportJades(a: SignedApproval, o: ExportOptions = {}): Promise<JadesExport> {
  requireEidas(o.env);
  const now = o.now ?? new Date();
  const evidence: ApprovalEvidence = { format: EVIDENCE_FORMAT, decision: "APPROVED", ...a, exported_at: now.toISOString() };
  const payloadBytes = Buffer.from(jcs(evidence as unknown as Json), "utf8");
  const out: JadesExport = { payload: b64u(payloadBytes), signatures: [], purser: { format: JADES_EXPORT_FORMAT, note: EXPORT_NOTE } };
  if (o.stamp) out.purser.payloadTst = { tstTokens: [{ val: (await o.stamp(sha256(payloadBytes))).toString("base64") }] };
  if (o.qes) {
    const c = await o.qes.credential();
    const header = {
      alg: c.alg, x5c: c.certificates, "x5t#S256": b64u(sha256(Buffer.from(c.certificates[0]!, "base64"))),
      iat: Math.floor(now.getTime() / 1000), srCms: [{ commId: { id: PROOF_OF_APPROVAL } }],
    };
    const prot = b64u(Buffer.from(jcs(header as unknown as Json), "utf8"));
    const signature = b64u(await o.qes.signHash(sha256(`${prot}.${out.payload}`), `Purser approval ${a.proposal_id}: terms SHA-256 ${a.terms_sha256}`));
    const sig: JadesSignature = { protected: prot, signature };
    // JAdES-B-T: a sigTst over the base64url signature value (TS 119 182-1 clause 5.3.4).
    if (o.stamp) sig.header = { etsiU: [{ sigTst: { tstTokens: [{ val: (await o.stamp(sha256(signature))).toString("base64") }] } }] };
    out.signatures.push(sig);
  }
  const r = await verifyJades(out);
  if (!r.ok) throw new Error(`the exported file does not verify: ${r.checks.filter((x) => !x.ok).map((x) => `${x.check}: ${x.detail}`).join("; ")}`);
  return out;
}

/** The file as written: two-space JSON and a newline. */
export const jadesText = (e: JadesExport): string => `${JSON.stringify(e, null, 2)}\n`;

export interface EidasCheck { check: string; ok: boolean; detail: string }
export interface EidasResult { ok: boolean; checks: EidasCheck[]; levels: string[] }

/** The QC statements a certificate carries (ETSI EN 319 412-5), by name; empty when it carries none. */
export function qcStatementsOf(certDer: Buffer): string[] {
  const tbs = children(readOne(certDer))[0]!;
  const ext = children(tbs).find((c) => c.tag === 0xa3);
  if (!ext) return [];
  const names: Record<string, string> = { [OID.qcCompliance]: "QcCompliance", [OID.qcSSCD]: "QcSSCD", [OID.qcTypeEsign]: "QcType esign" };
  const out: string[] = [];
  for (const e of children(children(ext)[0]!)) {
    const parts = children(e);
    if (oidOf(parts[0]!) !== OID.qcStatements) continue;
    for (const st of children(readOne(Buffer.from(parts[parts.length - 1]!.content)))) {
      const [id, info] = children(st);
      const o = oidOf(id!);
      if (o === OID.qcType && info) for (const t of children(info)) out.push(names[oidOf(t)] ?? `QcType ${oidOf(t)}`);
      else out.push(names[o] ?? o);
    }
  }
  return out;
}

/** Reads a file's text and verifies it; a file that is not JSON is a failed check, never a throw. */
export async function verifyJadesText(text: string): Promise<EidasResult> {
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { return { ok: false, checks: [{ check: "format", ok: false, detail: `not JSON: ${(e as Error).message}` }], levels: [] }; }
  return verifyJades(json);
}

/** Verifies an export offline: no network, no server, no key of ours. Never throws. */
export async function verifyJades(file: unknown): Promise<EidasResult> {
  const checks: EidasCheck[] = [];
  const levels: string[] = [];
  const add = (check: string, ok: boolean, detail: string) => { checks.push({ check, ok, detail }); return ok; };
  const done = (): EidasResult => ({ ok: checks.length > 0 && checks.every((c) => c.ok), checks, levels });
  try {
    // 1. The envelope: a JWS JSON Serialization with the fixed note, nothing more.
    const f = file as JadesExport;
    const shaped = keysAre(file, ["payload", "signatures", "purser"]) && isB64u(f.payload) && f.payload.length > 0 && Array.isArray(f.signatures)
      && keysAre(f.purser, ["format", "note"], ["payloadTst"]) && f.purser.format === JADES_EXPORT_FORMAT && f.purser.note === EXPORT_NOTE;
    if (!add("format", shaped, shaped ? `${JADES_EXPORT_FORMAT}: a JWS JSON Serialization with ${f.signatures.length} JAdES signature(s)` : `not a ${JADES_EXPORT_FORMAT} file (a member is missing, extra, changed or not canonical base64url)`)) return done();

    // 2. The payload: canonical JSON of the evidence, each member where it belongs.
    const payloadBytes = Buffer.from(f.payload, "base64url");
    let ev: ApprovalEvidence | null = null;
    try { ev = JSON.parse(payloadBytes.toString("utf8")) as ApprovalEvidence; } catch { ev = null; }
    const pkShaped = (p: unknown) => keysAre(p, ["credential_id", "rp_id", "origin", "public_key", "signed_sha256", "assertion", "signed_at"])
      && typeof p.credential_id === "string" && typeof p.rp_id === "string" && typeof p.origin === "string" && HEX64.test(String(p.signed_sha256)) && ISO.test(String(p.signed_at))
      && keysAre(p.public_key, ["format", "cose", "alg"]) && p.public_key.format === "cose" && isB64u(p.public_key.cose)
      && keysAre(p.assertion, ["authenticatorData", "clientDataJSON", "signature"]) && [p.assertion.authenticatorData, p.assertion.clientDataJSON, p.assertion.signature].every(isB64u);
    const evShaped = keysAre(ev, ["format", "decision", "proposal_id", "terms", "canonical", "terms_sha256", "policy", "passkeys", "source", "exported_at"])
      && ev.format === EVIDENCE_FORMAT && ev.decision === "APPROVED" && typeof ev.proposal_id === "string" && isObj(ev.terms) && typeof ev.canonical === "string"
      && HEX64.test(String(ev.terms_sha256)) && ["runner-ledger", "try-proof-bundle"].includes(ev.source) && ISO.test(String(ev.exported_at))
      && Array.isArray(ev.passkeys) && ev.passkeys.length > 0 && ev.passkeys.every(pkShaped)
      && (ev.policy === null || (keysAre(ev.policy, ["version", "sha256"]) && Number.isInteger(ev.policy.version) && ev.policy.version >= 1 && (ev.policy.sha256 === null || HEX64.test(ev.policy.sha256))));
    const canonicalPayload = evShaped && Buffer.from(jcs(ev as unknown as Json), "utf8").equals(payloadBytes);
    if (!add("payload", canonicalPayload, !evShaped ? `the payload is not ${EVIDENCE_FORMAT} evidence` : !canonicalPayload ? "the payload is not the canonical JSON (RFC 8785) of its evidence"
      : `${EVIDENCE_FORMAT}, proposal ${ev!.proposal_id}, from the ${ev!.source === "runner-ledger" ? "runner's ledger" : "/try proof bundle"}, exported ${ev!.exported_at}`)) return done();
    const e = ev!;

    // 3. The terms hash, recomputed here, never taken from the file.
    let canonical: string | null = null;
    try { canonical = noNumbers(e.terms) ? jcs(e.terms as Json) : null; } catch { canonical = null; }
    const h = canonical === null ? null : sha256(canonical).toString("hex");
    const named = e.terms.proposal_id === undefined || e.terms.proposal_id === e.proposal_id;
    add("terms hash", h !== null && h === e.terms_sha256 && canonical === e.canonical && named, h === null ? "the terms carry a number or a value signed terms never have"
      : !named ? `the terms are for ${String(e.terms.proposal_id)}, the file says ${e.proposal_id}`
      : h !== e.terms_sha256 ? `SHA-256 of the canonical terms is ${h}, the file says ${e.terms_sha256}`
        : canonical !== e.canonical ? "the file's canonical text is not the terms' canonical JSON" : `SHA-256 of the canonical terms is ${h}, as the file says`);

    // 4. Each passkey's signature, by WebAuthn's rules, with the runner's own verifier.
    let want: string | null = null;
    try { want = h === null ? null : approvalHash(e.terms, e.canonical, h); } catch (err) { want = null; add("signed hash", false, (err as Error).message); }
    const seen = new Set<string>();
    for (const [i, p] of e.passkeys.entries()) {
      const name = e.passkeys.length > 1 ? `passkey ${i + 1}` : "passkey";
      if (want === null || p.signed_sha256 !== want) { add(name, false, `it signed ${p.signed_sha256.slice(0, 12)}…, not the approval hash of these terms`); continue; }
      if (seen.has(p.credential_id)) { add(name, false, "the same passkey twice: an approval by two people needs two keys"); continue; }
      seen.add(p.credential_id);
      const row: PasskeyRow = { credential_id: p.credential_id, public_key: p.public_key.cose, counter: 0, transports: null, rp_id: p.rp_id, origin: p.origin, label: "", aaguid: null, registration_json: "", enrolled_at: "", status: "ACTIVE" };
      const response: AuthenticationResponseJSON = { id: p.credential_id, rawId: p.credential_id, type: "public-key", response: { ...p.assertion }, clientExtensionResults: {} };
      const v = await verifyApprovalSignature(response, p.signed_sha256, row, 0);
      const alg = coseAlg(p.public_key.cose) === -257 ? "RS256" : "ES256";
      add(name, v.ok && coseAlg(p.public_key.cose) === p.public_key.alg, !v.ok ? v.reason : coseAlg(p.public_key.cose) !== p.public_key.alg ? "the key's stated algorithm is not its COSE algorithm"
        : `${alg} WebAuthn signature by passkey ${p.credential_id.slice(0, 8)}… over ${p.signed_sha256.slice(0, 12)}…, user verified, for ${p.rp_id} (${p.origin})`);
    }
    levels.push(`passkey: an electronic signature over the terms hash (${e.passkeys.length} signer${e.passkeys.length > 1 ? "s" : ""}); not a QES`);

    // 5. The times and the policy version: the runner's record beside the signature, checked for sense, not signed by the passkey.
    const exp = typeof e.terms.expires_at === "string" ? e.terms.expires_at : null;
    const late = e.passkeys.find((p) => Date.parse(p.signed_at) > Date.parse(e.exported_at) || (exp !== null && Date.parse(p.signed_at) > Date.parse(exp)));
    add("times", !late, late ? `a signature dated ${late.signed_at} is after ${Date.parse(late.signed_at) > Date.parse(e.exported_at) ? "the export" : "the terms expired"}` : `signed ${e.passkeys.map((p) => p.signed_at).join(", ")}${exp ? `, before the terms expired (${exp})` : ""}; exported ${e.exported_at}`);
    add("policy", true, e.policy === null ? "no CFO policy version recorded (a /try proof bundle carries none)" : `signed under CFO policy v${e.policy.version}${e.policy.sha256 ? ` (sha256 ${e.policy.sha256.slice(0, 12)}…)` : ""}: the runner's record, not signed by the passkey`);

    // 6. A time-stamp on the payload.
    const stampOf = (c: unknown, digest: Buffer, check: string) => {
      const okShape = keysAre(c, ["tstTokens"]) && Array.isArray(c.tstTokens) && c.tstTokens.length === 1 && keysAre(c.tstTokens[0], ["val"]) && isB64((c.tstTokens[0] as { val: unknown }).val);
      if (!okShape) return add(check, false, "a time-stamp container must hold exactly one RFC 3161 token, base64");
      const t = verifyTimestampToken(Buffer.from((c as unknown as TstContainer).tstTokens[0]!.val, "base64"), digest);
      return add(check, t.ok, t.detail);
    };
    if (f.purser.payloadTst !== undefined && stampOf(f.purser.payloadTst, sha256(payloadBytes), "payload time-stamp")) levels.push("payload: RFC 3161 time-stamped (proof the evidence existed at that time)");

    // 7. Each JAdES signature over the payload.
    for (const [i, s] of f.signatures.entries()) {
      const name = f.signatures.length > 1 ? `jades ${i + 1}` : "jades";
      if (!keysAre(s, ["protected", "signature"], ["header"]) || !isB64u(s.protected) || !isB64u(s.signature)) { add(name, false, "a signature that is not { protected, header?, signature } in canonical base64url"); continue; }
      let hd: Record<string, unknown> | null = null;
      try { hd = JSON.parse(Buffer.from(s.protected, "base64url").toString("utf8")) as Record<string, unknown>; } catch { hd = null; }
      if (!keysAre(hd, ["alg", "x5c", "x5t#S256", "iat", "srCms"]) || !["ES256", "RS256"].includes(String(hd.alg)) || !Array.isArray(hd.x5c) || hd.x5c.length === 0 || !hd.x5c.every(isB64)
        || !Number.isInteger(hd.iat) || JSON.stringify(hd.srCms) !== JSON.stringify([{ commId: { id: PROOF_OF_APPROVAL } }])) { add(name, false, "the protected header is not a JAdES-B-B header of this format (alg, x5c, x5t#S256, iat, srCms ProofOfApproval)"); continue; }
      const certs = (hd.x5c as string[]).map((c) => new X509Certificate(Buffer.from(c, "base64")));
      const leaf = certs[0]!;
      if (hd["x5t#S256"] !== b64u(sha256(leaf.raw))) { add(name, false, "x5t#S256 is not the SHA-256 of the signing certificate"); continue; }
      const chainBad = certs.slice(1).findIndex((ca, k) => !certs[k]!.checkIssued(ca) || !certs[k]!.verify(ca.publicKey));
      if (chainBad >= 0) { add(name, false, `certificate ${chainBad + 1} in x5c is not issued by the next one`); continue; }
      const at = (hd.iat as number) * 1000;
      if (at < Date.parse(leaf.validFrom) || at > Date.parse(leaf.validTo)) { add(name, false, `signed (iat ${new Date(at).toISOString()}) outside the certificate's validity`); continue; }
      const input = Buffer.from(`${s.protected}.${f.payload}`, "ascii");
      const sig = Buffer.from(s.signature, "base64url");
      const ok = hd.alg === "ES256" ? cryptoVerify("sha256", input, { key: leaf.publicKey, dsaEncoding: "ieee-p1363" }, sig) : cryptoVerify("sha256", input, leaf.publicKey, sig);
      const qc = qcStatementsOf(leaf.raw);
      const claims = qc.includes("QcCompliance") && qc.includes("QcSSCD");
      const who = leaf.subject.replace(/\n/g, ", ");
      if (!add(name, ok, ok ? `${hd.alg} JAdES signature over the payload (so over the terms hash ${e.terms_sha256.slice(0, 12)}…) verifies with ${who}'s certificate; it claims ${qc.length ? qc.join(", ") : "no QC statement"}; issuer ${leaf.issuer.replace(/\n/g, ", ")} not checked against the EU Trusted List offline`
        : `the ${hd.alg} signature does not verify with ${who}'s certificate`)) continue;
      let level = "JAdES-B-B";
      if (s.header !== undefined) {
        const u = s.header as { etsiU?: unknown };
        const tst = keysAre(u, ["etsiU"]) && Array.isArray(u.etsiU) && u.etsiU.length === 1 && keysAre(u.etsiU[0], ["sigTst"]) ? (u.etsiU[0] as { sigTst: unknown }).sigTst : undefined;
        if (tst === undefined) { add(`${name} sigTst`, false, "the unprotected header holds something other than one sigTst"); continue; }
        if (stampOf(tst, sha256(s.signature), `${name} sigTst`)) level = "JAdES-B-T";
      }
      levels.push(`${level} signature; ${claims ? "its certificate claims to be qualified with the key in a QSCD (QcCompliance, QcSSCD): a QES only if its issuer is a QTSP on the EU Trusted List, not checked offline" : "its certificate does not claim to be qualified: not a QES"}`);
    }
    if (f.signatures.length === 0) levels.push("no JAdES signature: evidence in JAdES layout; the passkey is its only signature");
    return done();
  } catch (err) {
    add("error", false, (err as Error).message);
    return done();
  }
}
