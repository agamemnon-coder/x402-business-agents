// /try/sign, 6c: a hash chain per test world. Every event in a world appends {seq, at, kind, data_sha256, prev, hash},
// hash = SHA-256 of the canonical JSON of the row without its hash, so each row covers the one before. Checked here:
// the rows as Node's own crypto recomputes them; a tampered row is found (by the chain's check, by the receipt's checks
// in Node and in the browser's code); the chain survives a reload of the store; and it is per world.
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { RECEIPT_FORMAT, canonicalTerms, chainRowCanonical, verifyReceipt, type ReceiptResult, type TryReceipt } from "../src/try/receipt.js";
import { VERIFY_CORE } from "../src/try/verify.js";
import { TrySignDesk } from "../worker/src/trySign.js";
import { CHAIN_GENESIS, CHAIN_KINDS, CHAIN_MAX_ROWS, canonicalRow, checkChain, nextRow, sha256HexSync, type ChainRow } from "../worker/src/worldChain.js";
import { StandInQuotes } from "./support/fxStandIn.js";
import { BASE, RP, TEST_RATE, call, challengeOf, desk, newWorld, signBody, sqlOver, t0, withPasskey } from "./support/trySign.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const verifyReceiptWeb = new Function(`${VERIFY_CORE}\nreturn verifyReceiptWeb;`)() as (r: unknown) => Promise<ReceiptResult>;
type Chain = { length: number; head: string | null; full: boolean; max: number; rows: ChainRow[] };
const chainOf = async (d: TrySignDesk, token: string): Promise<Chain> => {
  const r = await call(d, "chain", { token });
  expect(r.status).toBe(200);
  return ((await r.json()) as { chain: Chain }).chain;
};
const failed = (r: ReceiptResult) => r.checks.filter((c) => !c.ok).map((c) => c.check);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A visit: a world, its agents, a passkey, the payment signed, one cheat refused, a looser rule signed (the next invoice runs alone). */
async function visit(d: TrySignDesk) {
  const { w, auth, b } = await withPasskey(d, new FakeAuthenticator());
  const a = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
  const res = await call(d, "sign", signBody(w.world.token, b, a));
  expect(res.status).toBe(200);
  const signed = (await res.json()) as { terms_sha256: string; public_key: TryReceipt["public_key"]; executed: { id: string }; chain: Chain };
  const cheat = canonicalTerms({ ...(JSON.parse(b.canonical) as Record<string, unknown>), amount: "1850.01" });
  expect(await (await call(d, "sign", signBody(w.world.token, b, a, cheat))).json()).toMatchObject({ verified: false });
  expect((await call(d, "trick", { token: w.world.token, attack: "pre_approved" })).status).toBe(200);
  const policy = (w as unknown as { policy: { agents: { treasury: Record<string, unknown> }; reserve_floor: string } }).policy;
  const set = { ...policy.agents.treasury, reserve_floor: policy.reserve_floor, alone: "2000.00" };
  const ask = (await (await call(d, "policy", { token: w.world.token, agent: "treasury", set })).json()) as { canonical: string; terms_sha256: string };
  const pa = auth.sign({ challenge: challengeOf(ask.terms_sha256), origin: BASE, rpId: RP, counter: 2 });
  expect(await (await call(d, "policy", { token: w.world.token, agent: "treasury", set, canonical: ask.canonical, credential: pa })).json()).toMatchObject({ applied: true, paid_alone: ["T-0003"] });
  const receipt: TryReceipt = {
    receipt: RECEIPT_FORMAT, note: "", terms: JSON.parse(b.canonical) as Record<string, unknown>, terms_sha256: signed.terms_sha256, algorithm: "ES256", public_key: signed.public_key,
    credential_id: a.id, rp_id: RP, origin: BASE, assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
    chain: { length: signed.chain.length, head: signed.chain.head, rows: signed.chain.rows },
  };
  return { w, b, signed, receipt };
}

