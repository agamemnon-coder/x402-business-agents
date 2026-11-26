// /proof's "Check it on chain" (src/redesign/chainCheck.ts, worker/src/altaTx.ts): the Worker's read-only desk reads
// only the transactions the committed records name, in fixed words when it cannot, never quoting the RPC URL; one read
// per transaction for everyone, under a daily ceiling and a switch. The page names each transaction with what the repo
// says it should show (the anchor head recomputed from the records, the mandate the main run names), and its script's
// verdict, run here in Node on answers built from those records, says match only when the chain's answer matches.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { sqlOver } from "./support/trySign.js";
import { readRecord } from "../src/anchor/anchor.js";
import { anchorCalldata, computeAnchorHead } from "../src/anchor/head.js";
import { ALTA_TX_PATH, AltaTxDesk, LOCAL_TX_REASON, altaTxHashOf, altaTxOff, localAltaTx, readOf, type AltaTxAnswer, type AltaTxTarget } from "../worker/src/altaTx.js";
import { MANDATE_REFUSED_TOPIC } from "../worker/src/metalInspector.js";
import { CHAIN_CHECK_CORE, anchorChecks, chainChecks } from "../src/redesign/chainCheck.js";
import { loadRecord } from "../src/redesign/run.js";
import { ALTA_TX_TARGETS, PROOF_CSP, PROOF_PAGE } from "../src/servers/dashboard.js";

const RPC = "https://rpc.example/v1/secret-access-key-in-the-path";
const H = (c: string) => `0x${c.repeat(64)}`;
const target: AltaTxTarget = { hash: H("a"), label: "The anchor of 19 Nov", kind: "anchor", record: "docs/runs/2026-11-19-anchor.json" };
const FROM = "0xd996570d2a70991e8793a074fe0000b099823374";
const txOf = (o: Record<string, unknown> = {}) => ({ hash: target.hash, from: FROM, to: FROM, input: "0x7075727365", chainId: "0xf951", blockNumber: "0x21bba2c", ...o });
const receiptOf = (o: Record<string, unknown> = {}) => ({ status: "0x1", blockNumber: "0x21bba2c", logs: [], ...o });

function rpc(answers: Record<string, unknown>, calls: string[] = []) {
  return (async (url: string, init?: RequestInit) => {
    expect(url).toBe(RPC);
    const m = (JSON.parse(String(init?.body)) as { method: string }).method;
    calls.push(m);
    const a = answers[m];
    if (a instanceof Response) return a;
    return Response.json({ jsonrpc: "2.0", id: 1, result: a });
  }) as typeof fetch;
}
const desk = (o: Partial<ConstructorParameters<typeof AltaTxDesk>[1]> = {}) => new AltaTxDesk(sqlOver(new Database(":memory:")), { rpcUrl: RPC, targets: [target], ...o });
const get = async (d: AltaTxDesk, hash = target.hash, method = "GET") => { const r = await d.fetch(new Request(`https://site.test${ALTA_TX_PATH}/${hash}`, { method })); return { status: r.status, body: (await r.json()) as AltaTxAnswer & { error?: string } }; };

