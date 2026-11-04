// The approval-page redesign (4 November) changed only how the page looks. These hashes were stored before it, from
// the page's own canonicalisation and SHA-256; the page and the runner must still hash every sample to exactly them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalize, checkOption, describeTerms, sha256Hex, type PhoneProposal } from "../src/approve/client.js";
import { termsHash, type Terms } from "../src/lib/terms.js";

type Sample = { name: string; terms: Terms; terms_sha256: string };
const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;
const S = read("approve-samples.json") as { samples: Sample[]; owners_execute_sha256: string };
const P = read("proposals.json") as { names: Record<string, string>; proposals: { proposal_id: string; terms: Terms; terms_sha256: string }[] };
const owners = read("owners-execute-terms.json") as Terms;

const all: Sample[] = [
  ...P.proposals.map((p) => ({ name: `${p.proposal_id} ${String(p.terms.kind)}`, terms: p.terms, terms_sha256: p.terms_sha256 })),
  { name: "owners_execute", terms: owners, terms_sha256: S.owners_execute_sha256 },
  ...S.samples,
];

describe("the terms hash, unchanged by the approval-page redesign", () => {
  it("covers every kind the page describes", () => {
    expect(new Set(all.map((s) => String(s.terms.kind)))).toEqual(new Set([
      "mandate_replace", "refund_batch", "invoice_payment", "owners_execute", "policy_change", "payee_change", "quarantine_release", "task_card", "agent_onboard", "dev_test",
    ]));
  });

  it.each(all)("$name: the page and the runner hash it to the stored hash", async (s) => {
    const canonical = canonicalize(s.terms);
    expect(await sha256Hex(canonical)).toBe(s.terms_sha256);
    expect(termsHash(s.terms)).toBe(s.terms_sha256);
    const p: PhoneProposal = {
      proposal_id: s.terms.proposal_id, kind: s.terms.kind, group: s.terms.proposal_id, canonical, terms_sha256: s.terms_sha256,
      expires_at: s.terms.expires_at, created_by: "treasury", created_at: "2026-11-04T10:00:00Z", review: null,
    };
    expect((await checkOption(p)).ok).toBe(true);
  });

  it.each(all)("$name: the summary card's words carry no snake_case", (s) => {
    const f = describeTerms(s.terms, P.names);
    for (const v of [f.title, f.big, f.unit, f.amountLabel ?? "", f.margin ?? "", f.recipient]) expect(v).not.toContain("_");
  });
});
