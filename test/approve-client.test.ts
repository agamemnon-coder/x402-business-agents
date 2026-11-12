// The phone's own checks and words: it canonicalises and hashes the terms itself, refuses anything that does not
// hash to the hash it will sign, and builds every line of the confirm screen from those hashed terms.
import { loosens } from "../src/policy/rules.js";
import { generateKeyPairSync } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { fingerprintOf, spkiSha256OfCose } from "../src/passkey/ledger.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { agentOf, whyYou, amountProblem, b64urlToBytes, buildPolicyTerms, normalizeAmount, bytesToB64url, canonicalize, checkOption, describeTerms, hexToBytes, money, notList, freshEnough, passkeyFingerprint, policyLoosens, rejectionHash, takeRunnerKey, takeViewKey, type PhoneProposal } from "../src/approve/client.js";
import { rejectionSha256, sha256Hex } from "../src/lib/terms.js";
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
    expect(d).toMatchObject({ approvable: true, title: "Option B: sell at 0.07", amount: "0.07 USDZ per query", margin: "0.03 per sale", label: "Option B", big: "0.07", unit: "USDZ per query" });
    expect(d.sentence).toBe("Sell each query at 0.07 USDZ. The supplier now charges 0.04, so each sale earns 0.03.");
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
    expect(d).toMatchObject({ approvable: true, title: "Refund 9 sales", amount: "0.45 USDZ", label: "Refund 9 sales", big: "0.45", unit: "USDZ" });
    expect(d.sentence).toBe("Refund 9 sales to Kestrel Quant, 0.45 USDZ in total.");
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

  it("reads an amount typed with a decimal comma, and says what is wrong before anything is signed", () => {
    expect(["0,03", " 0.03 ", "12,50", "none", ""].map((v) => normalizeAmount(v))).toEqual(["0.03", "0.03", "12.50", "none", ""]);
    expect(amountProblem("optional_money", "")).toBeNull();
    expect(amountProblem("money", "0.03")).toBeNull();
    expect(amountProblem("money", "0.3")).toMatch(/0\.03/);
    expect(amountProblem("money", "1.850,00")).toMatch(/0\.03/);
    expect(amountProblem("money", "")).toMatch(/amount/);
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

  it("to reject, is the rejection hash the runner derives, never the terms hash", async () => {
    const h = byId("P-0004").terms_sha256;
    expect(await rejectionHash(h)).toBe(rejectionSha256(h));
    expect(await rejectionHash(h)).not.toBe(h);
  });
});

describe("the viewer key (M2)", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it("takes the key from the link's fragment once and keeps it on the device", () => {
    const store = mem();
    const key = "ab".repeat(16);
    expect(takeViewKey(`#view=${key}`, store)).toBe(key);
    expect(takeViewKey("", store)).toBe(key);
  });

  it("ignores anything that is not a 32-hex key, and works without storage", () => {
    expect(takeViewKey("#view=<script>", mem())).toBe("");
    expect(takeViewKey(`#view=${"ab".repeat(16)}x`, mem())).toBe("");
    expect(takeViewKey(`#view=${"cd".repeat(16)}`, null)).toBe("cd".repeat(16));
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(takeViewKey("", broken)).toBe("");
  });
});

describe("the new passkey's fingerprint (M3)", () => {
  it("is the same on the phone (from SPKI) and on the runner (from the stored COSE key)", async () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
    const spki = publicKey.export({ type: "spki", format: "der" });
    const onPhone = await passkeyFingerprint(spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength) as ArrayBuffer);
    expect(onPhone).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(onPhone).toBe(fingerprintOf(spkiSha256OfCose(Buffer.from(cose).toString("base64url"))));
  });
});

