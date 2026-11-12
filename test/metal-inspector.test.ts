// The live, read-only Metal mandate inspector (worker/src/metalInspector.ts, GET /api/metal/mandates): its decoder
// against the real answers of the check of 12 November (docs/runs/2026-11-12-metal-inspector.json), and its limits with a
// stand-in RPC that records every call: one answer for everyone within the TTL, a hard ceiling of calls a UTC day checked
// before each call (concurrent visits included), the switch, a missing URL, every kind of RPC failure, and the URL never
// in an answer. No network: the stand-in answers in-process.
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sqlOver } from "../src/relay/local.js";
import {
  INSPECTOR_DAILY_CEILING, INSPECTOR_TTL_SECONDS, LOCAL_REASON, METAL_INSPECTOR_PATH, MANDATES_SELECTOR, MetalInspector, amountOf, decodeMandateState,
  MANDATE_REFUSED_TOPIC, decodeRefusal, inspectorOff, localInspector, mandatesCalldata, metalRecordedOf, type InspectorAnswer, type RefusalLog,
} from "../worker/src/metalInspector.js";

const RECORD = JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-metal-inspector.json", import.meta.url), "utf8")) as {
  account: { address: string };
  read: { block: number; block_hex: string; read_at: string; mandates: { agent: string; ref: string; spent: string; occurrences: number; bound_block: number; result_hex: string; call: { data: string } }[] };
  calls: { n: number; method: string; params: unknown[]; result: unknown }[];
};
const recorded = metalRecordedOf(RECORD)!;
const ACCOUNT = RECORD.account.address;
// A URL that looks like a provider's, with a made-up key in its path and query: it must never come back out.
// Made up, and spelled so no scanner takes it for a real credential: it stands for a provider URL with its access value.
const URL_WITH_KEY = "https://rpc.example.invalid/v2/FAKE0path0value0123456789?x=FAKE0query0value987";

/** A stand-in Metal RPC: answers as the chain did on 12 November, counts every call, and can be told to fail. */
function standIn(mode: "ok" | "throw" | "http500" | "rpcError" | "malformed" = "ok") {
  const calls: { method: string; params: unknown[] }[] = [];
  const answers = new Map(RECORD.read.mandates.map((m) => [m.call.data, m.result_hex]));
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    calls.push({ method: body.method, params: body.params });
    await new Promise((r) => setTimeout(r, 5));
    if (mode === "throw") throw new Error(`connect failed to ${URL_WITH_KEY}`);
    if (mode === "http500") return new Response(`upstream error at ${URL_WITH_KEY}`, { status: 500 });
    if (mode === "rpcError") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: `bad key ${URL_WITH_KEY}` } });
    if (mode === "malformed") return new Response("not json at all", { status: 200 });
    if (body.method === "eth_blockNumber") return Response.json({ jsonrpc: "2.0", id: body.id, result: RECORD.read.block_hex });
    const data = (body.params[0] as { data: string }).data;
    return Response.json({ jsonrpc: "2.0", id: body.id, result: answers.get(data) ?? "0x" });
  }) as typeof fetch;
  return { calls, fetcher };
}

function desk(o: { mode?: Parameters<typeof standIn>[0]; rpcUrl?: string | undefined; off?: string | null; now?: () => Date; ceiling?: number } = {}) {
  const sql = sqlOver(new Database(":memory:"));
  const rpc = standIn(o.mode);
  const d = new MetalInspector(sql, { rpcUrl: "rpcUrl" in o ? o.rpcUrl : URL_WITH_KEY, off: o.off ?? null, recorded, fetcher: rpc.fetcher, now: o.now, ceiling: o.ceiling });
  return { sql, rpc, d };
}
const get = (d: MetalInspector, method = "GET") => d.fetch(new Request(`https://kit11.example${METAL_INSPECTOR_PATH}`, { method }));
const clock = (start = "2026-11-13T10:00:00.000Z") => { let t = Date.parse(start); return { now: () => new Date(t), add: (s: number) => { t += s * 1000; } }; };