describe("the Worker's transaction desk", () => {
  it("reads only the committed records' transactions, GET only", async () => {
    const calls: string[] = [];
    const d = desk({ fetcher: rpc({ eth_getTransactionByHash: txOf(), eth_getTransactionReceipt: receiptOf() }, calls) });
    expect((await get(d, H("b"))).status).toBe(404);
    expect((await get(d, "0x1234")).status).toBe(404);
    expect((await get(d, target.hash, "POST")).status).toBe(405);
    expect(calls).toEqual([]);
    expect(altaTxHashOf(`${ALTA_TX_PATH}/${H("A")}`)).toBe(H("a"));
    expect(altaTxHashOf(`${ALTA_TX_PATH}/${H("a")}/x`)).toBeNull();
  });

  it("answers what the chain returns, once for everyone, and says when", async () => {
    const calls: string[] = [];
    let now = new Date("2026-11-26T15:00:00Z");
    const d = desk({ now: () => now, fetcher: rpc({ eth_getTransactionByHash: txOf(), eth_getTransactionReceipt: receiptOf({ logs: [{ address: FROM, topics: [MANDATE_REFUSED_TOPIC, H("c")], data: "0x00" }] }) }, calls) });
    const [a, b] = await Promise.all([get(d), get(d)]);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ source: "chain", network: "Alta testnet", found: true, hash: target.hash, label: target.label, record: target.record, tx: { chain_id: 63825, status: "success", block: 35371564, from: FROM, to: FROM, input: "0x7075727365", input_bytes: 5, logs: [{ topics: [MANDATE_REFUSED_TOPIC, H("c")], data: "0x00", data_bytes: 1 }] } });
    expect(a.body.says).toBe("Read live from Alta testnet at 15:00 UTC, block 35371564.");
    expect(b.body.tx).toEqual(a.body.tx);
    expect(calls).toEqual(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);
    await get(d);
    expect(calls).toHaveLength(2);
    now = new Date("2026-11-26T16:00:01Z");
    await get(d);
    expect(calls).toHaveLength(4);
    expect(JSON.stringify(a.body)).not.toContain("secret-access-key");
  });

  it("says, in fixed words and never with the RPC's address, when it cannot read", async () => {
    const cases: [Partial<ConstructorParameters<typeof AltaTxDesk>[1]>, string][] = [
      [{ off: "switched off" }, "Not read from the chain: switched off."],
      [{ rpcUrl: undefined }, "Not read from the chain: no RPC configured."],
      [{ fetcher: (async () => { throw new Error(`fetch failed: ${RPC}`); }) as typeof fetch }, "Not read from the chain: the RPC did not answer."],
      [{ fetcher: rpc({ eth_getTransactionByHash: new Response(`bad gateway at ${RPC}`, { status: 502 }) }) }, "Not read from the chain: the RPC answered with an error."],
      [{ fetcher: rpc({ eth_getTransactionByHash: txOf({ hash: H("b") }), eth_getTransactionReceipt: receiptOf() }) }, "Not read from the chain: the RPC answered with something else."],
      [{ fetcher: rpc({ eth_getTransactionByHash: txOf({ chainId: "0x1" }), eth_getTransactionReceipt: receiptOf() }) }, "Not read from the chain: the RPC is not Alta testnet's."],
      [{ ceiling: 0, fetcher: rpc({}) }, "Not read from the chain: today's call ceiling is reached."],
    ];
    for (const [o, says] of cases) {
      const r = await get(desk(o));
      expect(r.body.says, says).toBe(says);
      expect(r.body).toMatchObject({ source: "unavailable", tx: null, found: null });
      expect(JSON.stringify(r.body)).not.toContain("secret-access-key");
    }
    expect((await get(localAltaTx([target]))).body.reason).toBe(LOCAL_TX_REASON);
    expect(altaTxOff(undefined, " OFF ")).toBe(true);
    expect(altaTxOff("on", undefined)).toBe(false);
  });

  it("says when the chain does not know the hash, and keeps a failed read a short while only", async () => {
    const calls: string[] = [];
    let now = new Date("2026-11-26T15:00:00Z");
    const d = desk({ now: () => now, fetcher: rpc({ eth_getTransactionByHash: null }, calls) });
    const r = await get(d);
    expect(r.body).toMatchObject({ source: "chain", found: false, tx: null });
    now = new Date("2026-11-26T15:05:01Z");
    await get(d);
    expect(calls).toHaveLength(2);
  });

  it("keeps the counted calls under the day's ceiling", async () => {
    const calls: string[] = [];
    let now = new Date("2026-11-26T00:00:00Z");
    const d = desk({ ceiling: 3, ttlSeconds: 1, retrySeconds: 1, now: () => now, fetcher: rpc({ eth_getTransactionByHash: txOf(), eth_getTransactionReceipt: receiptOf() }, calls) });
    for (let i = 0; i < 4; i++) { await get(d); now = new Date(now.getTime() + 2000); }
    expect(calls.length).toBe(3);
    expect(d.callsToday(now)).toBe(3);
  });

  it("checks the chain's answer field by field, and keeps no oversized data", () => {
    expect(readOf(target.hash, txOf({ to: null }), null)).toMatchObject({ status: "pending", block: null, to: null });
    expect(() => readOf(target.hash, txOf({ from: "nope" }), null)).toThrow();
    expect(() => readOf(target.hash, txOf(), receiptOf({ status: "0x2" }))).toThrow();
    expect(() => readOf(target.hash, txOf(), receiptOf({ logs: [{ address: FROM, topics: ["0x12"], data: "0x" }] }))).toThrow();
    const big = `0x${"ab".repeat(5000)}`;
    expect(readOf(target.hash, txOf({ input: big }), receiptOf())).toMatchObject({ input: null, input_bytes: 5000 });
    expect(readOf(target.hash, txOf(), receiptOf({ status: "0x0" })).status).toBe("reverted");
  });
});