describe("loosening the policy (N2)", () => {
  it("is judged the same on the phone and on the runner", () => {
    const cases = [
      ["cap.sourcing", "", "0.03"], ["cap.sourcing", "0.03", "0.05"], ["cap.sourcing", "0.03", ""], ["cap.sourcing", "0.05", "0.03"],
      ["approval.refund_each", "0.10", "0.20"], ["approval.refund_each", "0.10", "0.00"],
      ["eur_floor", "500.00", "0.00"], ["eur_floor", "500.00", "800.00"], ["eur_floor", "", "500.00"], ["eur_floor", "500.00", ""],
      ["counterparty:X GmbH", "blocked", "allowed"], ["counterparty:X GmbH", "allowed", "blocked"], ["unknown", "a", "b"],
      ["card.sourcing.per_tx", "30.00", "50.00"], ["card.sourcing.per_tx", "30.00", "20.00"], ["card.support.monthly", "150.00", "150.01"],
    ];
    const expected = [false, true, true, false, true, false, true, false, false, true, true, false, true, true, false, true];
    expect(cases.map(([key, from, to]) => loosens({ key: key!, from: from!, to: to! }))).toEqual(expected);
    expect(cases.map(([key, from, to]) => policyLoosens({ key: key!, from: from!, to: to! }))).toEqual(expected);
  });
});

describe("the runner's pinned key and its ledger counter (N3, N4)", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  const A = "A".repeat(122);
  const B = "B".repeat(122);

  it("keeps the first runner key; a later link with another key does not replace it, it only offers it", () => {
    const store = mem();
    expect(takeRunnerKey(`#runner=${A}`, store)).toEqual({ key: A, offered: null });
    expect(takeRunnerKey(`#runner=${B}`, store)).toEqual({ key: A, offered: B });
    expect(takeRunnerKey("", store)).toEqual({ key: A, offered: B });
    expect(store.getItem("kit11.runner")).toBe(A);
    // The link with the pinned key again withdraws the offer.
    expect(takeRunnerKey(`#runner=${A}`, store)).toEqual({ key: A, offered: null });
    expect(takeRunnerKey("", store)).toEqual({ key: A, offered: null });
  });

  it("refuses signed approvals older than the newest this phone has seen", () => {
    const store = mem();
    expect(freshEnough(170, store)).toBe(true);
    expect(freshEnough(175, store)).toBe(true);
    expect(freshEnough(175, store)).toBe(true);
    expect(freshEnough(174, store)).toBe(false);
    expect(freshEnough(Number.NaN, store)).toBe(false);
  });
});

describe("approving against Opus's advice", () => {
  // Breaks if the approval sheet no longer warns when the CFO approves what Opus advises rejecting (Friday run 2).
  it("warns loudly on approve when Opus advises reject, and never on reject", async () => {
    const { againstAdvice } = await import("../src/approve/client.js");
    expect(againstAdvice("APPROVED", { recommendation: "reject" })[0]).toMatch(/about to APPROVE/);
    expect(againstAdvice("REJECTED", { recommendation: "reject" })).toEqual([]);
    expect(againstAdvice("APPROVED", { recommendation: "approve" })).toEqual([]);
    expect(againstAdvice("APPROVED", null)).toEqual([]);
  });
});

describe("a task card one of Northwind's own agents asked for (D22)", () => {
  it("says which agent asked, that it chose the purchase, and that the card pays once at a software or data seller", () => {
    const d = describeTerms({ schema: "x", kind: "task_card", proposal_id: "P-0009", expires_at: "2026-11-05T11:00:00Z", task: "data", label: "Data purchase", purpose: "Ridgeline Data, one-off regional demand report", merchant_categories: ["5734"], amount: "15.00", currency: "EUR", valid_until: "2026-11-12T10:00:00.000Z", single_use: true, message_sha256: "0".repeat(64), asked_by: "agent:sourcing" }, {});
    expect(d.rows).toContainEqual(["Asked by", "the Sourcing agent"]);
    expect(d.recipient).toBe("a software or data seller (merchant category 5734)");
    expect(d.warnings[0]).toMatch(/^The Sourcing agent chose this purchase and asked for the card; it cannot pay before you approve, and the card pays once\./);
  });
});

