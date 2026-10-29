// The phone's own checks and words: it canonicalises and hashes the terms itself, refuses anything that does not
// hash to the hash it will sign, and builds every line of the confirm screen from those hashed terms.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { b64urlToBytes, buildPolicyTerms, bytesToB64url, canonicalize, checkOption, describeTerms, hexToBytes, money, notList, type PhoneProposal } from "../src/approve/client.js";
import { sha256Hex } from "../src/lib/terms.js";
import { challengeFor } from "../src/passkey/webauthn.js";

type Fixture = { proposal_id: string; kind: string; terms: Record<string, Json>; terms_sha256: string };
const F = JSON.parse(readFileSync(new URL("./fixtures/proposals.json", import.meta.url), "utf8")) as { names: Record<string, string>; proposals: Fixture[] };
const byId = (id: string) => F.proposals.find((p) => p.proposal_id === id)!;
const phone = (f: Fixture, group = f.proposal_id): PhoneProposal => ({
  proposal_id: f.proposal_id, kind: f.kind, group, canonical: jcs(f.terms), terms_sha256: f.terms_sha256,
  expires_at: String(f.terms.expires_at), created_by: "treasury", created_at: "2026-10-29T06:28:03Z", review: null,
});

describe("canonical JSON in the browser", () => {
  it("is byte for byte what the runner hashed, for every real proposal kind", () => {
    for (const f of F.proposals) {
      expect(canonicalize(f.terms)).toBe(jcs(f.terms));
      expect(sha256Hex(canonicalize(f.terms))).toBe(f.terms_sha256);
    }
  });

  it("sorts keys by UTF-16 code units and escapes strings as JSON does", () => {
    const tricky = { z: "Müller & Söhne \"quoted\"   \u0007 😀 \\", a: [null, true, false, "é"], B: { y: "", x: "\t" } };
    expect(canonicalize(tricky)).toBe(jcs(tricky));
    expect(canonicalize(tricky).startsWith('{"B":')).toBe(true);
  });
});

describe("the hash check before anything is shown or signed", () => {
  it("accepts the real proposals", async () => {
    for (const f of F.proposals) expect(await checkOption(phone(f))).toMatchObject({ ok: true, problem: null });
  });

  it("refuses terms that do not hash to the hash, terms not in canonical form, and terms of another proposal", async () => {
    const b = phone(byId("P-0002"));
    expect(await checkOption({ ...b, terms_sha256: byId("P-0001").terms_sha256 })).toMatchObject({ ok: false, problem: expect.stringMatching(/hash/) });
    const spaced = JSON.stringify(byId("P-0002").terms, null, 1);
    expect(await checkOption({ ...b, canonical: spaced, terms_sha256: sha256Hex(spaced) })).toMatchObject({ ok: false, problem: expect.stringMatching(/canonical/) });
    expect(await checkOption({ ...b, proposal_id: "P-0001" })).toMatchObject({ ok: false, problem: expect.stringMatching(/P-0001/) });
    expect(await checkOption({ ...b, canonical: "{oops" })).toMatchObject({ ok: false });
  });
});