describe("the Metal inspector's decoder, against the chain's own answers of 12 November", () => {
  it("reads the three mandates as the chain answered: bound on Northwind's account, not revoked, the spend and payments", () => {
    for (const m of RECORD.read.mandates) {
      expect(mandatesCalldata(m.ref)).toBe(m.call.data);
      expect(m.call.data.startsWith(MANDATES_SELECTOR)).toBe(true);
      const d = decodeMandateState(m.result_hex);
      expect(d.principal.toLowerCase()).toBe(ACCOUNT.toLowerCase());
      expect(d.revoked).toBe(false);
      expect(amountOf(d.spent)).toBe(m.spent);
      expect(Number(d.occurrences)).toBe(m.occurrences);
      expect(Number(d.boundBlock)).toBe(m.bound_block);
    }
    // The figures the main run recorded on 3 November.
    expect(RECORD.read.mandates.map((m) => [m.agent, m.spent, m.occurrences])).toEqual([["sourcing", "1.18", 41], ["support", "0.15", 3], ["treasury", "0.69", 1]]);
  });

  it("reads the record's read for the bundle, and nothing that is not in its shape", () => {
    expect(recorded).toMatchObject({ account: ACCOUNT, block: RECORD.read.block, read_at: RECORD.read.read_at, recorded_on: RECORD.read.read_at.slice(0, 10) });
    expect(recorded.mandates.map((m) => m.agent)).toEqual(["sourcing", "support", "treasury"]);
    expect(metalRecordedOf(null)).toBeNull();
    expect(metalRecordedOf({ account: { address: ACCOUNT }, read: { ...RECORD.read, mandates: [{ agent: "x", ref: "0x12" }] } })).toBeNull();
    expect(metalRecordedOf({ account: { address: "not an address" }, read: RECORD.read })).toBeNull();
  });

  it("refuses what is not an answer of mandates(ref), and writes amounts as the record does", () => {
    expect(() => decodeMandateState("0x")).toThrow();
    expect(() => decodeMandateState("0x1234")).toThrow();
    expect(() => mandatesCalldata("0x1234")).toThrow();
    expect(amountOf(1180000000000000000n)).toBe("1.18");
    expect(amountOf(2000000000000000000n)).toBe("2.00");
    expect(amountOf(10000000000000001n)).toBe("0.010000000000000001");
    expect(inspectorOff(" OFF ")).toBe(true);
    expect(inspectorOff("off")).toBe(true);
    expect(inspectorOff("on")).toBe(false);
    expect(inspectorOff(undefined)).toBe(false);
  });
});

