// The control map (27 Nov): for each requirement of four frameworks, the Purser controls that address it and how their
// evidence is derived from the ledger. This file is the single source: docs/compliance/controls.md is rendered from it
// (npm run compliance:controls), and the compliance evidence (./evidence.ts, npm run compliance-evidence) reads each
// control's evidence rule here to pick, for a period, the audit rows and table rows that show the control ran.
//
// A row's status says what stands behind it, honestly:
//   evidence-in-ledger  a control that leaves records in the ledger addresses it; the evidence files list them per period
//   documented          addressed by code, tests and documents only; nothing per period to count
//   gap                 Purser does not address it; the row says what is missing
// "Mapped to" and "evidence for", never more: see HONEST_LINE.

import { deriveRules } from "../audit/pack.js";
import { ANOMALY_HELD } from "../policy/anomaly.js";
import { REFUSED_UNSIGNED } from "../policy/approvals.js";
import { WEBHOOK_REFUSED } from "../policy/cardHooks.js";
import { RATIONALE_NOT_VIEWED, RATIONALE_VIEWED } from "../passkey/process.js";

export const HONEST_LINE = "Mapped to, not certified against: certification or an attestation needs an independent auditor, "
  + "and nobody has audited Purser against any of these frameworks. Purser moves test money only, in the Airwallex sandbox "
  + "and on Alta testnet.";

export const STATUSES = ["evidence-in-ledger", "documented", "gap"] as const;
export type Status = typeof STATUSES[number];

export type FrameworkId = "eu-ai-act" | "iso-42001" | "soc2" | "dora" | "psd2-sca" | "gdpr" | "eidas" | "nis2" | "iso-27001";
export interface Framework { id: FrameworkId; name: string; source: string; scope: string }

export const FRAMEWORKS: readonly Framework[] = [
  {
    id: "eu-ai-act", name: "EU AI Act, Regulation (EU) 2024/1689", source: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
    scope: "Articles 9 to 17 set requirements for high-risk AI systems. Purser's own reading (docs/compliance/ai-act-classification.md, "
      + "not legal advice) finds no agent or feature in Annex III; the rows of Arts. 9 to 17 show which controls would give evidence if a "
      + "deployer's use made it one. Arts. 4, 5 and 50 apply whatever the class.",
  },
  {
    id: "iso-42001", name: "ISO/IEC 42001:2023, Annex A reference controls", source: "https://www.iso.org/standard/81230.html",
    scope: "A management-system standard: it applies to an organisation, not to a product. The rows show which Purser controls an "
      + "organisation's AI management system could point to. Only the Annex A controls that can be mapped credibly are listed.",
  },
  {
    id: "soc2", name: "SOC 2, AICPA Trust Services Criteria (2017, points of focus revised 2022): CC6, CC7, CC8", source: "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022",
    scope: "A SOC 2 report is an independent service auditor's opinion on an organisation's controls over a period. Nobody has "
      + "examined Purser; the rows show which controls, and which records, such an examination could test.",
  },
  {
    id: "dora", name: "DORA, Regulation (EU) 2022/2554", source: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj/eng",
    scope: "DORA binds financial entities; Purser is not one. The rows show which controls would support such an entity. The "
      + "regulatory technical standards made under DORA are not mapped.",
  },
  // 26 Nov (Max: "do more for the eu compliance and governance ... and more security").
  {
    id: "psd2-sca", name: "PSD2 SCA, Directive (EU) 2015/2366 Art. 97 and the RTS on strong customer authentication, Delegated Regulation (EU) 2018/389", source: "https://eur-lex.europa.eu/eli/reg_del/2018/389/oj/eng",
    scope: "SCA is the payment service provider's duty (PSD2 Art. 97); Purser is not a PSP. Airwallex, the PSP, applies its own SCA to its "
      + "logins and payments. The rows map Purser's own approval inside the business, a passkey over the exact terms, to the RTS's "
      + "requirements, as a second, independent control (docs/compliance/psd2-sca.md).",
  },
  {
    id: "gdpr", name: "GDPR, Regulation (EU) 2016/679", source: "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",
    scope: "The deploying business is the controller of its data; Purser Cloud processes it on the business's behalf. The rows show what "
      + "Purser provides for the controller's duties (docs/compliance/gdpr.md: the record of processing, the DPIA, data subjects' "
      + "rights, transfers). Not legal advice.",
  },
  {
    id: "eidas", name: "eIDAS, Regulation (EU) No 910/2014 as amended by Regulation (EU) 2024/1183", source: "https://eur-lex.europa.eu/eli/reg/2014/910/oj/eng",
    scope: "What Purser's approval signatures are under eIDAS, and what the eIDAS option (src/eidas/, off by default) builds toward a "
      + "qualified signature and time-stamp. No qualified trust service has been used (docs/legal/eidas-qes.md).",
  },
  {
    id: "nis2", name: "NIS2, Directive (EU) 2022/2555, Art. 21(2) cybersecurity risk-management measures", source: "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng",
    scope: "NIS2 binds essential and important entities in the sectors it lists, as each Member State transposes it; Purser is not one. "
      + "The rows show which Purser controls an entity running it could point to for each of the ten measures.",
  },
  {
    id: "iso-27001", name: "ISO/IEC 27001:2022, Annex A controls", source: "https://www.iso.org/standard/27001",
    scope: "A management-system standard for an organisation, not a product; nobody has audited Purser against it. Only the Annex A "
      + "controls that can be mapped credibly are listed, from the organisational (5), people (6), physical (7) and technological (8) themes.",
  },
];

/** Rows of one ledger table that show a control ran: those stamped in the period, by `at`; `cite` names the columns shown. */
export interface TableEvidence { table: string; at: string; cite: string[] }

/** How a control's evidence is derived from the ledger for a period. */
export interface LedgerEvidence {
  /** Audit events, by exact name. */
  events: string[];
  /** Audit events by pattern (regular expressions over the event name), as the audit pack's reading sections. */
  patterns: string[];
  /** An audit event only when its subject matches (a regular expression): a policy change of one setting, say. */
  scoped: { event: string; subject: string }[];
  tables: TableEvidence[];
  /** The period's whole run of the audit chain: its first and last row, the hash it links to, its head. */
  chain: boolean;
  /** In words, for the document. */
  how: string;
}

export interface Control {
  id: string;
  name: string;
  does: string;
  code: string[];
  docs: string[];
  /** Null: documented only (no records per period). */
  evidence: LedgerEvidence | null;
}

const ev = (e: Partial<LedgerEvidence> & { how: string }): LedgerEvidence => ({ events: [], patterns: [], scoped: [], tables: [], chain: false, ...e });
const refusals = deriveRules().refusals_holds;
const reconciliation = deriveRules().reconciliation;

