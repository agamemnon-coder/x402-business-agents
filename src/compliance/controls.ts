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

export const HONEST_LINE = "Mapped to, not certified against: certification or an attestation needs an independent auditor, "
  + "and nobody has audited Purser against any of these frameworks. Purser moves test money only, in the Airwallex sandbox "
  + "and on Alta testnet.";

export const STATUSES = ["evidence-in-ledger", "documented", "gap"] as const;
export type Status = typeof STATUSES[number];

export type FrameworkId = "eu-ai-act" | "iso-42001" | "soc2" | "dora";
export interface Framework { id: FrameworkId; name: string; source: string; scope: string }

export const FRAMEWORKS: readonly Framework[] = [
  {
    id: "eu-ai-act", name: "EU AI Act, Regulation (EU) 2024/1689", source: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng",
    scope: "Articles 9 to 15 set requirements for high-risk AI systems. Whether Purser's use would be one (Article 6, Annex III) "
      + "has not been assessed; the rows show which controls would give evidence for each requirement if it were.",
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
    code: ["src/policy/approvals.ts", "src/passkey/webauthn.ts", "src/passkey/process.ts", "src/lib/terms.ts"], docs: ["docs/phone-approval.md"],
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
      events: [...new Set([...refusals.events, ANOMALY_HELD])].sort(), patterns: refusals.patterns,
      how: "each refusal or hold, sorted as the audit pack's refusals_holds section is (the same events and patterns), with the anomaly hold",
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
    does: "An Airwallex webhook is recorded only after the relay and then the runner, with its own copy of the secret, check its HMAC; a webhook only records what Airwallex decided and can never move money; a disagreement with the ledger raises an alarm.",
    code: ["src/policy/cardHooks.ts", "src/policy/airwallexEvents.ts"], docs: ["docs/security/SECURITY-MAPPING.md"],
    evidence: ev({
      events: ["airwallex.disagrees"],
      tables: [{ table: "airwallex_events", at: "received_at", cite: ["event_id", "object", "agrees"] }],
      how: "each webhook recorded after its signature verified, and each that disagreed with the ledger (a webhook with a bad signature is dropped and logged by the runner, not recorded in the ledger)",
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
    code: [], docs: ["docs/runbook.md"], evidence: null,
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
    code: [], docs: ["docs/security/roles.md", "docs/who-does-what.md", "docs/compliance.md"], evidence: null,
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
  { framework: "eu-ai-act", clause: "Art. 9(2)", requirement: "A risk management system run as a continuous process: identify, estimate and evaluate the known and foreseeable risks.", controls: ["PC-23", "PC-19"], status: "documented", gap: "no risk register kept as a continuous process with owners and reviews" },
  { framework: "eu-ai-act", clause: "Art. 9(2)(d)", requirement: "Adopt targeted risk management measures for the risks identified.", controls: ["PC-11", "PC-13", "PC-06", "PC-01"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 9(6)", requirement: "Test the system to find the most appropriate risk management measures.", controls: ["PC-19"], status: "documented" },
  { framework: "eu-ai-act", clause: "Art. 12(1)", requirement: "Automatically record events (logs) over the lifetime of the system.", controls: ["PC-10", "PC-16", "PC-01"], status: "evidence-in-ledger", gap: "how long logs are kept is not set (a retention policy is the business's, and open)" },
  { framework: "eu-ai-act", clause: "Art. 12(2)", requirement: "Logs that let one identify risky situations, support post-market monitoring and monitor the system's operation.", controls: ["PC-11", "PC-13", "PC-15", "PC-10"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 13(1)", requirement: "Operation transparent enough for deployers to interpret the output and use it appropriately.", controls: ["PC-12", "PC-22"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 13(3)", requirement: "Instructions for use with the provider's identity, the system's capabilities and limits, its declared accuracy, the human oversight measures and how logs are collected.", controls: ["PC-22"], status: "gap", gap: "no instructions-for-use document with the contents Art. 13(3) lists; the docs describe the system but are not that document" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(b)", requirement: "Help the people overseeing it stay aware of automation bias (over-relying on the output).", controls: ["PC-12"], status: "gap", gap: "nothing measures or counters automation bias: whether the approver opened the rationale before signing is not recorded" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(d)", requirement: "A person can decide not to use the output, or disregard, override or reverse it.", controls: ["PC-01", "PC-02", "PC-04"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 14(4)(e)", requirement: "A person can intervene or interrupt the system with a stop button or similar procedure that halts it in a safe state.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 15(1)", requirement: "An appropriate level of accuracy, robustness and cybersecurity, consistent over the lifecycle.", controls: ["PC-19", "PC-23"], status: "documented" },
  { framework: "eu-ai-act", clause: "Art. 15(3)", requirement: "Accuracy levels and metrics declared in the instructions for use.", controls: ["PC-19"], status: "gap", gap: "eval results are published, but no accuracy level is declared as a commitment to deployers" },
  { framework: "eu-ai-act", clause: "Art. 15(4)", requirement: "Resilient to errors, faults and inconsistencies, with fail-safe measures.", controls: ["PC-02", "PC-11", "PC-15"], status: "evidence-in-ledger" },
  { framework: "eu-ai-act", clause: "Art. 15(5)", requirement: "Resilient against unauthorised attempts to alter its use, outputs or performance (for example manipulated inputs).", controls: ["PC-13", "PC-08", "PC-14", "PC-19"], status: "evidence-in-ledger" },

  // ISO/IEC 42001 Annex A
  { framework: "iso-42001", clause: "A.2.2", requirement: "A documented AI policy for the organisation.", controls: ["PC-24"], status: "gap", gap: "no AI policy of the organisation running Purser (the CFO policy limits the agents; it is not an AI policy)" },
  { framework: "iso-42001", clause: "A.3.2", requirement: "AI roles and responsibilities defined and allocated.", controls: ["PC-24", "PC-07"], status: "documented" },
  { framework: "iso-42001", clause: "A.5.2", requirement: "A process to assess the impact of AI systems on individuals, groups and society.", controls: ["PC-23"], status: "gap", gap: "no AI system impact assessment; the threat model and worst-case write-up cover harm to the business, not to individuals or society" },
  { framework: "iso-42001", clause: "A.6.2.4", requirement: "Verification and validation of the AI system.", controls: ["PC-19"], status: "documented" },
  { framework: "iso-42001", clause: "A.6.2.6", requirement: "Operation and monitoring of the AI system.", controls: ["PC-15", "PC-11", "PC-13"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.6.2.8", requirement: "Recording of event logs of the AI system.", controls: ["PC-10", "PC-16", "PC-01"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.7.5", requirement: "Record the provenance of the data used by the AI system.", controls: ["PC-16"], status: "evidence-in-ledger", gap: "covers the documents a model read (their hash per reading); Purser trains no model" },
  { framework: "iso-42001", clause: "A.8.2", requirement: "System documentation and information for users.", controls: ["PC-22", "PC-12"], status: "documented" },
  { framework: "iso-42001", clause: "A.8.4", requirement: "A plan for communicating incidents to users and interested parties.", controls: ["PC-20"], status: "gap", gap: "the runbook says what to do, not whom to tell or how; no named people" },
  { framework: "iso-42001", clause: "A.9.2", requirement: "Processes for the responsible use of the AI system.", controls: ["PC-01", "PC-03", "PC-05"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.9.4", requirement: "The AI system is used only as intended.", controls: ["PC-07", "PC-09", "PC-11"], status: "evidence-in-ledger" },
  { framework: "iso-42001", clause: "A.10.2", requirement: "Responsibilities allocated between the organisation, its partners, suppliers and customers.", controls: ["PC-24"], status: "documented" },
  { framework: "iso-42001", clause: "A.10.3", requirement: "A process so that suppliers' services fit the organisation's approach to responsible AI.", controls: ["PC-15"], status: "gap", gap: "no assessment or register of the suppliers (Anthropic, Airwallex, Alta); reconciliation checks their records, not the suppliers" },

  // SOC 2
  { framework: "soc2", clause: "CC6.1", requirement: "Logical access security over protected information assets, including the protection of keys.", controls: ["PC-01", "PC-07", "PC-08", "PC-17"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.2", requirement: "Register and authorise users before issuing credentials; remove credentials when access is no longer authorised.", controls: ["PC-25", "PC-07"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.3", requirement: "Authorise, modify and remove access by role, least privilege and segregation of duties.", controls: ["PC-05", "PC-07", "PC-09"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC6.6", requirement: "Logical access measures against threats from outside the system's boundaries.", controls: ["PC-08", "PC-14", "PC-13"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.1", requirement: "Detect changes to configurations that introduce vulnerabilities, and newly discovered vulnerabilities.", controls: ["PC-03", "PC-21"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.2", requirement: "Monitor system components and their operation for anomalies that indicate malicious acts or errors.", controls: ["PC-13", "PC-15", "PC-11"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.3", requirement: "Evaluate security events to decide whether they are incidents.", controls: ["PC-11", "PC-20"], status: "gap", gap: "events are recorded, but no procedure decides which are incidents, and no one is named to decide" },
  { framework: "soc2", clause: "CC7.4", requirement: "Respond to identified security incidents with a defined incident response programme.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC7.5", requirement: "Recover from identified security incidents.", controls: ["PC-20"], status: "documented", gap: "no recorded restore test" },
  { framework: "soc2", clause: "CC8.1", scope: "configuration: the CFO policy", requirement: "Changes are authorised, documented, tested and approved before they are implemented.", controls: ["PC-04", "PC-03", "PC-05"], status: "evidence-in-ledger" },
  { framework: "soc2", clause: "CC8.1", scope: "software", requirement: "Changes are authorised, documented, tested and approved before they are implemented.", controls: ["PC-21", "PC-19"], status: "documented", gap: "one maintainer: most changes have no second human reviewer; no branch ruleset or signed commits yet" },

  // DORA
  { framework: "dora", clause: "Art. 6(1)", requirement: "A sound, comprehensive and well-documented ICT risk management framework.", controls: ["PC-23", "PC-20"], status: "documented", gap: "no management body and no yearly review of the framework" },
  { framework: "dora", clause: "Art. 8(1)", requirement: "Identify, classify and document ICT-supported functions, information assets and their dependencies.", controls: ["PC-18", "PC-23"], status: "documented" },
  { framework: "dora", clause: "Art. 9(4)(c)", requirement: "Limit logical access to what legitimate, approved functions need, with sound administration of access rights.", controls: ["PC-07", "PC-09", "PC-05"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 9(4)(d)", requirement: "Strong authentication and protection of cryptographic keys.", controls: ["PC-01", "PC-08", "PC-25", "PC-17"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 9(4)(e)", requirement: "Documented ICT change management: changes recorded, tested, assessed and approved in a controlled way.", controls: ["PC-04", "PC-03", "PC-21"], status: "evidence-in-ledger", gap: "for the CFO policy; software changes are documented only (see SOC 2 CC8.1)" },
  { framework: "dora", clause: "Art. 10(1)", requirement: "Promptly detect anomalous activities.", controls: ["PC-13", "PC-15", "PC-11"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 11(2)(c)", requirement: "Activate, without delay, plans that contain an ICT-related incident and prevent further damage.", controls: ["PC-06", "PC-20"], status: "evidence-in-ledger" },
  { framework: "dora", clause: "Art. 17(1)", requirement: "An ICT-related incident management process to detect, manage and notify incidents.", controls: ["PC-20", "PC-11"], status: "documented", gap: "no named people for the procedure" },
  { framework: "dora", clause: "Art. 17(2)", requirement: "Record ICT-related incidents and significant cyber threats.", controls: ["PC-11", "PC-10", "PC-15"], status: "evidence-in-ledger", gap: "the events are recorded; which of them are incidents is not decided (Art. 18(1))" },
  { framework: "dora", clause: "Art. 18(1)", requirement: "Classify ICT-related incidents by the criteria the regulation sets.", controls: ["PC-11"], status: "gap", gap: "no incident classification scheme" },
  { framework: "dora", clause: "Art. 19(1)", requirement: "Report major ICT-related incidents to the competent authority.", controls: ["PC-20"], status: "gap", gap: "no reporting to an authority (Purser is not a financial entity)" },
  { framework: "dora", clause: "Art. 24(1)", requirement: "A sound and comprehensive digital operational resilience testing programme.", controls: ["PC-19"], status: "documented", gap: "no threat-led penetration test by an independent tester (Arts. 26, 27)" },
  { framework: "dora", clause: "Art. 28(1)", requirement: "Manage ICT third-party risk as part of the ICT risk management framework.", controls: ["PC-15", "PC-14"], status: "evidence-in-ledger", gap: "monitors the providers' records only (reconciliation, webhooks checked against the ledger)" },
  { framework: "dora", clause: "Art. 28(3)", requirement: "A register of information on all contractual arrangements with ICT third-party service providers.", controls: ["PC-24"], status: "gap", gap: "no register of information" },
  { framework: "dora", clause: "Art. 28(8)", requirement: "Exit strategies for ICT services supporting critical or important functions.", controls: ["PC-20"], status: "gap", gap: "no exit plan per provider" },
  { framework: "dora", clause: "Art. 30(1)", requirement: "The rights and obligations with each ICT third-party service provider set out in writing.", controls: ["PC-24"], status: "gap", gap: "sandbox terms only; no contracts with providers" },
];

export const controlById = (id: string): Control | undefined => CONTROLS.find((c) => c.id === id);

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
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