describe("the page's transactions and its verdict", () => {
  const { record, file } = loadRecord();
  const checks = chainChecks(record, file);
  // The verdict as the page runs it (ES5 in a template string), here in Node.
  const ccxVerdict = new Function(`${CHAIN_CHECK_CORE}; return ccxVerdict;`)() as (d: Record<string, string>, a: unknown) => { rows: [string, string, boolean | null][]; match: boolean | null };
  const dataOf = (c: (typeof checks)[number]) => Object.fromEntries(Object.entries({ hash: c.hash, kind: c.kind, ...c.expect }).map(([k, v]) => [k, String(v)]));
  const answer = (tx: Record<string, unknown> | null) => ({ source: "chain", says: "Read live", tx, found: !!tx });

  it("names #24's refusal and every anchor, each anchor's head recomputed from the records", () => {
    expect(checks.map((c) => c.kind)).toEqual(["refusal", "anchor", "anchor"]);
    for (const c of anchorChecks()) {
      const rec = readRecord(c.record);
      expect(c.hash).toBe(rec.tx.toLowerCase());
      expect(c.expect.head).toBe(computeAnchorHead(process.cwd(), rec.parts.map(({ name, file: f, kind }) => ({ name, file: f, kind }))).head);
      expect(PROOF_PAGE).toContain(`data-hash="${c.hash}"`);
      expect(PROOF_PAGE).toContain(`data-head="${c.expect.head}"`);
    }
    const refusal = checks[0]!;
    expect(refusal.label).toMatch(/^Purchase #\d+ refused on chain$/);
    expect(refusal.expect.topic).toBe(MANDATE_REFUSED_TOPIC);
    expect(refusal.expect.mandate).toMatch(/^0x[0-9a-f]{64}$/);
    // The Worker's allowlist is exactly the page's transactions.
    expect(ALTA_TX_TARGETS.map((t) => t.hash)).toEqual(checks.map((c) => c.hash));
  });

  it("keeps /proof's policy as it was: its own script and style, connect-src 'self', no other host", () => {
    expect(PROOF_PAGE).toContain('id="chain-check"');
    expect(PROOF_CSP).toContain("connect-src 'self'");
    expect(PROOF_CSP).not.toMatch(/https?:/);
    expect(PROOF_PAGE).not.toContain("rpc-testnet");
    expect(PROOF_PAGE).toMatch(/Alta testnet, test money\./);
  });

  it("says match for an anchor's calldata equal to the recomputed head, and not for any other", () => {
    const c = checks.find((x) => x.kind === "anchor")!, d = dataOf(c);
    const tx = { status: "success", block: c.expect.block, from: c.expect.from, to: c.expect.from, input: anchorCalldata({ head: c.expect.head!, height: c.expect.height! }), input_bytes: 87, logs: [] };
    const ok = ccxVerdict(d, answer(tx));
    expect(ok.match).toBe(true);
    expect(ok.rows.find((r) => r[0] === "Anchor head")![1]).toBe("equals the head recomputed from the repo");
    expect(ccxVerdict(d, answer({ ...tx, input: anchorCalldata({ head: "0".repeat(64), height: c.expect.height! }) })).match).toBe(false);
    expect(ccxVerdict(d, answer({ ...tx, block: (c.expect.block ?? 0) + 1 })).match).toBe(false);
    expect(ccxVerdict(d, answer({ ...tx, status: "reverted" })).match).toBe(false);
    expect(ccxVerdict(d, answer(null)).match).toBe(false);
    // Not read: no verdict at all, only what the site said.
    expect(ccxVerdict(d, { source: "unavailable", says: "Not read from the chain: switched off.", tx: null })).toEqual({ rows: [["Source", "Not read from the chain: switched off.", null]], match: null });
  });

  it("says match for the refusal only with Alta's MandateRefused event for the mandate the record names", () => {
    const c = checks[0]!, d = dataOf(c);
    const tx = (topics: string[]) => ({ status: "success", block: 1, from: FROM, to: FROM, input: "0x", input_bytes: 0, logs: [{ address: FROM, topics, data: "0x", data_bytes: 0 }] });
    expect(ccxVerdict(d, answer(tx([MANDATE_REFUSED_TOPIC, c.expect.mandate!, H("1")]))).match).toBe(true);
    expect(ccxVerdict(d, answer(tx([MANDATE_REFUSED_TOPIC, H("9"), H("1")]))).match).toBe(false);
    expect(ccxVerdict(d, answer(tx([H("8"), c.expect.mandate!]))).match).toBe(false);
  });
});
