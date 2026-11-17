// The Airwallex API trail (src/airwallex/apiTrail.ts, /airwallex/calls, npm run airwallex-trail): every figure computed
// from the committed run records, every hash check holding, and no secret-looking string anywhere in its output.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiTrail, familyOf, redact, trailRuns } from "../src/airwallex/apiTrail.js";
import { awxCallsPage, batchLine, familyLine, transferLine } from "../src/redesign/awxTrailPage.js";
import { termsHash, type Terms } from "../src/lib/terms.js";

const json = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")) as Record<string, unknown>;

/** Strings that must never reach the trail: tokens, keys, client ids, full account or card numbers. */
const SECRET_SHAPES: [string, RegExp][] = [
  ["JWT", /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/],
  ["bearer token", /\bBearer\s+[\w.-]{16,}/i],
  ["API key field", /"(api_key|x-api-key|client_secret|access_token|token|client_id)"\s*:/i],
  ["client id/key word", /\b(client[_-]?id|api[_-]?key|client[_-]?secret)\b\s*[:=]/i],
  ["key prefix", /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/],
  ["IBAN", /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/],
  ["card number", /\b(?:\d[ -]?){13,19}\b/],
  ["CVV", /\bcvv\b/i],
];

describe("the Airwallex API trail", () => {
  const t = apiTrail();

  it("reads every Airwallex record in docs/runs, newest first", () => {
    const records = t.runs.map((r) => r.record);
    for (const f of ["docs/runs/2026-11-12-airwallex-batch-transfer.json", "docs/runs/2026-11-12-airwallex-batch-transfer-2.json", "docs/runs/2026-11-12-airwallex-payee-check.json",
      "docs/runs/2026-11-12-airwallex-financial-transactions.json", "docs/runs/2026-11-13-airwallex-deposits.json", "docs/runs/2026-11-13-airwallex-switch-on.json",
      "docs/runs/airwallex-cards-2026-11-06.json", "docs/runs/airwallex-transfer-approval-2026-11-06.json", "docs/runs/airwallex-vic-payment-intents-2026-11-12.json",
      "docs/runs/airwallex-readback.json", "docs/demo/airwallex-run.json", "docs/runs/2026-11-17-airwallex-late-failure.json"]) expect(records).toContain(f);
    const isos = t.runs.map((r) => r.iso);
    expect([...isos].sort().reverse()).toEqual(isos);
  });

  it("counts each record's calls as the record does", () => {
    const by = new Map(t.runs.map((r) => [r.record, r.calls.reduce((n, c) => n + c.count, 0)]));
    for (const f of ["2026-11-12-airwallex-batch-transfer.json", "2026-11-12-airwallex-batch-transfer-2.json", "2026-11-12-airwallex-payee-check.json", "2026-11-12-airwallex-financial-transactions.json", "2026-11-13-airwallex-deposits.json", "2026-11-13-airwallex-switch-on.json", "2026-11-17-airwallex-late-failure.json"]) {
      expect(by.get(`docs/runs/${f}`)).toBe((json(`docs/runs/${f}`).calls as { total: number }).total);
    }
    expect(by.get("docs/demo/airwallex-run.json")).toBe((json("docs/demo/airwallex-run.json").calls as { airwallex_total: number }).airwallex_total);
    expect(by.get("docs/runs/airwallex-vic-payment-intents-2026-11-12.json")).toBe((json("docs/runs/airwallex-vic-payment-intents-2026-11-12.json").calls as unknown[]).length);
    const sum = Object.values(t.byFamily).reduce((a, b) => a + b, 0);
    expect(sum).toBe(t.calls);
    expect(t.calls).toBe([...by.values()].reduce((a, b) => a + b, 0));
  });

  it("keeps itemised calls' times and never invents one", () => {
    const lines = (json("docs/runs/2026-11-12-airwallex-payee-check.json").calls as { lines: { at: string }[] }).lines.map((l) => l.at).sort();
    const run = t.runs.find((r) => r.key === "payee-1112")!;
    expect(run.calls.map((c) => c.at).sort()).toEqual(lines);
    for (const key of ["awx-1", "switch-on-1113", "cards-1106", "readback-1101", "transfer-1106"]) expect(t.runs.find((r) => r.key === key)!.calls.every((c) => c.at === null)).toBe(true);
  });

  it("finds every transfer's approval hash equal to the hash the passkey signed", () => {
    expect(t.checks.transfers.total).toBeGreaterThan(0);
    expect(t.checks.transfers.match).toBe(t.checks.transfers.total);
    expect(t.checks.batches.match).toBe(t.checks.batches.total);
    // The owner's approval of 7 November: SHA-256 of the receipt's terms, recomputed here, is what the transfer carries.
    const receipt = json("docs/runs/2026-11-07-awx-1/receipt-P-0002.json");
    const awx1 = t.runs.find((r) => r.key === "awx-1")!.checks.find((c) => c.recomputed)!;
    expect(awx1.recomputed).toBe(termsHash(receipt.terms as Terms));
    expect(awx1.carried).toBe(awx1.recomputed);
  });

  it("lists the late-failure run of 17 Nov as its record holds it: the simulated moves, the stand-in reads, the signed hashes", () => {
    const rec = json("docs/runs/2026-11-17-airwallex-late-failure.json") as { calls: { lines: { at: string }[] }; transfers: { transfer_id: string }[] };
    const run = t.runs.find((r) => r.key === "late-failure-1117")!;
    expect(run.calls.map((c) => c.at).sort()).toEqual(rec.calls.lines.map((l) => l.at).sort());
    const moves = run.calls.filter((c) => c.path.endsWith("/simulation/transfers/{id}/transition")).reverse().map((c) => c.outcome);
    expect(moves).toEqual(["SENT", "PAID", "SENT", "PAID", "FAILED", "FAILED"].map((s) => `${s} (simulated)`));
    expect(run.calls.filter((c) => /in place of the webhook/.test(c.outcome ?? "")).map((c) => c.objectId).sort()).toEqual(rec.transfers.map((x) => x.transfer_id).sort());
    expect(run.calls.filter((c) => c.path.endsWith("/transfers/create"))).toHaveLength(2);
    expect(run.checks.map((c) => c.match)).toEqual([true, true]);
  });

  it("says match only where the carried hash is the signed one (and the recomputed one, where there is one)", () => {
    for (const c of trailRuns().flatMap((r) => r.checks)) expect(c.match).toBe(c.signed === c.carried && (c.recomputed === null || c.recomputed === c.carried));
  });

  it("sorts paths into families", () => {
    expect(familyOf("/api/v1/batch_transfers/{id}/submit")).toBe("transfers");
    expect(familyOf("/api/v1/fx/quotes/create")).toBe("fx");
    expect(familyOf("/api/v1/pa/payment_intents/{id}")).toBe("payment-intents");
    expect(familyOf("/api/v1/issuing/cards/{id}")).toBe("cards");
    expect(familyOf("/api/v1/financial_transactions")).toBe("balances");
    expect(familyOf("/api/v1/beneficiaries/verify_account")).toBe("beneficiaries");
  });

  it("puts no secret-looking string in the list, the page or the CLI's words", () => {
    const out = [JSON.stringify(apiTrail()), awxCallsPage().replace(/<svg[\s\S]*?<\/svg>/g, "")];
    for (const s of out) for (const [name, re] of SECRET_SHAPES) expect(re.test(s), `${name}: ${re.exec(s)?.[0] ?? ""}`).toBe(false);
  });

  it("masks a secret-looking string that would reach it", () => {
    // A token-shaped string built here, so no token-shaped literal sits in the source (the secrets scan reads it).
    const seg = (n: number) => "a".repeat(n);
    expect(redact(["ey" + "J" + seg(12), seg(14), seg(16)].join("."))).toBe("[token removed]");
    expect(redact("DE02120300000000202051")).toBe("[account removed]");
    expect(redact("4111 1111 1111 1111")).toBe("[number removed]");
  });

  it("shows the summary, the hash lines in words and every run on the page", () => {
    const html = awxCallsPage();
    expect(html).toContain(`${t.calls} calls to the Airwallex sandbox`);
    expect(html).toContain(transferLine(t));
    expect(html).toContain(batchLine(t));
    expect(transferLine(t)).toMatch(/^\d+ of \d+ transfers carry the signed hash$/);
    expect(html).not.toMatch(/\d+\/\d+ transfers/);
    for (const part of familyLine(t).split(" · ")) expect(html).toContain(part.replace(/ (\d+)$/, " <b>$1</b>"));
    for (const r of t.runs) expect(html).toContain(r.record.replace(/^docs\/(runs|demo)\//, ""));
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
});