describe("the words on the confirm screen", () => {
  it("states a price option's effect, margin and the mandates it changes, with names beside addresses", () => {
    const d = describeTerms(byId("P-0002").terms, F.names);
    expect(d).toMatchObject({ approvable: true, title: "Option B: sell at 0.07", amount: "0.07 *USDZ per query", margin: "0.03 per sale", label: "Option B", big: "0.07", unit: "*USDZ per query" });
    expect(d.sentence).toBe("Sell each query at 0.07 *USDZ. The supplier now charges 0.04, so each sale earns 0.03.");
    expect(d.recipient).toBe("Tidemark sweep wallet 0xce06…a6ed (treasury); Feedstock Labs 0x3295…713b (sourcing)");
    expect(d.rows).toContainEqual(["Step 2: sourcing mandate", "up to 0.04 per payment, 12.00 in total (0.80 already spent)"]);
    expect(d.short).toBe("option B: sell at 0.07 per query (margin 0.03)");
  });

  it("lists every payee a mandate may pay, and warns about a second payee or one the ledger does not know", () => {
    const t = structuredClone(byId("P-0002").terms) as Record<string, unknown>;
    const stranger = "0x000000000000000000000000000000000000dead";
    const steps = t.steps as Record<string, unknown>[];
    steps[1]!.payees = [...(steps[1]!.payees as string[]), stranger];
    const d = describeTerms(t, F.names);
    expect(d.recipient).toBe("Tidemark sweep wallet 0xce06…a6ed (treasury); Feedstock Labs 0x3295…713b, 0x0000…dead (sourcing)");
    expect(d.warnings).toEqual([
      "The sourcing mandate may pay 2 addresses",
      `The sourcing mandate may pay an address the ledger has no name for: ${stranger}`,
    ]);
  });

  it("states an invoice payment's amount, fee ceiling, conversion and bank details", () => {
    const d = describeTerms(byId("P-0004").terms, F.names);
    expect(d).toMatchObject({ approvable: true, title: "Pay invoice LIC-2026-11", amount: "EUR 1,850.00", margin: null, label: "Invoice LIC-2026-11", big: "1,850.00", unit: "EUR" });
    expect(d.sentence).toBe("Pay Lizenzhaus Beispiel GmbH EUR 1,850.00 for invoice LIC-2026-11 by SWIFT, after converting USD 416.59 into EUR 370.00.");
    expect(d.recipient).toBe("Lizenzhaus Beispiel GmbH, IBAN …3000, BIC COBADEFFXXX");
    expect(d.rows).toContainEqual(["Bank fee", "at most EUR 20.00 (the real fee is recorded)"]);
    expect(d.rows).toContainEqual(["Conversion", "USD 416.59 into EUR 370.00 at rate 1.125922, quote valid until 2026-10-29T06:49:53.000Z"]);
  });

  it("states a refund batch's count, total and the customer it pays", () => {
    const d = describeTerms(byId("P-0003").terms, F.names);
    expect(d).toMatchObject({ approvable: true, title: "Refund 9 sales", amount: "0.45 *USDZ", label: "Refund 9 sales", big: "0.45", unit: "*USDZ" });
    expect(d.sentence).toBe("Refund 9 sales to Kestrel Quant, 0.45 *USDZ in total.");
    expect(d.recipient).toBe("Kestrel Quant 0x5ab2…dbb7");
    expect(d.rows).toContainEqual(["Pays", "Kestrel Quant 0x5ab2a56a249ff9d0892846a8ac40aa65f1ccdbb7"]);
  });

  it("labels a dev test as one that moves no money", () => {
    const d = describeTerms({ kind: "dev_test", proposal_id: "P-0001", label: "DEV TEST: moves no money", purpose: "Max checks Face ID approval on his iPhone" }, {});
    expect(d).toMatchObject({ approvable: true, title: "DEV TEST: moves no money", label: "Dev test", big: "0.00", unit: "nothing moves", recipient: "nobody" });
    expect(d.sentence).toBe("Max checks Face ID approval on his iPhone. Approving it records the approval and moves no money.");
  });

  it("states a policy change and warns when it loosens a limit", () => {
    const tighter = describeTerms({ kind: "policy_change", changes: [{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" }], reason: "prices rising" }, {});
    expect(tighter).toMatchObject({ approvable: true, title: "Policy change", amountLabel: "New value", label: "Policy change", big: "0.03", unit: "Sourcing agent: most per payment", recipient: "nobody: no money moves", warnings: [] });
    expect(tighter.sentence).toBe("Change Sourcing agent: most per payment from no extra limit to 0.03. Reason: prices rising.");
    const looser = describeTerms({ kind: "policy_change", changes: [
      { key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "0.03", to: "" },
      { key: "eur_floor", label: "EUR reserve floor", from: "500.00", to: "100.00" },
      { key: "counterparty:X GmbH", label: "X GmbH (Airwallex payee)", from: "blocked", to: "allowed" },
    ], reason: "r" }, {});
    expect(looser.sentence).toBe("Change 3 policy settings. Reason: r.");
    expect(looser.warnings).toEqual([
      "This loosens Sourcing agent: most per payment", "This loosens EUR reserve floor", "This loosens X GmbH (Airwallex payee)",
    ]);
  });

  it("builds a policy change the runner can check: its own id, ten minutes, the exact changes", () => {
    const t = buildPolicyTerms([{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" }], "prices rising", new Date("2026-10-30T14:00:00.456Z"), "0a1b2c3d");
    expect(t).toEqual({
      schema: "kit11.approval-terms/v1", kind: "policy_change", proposal_id: "C-0a1b2c3d", expires_at: "2026-10-30T14:10:00Z",
      changes: [{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" }], reason: "prices rising",
    });
  });

  it("will not offer a kind it cannot describe", () => {
    expect(describeTerms({ kind: "wire_everything", proposal_id: "P-0009" }, {})).toMatchObject({ approvable: false });
  });

  it("names the options a tap did not choose", () => {
    const a = phone(byId("P-0001"), "g");
    const b = phone(byId("P-0002"), "g");
    const r = phone(byId("P-0003"));
    expect(notList(b, [a, b, r], F.names)).toEqual(["option A: sell at 0.05 per query (margin 0.01)"]);
    expect(notList(r, [a, b, r], F.names)).toEqual([]);
  });

  it("groups thousands without touching the decimals", () => {
    expect([money("1850.00"), money("9995512.44"), money("0.05"), money("-0.62")]).toEqual(["1,850.00", "9,995,512.44", "0.05", "−0.62"]);
  });
});

describe("the challenge", () => {
  it("is the hash's 32 raw bytes, exactly what the runner expects", () => {
    const h = byId("P-0004").terms_sha256;
    expect(hexToBytes(h)).toHaveLength(32);
    expect(bytesToB64url(hexToBytes(h))).toBe(challengeFor(h));
    expect(bytesToB64url(b64urlToBytes(challengeFor(h)))).toBe(challengeFor(h));
  });
});