export const CONTROLS: readonly Control[] = [
  {
    id: "PC-01", name: "Passkey-signed exact terms",
    does: "Above the limits the CFO set, only a passkey signature (Face ID) over the SHA-256 of the exact terms approves a payment or a policy change; a person can also reject.",
    code: ["src/policy/approvals.ts", "src/passkey/webauthn.ts", "src/passkey/process.ts", "src/lib/terms.ts"], docs: ["docs/phone-approval.md", "docs/compliance/psd2-sca.md"],
    evidence: ev({
      events: ["proposal.created", "proposal.approved", "proposal.rejected", "proposal.cosigned", "proposal.factor_signed", "approval.too_late"],
      tables: [{ table: "approvals", at: "created_at", cite: ["proposal_id", "decision", "method", "approved_sha256"] }],
      how: "each proposal made and each decision on it, with the approval rows (method, approved terms hash) of the period",
    }),
  },
  {
    id: "PC-02", name: "Execution re-checks the signed terms",
    does: "Before any call to a rail the executor hashes the terms again and checks the stored passkey signature behind the approval; terms that no longer match, an unsigned approval or an audit log that no longer verifies are refused and recorded.",
    code: ["src/policy/approvals.ts", "src/policy/hashFirst.ts", "src/policy/blocked.ts"], docs: ["docs/evidence/tamper-matrix.md"],
    evidence: ev({
      events: ["proposal.executing", "proposal.executed", "proposal.failed", "proposal.needs_reapproval", REFUSED_UNSIGNED, "execution.refused_ledger_tampered", "execution.blocked"],
      how: "each execution begun (with the recomputed terms hash), finished, failed or refused",
    }),
  },
  {
    id: "PC-03", name: "Limits as hashed policy versions",
    does: "The CFO policy (limits, floors, payees, switches) is stored whole per version and hashed; each decision records the version it was made under; code approves alone only within the limit the CFO signed.",
    code: ["src/policy/versions.ts", "src/policy/rules.ts", "src/policy/signedApproval.ts", "src/policy/aloneLimit.ts"], docs: ["docs/cfo-policy.md"],
    evidence: ev({
      events: ["policy.version", "proposal.within_limit", "ap.alone_declined"],
      tables: [{ table: "policy_versions", at: "created_at", cite: ["version", "sha256"] }],
      how: "each policy version recorded in the period with its hash, and each payment code approved within the signed limit (or declined to)",
    }),
  },
  {
    id: "PC-04", name: "Policy changes only by an approved change",
    does: "A change to the CFO policy is itself a proposal: it takes effect only once approved (with the passkey above the limits) and executed; from the phone, limits can only be tightened.",
    code: ["src/executors/policyChange.ts", "src/policy/loosens.ts"], docs: ["docs/cfo-policy.md"],
    evidence: ev({ events: ["policy.changed"], how: "each setting changed, with its old and new value and the proposal that changed it" }),
  },
  {
    id: "PC-05", name: "Segregation of duties and four eyes",
    does: "Loosening the policy above approval.policy_sod_eur, and paying above approval.four_eyes_eur, needs the passkeys of two different people; whoever proposed a change never approves it; a second key above approval.second_key_eur.",
    code: ["src/policy/policySod.ts", "src/policy/fourEyes.ts", "src/policy/secondKey.ts", "src/policy/approvals.ts"], docs: ["docs/cfo-policy.md"],
    evidence: ev({
      events: ["proposal.cosigned", "proposal.factor_signed"],
      scoped: [{ event: "policy.changed", subject: "^approval\\.(policy_sod_eur|four_eyes_eur|second_key_[a-z_]+)$" }],
      tables: [{ table: "cosignatures", at: "created_at", cite: ["proposal_id", "credential_id", "terms_sha256", "assertion_sha256"] }],
      how: "each first of two signatures (and second key), each change of the thresholds, and the stored signatures of the period",
    }),
  },
  {
    id: "PC-06", name: "Emergency stop and agent stops",
    does: "One approved policy change (freeze) makes Purser refuse every agent payment and freeze every card; lifting it is a loosening, so it needs the passkey. One agent can be paused, and a velocity limit stops one agent at once.",
    code: ["src/policy/emergencyStop.ts", "src/policy/rules.ts", "src/policy/pause.ts", "src/policy/velocity.ts"], docs: ["docs/runbook.md", "docs/runs/2026-11-26-stop-at-rail-live.md"],
    evidence: ev({
      events: ["transfer.held_before_create", "velocity.tripped"],
      scoped: [{ event: "policy.changed", subject: "^(freeze|stop\\.[a-z0-9:_-]+|pause\\.[a-z0-9:_-]+)$" }],
      how: "each change of the emergency stop or of one agent's stop or pause, each payment held before the bank because of a stop, each velocity stop",
    }),
  },
  {
    id: "PC-07", name: "Agent principals with capabilities",
    does: "Every agent acts as a principal with the tools, rails, currencies and payees it may use; it can be revoked at once (its tokens with it), given an end date, or have its key rotated; a tool outside its capabilities is refused.",
    code: ["src/policy/principals.ts", "src/policy/agentTokenStore.ts"], docs: ["docs/security/agent-permissions.md"],
    evidence: ev({
      events: ["principal.revoked", "principal.expires", "principal.key_rotated", "principal.tool_refused", "principal.capabilities_widened", "agent_token.revoked"],
      tables: [{ table: "principals", at: "created_at", cite: ["principal_id", "kind", "status"] }],
      how: "each principal made, revoked, given an end date or a new key, and each tool refused to it",
    }),
  },
  {
    id: "PC-08", name: "Signed agent identity",
    does: "On the agent API each money-relevant request carries the agent's Ed25519 signature over the method, target, body hash, time and a fresh nonce (required by default); the ledger keeps public keys only.",
    code: ["src/policy/agentIdentity.ts"], docs: ["docs/security/agent-identity.md"],
    evidence: ev({
      events: ["principal.identity_verified", "principal.identity_refused", "principal.identity_absent"],
      tables: [{ table: "principal_identity_keys", at: "created_at", cite: ["key_id", "principal_id", "status"] }],
      how: "each signed request verified or refused, and each signing key issued (public key id only)",
    }),
  },
  {
    id: "PC-09", name: "Task mandates and short-lived tokens",
    does: "Authority for a task is granted explicitly (a policy change the CFO signs), narrowed or revoked on record, and carried by a short-lived token of which only the hash is kept; a payment outside its mandate is refused.",
    code: ["src/policy/taskMandates.ts", "src/policy/taskTokens.ts", "src/policy/agentTokens.ts"], docs: ["docs/security/agent-permissions.md"],
    evidence: ev({
      events: ["task_mandate.narrowed", "task_mandate.revoked", "task_mandate.refused", "task_token.issued", "task_token.revoked", "task_token.refused", "agent_token.issued", "agent_token.used", "agent_token.refused"],
      scoped: [{ event: "policy.changed", subject: "^task_mandate\\." }],
      tables: [{ table: "task_tokens", at: "issued_at", cite: ["token_id", "agent", "mandate_id", "status", "expires_at"] }],
      how: "each mandate granted, narrowed, revoked or refusing a payment, and each token issued, used or refused (ids, never the token)",
    }),
  },
  {
    id: "PC-10", name: "Hash-chained audit log and signed audit pack",
    does: "Every decision, refusal and approval is a row of an append-only log, each row hashing the one before; the database refuses edits; a payment is refused on a log that no longer verifies; the signed audit pack carries a period's rows to an auditor.",
    code: ["src/audit/log.ts", "src/audit/intact.ts", "src/audit/pack.ts", "src/audit/checkpointer.ts"], docs: ["docs/compliance/README.md"],
    evidence: ev({ chain: true, events: ["audit.checkpoint_refused"], how: "the period's run of the chain (first and last row, the hash it links to, its head), verified from the genesis hash when the evidence is made" }),
  },
  {
    id: "PC-11", name: "Refusals and holds recorded",
    does: "Every refusal, hold, block and escalation is an audit row with its reason, before anything moves; the CFO's dashboard lists them.",
    code: ["src/dashboard/snapshot.ts", "src/audit/pack.ts", "src/policy/blocked.ts"], docs: ["docs/fraud-and-injection.md"],
    evidence: ev({
      events: refusals.events, patterns: refusals.patterns,
      how: "each refusal or hold, sorted as the audit pack's refusals_holds section is (the same events and patterns; since 26 Nov they take in the anomaly hold, payment.anomaly_held, and a refused webhook signature)",
    }),
  },
  {
    id: "PC-12", name: "Rationale record per payment",
    does: "For every supplier or invoice payment executed or refused, a structured why: the account that funded it, the rail, the policy rule and version it was allowed under, who approved which terms hash, and the transfer.",
    code: ["src/payouts/rationale.ts"], docs: ["docs/payables.md"],
    evidence: ev({ events: ["payment.rationale"], how: "each payment's rationale record" }),
  },
  {
    id: "PC-13", name: "Anomaly, fraud and payee-change holds",
    does: "A payment far outside what its payee normally receives goes to the CFO; an invoice whose bank details changed, a look-alike payee or instructions planted in a document are flagged and change nothing; new bank details count only after a check outside the system and the CFO's approval.",
    code: ["src/policy/anomaly.ts", "src/policy/fraud.ts", "src/policy/injection.ts", "src/policy/payeeChange.ts"], docs: ["docs/fraud-and-injection.md"],
    evidence: ev({
      events: [ANOMALY_HELD, "invoice.fraud_suspected", "document.injection_flagged", "ap.account_changed", "payee.change_requested", "payee.change_verified", "payee.changed"],
      how: "each anomaly hold, fraud or injection flag, and each step of a payee's bank change",
    }),
  },
  {
    id: "PC-14", name: "Webhook signatures checked twice",
    does: "An Airwallex webhook is recorded only after the relay and then the runner, with its own copy of the secret, check its HMAC; a webhook only records what Airwallex decided and can never move money; a disagreement with the ledger raises an alarm; a signature the runner refuses is an audit row (source and reason, never the body).",
    code: ["src/policy/cardHooks.ts", "src/policy/airwallexEvents.ts"], docs: ["docs/security/SECURITY-MAPPING.md"],
    evidence: ev({
      events: ["airwallex.disagrees", WEBHOOK_REFUSED],
      tables: [{ table: "airwallex_events", at: "received_at", cite: ["event_id", "object", "agrees"] }],
      how: "each webhook recorded after its signature verified, each that disagreed with the ledger, and each the runner refused for a bad signature (recorded since 26 Nov, source and reason only)",
    }),
  },
  {
    id: "PC-15", name: "Reconciliation with the rails",
    does: "The runner reconciles the ledger with Airwallex and the chain every hour; a difference is recorded and raised.",
    code: ["src/finance/reconcile.ts"], docs: ["docs/reconcile-books.md"],
    evidence: ev({ events: reconciliation.events, patterns: reconciliation.patterns, how: "each reconciliation and each difference, sorted as the audit pack's reconciliation section is" }),
  },
  {
    id: "PC-16", name: "Each AI reading logged",
    does: "Every model reading is an audit row with the model, the request id, a hash of the input, the checked output and the token use; a fallback to the plain parser, a rejected reading and a spend cap are logged too.",
    code: ["src/claude/reader.ts"], docs: ["docs/agent-evals.md"],
    evidence: ev({ events: ["claude.read", "claude.fallback", "claude.rejected", "claude.capped"], how: "each reading, fallback, rejected reading and cap" }),
  },
  {
    id: "PC-17", name: "Secrets handling",
    does: "A key-management policy for every secret the code reads (NIST SP 800-57 Part 1 stages); scoped Airwallex keys per role; secrets redacted from every text that leaves the runner, the audit log included.",
    code: ["src/lib/redact.ts", "src/airwallex/keyScopes.ts"], docs: ["docs/security/key-management.md"], evidence: null,
  },
  {
    id: "PC-18", name: "Data classification",
    does: "Every table the code creates is classified (Secret, Restricted, Internal, Public) with its personal, financial and credential columns named, and each level's encryption, integrity, retention, access, logging and export rules.",
    code: [], docs: ["docs/security/data-classification.md"], evidence: null,
  },
  {
    id: "PC-19", name: "Testing: evals, red team, tamper matrix, fuzzing, chaos",
    does: "Evals of the agents' readings in CI; a red team whose every attack must fail; every changed copy of signed terms refused; fuzzing of parsers and verifiers; chaos for money movement; a formal model of the payment states.",
    code: ["src/evals/cases.ts", "src/redteamApi", "src/fuzz", "src/chaos"], docs: ["docs/agent-evals.md", "docs/redteam/coverage.md", "docs/evidence/tamper-matrix.md", "docs/evidence/fuzzing.md", "docs/evidence/chaos-money.md"], evidence: null,
  },
  {
    id: "PC-20", name: "Incident runbook",
    does: "A runbook for incidents, the emergency stop, a leaked key, outages and recovery, saying which steps were exercised live.",
    code: [], docs: ["docs/runbook.md", "docs/compliance/incident-response.md"], evidence: null,
  },
  {
    id: "PC-21", name: "Code change control",
    does: "Changes go through pull requests and CI (tests, type checks, Semgrep, gitleaks, OSV-Scanner, CodeQL); Actions pinned by SHA; releases signed with Sigstore provenance.",
    code: [".github/workflows/ci.yml", ".github/CODEOWNERS", ".github/dependabot.yml"], docs: ["docs/releasing.md", "docs/security/owner-actions.md"], evidence: null,
  },
  {
    id: "PC-22", name: "Transparency to the people who use it",
    does: "Each proposal shows which agent proposed it and why; the dashboard says the agents are AI and a person decides; simulated parts are labelled; who is responsible for what is written down.",
    code: ["src/dashboard/page.html"], docs: ["docs/how-it-works.md", "docs/compliance.md"], evidence: null,
  },
  {
    id: "PC-23", name: "Threat model and risk analysis",
    does: "A STRIDE threat model with trust zones, an assurance case, a zero-trust matrix and a write-up of what the worst-case AI could do and what stops it.",
    code: [], docs: ["docs/security.md", "docs/assurance.md", "docs/zero-trust.md", "docs/worst-case-ai.md"], evidence: null,
  },
  {
    id: "PC-24", name: "Roles and responsibilities",
    does: "Who does what among the business, Purser, Airwallex and Alta, and the roles of the people who approve.",
    code: [], docs: ["docs/security/roles.md", "docs/who-does-what.md", "docs/compliance.md", "docs/compliance/ai-policy.md"], evidence: null,
  },
  {
    id: "PC-25", name: "Passkey enrolment and revocation",
    does: "An approver's passkey counts only after enrolment in a window the runner opened and a fingerprint confirmed on the runner; a replaced passkey is revoked; Face ID stays on the phone and only the public key is stored.",
    code: ["src/passkey/ledger.ts", "src/passkey/process.ts"], docs: ["docs/phone-approval.md"],
    evidence: ev({
      events: ["passkey.enrolment_opened", "passkey.pending", "passkey.enrolled", "passkey.revoked", "passkey.enrol_refused", "passkey.enrol_conflict"],
      tables: [{ table: "passkeys", at: "enrolled_at", cite: ["credential_id", "status"] }],
      how: "each enrolment window, passkey enrolled, refused or revoked (credential ids only)",
    }),
  },
  // 26 Nov: the second round, closing the first round's gaps with documents and two small pieces of code.
  {
    id: "PC-26", name: "Automation-bias signal on the approval page",
    does: "With each passkey approval the phone's approval page reports whether the person opened Details (the agent's reasons, the review, the exact terms) before signing; once the signature is verified the runner records it just before the approval. It is what the page said, not signed, and it gates nothing; the evidence shows approvals signed with the rationale viewed as n/m.",
    code: ["src/approve/client.ts", "src/passkey/process.ts"], docs: ["docs/compliance/instructions-for-use.md", "docs/compliance/ai-policy.md"],
    evidence: ev({
      events: [RATIONALE_VIEWED, RATIONALE_NOT_VIEWED],
      how: "each passkey approval the approval page reported on: with the rationale viewed first, or not (summary.json gives n/m)",
    }),
  },
  {
    id: "PC-27", name: "AI policy and AI impact assessment",
    does: "The organisation's AI policy (no model output moves money, human oversight, acceptable use of Claude agents, roles, review cadence) and an impact assessment per agent and feature: intended use, affected parties, risks scored likelihood × impact, mitigations mapped to controls with their tests and records, residual risk, owners and a review date.",
    code: [], docs: ["docs/compliance/ai-policy.md", "docs/compliance/ai-impact-assessment.md"], evidence: null,
  },
  {
    id: "PC-28", name: "Instructions for use for deployers",
    does: "What Purser does and does not do, its limits, the human oversight it needs, how to stop it, how logs are collected, and its accuracy and robustness declared only as the eval and red-team records measured them, with their scope.",
    code: [], docs: ["docs/compliance/instructions-for-use.md"], evidence: null,
  },
  {
    id: "PC-29", name: "Incident classification, response and reporting",
    does: "Severity classes with criteria tied to Purser's audit events, a runbook from detection to closure, a communication plan with named roles, and a reporting template; reporting to an authority is the deployer's duty and is not done in the sandbox.",
    code: [], docs: ["docs/compliance/incident-response.md", "docs/runbook.md"], evidence: null,
  },
  {
    id: "PC-30", name: "ICT third-party register and exit plans",
    does: "A machine-readable register of every outside service the code calls (function, data by level, criticality, location, contract, substitution), checked against the code's hosts by a test; an exit plan per critical or important provider; what a production contract must include.",
    code: ["src/compliance/thirdParties.ts"], docs: ["docs/compliance/third-parties.json", "docs/compliance/third-parties.md", "docs/compliance/exit-plans.md"], evidence: null,
  },
  {
    id: "PC-31", name: "Retention defaults and the retention check",
    does: "A retention period per kind of record on the runner's ledger (the books seven years, short-lived records a day) and npm run retention -- --check, which reports the rows past their period and never deletes.",
    code: ["src/compliance/retention.ts", "src/cli/retention.ts"], docs: ["docs/compliance/retention.md", "docs/privacy/retention.md"], evidence: null,
  },
  {
    id: "PC-32", name: "Supply chain: SBOM, signed releases, dependency and secret scanning",
    does: "A CycloneDX SBOM with VEX statements; releases built by the release workflow with Sigstore-signed SLSA provenance; OSV-Scanner, dependency review, Dependabot, gitleaks and the OpenSSF Scorecard on the repository; Actions pinned by SHA.",
    code: [".github/workflows/release.yml", ".github/workflows/osv-scanner.yml", ".github/workflows/dependency-review.yml", ".github/workflows/scorecard.yml", ".github/dependabot.yml"],
    docs: ["docs/security/sbom.cdx.json", "docs/releasing.md", "docs/security/openssf-silver.md"], evidence: null,
  },
  {
    id: "PC-33", name: "Application security verification",
    does: "An OWASP ASVS 4.0.3 Level 2 self-assessment with every failing requirement listed; DAST with OWASP ZAP; a private vulnerability disclosure route with a response time.",
    code: [".github/workflows/dast-zap.yml"], docs: ["docs/security/asvs-l2.md", "SECURITY.md"], evidence: null,
  },
  {
    id: "PC-34", name: "eIDAS evidence export, time-stamp and QES adapter",
    does: "Behind a flag that is off by default: each approval exported as JAdES-layout evidence (ETSI TS 119 182-1) with an offline verifier, an optional RFC 3161 time-stamp, and a Cloud Signature Consortium API v2 adapter for a remote qualified signature; tested against a mock TSA and a mock CSC server.",
    code: ["src/eidas/jades.ts", "src/eidas/tsa.ts", "src/eidas/csc.ts", "test/eidas-evidence.test.ts"], docs: ["docs/legal/eidas-qes.md"], evidence: null,
  },
  {
    id: "PC-35", name: "GDPR records and data subjects' rights",
    does: "A record of processing activities checked against the data classification, a DPIA for the agents, transfers per provider from the third-party register, and the routes Purser Cloud has for access, export and erasure (GET /v1/me, POST /v1/export/staged, POST /v1/users/{id}/erase, POST /v1/offboarding).",
    code: ["src/compliance/gdpr.ts", "cloud/src/privacy.ts", "cloud/src/exports.ts"], docs: ["docs/compliance/gdpr.md", "docs/privacy/data-inventory.md", "docs/privacy/retention.md"], evidence: null,
  },
  {
    id: "PC-36", name: "EU AI Act classification and transparency to users",
    does: "Each agent and feature classified against Art. 5 and Annex III, with the reasoning; people told when they deal with AI: Ask Purser labels each answer by whether Claude wrote it, the approval page names the agent that proposed, the dashboard says the agents are AI.",
    code: ["cloud/src/ask/page.ts", "src/dashboard/page.html"], docs: ["docs/compliance/ai-act-classification.md"], evidence: null,
  },
];

