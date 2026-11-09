// npm run test:d1 runs the cloud's tests on local D1: this file fails that run if the harness quietly fell back to
// better-sqlite3 (and is a no-op in the normal run).
import { describe, expect, it } from "vitest";
import { testCloud } from "./support/cloud.js";

describe("the cloud test harness", () => {
  it.runIf(process.env.CLOUD_DB === "d1")("runs on D1 when CLOUD_DB=d1", async () => {
    expect(globalThis.__cloudD1).toBeDefined();
    const c = testCloud();
    expect((c.env.sql as { close?: unknown }).close).toBeTypeOf("function");
    // D1 refuses PRAGMA journal_mode changes that better-sqlite3 allows; the cheap tell is the batch result shape.
    await c.tenant("d1check");
    expect((await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM tenants"))!.n).toBe(1);
    c.close();
  });
  it("is a plain run otherwise", () => { expect(process.env.CLOUD_DB === "d1" || globalThis.__cloudD1 === undefined).toBe(true); });
});