describe("6c: each test world keeps a hash chain of its events", () => {
  it("the SHA-256 the Worker computes in plain code is Node's, at every padding boundary and in UTF-8", () => {
    for (const s of ["", "abc", "€1,850 — Ünïcode", ...[55, 56, 57, 63, 64, 65, 119, 120, 128, 1000].map((n) => "x".repeat(n))]) expect(sha256HexSync(s)).toBe(sha(s));
  });

  it("every kind of event appends a row; each row's hash is the SHA-256 of its canonical JSON without the hash, and covers the row before", async () => {
    const { d } = desk(undefined, new StandInQuotes());
    const { w, signed } = await visit(d);
    const c = await chainOf(d, w.world.token);
    const kinds = c.rows.map((r) => r.kind);
    expect(new Set(kinds)).toEqual(new Set(CHAIN_KINDS));
    expect(kinds.slice(0, 2)).toEqual(["world_opened", "proposal"]);
    expect(kinds.filter((k) => k === "agent_step")).toHaveLength(5);
    expect(c.rows[0]!.prev).toBe(CHAIN_GENESIS);
    c.rows.forEach((r, i) => {
      expect(Object.keys(r)).toEqual(["seq", "at", "kind", "data_sha256", "prev", "hash"]);
      expect(r.seq).toBe(i + 1);
      const without = `{"at":${JSON.stringify(r.at)},"data_sha256":"${r.data_sha256}","kind":"${r.kind}","prev":"${r.prev}","seq":${r.seq}}`;
      expect(canonicalRow(r)).toBe(without);
      expect(r.hash).toBe(sha(without));
      if (i > 0) expect(r.prev).toBe(c.rows[i - 1]!.hash);
    });
    expect([c.length, c.head]).toEqual([c.rows.length, c.rows.at(-1)!.hash]);
    expect(checkChain(c.rows)).toMatchObject({ ok: true, length: c.length, head: c.head });
    // The signature's row is exactly the proposal and the hash signed; the chain at signing is the start of the chain now.
    const sig = c.rows.find((r) => r.kind === "signature")!;
    expect(sig.data_sha256).toBe(sha(canonicalTerms({ proposal_id: "T-0002", terms_sha256: signed.terms_sha256 })));
    expect(c.rows.slice(0, signed.chain.length)).toEqual(signed.chain.rows);
    // The refusals: the cheat with the same signature, the fake invoice, the looser rule before its signature.
    expect(kinds.filter((k) => k === "refusal")).toHaveLength(3);
    expect(kinds.filter((k) => k === "execution")).toHaveLength(2);
  });

  it("a tampered row is detected: its data, time, kind, order, a dropped row, or a rewritten hash", async () => {
    const { d } = desk(undefined, new StandInQuotes());
    const { w } = await visit(d);
    const rows = (await chainOf(d, w.world.token)).rows;
    const k = 6;
    const cases: [string, (r: ChainRow[]) => void, number][] = [
      ["data", (r) => { r[k]!.data_sha256 = sha("other data"); }, k + 1],
      ["time", (r) => { r[k]!.at = "2026-11-04T10:00:00.001Z"; }, k + 1],
      ["kind", (r) => { r[k]!.kind = "execution"; }, k + 1],
      ["order", (r) => { [r[k], r[k + 1]] = [r[k + 1]!, r[k]!]; }, k + 1],
      ["dropped", (r) => { r.splice(k, 1); }, k + 1],
      // The row's own hash recomputed after the change: then the next row no longer follows it.
      ["rewritten", (r) => { r[k]!.data_sha256 = sha("other"); r[k]!.hash = sha(canonicalRow(r[k]!)); }, k + 2],
    ];
    for (const [what, change, at] of cases) {
      const t = copy(rows);
      change(t);
      expect({ what, ...checkChain(t) }).toMatchObject({ what, ok: false, bad: at });
    }
  });

  it("the receipt carries the chain: checked offline in Node and in the browser's code, which find the signature's row and any tampered row", async () => {
    const { d } = desk(undefined, new StandInQuotes());
    const { receipt } = await visit(d);
    const good = verifyReceipt(receipt);
    expect(failed(good)).toEqual([]);
    expect(good.checks.slice(-2).map((c) => c.check)).toEqual(["chain", "chain signature"]);
    expect(await verifyReceiptWeb(receipt)).toEqual(good);
    const k = 3;
    const cases: [string, (r: TryReceipt) => void, string[]][] = [
      ["a row's data", (r) => { r.chain!.rows[k]!.data_sha256 = sha("x"); }, ["chain"]],
      ["a row's hash", (r) => { r.chain!.rows[k]!.hash = sha("x"); }, ["chain"]],
      ["the head", (r) => { r.chain!.head = sha("x"); }, ["chain"]],
      ["the signature's row gone", (r) => { const rows = r.chain!.rows.filter((x) => x.kind !== "signature"); r.chain!.rows = rows; r.chain!.length = rows.length; }, ["chain"]],
      ["another proposal's chain", (r) => { r.chain!.rows = r.chain!.rows.slice(0, 5); r.chain!.length = 5; r.chain!.head = r.chain!.rows[4]!.hash; }, ["chain signature"]],
      ["not a chain", (r) => { (r as { chain: unknown }).chain = "rows"; }, ["chain"]],
    ];
    for (const [what, change, fails] of cases) {
      const t = copy(receipt);
      change(t);
      const node = verifyReceipt(t), web = await verifyReceiptWeb(t);
      expect({ what, web }).toEqual({ what, web: node });
      expect({ what, failed: failed(node) }).toEqual({ what, failed: fails });
    }
    expect(chainRowCanonical(receipt.chain!.rows[0]!)).toBe(canonicalRow(receipt.chain!.rows[0]! as ChainRow));
  });

  it("survives a reload: a new desk over the same store answers the same chain and goes on from its head", async () => {
    const db = new Database(":memory:");
    const first = desk(db, new StandInQuotes());
    const { w, auth, b } = await withPasskey(first.d, new FakeAuthenticator());
    const before = await chainOf(first.d, w.world.token);
    // The Durable Object restarts: a new desk over the same SQL store.
    const again = new TrySignDesk(sqlOver(db), { now: () => t0, fx: new StandInQuotes(), rate: TEST_RATE });
    expect(await chainOf(again, w.world.token)).toEqual(before);
    const a = auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 });
    expect((await call(again, "sign", signBody(w.world.token, b, a))).status).toBe(200);
    const after = await chainOf(again, w.world.token);
    expect(after.rows.slice(0, before.length)).toEqual(before.rows);
    expect(after.rows[before.length]).toMatchObject({ seq: before.length + 1, prev: before.head });
    expect(checkChain(after.rows).ok).toBe(true);
  });

  it("is per world: each starts at row 1 from zeros, one world's events never touch another's, and a token reads only its own", async () => {
    const { d, db } = desk(undefined, new StandInQuotes());
    const one = await newWorld(d), two = await newWorld(d);
    const [c1, c2] = [await chainOf(d, one.world.token), await chainOf(d, two.world.token)];
    for (const [c, w] of [[c1, one], [c2, two]] as const) {
      expect(c.rows[0]).toMatchObject({ seq: 1, kind: "world_opened", prev: CHAIN_GENESIS });
      expect(c.rows[0]!.data_sha256).toBe(sha(canonicalTerms({ world: w.world.id, expires_at: w.world.expires_at, terms_schema: "kit11.try-terms/v4" })));
    }
    expect(c1.head).not.toBe(c2.head);
    expect((await call(d, "trick", { token: two.world.token, attack: "lookalike" })).status).toBe(200);
    expect(await chainOf(d, one.world.token)).toEqual(c1);
    expect((await chainOf(d, two.world.token)).length).toBe(c2.length + 1);
    // Without a token, or with a made-up one: no chain.
    expect((await call(d, "chain", {})).status).toBe(410);
    expect((await call(d, "chain", { token: "A".repeat(43) })).status).toBe(410);
    expect((await call(d, "chain", { token: one.world.token, world: two.world.id })).status).toBe(400);
    // A world that goes takes its chain with it.
    const rowsOf = (id: string) => (db.prepare("SELECT COUNT(*) AS n FROM ts_chain WHERE world = ?").get(id) as { n: number }).n;
    expect(rowsOf(one.world.id)).toBe(c1.length);
  });

  it("stops at its ceiling rather than grow without end", () => {
    let last: ChainRow | null = null;
    const rows: ChainRow[] = [];
    for (let i = 0; i < 5; i++) { last = nextRow(last, "2026-11-07T12:00:00.000Z", "agent_step", { step: String(i) }); rows.push(last); }
    expect(checkChain(rows)).toMatchObject({ ok: true, length: 5 });
    expect(CHAIN_MAX_ROWS).toBeGreaterThanOrEqual(200);
  });
});