describe("the Metal inspector's limits, with a stand-in RPC", () => {
  it("reads the chain once (1 block number, 3 mandates) and answers everyone from that read until the TTL is over", async () => {
    const c = clock(), { rpc, d } = desk({ now: c.now });
    const first = (await (await get(d)).json()) as InspectorAnswer;
    expect(first).toMatchObject({ source: "chain", reason: null, block: RECORD.read.block, account: ACCOUNT, calls_today: 4, ceiling: INSPECTOR_DAILY_CEILING, cache_seconds: INSPECTOR_TTL_SECONDS });
    expect(first.read_at).toBe(c.now().toISOString());
    expect(first.mandates.map((m) => [m.agent, m.bound, m.revoked, m.spent, m.payments])).toEqual([["sourcing", true, false, "1.18", 41], ["support", true, false, "0.15", 3], ["treasury", true, false, "0.69", 1]]);
    expect(first.check).toMatchObject({ method: "eth_call", to: ACCOUNT, block: RECORD.read.block_hex });
    expect(rpc.calls.map((x) => x.method)).toEqual(["eth_blockNumber", "eth_call", "eth_call", "eth_call"]);
    // Every eth_call is made at the block the first call returned.
    for (const x of rpc.calls.slice(1)) expect(x.params[1]).toBe(RECORD.read.block_hex);
    c.add(INSPECTOR_TTL_SECONDS - 1);
    const cached = (await (await get(d)).json()) as InspectorAnswer;
    expect(rpc.calls).toHaveLength(4);
    expect(cached.read_at).toBe(first.read_at);
    c.add(1);
    await get(d);
    expect(rpc.calls).toHaveLength(8);
  });

  it("keeps a TTL of at least 180 seconds", () => {
    expect(INSPECTOR_TTL_SECONDS).toBeGreaterThanOrEqual(180);
    // A whole day of refreshes stays under the ceiling.
    expect(Math.ceil(86_400 / INSPECTOR_TTL_SECONDS) * 4).toBeLessThanOrEqual(INSPECTOR_DAILY_CEILING);
  });

  it("checks the daily ceiling before each call: at 499 the refresh stops before its second call; at 500 no call at all", async () => {
    const c = clock(), { sql, rpc, d } = desk({ now: c.now });
    sql.exec("INSERT INTO mi_calls (day, n) VALUES (?, ?)", "2026-11-13", INSPECTOR_DAILY_CEILING - 1);
    const a = (await (await get(d)).json()) as InspectorAnswer;
    expect(rpc.calls).toHaveLength(1);
    expect(a).toMatchObject({ source: "recorded", reason: "today's call ceiling is reached", calls_today: INSPECTOR_DAILY_CEILING, block: RECORD.read.block, recorded_on: "2026-11-12" });
    c.add(INSPECTOR_TTL_SECONDS);
    const b = (await (await get(d)).json()) as InspectorAnswer;
    expect(rpc.calls).toHaveLength(1);
    expect(b.reason).toBe("today's call ceiling is reached");
    // The next UTC day counts from 0.
    c.add(86_400);
    const next = (await (await get(d)).json()) as InspectorAnswer;
    expect(next).toMatchObject({ source: "chain", calls_today: 4 });
    expect(rpc.calls).toHaveLength(5);
  });

  it("shares one refresh among 50 visits at once: 4 calls, one answer", async () => {
    const c = clock(), { rpc, d } = desk({ now: c.now });
    const answers = await Promise.all(Array.from({ length: 50 }, async () => (await (await get(d)).json()) as InspectorAnswer));
    expect(rpc.calls).toHaveLength(4);
    expect(new Set(answers.map((a) => JSON.stringify({ ...a, calls_today: 0 }))).size).toBe(1);
    expect(answers.every((a) => a.source === "chain")).toBe(true);
  });

  it("never passes the ceiling with visits at once, two desks over one storage included", async () => {
    const c = clock();
    const sql = sqlOver(new Database(":memory:"));
    sql.exec("CREATE TABLE IF NOT EXISTS mi_calls (day TEXT PRIMARY KEY, n INTEGER NOT NULL)");
    sql.exec("INSERT INTO mi_calls (day, n) VALUES (?, ?)", "2026-11-13", INSPECTOR_DAILY_CEILING - 3);
    const rpc = standIn();
    const desks = [0, 1].map(() => new MetalInspector(sql, { rpcUrl: URL_WITH_KEY, recorded, fetcher: rpc.fetcher, now: c.now }));
    const answers = await Promise.all(Array.from({ length: 40 }, async (_, i) => (await (await get(desks[i % 2]!)).json()) as InspectorAnswer));
    expect(rpc.calls.length).toBeLessThanOrEqual(3);
    expect((sql.exec("SELECT n FROM mi_calls WHERE day = ?", "2026-11-13").toArray() as { n: number }[])[0]!.n).toBe(INSPECTOR_DAILY_CEILING);
    expect(answers.every((a) => a.source === "recorded" && a.reason === "today's call ceiling is reached")).toBe(true);
  });

  it("makes no call when switched off, without a URL, or on a local copy; the answer is the record's, labelled", async () => {
    for (const [o, reason] of [[{ off: "switched off" }, "switched off"], [{ rpcUrl: undefined }, "no RPC configured"], [{ off: LOCAL_REASON }, LOCAL_REASON]] as const) {
      const { rpc, d } = desk(o);
      const a = (await (await get(d)).json()) as InspectorAnswer;
      expect(rpc.calls).toHaveLength(0);
      expect(a).toMatchObject({ source: "recorded", reason, block: RECORD.read.block, read_at: RECORD.read.read_at, recorded_on: "2026-11-12", calls_today: 0 });
      expect(a.mandates.map((m) => m.spent)).toEqual(["1.18", "0.15", "0.69"]);
    }
  });

  it("serves the record's read on every kind of RPC failure, keeps that answer for the TTL, and never shows the URL", async () => {
    for (const [mode, reason] of [["throw", "the RPC did not answer"], ["http500", "the RPC answered with an error"], ["rpcError", "the RPC answered with an error"], ["malformed", "the RPC answered with an error"]] as const) {
      const c = clock(), { rpc, d } = desk({ mode, now: c.now });
      const res = await get(d);
      const raw = await res.text();
      const a = JSON.parse(raw) as InspectorAnswer;
      expect(res.status).toBe(200);
      expect(a).toMatchObject({ source: "recorded", reason, recorded_on: "2026-11-12" });
      expect(rpc.calls).toHaveLength(1);
      for (const part of ["FAKE0path0value0123456789", "FAKE0query0value987", "rpc.example.invalid", URL_WITH_KEY]) {
        expect(raw).not.toContain(part);
        expect([...res.headers.values()].join(" ")).not.toContain(part);
      }
      await get(d);
      expect(rpc.calls).toHaveLength(1);
    }
  });

  it("never labels the record's read as the chain's, and an answer from the chain carries its own block and time", async () => {
    const c = clock(), live = desk({ now: c.now }), off = desk({ off: "switched off" });
    const a = (await (await get(live.d)).json()) as InspectorAnswer, b = (await (await get(off.d)).json()) as InspectorAnswer;
    expect(a.source).toBe("chain");
    expect(a.recorded_on).toBeUndefined();
    expect(b.source).toBe("recorded");
    expect(b.recorded_on).toBe("2026-11-12");
    expect(b.read_at).toBe(RECORD.read.read_at);
  });

  it("answers GET and HEAD only, and 503 when the bundle carries no recorded read", async () => {
    const { d } = desk();
    expect((await get(d, "POST")).status).toBe(405);
    const none = new MetalInspector(sqlOver(new Database(":memory:")), { rpcUrl: URL_WITH_KEY, recorded: null, fetcher: standIn().fetcher });
    expect((await get(none)).status).toBe(503);
  });
});

