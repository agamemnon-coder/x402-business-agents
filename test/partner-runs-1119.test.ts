// The partner re-runs of 19 Nov: the Alta testnet series (docs/runs/2026-11-19-alta-series.md, its two records), the
// fresh anchor that pins them (docs/runs/2026-11-19-anchor.json and .md) and the Visa TAP interop re-run
// (docs/runs/2026-11-19-visa-tap-interop.md). They hold no secret, the series' figures are what its records say, and
// since the owner's call of 19 Nov (they go on the site) the /proof band counts the Alta files like any run's.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordSource } from "../src/anchor/head.js";
import { readRecord } from "../src/anchor/anchor.js";
import { NOT_IN_BAND, scaleFigures } from "../src/redesign/scale.js";

const ROOT = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, ROOT), "utf8");
const SERIES = "docs/runs/2026-11-19-alta-series.json", FINISH = "docs/runs/2026-11-19-alta-series-finish.json";
const ALTA = [SERIES, FINISH, "docs/runs/2026-11-19-alta-series.md", "docs/runs/2026-11-19-anchor.json", "docs/runs/2026-11-19-anchor.md"];
const TX = /testnet\.metalntwx\.com\/tx\/(0x[0-9a-f]{64})/g;

interface Step { kind: string; outcome: string; amount?: string; event?: string; reason?: string; tx: string | null; payee_delta?: string; account_delta?: string }
const steps = (f: string) => (JSON.parse(read(f)) as { steps: Step[] }).steps;

/** Every file under docs/runs and docs/demo the band reads, but those it skips. */
function counted(dir: string, re: RegExp): string[] {
  if (NOT_IN_BAND.includes(dir)) return [];
  return readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    return NOT_IN_BAND.includes(p) ? [] : d.isDirectory() ? counted(p, re) : re.test(d.name) ? [p] : [];
  });
}

describe("the partner re-runs of 19 Nov", () => {
  it("keep no key, token, secret or RPC address", () => {
    for (const f of [...ALTA, "docs/runs/2026-11-19-visa-tap-interop.md"]) {
      expect(read(f), f).not.toMatch(/bearer|secret|token|cookie|privateKey|privateJwk|"d":|rpc[^ ]*\.(com|io|xyz)/i);
    }
  });

  it("paid 21 payments, 1.00 in all, and had three over-mandate attempts refused on chain", () => {
    const all = [...steps(SERIES), ...steps(FINISH)];
    const paid = all.filter((s) => s.event === "MandatePayment");
    expect(paid).toHaveLength(21);
    expect(paid.reduce((n, s) => n + Math.round(Number(s.amount) * 100), 0)).toBe(100);
    for (const s of paid) expect(s.payee_delta).toBe(s.amount);
    const refused = all.filter((s) => s.outcome === "refused on chain");
    expect(refused.map((s) => s.reason)).toEqual(["OverPerPaymentCap", "PayeeNotAllowed", "OverBudget"]);
    for (const s of refused) expect([s.event, s.payee_delta, s.account_delta, typeof s.tx]).toEqual(["MandateRefused", "0.00", "0.00", "string"]);
    // The first pass's plan was a cent over the budget: said in the record, not hidden.
    expect(all.filter((s) => s.outcome === "UNEXPECTED")).toHaveLength(2);
  });

  it("is pinned by the fresh anchor, which names both series records as parts", () => {
    const r = readRecord("docs/runs/2026-11-19-anchor.json");
    expect(r.parts.filter((p) => p.kind === "record-digest").map((p) => p.file)).toEqual([SERIES, FINISH]);
    expect(recordSource(SERIES).kind).toBe("record-digest");
  });

  it("is counted in the /proof band: its Alta transactions are among the band's", () => {
    for (const f of ALTA) expect(NOT_IN_BAND).not.toContain(f);
    const own = new Set(ALTA.flatMap((f) => [...read(f).matchAll(TX)].map((m) => m[1]!)));
    expect(own.size).toBe(30);
    const seen = new Set([...counted("docs/runs", /\.(json|md)$/), ...counted("docs/demo", /\.json$/)].flatMap((f) => [...read(f).matchAll(TX)].map((m) => m[1]!)));
    expect(scaleFigures().metalTx).toBe(seen.size);
    for (const tx of own) expect(seen.has(tx), tx).toBe(true);
  });

});
