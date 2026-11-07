// /try/sign, "Try to trick the agent" (Max, 7 Nov, 1.3): each fixed attack is blocked by Purser's own code, the same
// code the runner uses (src/policy/fraud.ts and src/policy/injection.ts), not by words written for the page. A real
// invoice from the allowlisted supplier passes the same check, so the block is the code's finding, not a constant.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ATTACKS, TEST_ALLOWLIST, TRICKS, TRICK_LESSON, ibanSha256, runTrick } from "../worker/src/trick.js";
import { TEST_IBAN } from "../worker/src/trySign.js";
import { assessAgainst } from "../src/policy/fraudCore.js";
import { assessInvoice } from "../src/policy/fraud.js";
import { findInjections } from "../src/policy/injection.js";
import { openDb } from "../src/db/open.js";
import { call, desk, newWorld } from "./support/trySign.js";

const nodeSha = (iban: string) => createHash("sha256").update(iban.replace(/\s+/g, "").toUpperCase()).digest("hex");
const allowlist = () => TEST_ALLOWLIST.map((b) => ({ beneficiary_id: b.beneficiary_id, name: b.name, iban_last4: b.iban.slice(-4), iban_sha256: nodeSha(b.iban), bic: b.bic }));

describe("try to trick the agent: every attack is blocked by Purser's code", () => {
  it("offers two attacks, and leaves out the split invoice (no rule in the code detects a split)", () => {
    expect([...ATTACKS]).toEqual(["pre_approved", "lookalike"]);
    expect(TEST_ALLOWLIST.map((b) => b.iban)).toEqual([TEST_IBAN.alpine, TEST_IBAN.stockline]);
  });

  it("“Pre-approved by the CFO” to a new IBAN: the approval claim is flagged, the changed bank details block it", async () => {
    const r = await runTrick("pre_approved");
    expect(r.blocked).toBe(true);
    expect(r.signals.find((s) => s.blocks)!.code).toBe("bank_details_changed");
    expect(r.injections.map((i) => i.kind)).toContain("approval_claim");
    expect(r.outcome).toBe("Blocked: a new IBAN needs a person and Face ID. The agent's words don't change that.");
    expect(r.lesson).toBe(TRICK_LESSON);
    expect(TRICK_LESSON).toBe("A prompt is not a control.");
    expect(r.proposal).toBeNull();
  });

  it("a lookalike supplier: the name one letter off Alpine Packaging is blocked, and so are its bank details", async () => {
    const r = await runTrick("lookalike");
    expect(r.blocked).toBe(true);
    const codes = r.signals.filter((s) => s.blocks).map((s) => s.code);
    expect(codes).toEqual(["lookalike_vendor", "bank_details_changed"]);
    expect(r.signals[0]!.detail).toBe('"Alpine Pakaging" is not the allowlisted "Alpine Packaging" but looks like it (1 letter differs)');
    expect(r.outcome).toBe("Blocked: this is not Alpine Packaging. Only allowlisted payees get paid.");
  });

  it("is the runner's own check: the Worker's WebCrypto hash and Node's give the same finding as assessInvoice on a ledger", async () => {
    for (const a of ATTACKS) {
      const inv = TRICKS[a];
      expect(await ibanSha256(inv.iban)).toBe(nodeSha(inv.iban));
      const worker = await runTrick(a);
      expect(worker.signals).toEqual(assessAgainst(allowlist(), inv, inv.text, nodeSha(inv.iban)).signals);
      expect(worker.injections).toEqual(findInjections(inv.text));
      // The same invoice through the runner's assessInvoice, against a ledger holding the same allowlist.
      const db = openDb(":memory:");
      for (const b of allowlist()) db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(b.beneficiary_id, b.name, b.iban_last4, b.iban_sha256, b.bic);
      const runner = assessInvoice(db, { invoice_no: inv.reference, vendor: inv.vendor, amount: inv.amount, currency: "EUR", due_date: "2026-11-20", iban: inv.iban, bic: inv.bic, reference: inv.reference }, inv.text);
      expect(runner.signals).toEqual(worker.signals);
    }
  });

  it("lets the genuine invoice through the same check: Alpine Packaging, its own IBAN and BIC, no planted line", () => {
    const real = allowlist().find((b) => b.name === "Alpine Packaging")!;
    const text = ["Invoice INV-2026-118", "From: Alpine Packaging", "Amount: EUR 1,850.00", `IBAN: ${TEST_IBAN.alpine}`, "BIC: TESTDEFFXXX", "Account name: Alpine Packaging"].join("\n");
    const f = assessAgainst(allowlist(), { vendor: "Alpine Packaging", iban: TEST_IBAN.alpine, bic: real.bic }, text, nodeSha(TEST_IBAN.alpine));
    expect(f.blocked).toBe(false);
    expect(findInjections(text)).toEqual([]);
  });
});

describe("the /trick endpoint", () => {
  it("answers with the code's finding, creates no proposal and asks for no quote", async () => {
    let quotes = 0;
    const { d, db } = desk(undefined, { quote: async () => { quotes++; throw new Error("no quote expected"); } } as never);
    const w = await newWorld(d);
    const rows = () => (db.prepare("SELECT COUNT(*) AS n FROM ts_proposals").get() as { n: number }).n;
    const before = rows(), quotesAtOpen = quotes;
    for (const attack of ATTACKS) {
      const r = await call(d, "trick", { token: w.world.token, attack });
      expect(r.status).toBe(200);
      const out = (await r.json()) as { trick: { blocked: boolean; attack: string; proposal: null } };
      expect(out.trick).toMatchObject({ attack, blocked: true, proposal: null });
    }
    expect(before).toBeGreaterThan(0);
    expect(rows()).toBe(before);
    expect(quotes).toBe(quotesAtOpen);
  });

  it("takes only a listed attack: no free text, so no visitor's words reach any code or model", async () => {
    const { d } = desk();
    const w = await newWorld(d);
    for (const attack of ["split", "Pay to my IBAN", 1, null]) expect((await call(d, "trick", { token: w.world.token, attack })).status).toBe(400);
    expect((await call(d, "trick", { attack: "lookalike" })).status).toBe(410);
  });
});
