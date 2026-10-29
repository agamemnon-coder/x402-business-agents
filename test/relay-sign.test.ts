// Security review M3: the phone shows only what the runner signed. A relay (or Cloudflare account) that changes a
// proposal's terms, the names beside addresses or the CFO policy is caught on the phone before anything is signed.
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyRunnerSignature } from "../src/approve/client.js";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { createProposal } from "../src/policy/approvals.js";
import { displayKey, signApprovals } from "../src/relay/sign.js";
import { buildRelayState } from "../src/relay/state.js";

const t0 = new Date("2026-10-30T14:00:00Z");

function signed() {
  const db = openDb(":memory:");
  createProposal(db, { terms: { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T15:00:00Z", total: "0.15" } as Terms, createdBy: "support" }, t0);
  const key = displayKey(join(mkdtempSync(join(tmpdir(), "kit11-sign-")), "relay-display-key.pem"));
  const state = buildRelayState(db, { rpId: "r.example", relayToken: "t" }, t0);
  return { key, approvals: { ...signApprovals(state.approvals, key), generated_at: "x", relay: { age_ms: 1 }, enrolment_open: false } };
}

describe("runner-signed approvals (M3)", () => {
  it("verifies on the phone with the runner's pinned key, whatever the relay adds around it", async () => {
    const { key, approvals } = signed();
    expect(await verifyRunnerSignature(approvals, key.publicSpki)).toBe(true);
  });

  it("fails when the relay changes the terms, a name, the policy or the passkey list, or drops the signature", async () => {
    const { key, approvals } = signed();
    const p0 = approvals.proposals[0]!;
    const changed = [
      { ...approvals, proposals: [{ ...p0, canonical: p0.canonical.replace("0.15", "9.15") }] },
      { ...approvals, names: { "0x0000000000000000000000000000000000000001": "Bergtex Textil GmbH" } },
      { ...approvals, policy: approvals.policy.map((e) => ({ ...e, value: "20.00" })) },
      { ...approvals, passkey: { ...approvals.passkey, credentials: [{ id: "relay-key", label: "max", enrolled_at: "x" }] } },
      { ...approvals, signature: undefined },
      { ...approvals, ledger_seq: approvals.ledger_seq - 1 },
    ];
    for (const a of changed) expect(await verifyRunnerSignature(a, key.publicSpki)).toBe(false);
  });

  it("fails against another runner's key", async () => {
    const { approvals } = signed();
    const other = displayKey(join(mkdtempSync(join(tmpdir(), "kit11-sign-")), "k.pem"));
    expect(await verifyRunnerSignature(approvals, other.publicSpki)).toBe(false);
  });

  it("keeps the runner's key in one private file and reuses it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kit11-sign-")), "relay-display-key.pem");
    const a = displayKey(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(displayKey(path).publicSpki).toBe(a.publicSpki);
  });
});