export interface Requirement {
  framework: FrameworkId;
  clause: string;
  /** Tells two rows of one clause apart. */
  scope?: string;
  requirement: string;
  controls: string[];
  status: Status;
  /** What is missing: the whole requirement (status gap) or a part of it. */
  gap?: string;
}

export const REQUIREMENTS: readonly Requirement[] = [
  // EU AI Act
  { framework: "eu-ai-act", clause: "Art. 4", requirement: "Providers and deployers take measures to ensure a sufficient level of AI literacy of the people who operate and use the AI systems.", controls: ["PC-28", "PC-27"], status: "gap", gap: "the instructions for use and the AI policy say what an approver must know, but no training or literacy measure is recorded for anyone" },
  { framework: "eu-ai-act", clause: "Art. 5(1)", requirement: "No prohibited AI practice (manipulation, exploiting vulnerabilities, social scoring, and the others Art. 5 lists).", controls: ["PC-36"], status: "documented" },
  { framework: "eu-ai-act", clause: "Art. 6(2)", requirement: "Classify the system: high-risk if its use is one of those Annex III lists.", controls: ["PC-36"], status: "documented", gap: "Purser's own reading, not legal advice and not reviewed by a lawyer; a deployer's own use (say, scoring people) could change it" },
  { framework: "eu-ai-act", clause: "Art. 9(2)", requirement: "A risk management system run as a continuous process: identify, estimate and evaluate the known and foreseeable risks.", controls: ["PC-27", "PC-23", "PC-19"], status: "documented", gap: "the risk register (ai-impact-assessment.md) has owners and a review date, but its first review is due 26 May 2027: it has not yet run as a continuous process" },
  { framework: "eu-ai-act", clause: "Art. 9(2)(d)", requirement: "Adopt targeted risk management measures for the risks identified.", controls: ["PC-11", "PC-13", "PC-06", "PC-01"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 9(6)", requirement: "Test the system to find the most appropriate risk management measures.", controls: ["PC-19"], status: "documented" },
  { framework: "eu-ai-act", clause: "Art. 12(1)", requirement: "Automatically record events (logs) over the lifetime of the system.", controls: ["PC-10", "PC-16", "PC-01", "PC-31"], status: "evidence-in-ledger", gap: "the retention periods are defaults the deployer confirms; the check reports rows past their period and deletes nothing, and removing an expired ledger whole is a procedure, not built" },
  { framework: "eu-ai-act", clause: "Art. 12(2)", requirement: "Logs that let one identify risky situations, support post-market monitoring and monitor the system's operation.", controls: ["PC-11", "PC-13", "PC-15", "PC-10"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 13(1)", requirement: "Operation transparent enough for deployers to interpret the output and use it appropriately.", controls: ["PC-12", "PC-22"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 13(3)", requirement: "Instructions for use with the provider's identity, the system's capabilities and limits, its declared accuracy, the human oversight measures and how logs are collected.", controls: ["PC-28", "PC-22"], status: "documented", gap: "written for the sandbox: a deployer adapts it before production; no deployer has reviewed it yet" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(b)", requirement: "Help the people overseeing it stay aware of automation bias (over-relying on the output).", controls: ["PC-26", "PC-12", "PC-27"], status: "evidence-in-ledger", gap: "the signal is what the phone's approval page reports, not signed; approvals in Purser Cloud's console or the CLI report nothing; it measures, it does not yet prompt the approver" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(d)", requirement: "A person can decide not to use the output, or disregard, override or reverse it.", controls: ["PC-01", "PC-02", "PC-04"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(e)", requirement: "A person can intervene or interrupt the system with a stop button or similar procedure that halts it in a safe state.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 15(1)", requirement: "An appropriate level of accuracy, robustness and cybersecurity, consistent over the lifecycle.", controls: ["PC-19", "PC-23"], status: "documented" },
  { framework: "eu-ai-act", clause: "Art. 15(3)", requirement: "Accuracy levels and metrics declared in the instructions for use.", controls: ["PC-28", "PC-19"], status: "documented", gap: "declared only as the eval records measured them, per agent, model and case set, on test cases; no level is promised beyond those records" },
  { framework: "eu-ai-act", clause: "Art. 15(4)", requirement: "Resilient to errors, faults and inconsistencies, with fail-safe measures.", controls: ["PC-02", "PC-11", "PC-15"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 50(1)", requirement: "People are informed that they are interacting with an AI system, unless that is obvious.", controls: ["PC-36", "PC-22"], status: "documented", gap: "held by labels on the pages (test-checked), not by a record per conversation" },
  { framework: "eu-ai-act", clause: "Art. 11(1)", requirement: "Technical documentation, drawn up before the system is placed on the market and kept up to date, with the contents Annex IV lists.", controls: ["PC-22", "PC-28", "PC-23"], status: "gap", gap: "the contents are spread over docs/ (architecture, threat model, evals, instructions for use); no single document follows Annex IV" },
  { framework: "eu-ai-act", clause: "Art. 17(1)", requirement: "A quality management system, documented in written policies, procedures and instructions.", controls: ["PC-21", "PC-27"], status: "gap", gap: "no quality management system: one maintainer, CI and the change rules; the procedures Art. 17(1) lists (design control, data management, post-market monitoring, accountability) are not written as one" },
  { framework: "eu-ai-act", clause: "Art. 15(5)", requirement: "Resilient against unauthorised attempts to alter its use, outputs or performance (for example manipulated inputs).", controls: ["PC-13", "PC-08", "PC-14", "PC-19"], status: "evidence-in-ledger" },

  // ISO/IEC 42001 Annex A
  { framework: "iso-42001", clause: "A.2.2", requirement: "A documented AI policy for the organisation.", controls: ["PC-27", "PC-24"], status: "documented", gap: "the policy of the project as it runs today (one maintainer, sandbox); a deploying organisation adopts and adapts it" },
  { framework: "iso-42001", clause: "A.3.2", requirement: "AI roles and responsibilities defined and allocated.", controls: ["PC-24", "PC-07"], status: "documented" },
  { framework: "iso-42001", clause: "A.4.6", requirement: "Document the human resources, and their competences, used for the AI system's life cycle.", controls: ["PC-24", "PC-27"], status: "gap", gap: "the roles are named, but no one's competences or training are recorded" },
  { framework: "iso-42001", clause: "A.5.2", requirement: "A process to assess the impact of AI systems on individuals, groups and society.", controls: ["PC-27", "PC-23"], status: "documented", gap: "assessed by the maintainer alone; no affected party (a supplier, an approver) was consulted" },
  { framework: "iso-42001", clause: "A.6.2.4", requirement: "Verification and validation of the AI system.", controls: ["PC-19"], status: "documented" },
  { framework: "iso-42001", clause: "A.6.2.6", requirement: "Operation and monitoring of the AI system.", controls: ["PC-15", "PC-11", "PC-13"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.6.2.8", requirement: "Recording of event logs of the AI system.", controls: ["PC-10", "PC-16", "PC-01"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.7.5", requirement: "Record the provenance of the data used by the AI system.", controls: ["PC-16"], status: "evidence-in-ledger", gap: "covers the documents a model read (their hash per reading); Purser trains no model" },
  { framework: "iso-42001", clause: "A.8.2", requirement: "System documentation and information for users.", controls: ["PC-22", "PC-12"], status: "documented" },
  { framework: "iso-42001", clause: "A.8.4", requirement: "A plan for communicating incidents to users and interested parties.", controls: ["PC-29", "PC-20"], status: "documented", gap: "one person holds the incident roles today (the maintainer), with no deputy" },
  { framework: "iso-42001", clause: "A.9.2", requirement: "Processes for the responsible use of the AI system.", controls: ["PC-01", "PC-03", "PC-05"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.9.4", requirement: "The AI system is used only as intended.", controls: ["PC-07", "PC-09", "PC-11"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.10.2", requirement: "Responsibilities allocated between the organisation, its partners, suppliers and customers.", controls: ["PC-24"], status: "documented" },
  { framework: "iso-42001", clause: "A.10.3", requirement: "A process so that suppliers' services fit the organisation's approach to responsible AI.", controls: ["PC-30", "PC-27", "PC-15"], status: "documented", gap: "the register and the AI policy's supplier rules rest on the suppliers' public documents; no supplier was assessed beyond them" },

  // SOC 2
  { framework: "soc2", clause: "CC6.1", requirement: "Logical access security over protected information assets, including the protection of keys.", controls: ["PC-01", "PC-07", "PC-08", "PC-17"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.2", requirement: "Register and authorise users before issuing credentials; remove credentials when access is no longer authorised.", controls: ["PC-25", "PC-07"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.3", requirement: "Authorise, modify and remove access by role, least privilege and segregation of duties.", controls: ["PC-05", "PC-07", "PC-09"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.6", requirement: "Logical access measures against threats from outside the system's boundaries.", controls: ["PC-08", "PC-14", "PC-13"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.1", requirement: "Detect changes to configurations that introduce vulnerabilities, and newly discovered vulnerabilities.", controls: ["PC-03", "PC-21"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.2", requirement: "Monitor system components and their operation for anomalies that indicate malicious acts or errors.", controls: ["PC-13", "PC-15", "PC-11"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.3", requirement: "Evaluate security events to decide whether they are incidents.", controls: ["PC-29", "PC-11", "PC-20"], status: "documented", gap: "the classification is a person's decision and is not yet recorded in the ledger" },
  { framework: "soc2", clause: "CC7.4", requirement: "Respond to identified security incidents with a defined incident response programme.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.5", requirement: "Recover from identified security incidents.", controls: ["PC-20"], status: "documented", gap: "no recorded restore test" },
  { framework: "soc2", clause: "CC8.1", scope: "configuration: the CFO policy", requirement: "Changes are authorised, documented, tested and approved before they are implemented.", controls: ["PC-04", "PC-03", "PC-05"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC8.1", scope: "software", requirement: "Changes are authorised, documented, tested and approved before they are implemented.", controls: ["PC-21", "PC-19"], status: "documented", gap: "one maintainer: most changes have no second human reviewer; no branch ruleset or signed commits yet" },

  // DORA
  { framework: "dora", clause: "Art. 6(1)", requirement: "A sound, comprehensive and well-documented ICT risk management framework.", controls: ["PC-23", "PC-20", "PC-27"], status: "documented", gap: "no management body; the review the AI policy sets has not run yet" },
  { framework: "dora", clause: "Art. 8(1)", requirement: "Identify, classify and document ICT-supported functions, information assets and their dependencies.", controls: ["PC-18", "PC-23"], status: "documented" },
  { framework: "dora", clause: "Art. 9(4)(c)", requirement: "Limit logical access to what legitimate, approved functions need, with sound administration of access rights.", controls: ["PC-07", "PC-09", "PC-05"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 9(4)(d)", requirement: "Strong authentication and protection of cryptographic keys.", controls: ["PC-01", "PC-08", "PC-25", "PC-17"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 9(4)(e)", requirement: "Documented ICT change management: changes recorded, tested, assessed and approved in a controlled way.", controls: ["PC-04", "PC-03", "PC-21"], status: "evidence-in-ledger", gap: "for the CFO policy; software changes are documented only (see SOC 2 CC8.1)" },
  { framework: "dora", clause: "Art. 10(1)", requirement: "Promptly detect anomalous activities.", controls: ["PC-13", "PC-15", "PC-11"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 11(2)(c)", requirement: "Activate, without delay, plans that contain an ICT-related incident and prevent further damage.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 12(1)", requirement: "Backup policies and procedures, and restoration and recovery procedures and methods.", controls: ["PC-20", "PC-10"], status: "gap", gap: "no backup policy for the runner's ledger and no recorded restore test (the hash chains would show a restore that lost or changed a row)" },
  { framework: "dora", clause: "Art. 17(1)", requirement: "An ICT-related incident management process to detect, manage and notify incidents.", controls: ["PC-29", "PC-20", "PC-11"], status: "documented", gap: "the roles are named, but one person holds them today" },
  { framework: "dora", clause: "Art. 17(2)", requirement: "Record ICT-related incidents and significant cyber threats.", controls: ["PC-11", "PC-10", "PC-15", "PC-14"], status: "evidence-in-ledger", gap: "the events are recorded; an incident's classification and record (incident-response.md's template) are kept outside the ledger" },
  { framework: "dora", clause: "Art. 18(1)", requirement: "Classify ICT-related incidents by the criteria the regulation sets.", controls: ["PC-29", "PC-11"], status: "documented", gap: "Purser's own classes, with the regulation's criteria named; the thresholds of the regulatory technical standards are not applied (Purser is not a financial entity)" },
  { framework: "dora", clause: "Art. 19(1)", requirement: "Report major ICT-related incidents to the competent authority.", controls: ["PC-29", "PC-20"], status: "documented", gap: "a template and a procedure only: reporting is the deploying financial entity's duty, and nothing is reported from the sandbox" },
  { framework: "dora", clause: "Art. 24(1)", requirement: "A sound and comprehensive digital operational resilience testing programme.", controls: ["PC-19"], status: "documented", gap: "no threat-led penetration test by an independent tester (Arts. 26, 27)" },
  { framework: "dora", clause: "Art. 28(1)", requirement: "Manage ICT third-party risk as part of the ICT risk management framework.", controls: ["PC-15", "PC-14", "PC-30"], status: "evidence-in-ledger", gap: "the ledger evidence is of the providers' records (reconciliation, webhooks checked against the ledger); the register and exit plans are documents" },
  { framework: "dora", clause: "Art. 28(3)", requirement: "A register of information on all contractual arrangements with ICT third-party service providers.", controls: ["PC-30", "PC-24"], status: "documented", gap: "Purser's own register, not the implementing technical standards' template; it records no contractual arrangement because there is none yet" },
  { framework: "dora", clause: "Art. 28(8)", requirement: "Exit strategies for ICT services supporting critical or important functions.", controls: ["PC-30", "PC-20"], status: "documented", gap: "written, none exercised" },
  { framework: "dora", clause: "Art. 30(1)", requirement: "The rights and obligations with each ICT third-party service provider set out in writing.", controls: ["PC-30", "PC-24"], status: "gap", gap: "no contract yet: test and developer accounts on the providers' standard terms; exit-plans.md lists what a production contract must include" },
  // PSD2 and the RTS on SCA (26 Nov)
  { framework: "psd2-sca", clause: "PSD2 Art. 97(1)", requirement: "The payment service provider applies strong customer authentication when the payer initiates an electronic payment.", controls: ["PC-30", "PC-01"], status: "documented", gap: "Purser is not a PSP: this SCA is Airwallex's, for its own logins and payments; Purser's passkey approval comes before it and does not replace it" },
  { framework: "psd2-sca", clause: "RTS Art. 4(1)", requirement: "Authentication based on two or more elements (knowledge, possession, inherence) that generates an authentication code.", controls: ["PC-01", "PC-25"], status: "evidence-in-ledger", gap: "the passkey (possession) is unlocked by Face ID (inherence) or the phone's passcode (knowledge); a synced passkey can live on more than one of the person's devices, and whether that still counts as possession is for a PSP and its supervisor to assess" },
  { framework: "psd2-sca", clause: "RTS Art. 4(2)", requirement: "The authentication code cannot be forged, and no new code can be derived from one generated before.", controls: ["PC-01", "PC-02"], status: "evidence-in-ledger" },
  { framework: "psd2-sca", clause: "RTS Art. 4(3)(b)", requirement: "No more than five failed authentication attempts in a row before the action is blocked.", controls: ["PC-25", "PC-11"], status: "documented", gap: "failed passkey signatures are counted and alerted (src/passkey/failures.ts) and the relay slows an address that keeps failing; the passkey is not blocked after five, the phone's own Face ID lock applies" },
  { framework: "psd2-sca", clause: "RTS Art. 5(1)(a)", requirement: "Dynamic linking: the payer is made aware of the amount and the payee being authenticated.", controls: ["PC-01", "PC-22"], status: "documented", gap: "the approval page draws the amount and payee from the hashed terms it checks itself (test-checked); what it showed is not logged per approval" },
  { framework: "psd2-sca", clause: "RTS Art. 5(1)(b)", requirement: "Dynamic linking: the authentication code is specific to the amount and the payee.", controls: ["PC-01", "PC-02"], status: "evidence-in-ledger" },
  { framework: "psd2-sca", clause: "RTS Art. 5(1)(d)", requirement: "Dynamic linking: any change to the amount or the payee invalidates the authentication code.", controls: ["PC-02", "PC-19"], status: "evidence-in-ledger" },
  { framework: "psd2-sca", clause: "RTS Art. 9(1)", requirement: "The elements are independent: the breach of one does not compromise the others.", controls: ["PC-25", "PC-17"], status: "documented", gap: "both elements sit on one phone; their separation rests on the phone's secure hardware (Art. 9(2), (3)), which Purser has not assessed" },
  { framework: "psd2-sca", clause: "RTS Art. 22(1)", requirement: "The confidentiality and integrity of the personalised security credentials are ensured, in every phase.", controls: ["PC-25", "PC-17"], status: "evidence-in-ledger" },
  { framework: "psd2-sca", clause: "RTS Art. 27", requirement: "Credentials can be destroyed, deactivated or revoked securely.", controls: ["PC-25", "PC-07"], status: "evidence-in-ledger" },

  // GDPR (26 Nov)
  { framework: "gdpr", clause: "Art. 5(1)(c)", requirement: "Data minimisation: personal data adequate, relevant and limited to what is necessary.", controls: ["PC-18", "PC-35", "PC-16"], status: "documented" },
  { framework: "gdpr", clause: "Art. 5(1)(e)", requirement: "Storage limitation: kept no longer than necessary.", controls: ["PC-31", "PC-35"], status: "documented", gap: "Purser Cloud deletes on its schedule; the runner's check only reports rows past their period" },
  { framework: "gdpr", clause: "Art. 15", scope: "access", requirement: "The data subject's right of access to their personal data.", controls: ["PC-35"], status: "documented", gap: "a user reads their own account (GET /v1/me) and an owner exports the company's data; a person who is not a user (a supplier, a customer) is answered by the controller by hand from that export" },
  { framework: "gdpr", clause: "Art. 17", requirement: "The right to erasure, within the limits of Art. 17(3).", controls: ["PC-35", "PC-31"], status: "documented", gap: "Purser Cloud erases a person at once and keeps the books (Art. 17(3)(b)); the runner's ledger has no erasure tool, its hash chains are kept or deleted whole" },
  { framework: "gdpr", clause: "Art. 20", requirement: "The right to data portability, in a structured, commonly used, machine-readable format.", controls: ["PC-35"], status: "documented", gap: "the company's export (JSON and CSV) is per company, not per person" },
  { framework: "gdpr", clause: "Art. 22", requirement: "No decision based solely on automated processing with legal or similarly significant effects on a person, without the safeguards Art. 22 sets.", controls: ["PC-01", "PC-03", "PC-36"], status: "evidence-in-ledger", gap: "code pays a supplier's invoice alone within the limit the CFO signed; a refusal or hold always goes to a person; no decision about a natural person's credit or rights is made" },
  { framework: "gdpr", clause: "Art. 25", requirement: "Data protection by design and by default.", controls: ["PC-18", "PC-17", "PC-35"], status: "documented" },
  { framework: "gdpr", clause: "Art. 28", requirement: "Processing on the controller's behalf only under a contract with the terms Art. 28(3) lists, and subprocessors under the same terms.", controls: ["PC-30", "PC-35"], status: "gap", gap: "no data processing agreement with any deploying business or any subprocessor: test accounts only" },
  { framework: "gdpr", clause: "Art. 30", requirement: "A record of processing activities.", controls: ["PC-35", "PC-18"], status: "documented", gap: "drawn up for the controller to adopt; the controller's name and contact are blanks until a business deploys Purser" },
  { framework: "gdpr", clause: "Art. 32", requirement: "Security of processing appropriate to the risk, including pseudonymisation, encryption, integrity and resilience.", controls: ["PC-17", "PC-10", "PC-01", "PC-18"], status: "evidence-in-ledger", gap: "the runner's SQLite file is not encrypted at rest by Purser (an encrypted volume is the owner's)" },
  { framework: "gdpr", clause: "Art. 33", requirement: "Notify a personal data breach to the supervisory authority within 72 hours where feasible.", controls: ["PC-29"], status: "documented", gap: "the controller's duty: incident-response.md has the procedure and template; nothing has been notified (sandbox, test data)" },
  { framework: "gdpr", clause: "Art. 35", requirement: "A data protection impact assessment where processing is likely to result in a high risk.", controls: ["PC-35", "PC-27"], status: "documented", gap: "done voluntarily by the maintainer (AI is new technology); no data protection officer or data subject consulted" },
  { framework: "gdpr", clause: "Art. 44", requirement: "Transfers to a third country only under Chapter V (adequacy, appropriate safeguards).", controls: ["PC-30", "PC-35"], status: "gap", gap: "Anthropic, Resend and Twilio are in the United States; no transfer mechanism (EU-US Data Privacy Framework, Standard Contractual Clauses) is recorded for any of them" },

  // eIDAS (26 Nov)
  { framework: "eidas", clause: "Art. 3(10)", requirement: "An electronic signature: data in electronic form attached to other data, used by the signatory to sign.", controls: ["PC-01", "PC-25"], status: "evidence-in-ledger" },
  { framework: "eidas", clause: "Art. 26", requirement: "An advanced electronic signature: uniquely linked to and capable of identifying the signatory, under their sole control, and linked to the data so any later change is detectable.", controls: ["PC-01", "PC-25", "PC-34"], status: "documented", gap: "the link to the data holds (a signature over the terms hash; one changed byte fails, exported as JAdES and verified offline); whether the passkey identifies the CFO enough for Art. 26 is a legal assessment that has not been made" },
  { framework: "eidas", clause: "Art. 25(2)", requirement: "A qualified electronic signature, with the legal effect of a handwritten signature.", controls: ["PC-34"], status: "gap", gap: "no qualified signature has been made: the CSC adapter is tested against a mock server only; there is no QTSP contract and no qualified signing credential" },
  { framework: "eidas", clause: "Art. 42(1)", requirement: "A qualified electronic time stamp: bound to the data, from an accurate time source, signed by a qualified trust service provider.", controls: ["PC-34"], status: "documented", gap: "RFC 3161 time-stamps are built and tested against a mock TSA, and two tokens from public TSAs were checked offline on 19 Nov; no qualified TSA was used and the EU Trusted List is not checked" },

  // NIS2 Art. 21(2) (26 Nov)
  { framework: "nis2", clause: "Art. 21(2)(a)", requirement: "Policies on risk analysis and information system security.", controls: ["PC-23", "PC-27", "PC-18"], status: "documented" },
  { framework: "nis2", clause: "Art. 21(2)(b)", requirement: "Incident handling: detect, analyse, contain and respond to incidents.", controls: ["PC-29", "PC-06", "PC-11"], status: "evidence-in-ledger", gap: "the decision that an event is an incident is not recorded in the ledger" },
  { framework: "nis2", clause: "Art. 21(2)(c)", requirement: "Business continuity, such as backup management and disaster recovery, and crisis management.", controls: ["PC-20", "PC-30"], status: "gap", gap: "the runbook covers recovery steps and the exit plans the providers, but there is no backup policy for the runner's ledger and no recorded restore test" },
  { framework: "nis2", clause: "Art. 21(2)(d)", requirement: "Supply chain security, including the relationships with direct suppliers and service providers.", controls: ["PC-30", "PC-32"], status: "documented" },
  { framework: "nis2", clause: "Art. 21(2)(e)", requirement: "Security in acquisition, development and maintenance, including vulnerability handling and disclosure.", controls: ["PC-21", "PC-32", "PC-33"], status: "documented" },
  { framework: "nis2", clause: "Art. 21(2)(f)", requirement: "Policies and procedures to assess the effectiveness of the cybersecurity measures.", controls: ["PC-19", "PC-33"], status: "documented", gap: "self-assessed and tested in CI; no independent assessment or penetration test" },
  { framework: "nis2", clause: "Art. 21(2)(g)", requirement: "Basic cyber hygiene practices and cybersecurity training.", controls: ["PC-27"], status: "gap", gap: "no training programme and no record of anyone's training" },
  { framework: "nis2", clause: "Art. 21(2)(h)", requirement: "Policies and procedures on the use of cryptography and, where appropriate, encryption.", controls: ["PC-17", "PC-01"], status: "documented" },
  { framework: "nis2", clause: "Art. 21(2)(i)", requirement: "Human resources security, access control policies and asset management.", controls: ["PC-07", "PC-05", "PC-18"], status: "evidence-in-ledger" },
  { framework: "nis2", clause: "Art. 21(2)(j)", requirement: "Multi-factor or continuous authentication, secured communications, and secured emergency communication.", controls: ["PC-01", "PC-25", "PC-08"], status: "evidence-in-ledger", gap: "no separate emergency communication channel is set up" },

  // ISO/IEC 27001:2022 Annex A (26 Nov)
  { framework: "iso-27001", clause: "A.5.1", requirement: "Policies for information security, approved and communicated.", controls: ["PC-27", "PC-23", "PC-33"], status: "documented", gap: "written by the maintainer; no management approval process beyond the one maintainer" },
  { framework: "iso-27001", clause: "A.5.15", requirement: "Access control rules, by business and information security requirements.", controls: ["PC-07", "PC-05", "PC-09"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.5.17", requirement: "Authentication information allocated and managed.", controls: ["PC-25", "PC-17"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.5.19", requirement: "Information security in supplier relationships.", controls: ["PC-30"], status: "documented" },
  { framework: "iso-27001", clause: "A.5.23", requirement: "Information security for the use of cloud services.", controls: ["PC-30", "PC-18"], status: "documented", gap: "on the providers' standard terms; no cloud agreement reviewed" },
  { framework: "iso-27001", clause: "A.5.24", requirement: "Information security incident management planning and preparation.", controls: ["PC-29", "PC-20"], status: "documented" },
  { framework: "iso-27001", clause: "A.5.28", requirement: "Collection and preservation of evidence.", controls: ["PC-10"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.5.34", requirement: "Privacy and protection of personal data.", controls: ["PC-35", "PC-18"], status: "documented" },
  { framework: "iso-27001", clause: "A.6.3", requirement: "Information security awareness, education and training.", controls: ["PC-27"], status: "gap", gap: "no training programme and no record of anyone's training" },
  { framework: "iso-27001", clause: "A.7.1", requirement: "Physical security perimeters.", controls: ["PC-30"], status: "gap", gap: "no premises of its own: the runner runs on its owner's machine and Purser Cloud in Cloudflare's data centres, whose physical security Purser has not assessed" },
  { framework: "iso-27001", clause: "A.8.5", requirement: "Secure authentication.", controls: ["PC-01", "PC-08", "PC-25"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.8.8", requirement: "Management of technical vulnerabilities.", controls: ["PC-32", "PC-33"], status: "documented" },
  { framework: "iso-27001", clause: "A.8.13", requirement: "Information backup, kept and tested.", controls: ["PC-20"], status: "gap", gap: "no backup policy for the runner's ledger and no recorded restore test" },
  { framework: "iso-27001", clause: "A.8.15", requirement: "Logging: logs that record activities, exceptions and faults, produced, kept, protected and analysed.", controls: ["PC-10", "PC-16", "PC-31"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.8.16", requirement: "Monitoring of networks, systems and applications for anomalous behaviour.", controls: ["PC-11", "PC-13", "PC-15", "PC-14"], status: "evidence-in-ledger" },
  { framework: "iso-27001", clause: "A.8.24", requirement: "Rules for the effective use of cryptography, including key management.", controls: ["PC-17"], status: "documented" },
  { framework: "iso-27001", clause: "A.8.25", requirement: "A secure development life cycle.", controls: ["PC-21", "PC-33", "PC-32"], status: "documented", gap: "one maintainer: most changes have no second human reviewer" },
  { framework: "iso-27001", clause: "A.8.29", requirement: "Security testing in development and acceptance.", controls: ["PC-19", "PC-33"], status: "documented" },
  { framework: "iso-27001", clause: "A.8.32", requirement: "Changes to information processing facilities and systems are subject to change management procedures.", controls: ["PC-04", "PC-21"], status: "evidence-in-ledger", gap: "the CFO policy's changes leave records; software changes are documented only" },
];

export const controlById = (id: string): Control | undefined => CONTROLS.find((c) => c.id === id);

// A Markdown table cell: a pipe becomes "\\|", GFM's table escape, which also holds inside a code span (where a backslash is
// literal, so backslashes are left as they are: a regex like "\\." must render as written). Newlines become spaces.
const cell = (s: string) => s.split("|").join("\\|").split("\n").join(" ");
const code = (s: string) => `\`${s}\``;

/** A control's evidence source, in words, for the document. */
export function evidenceSource(c: Control): string {
  const e = c.evidence;
  if (!e) return `documented only: ${[...c.docs, ...c.code].map(code).join(", ")}`;
  const parts: string[] = [];
  if (e.chain) parts.push("the period's run of `audit_log` (first and last `seq`, the hash it links to, its head)");
  if (e.events.length) parts.push(`audit events ${e.events.map(code).join(", ")}`);
  if (e.patterns.length) parts.push(`audit events matching ${e.patterns.map(code).join(", ")}`);
  for (const s of e.scoped) parts.push(`audit event ${code(s.event)} whose subject matches ${code(s.subject)}`);
  for (const t of e.tables) parts.push(`table ${code(t.table)} rows by ${code(t.at)} (${t.cite.map(code).join(", ")}, and each row's SHA-256)`);
  return parts.join("; ");
}

const statusWords: Record<Status, string> = { "evidence-in-ledger": "evidence in ledger", documented: "documented", gap: "**gap**" };

/** docs/compliance/controls.md, rendered from this file (npm run compliance:controls; test/compliance-controls.test.ts). */
export function controlsMarkdown(): string {
  const L: string[] = [];
  L.push("# Control map: frameworks to Purser's controls and their evidence", "");
  L.push("<!-- Generated by npm run compliance:controls from src/compliance/controls.ts. Do not edit by hand. -->", "");
  L.push(`**${HONEST_LINE}**`, "");
  L.push("Each row below maps one requirement of a framework to the Purser controls that address it, and says how its "
    + "evidence is derived. `npm run compliance-evidence` lists, for a period, the records each control left in the ledger "
    + "([how to run and verify it](README.md)). A status says what stands behind a row:", "");
  L.push("- **evidence in ledger**: a control that leaves records in the ledger addresses it; the evidence lists them per period.");
  L.push("- **documented**: addressed by code, tests and documents only; there is nothing per period to count.");
  L.push("- **gap**: Purser does not address it, or only part of it; the row says what is missing.", "");
  L.push("## Summary", "");
  L.push("| Framework | Requirements | Evidence in ledger | Documented | Gap |", "|---|---|---|---|---|");
  for (const c of statusCounts()) L.push(`| ${c.short} | ${c.requirements} | ${c["evidence-in-ledger"]} | ${c.documented} | ${c.gap} |`);
  const all = statusCounts();
  L.push(`| **All** | ${all.reduce((n, c) => n + c.requirements, 0)} | ${all.reduce((n, c) => n + c["evidence-in-ledger"], 0)} | ${all.reduce((n, c) => n + c.documented, 0)} | ${all.reduce((n, c) => n + c.gap, 0)} |`, "");
  L.push("## Frameworks", "");
  for (const f of FRAMEWORKS) L.push(`- **${f.name}** ([source](${f.source})). ${f.scope}`);
  L.push("");
  L.push("## Purser's controls", "");
  L.push("| Id | Control | What it does | Where | Evidence source |", "|---|---|---|---|---|");
  for (const c of CONTROLS) L.push(`| ${c.id} | ${cell(c.name)} | ${cell(c.does)} | ${cell([...c.code, ...c.docs].map(code).join(", "))} | ${cell(evidenceSource(c))} |`);
  L.push("");
  for (const f of FRAMEWORKS) {
    const rows = REQUIREMENTS.filter((r) => r.framework === f.id);
    const n = (s: Status) => rows.filter((r) => r.status === s).length;
    L.push(`## ${f.name}`, "");
    L.push(`${rows.length} requirements: ${n("evidence-in-ledger")} with evidence in the ledger, ${n("documented")} documented, ${n("gap")} ${n("gap") === 1 ? "gap" : "gaps"}.`, "");
    L.push("| Clause | Requirement, in plain words | Purser controls | Status | Missing |", "|---|---|---|---|---|");
    for (const r of rows) L.push(`| ${cell(r.clause)}${r.scope ? ` (${cell(r.scope)})` : ""} | ${cell(r.requirement)} | ${r.controls.join(", ")} | ${statusWords[r.status]} | ${cell(r.gap ?? "")} |`);
    L.push("");
  }
  const short = (r: Requirement) => `${FRAMEWORKS.find((f) => f.id === r.framework)!.name.split(",")[0]} ${r.clause}${r.scope ? ` (${r.scope})` : ""}`;
  L.push("## Gaps in one list", "");
  for (const r of REQUIREMENTS.filter((x) => x.status === "gap")) L.push(`- ${short(r)}: ${r.gap}.`);
  L.push("", "And the parts still open in rows that are mapped:", "");
  for (const r of REQUIREMENTS.filter((x) => x.status !== "gap" && x.gap)) L.push(`- ${short(r)}: ${r.gap}.`);
  L.push("");
  return `${L.join("\n")}`;
}

/** A framework's short name: the part of its name before the first comma ("EU AI Act", "GDPR", "PSD2 SCA"). */
export const shortName = (f: Framework): string => f.name.split(",")[0]!;

export interface StatusCount { framework: FrameworkId; short: string; requirements: number; "evidence-in-ledger": number; documented: number; gap: number }

/** Per framework, its requirements by status (the map's own statuses, not a period's evidence). */
export function statusCounts(): StatusCount[] {
  return FRAMEWORKS.map((f) => {
    const rows = REQUIREMENTS.filter((r) => r.framework === f.id);
    const n = (s: Status) => rows.filter((r) => r.status === s).length;
    return { framework: f.id, short: shortName(f), requirements: rows.length, "evidence-in-ledger": n("evidence-in-ledger"), documented: n("documented"), gap: n("gap") };
  });
}

/** The palette of the compliance pages: evidence emerald, documented sky, gap rose; violet and amber for people and signatures. */
export const PALETTE = { violet: "#8b5cf6", emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9" } as const;

const badge = (label: string, n: number, colour: string) =>
  `![${label}: ${n}](https://img.shields.io/badge/${encodeURIComponent(label.replace(/-/g, "--").replace(/ /g, "_"))}-${n}-${colour.slice(1)}?style=flat-square&labelColor=1f2937)`;

/**
 * The governance dashboard of docs/compliance/README.md, between its dashboard markers (npm run compliance:controls
 * writes it; test/compliance-docs.test.ts holds the page to it): per framework a bar of its statuses and three badges
 * drawn from the counts above, and a pie of every requirement by status.
 */
export function dashboardMarkdown(): string {
  const counts = statusCounts();
  const total = (k: "requirements" | "evidence-in-ledger" | "documented" | "gap") => counts.reduce((n, c) => n + c[k], 0);
  const bar = (c: StatusCount) => {
    const w = 20, e = Math.round((c["evidence-in-ledger"] / c.requirements) * w), d = Math.round(((c["evidence-in-ledger"] + c.documented) / c.requirements) * w) - e;
    return `\`${"█".repeat(e)}${"▓".repeat(d)}${"░".repeat(Math.max(0, w - e - d))}\``;
  };
  const L: string[] = [];
  L.push("<!-- dashboard:start: generated by npm run compliance:controls from src/compliance/controls.ts; do not edit by hand -->", "");
  L.push(`${total("requirements")} requirements of ${counts.length} frameworks, mapped to ${CONTROLS.length} Purser controls: ${total("evidence-in-ledger")} with evidence in the ledger, ${total("documented")} documented, ${total("gap")} gaps. In the bars, █ is evidence in the ledger, ▓ documented, ░ gap.`, "");
  L.push("| Framework | Requirements | Status | Evidence in ledger | Documented | Gap |", "|---|---|---|---|---|---|");
  for (const c of counts) {
    const f = FRAMEWORKS.find((x) => x.id === c.framework)!;
    const anchor = f.name.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    L.push(`| [${c.short}](controls.md#${anchor}) | ${c.requirements} | ${bar(c)} | ${badge("evidence", c["evidence-in-ledger"], PALETTE.emerald)} | ${badge("documented", c.documented, PALETTE.sky)} | ${badge("gap", c.gap, PALETTE.rose)} |`);
  }
  L.push("");
  L.push("```mermaid");
  L.push(`%%{init: {"theme": "base", "themeVariables": {"pie1": "${PALETTE.emerald}", "pie2": "${PALETTE.sky}", "pie3": "${PALETTE.rose}", "pieStrokeColor": "#1f2937", "pieOuterStrokeColor": "#1f2937"}}}%%`);
  L.push(`pie showData title All ${total("requirements")} requirements, by status`);
  L.push(`  "Evidence in ledger" : ${total("evidence-in-ledger")}`, `  "Documented" : ${total("documented")}`, `  "Gap" : ${total("gap")}`);
  L.push("```", "");
  L.push("<!-- dashboard:end -->");
  return L.join("\n");
}

/** Replaces the block between `<!-- name:start` and `<!-- name:end -->` with `block` (which carries both markers). */
export function replaceBlock(text: string, name: string, block: string): string {
  const a = text.indexOf(`<!-- ${name}:start`), end = `<!-- ${name}:end -->`, b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`no ${name} block`);
  return text.slice(0, a) + block + text.slice(b + end.length);
}

/** The text between a block's markers, markers included (for a test that holds a page to its generated block). */
export function blockOf(text: string, name: string): string {
  const a = text.indexOf(`<!-- ${name}:start`), end = `<!-- ${name}:end -->`, b = text.indexOf(end);
  return a < 0 || b < a ? "" : text.slice(a, b + end.length);
}

/** The per-framework summary block of docs/governance.md and docs/compliance.md (npm run compliance:controls writes it). */
export function frameworksBlock(): string {
  const counts = statusCounts();
  const L = ["<!-- frameworks:start: generated by npm run compliance:controls from src/compliance/controls.ts; do not edit by hand -->", ""];
  L.push("| Framework | Requirements | Evidence in ledger | Documented | Gap |", "|---|---|---|---|---|");
  for (const c of counts) L.push(`| ${c.short} | ${c.requirements} | ${c["evidence-in-ledger"]} | ${c.documented} | ${c.gap} |`);
  L.push(`| **All** | ${counts.reduce((n, c) => n + c.requirements, 0)} | ${counts.reduce((n, c) => n + c["evidence-in-ledger"], 0)} | ${counts.reduce((n, c) => n + c.documented, 0)} | ${counts.reduce((n, c) => n + c.gap, 0)} |`);
  L.push("", "<!-- frameworks:end -->");
  return L.join("\n");
}