describe("the approval view's first screen: the agent, and why it needs the CFO", () => {
  it("names the agent from the hashed terms where they name one, else from who proposed it", () => {
    expect(agentOf("treasury", byId("P-0002").terms)).toBe("Treasury agent");
    expect(agentOf("support", byId("P-0003").terms)).toBe("Support agent");
    expect(agentOf("treasury", { kind: "task_card", asked_by: "agent:sourcing" })).toBe("Sourcing agent");
    expect(agentOf("treasury", { kind: "task_card", asked_by: "cfo-at-runner" })).toBe("None: you asked at the runner");
    expect(agentOf("ext:acme-buyer", { kind: "agent_onboard", display_name: "Acme Buyer", agent_id: "acme-buyer" })).toBe("Acme Buyer (outside agent acme-buyer)");
    expect(agentOf("sourcing", { kind: "airi_purchase", agent: "sourcing" })).toBe("Sourcing agent");
    expect(agentOf("human", { kind: "policy_change" })).toBe("None: a change made by a person");
    expect(agentOf("system", { kind: "dev_test" })).toBe("Purser");
  });

  it("says in one line which rule sends it to the CFO, with the policy's own numbers, and when two people must approve", () => {
    const policy = [{ key: "approval.refund_each", value: "0.10" }, { key: "approval.refund_per_dispute", value: "0.30" }, { key: "approval.task_card_eur", value: "50.00" }];
    expect(whyYou(byId("P-0003").terms, policy)).toBe("Your policy sends refunds above 0.10 USDZ each, or 0.30 per dispute, to you.");
    expect(whyYou({ kind: "task_card" }, policy)).toBe("Without your Face ID, a task card is issued only when you ask at the runner, up to 50.00 EUR.");
    expect(whyYou(byId("P-0004").terms, policy, { approved_by: ["controller"] })).toBe("A supplier is paid from the Airwallex account only with your Face ID. It needs two people (four eyes). Approved so far: controller.");
    for (const f of F.proposals) expect(whyYou(f.terms, policy)).not.toMatch(/\n|cannot be approved/);
    expect(whyYou({ kind: "wire_everything" })).toMatch(/cannot be approved on the phone/);
  });
});