describe("a MandateRefused log, decoded (the two refusals of the check of 12 November)", () => {
  const REFUSALS = (JSON.parse(readFileSync(new URL("../docs/runs/2026-11-12-metal-inspector.json", import.meta.url), "utf8")) as {
    abi: { topic0: { MandateRefused: string } };
    refusals: { tx: string; account: string; event: { arg_values: (string | number)[]; mandate: string; payee: string; amount: string; reason: number; reason_name: string }; raw_log: RefusalLog }[];
  });
  it("gives the mandate, the payee, the amount and the reason the record decoded, from the raw log alone", () => {
    expect(MANDATE_REFUSED_TOPIC).toBe(REFUSALS.abi.topic0.MandateRefused);
    expect(REFUSALS.refusals).toHaveLength(2);
    for (const r of REFUSALS.refusals) {
      const d = decodeRefusal(r.raw_log)!;
      expect(d).toMatchObject({ account: r.account.toLowerCase(), ref: r.event.mandate.toLowerCase(), to: r.event.payee.toLowerCase(), amount: r.event.amount, reason: r.event.reason, reason_name: r.event.reason_name });
      expect(d.l3aDigest).toBe(String(r.event.arg_values[2]).toLowerCase());
      expect(d.agentKey).toBe(String(r.event.arg_values[3]).toLowerCase());
    }
    expect(REFUSALS.refusals.map((r) => decodeRefusal(r.raw_log)!.reason_name)).toEqual(["OverPerPaymentCap", "Revoked"]);
  });
  it("is null for any other log, or a log cut short", () => {
    const log = REFUSALS.refusals[0]!.raw_log;
    expect(decodeRefusal({ ...log, topics: [`0x${"00".repeat(32)}`, ...log.topics.slice(1)] })).toBeNull();
    expect(decodeRefusal({ ...log, topics: log.topics.slice(0, 2) })).toBeNull();
    expect(decodeRefusal({ ...log, data: log.data.slice(0, 2 + 64 * 3) })).toBeNull();
    // Cut inside the 65-byte key: the length word is there, the key is not all there.
    expect(decodeRefusal({ ...log, data: log.data.slice(0, 2 + 64 * 6) })).toBeNull();
    expect(decodeRefusal({ ...log, data: "0x12" })).toBeNull();
  });
});

describe("a local copy's desk (the judge's server, the local relay, the dashboard)", () => {
  it("answers the record's read with its reason and never calls anything", async () => {
    const d = localInspector(recorded);
    const res = await d.fetch(new Request(`http://localhost${METAL_INSPECTOR_PATH}`));
    expect(res.status).toBe(200);
    const a = (await res.json()) as InspectorAnswer;
    expect(a).toMatchObject({ source: "recorded", reason: LOCAL_REASON, block: RECORD.read.block, calls_today: 0 });
    expect(a.mandates).toEqual(recorded.mandates);
    expect((await localInspector(null).fetch(new Request(`http://localhost${METAL_INSPECTOR_PATH}`))).status).toBe(503);
  });
});
