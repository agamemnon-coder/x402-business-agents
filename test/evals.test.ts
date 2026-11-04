// The eval set in CI: the deterministic parsers read (no key, no network), and the code decides as it would live.
import { describe, expect, it } from "vitest";
import { CASES, runEvals } from "../src/evals/cases.js";

describe("evals (agent quality): normal, too expensive, fraud, injection, double payment, price notice", () => {
  it("every case passes on the deterministic path, with no approval and no payout", async () => {
    const results = await runEvals(null);
    expect(results.map((r) => r.id)).toEqual(CASES.map((c) => c.id));
    for (const r of results) expect({ id: r.id, problems: r.problems }).toEqual({ id: r.id, problems: [] });
    expect(results.every((r) => r.models.length === 0)).toBe(true);
    // Every escalation says why, in words a CFO can act on.
    for (const id of ["too-expensive", "fraud", "double-payment"]) expect(results.find((r) => r.id === id)!.why).not.toBe("");
  });
});