// Block 1 on the phone: what the owner reads before Face ID signs an account call on chain. A bind, a revoke and a
// replace each say what they do in their own words; a change the page does not know is never shown as a bind.
describe("an owners_execute on the phone: bind, revoke and replace", () => {
  const B = JSON.parse(readFileSync(new URL("./fixtures/owners-execute-terms.json", import.meta.url), "utf8")) as Record<string, Json> & { action: Record<string, string>; calls: Record<string, string>[]; account: string; onchain_digest: string };
  const OLD = `0x${"5e".repeat(32)}`;
  const withCall = (selector: string, action: Record<string, string>) => ({ ...B, calls: [{ ...B.calls[0]!, call_data: `${selector}${B.calls[0]!.call_data!.slice(10)}` }], action }) as unknown as Record<string, Json>;
  const revoke = withCall("0xb75c7dc6", { ...B.action, what: "revoke" });
  const replace = withCall("0x2f2c2052", { ...B.action, what: "replace", cap: "0.10", mandate: `0x${"7a".repeat(32)}`, replaces: OLD, was_cap: "0.05", was_budget: "0.50" });
  const LEAD = "Your Face ID signs this on chain: the business account 0x1062…04ea is owned by two passkeys, the CFO's and the controller's, and runs this only with both.";
  const keys = (t: Record<string, Json>) => describeTerms(t, {}).rows.map((r) => r[0]);
  const row = (t: Record<string, Json>, k: string) => describeTerms(t, {}).rows.find((r) => r[0] === k)?.[1];

  it("the selectors are the account's own bind, replace and revoke", async () => {
    const { toFunctionSelector } = await import("viem");
    const { mandateBindingAbi } = await import("@metalntwx/metal-pay/mandates");
    const { OWNER_SELECTORS } = await import("../src/approve/client.js");
    const fn = (name: string) => toFunctionSelector(mandateBindingAbi.find((x) => x.type === "function" && x.name === name) as never);
    expect(OWNER_SELECTORS).toEqual({ bind: fn("bind"), replace: fn("replace"), revoke: fn("revoke") });
  });

  it("a bind: the account, the mandate, the cap, the budget, the payee, the digest and the deadline", () => {
    const f = describeTerms(B, {});
    expect(f).toMatchObject({ approvable: true, title: "Bind the sourcing mandate, signed on chain", amount: "0.50 USDZ in total", recipient: "Stockline 0x82e5…4b9A", warnings: [] });
    expect(f.sentence).toBe(`${LEAD} Up to 0.05 per payment, 0.50 in total, to Stockline only.`);
    expect(keys(B)).toEqual(["Account", "Mandate", "Per payment", "Budget", "May pay", "Signed on chain", "Digest", "Valid until"]);
    expect([row(B, "Account"), row(B, "Per payment"), row(B, "Budget"), row(B, "Digest")]).toEqual([B.account, "0.05 USDZ", "0.50 USDZ", B.onchain_digest]);
    expect(row(B, "Valid until")).toMatch(/^\d+ [A-Z][a-z]{2} \d{4}, \d\d:\d\d UTC$/);
  });

  it("a revoke says the mandate ends: its limits are what stops, not what is granted", () => {
    const f = describeTerms(revoke, {});
    expect(f).toMatchObject({ approvable: true, title: "Revoke the sourcing mandate, signed on chain", warnings: [] });
    expect(f.sentence).toBe(`${LEAD} It ends the mandate that allowed up to 0.05 per payment, 0.50 in total, to Stockline only.`);
    expect(keys(revoke)).toEqual(keys(B));
  });

  it("a replace shows each new limit with the earlier one beside it, and the mandate it replaces", () => {
    const f = describeTerms(replace, {});
    expect(f).toMatchObject({ approvable: true, title: "Replace the sourcing mandate, signed on chain", amountLabel: "Per payment", amount: "0.10 USDZ (0.05 before)", big: "0.10", unit: "USDZ per payment", recipient: "Stockline 0x82e5…4b9A", warnings: [] });
    expect(f.sentence).toBe(`${LEAD} It replaces the mandate in one step: up to 0.10 per payment (0.05 before), 0.50 in total (0.50 before), to Stockline only.`);
    expect(keys(replace)).toEqual(["Account", "Mandate", "Replaces", "Per payment", "Budget", "May pay", "Signed on chain", "Digest", "Valid until"]);
    expect([row(replace, "Mandate"), row(replace, "Replaces"), row(replace, "Per payment"), row(replace, "Budget")]).toEqual([`0x${"7a".repeat(32)}`, OLD, "0.10 USDZ (0.05 before)", "0.50 USDZ (0.50 before)"]);
    expect(agentOf("treasury", replace)).toBe("Sourcing agent");
  });

  it("a replace that does not name what it replaces, or whose words and call differ, cannot be signed", () => {
    const a = replace.action as Record<string, string>;
    for (const drop of ["replaces", "was_cap", "was_budget"]) {
      const f = describeTerms({ ...replace, action: { ...a, [drop]: undefined } as never }, {});
      expect(f.approvable).toBe(false);
      expect(f.warnings.join(" ")).toMatch(/does not name the mandate it replaces and its earlier limits; this cannot be signed/);
    }
    expect(describeTerms({ ...replace, action: { ...a, was_cap: "a lot" } }, {}).approvable).toBe(false);
    // A replace's words on a bind call, and a bind's or a revoke's words on a replace call.
    expect(describeTerms({ ...B, action: a }, {}).approvable).toBe(false);
    expect(describeTerms({ ...replace, action: { ...a, what: "bind" } }, {}).approvable).toBe(false);
    expect(describeTerms({ ...replace, action: { ...a, what: "revoke" } }, {}).approvable).toBe(false);
  });

  it("a change the page does not know is not approvable and is never shown as a bind", () => {
    for (const what of ["transfer", "addSigner", "", "constructor", "toString"]) {
      const f = describeTerms({ ...B, action: { ...B.action, what } }, {});
      expect(f.approvable).toBe(false);
      expect(f.title).not.toMatch(/Bind|Replace|Revoke/);
      expect(f.sentence).not.toMatch(/Up to|per payment/);
      expect(f.warnings.join(" ")).toMatch(/a change this page does not know; this cannot be signed/);
    }
  });
});
