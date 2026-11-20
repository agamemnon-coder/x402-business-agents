// The checkpoint drill (src/e2e/checkpointDrill.ts, npm run audit:checkpoint-drill): checkpoints switched on for a
// runner's ledger file and run through the runner's code, then each attack on copies of it. Run here whole (no network:
// a dev key in a temporary directory, the in-memory Issuing double), and its committed record checked against itself.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkpointDrillRecord, renderCheckpointDrill, runCheckpointDrill, timing, type CheckpointDrillRecord } from "../src/e2e/checkpointDrill.js";

describe("the drill's timings", () => {
  it("are a median and a maximum over the samples, to a hundredth of a millisecond", () => {
    expect(timing([3, 1, 2])).toEqual({ n: 3, median_ms: 2, max_ms: 3 });
    expect(timing([4, 1, 2, 3.333])).toEqual({ n: 4, median_ms: 2.67, max_ms: 4 });
  });
});

describe("the drill, run whole", () => {
  it("passes every step: the flows run with the gate on, and each attack is refused at every gate and found by verify-audit", async () => {
    const env = { ...process.env };
    const res = await runCheckpointDrill();
    expect(res.steps.filter((s) => !s.pass)).toEqual([]);
    const attacks = new Set(res.steps.filter((s) => s.id.startsWith("attack.")).map((s) => s.id.split(".")[1]));
    expect([...attacks]).toEqual(["truncate", "rewrite", "forged_money_row", "checkpoint_file_cut", "checkpoint_replayed", "wrong_key"]);
    expect(res.ledger.money_rows).toBeGreaterThan(0);
    expect(res.ledger.intents).toBe(res.ledger.money_rows);
    // The environment is put back, and nothing of the key is in the result but its public half and id.
    expect(process.env).toEqual(env);
    expect(JSON.stringify(res)).not.toMatch(/PRIVATE KEY/);
    const md = renderCheckpointDrill(checkpointDrillRecord(res, { date: "2026-11-20", commit: "0123456789ab", node: "v22", platform: "linux x64" }));
    expect(md).toContain(`**${res.steps.length} of ${res.steps.length} steps passed, 0 failed.** 6 of 6 attacks refused at every gate`);
  }, 180_000);
});

describe("the committed record (docs/runs/2026-11-20-checkpoint-drill)", () => {
  const base = new URL("../docs/runs/2026-11-20-checkpoint-drill", import.meta.url).pathname;
  it("exists, its counts are its own steps', and its page is rendered from it", () => {
    expect(existsSync(`${base}.json`)).toBe(true);
    const rec = JSON.parse(readFileSync(`${base}.json`, "utf8")) as CheckpointDrillRecord;
    expect(rec.summary).toEqual({ steps: rec.steps.length, passed: rec.steps.filter((s) => s.pass).length, failed: rec.steps.filter((s) => !s.pass).length });
    expect(rec.summary.failed).toBe(0);
    expect(rec.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(`${base}.md`, "utf8")).toBe(renderCheckpointDrill(rec));
  });
});
