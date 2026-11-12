// /proof.json and /receipt-sample.json (agent-surface, 12 Nov): the proof as data for a tool that fetches the site, and
// one real signed receipt it can check itself. Every value is read at build time from the functions the pages use
// (liveRuns, GUARANTEES, agentView) and from the receipt file; nothing is typed in but the field names and the four
// steps of the check, which follow src/try/receipt.ts. No card digits, no decisions, no payments.
// test/agent-data.test.ts holds every value to its source.

import { readFileSync } from "node:fs";
import { AGENT_IDS, agentView, type AgentView } from "./agents.js";
import { GUARANTEES } from "./guarantees.js";
import { EXPLORER, REPO_BLOB } from "./metalStory.js";
import { liveRuns } from "./runs.js";
import { RECEIPT_MEANS } from "../try/receipt.js";
import { SITE_URL } from "../ui/meta.js";

/** The one receipt /receipt-sample.json serves (the owner's decision, 12 Nov). A swap needs no other change. */
export const RECEIPT_SAMPLE_FILE = "docs/runs/2026-11-07-awx-1/receipt-P-0002.json";
export const PROOF_JSON_PATH = "/proof.json";
export const RECEIPT_SAMPLE_PATH = "/receipt-sample.json";
/** The repository, from the blob prefix every record link uses. */
export const REPOSITORY_URL = REPO_BLOB.replace(/\/blob\/main\/$/, "");

/** How to check a receipt by hand, step by step as src/try/receipt.ts (verifyReceipt) does it. */
export const RECEIPT_CHECK_STEPS = [
  "Write the terms as canonical JSON: keys sorted, no spaces, money as decimal strings (the terms hold no numbers).",
  "Its SHA-256, in hex, equals terms_sha256.",
  "That hash, as base64url, is the WebAuthn challenge in assertion.clientDataJSON (type webauthn.get, on the receipt's origin).",
  "The ES256 signature over authenticatorData followed by the SHA-256 of clientDataJSON verifies with public_key.",
];

/** A link made absolute: "http…" stays; "../../x" (from the repository's docs) is the repository's x; else a page of the site. */
export const absolute = (href: string) => href.startsWith("http") ? href : href.startsWith("../../") ? REPO_BLOB + href.slice("../../".length) : `${SITE_URL}/${href}`;

const agentEntry = (v: AgentView) => ({
  id: v.id, name: v.name, job: v.job, models: v.models,
  card: v.card ? { per_purchase: v.card.per_tx, monthly: v.card.monthly, only: v.card.only } : null,
  mandate: v.mandate ? { cap: v.mandate.cap, budget: v.mandate.budget, tx_url: v.mandate.tx ? `${EXPLORER}/tx/${v.mandate.tx}` : null } : null,
  page: `${SITE_URL}/agents/${v.id}`,
});

export function proofData() {
  const receipt = JSON.parse(readFileSync(new URL(`../../${RECEIPT_SAMPLE_FILE}`, import.meta.url), "utf8")) as { note: string; verify: string };
  return {
    schema: "purser.proof/v1",
    note: "Test money only: the customer, the supplier, the settlement and the second approver are simulated, and the runs and limits here are read from the repository's run records and code at build time.",
    site: SITE_URL,
    repository: REPOSITORY_URL,
    runs: liveRuns().map((r) => ({
      key: r.key, date_iso: r.iso, title: r.title, rails: r.rails, what: r.what, checks: r.checks, money: r.money,
      ids: r.ids.map((x) => ({ label: x.label, value: x.value, ...(x.href ? { url: absolute(x.href) } : {}) })),
      records: r.files.map((f) => ({ label: f.label, url: absolute(f.href) })),
      page: `${SITE_URL}/runs#${r.key}`,
    })),
    guarantees: GUARANTEES.map((g) => ({
      id: g.id, promise: g.promise, enforced_by: g.by, how: g.how, source: REPO_BLOB + g.source, test: REPO_BLOB + g.test,
      evidence: { label: g.evidence.label, url: absolute(g.evidence.href) },
    })),
    agents: AGENT_IDS.map((id) => agentEntry(agentView(id))),
    receipt_sample: {
      url: SITE_URL + RECEIPT_SAMPLE_PATH, what: receipt.note, proves: RECEIPT_MEANS[0]!, does_not_prove: RECEIPT_MEANS[1]!,
      verify_command: receipt.verify,
    },
    how_to_check_a_receipt: RECEIPT_CHECK_STEPS,
  };
}
