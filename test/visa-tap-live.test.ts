// D25, the live TAP run's script, tested offline: Airwallex's stand-in, a scripted Claude, a pass-through stand-in for
// Visa's reference proxy and registry, and our real merchant server. The record must hold, per step, the TAP keyId and
// nonce, the proxy's HTTP status, our layer's verdict, the Airwallex id confirmed by a read-only GET, the D24 origin,
// and the card brand exactly as the GET returns it (or that it returned none).
import type Anthropic from "@anthropic-ai/sdk";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CardTransaction } from "../src/airwallex/issuing.js";
import { audit } from "../src/audit/log.js";
import { CARDS } from "../src/config/policy.js";
import { cardRows, setupCards } from "../src/policy/cards.js";
import { describeStep, freshWorldProblem, liveRunPreflight, PER_TX_LIMIT_REASON, REF_COMMIT, runTapLive, type LiveRunDeps, type PreflightIo } from "../src/visa/tapLiveRun.js";

type Call = { name: string; input: unknown };
function fake(turns: Call[][]): Anthropic {
  let i = 0;
  return { beta: { messages: { create: async () => {
    const t = turns[i++];
    const usage = { input_tokens: 100, output_tokens: 20 };
    if (!t) return { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", model: "claude-haiku-5-5", usage };
    return { content: t.map((c, k) => ({ type: "tool_use", id: `t${i}-${k}`, name: c.name, input: c.input })), stop_reason: "tool_use", model: "claude-haiku-5-5", usage };
  } } } } as unknown as Anthropic;
}
const buy = (plan: string, rail: string) => ({ name: "buy_software", input: { plan, rail, reason: "The Starter plan is due; Packwise takes a card only." } });
const finish = { name: "finish", input: { summary: "Paid Packwise Starter on my card." } };

let db: DB, awx: FakeIssuing, proxy: Server, proxyUrl: string, merchantPort: number, proxyRefuses: boolean, cardGet: Record<string, unknown>;

const freePort = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => ok(p)); }); });

beforeEach(async () => {
  db = openDb(":memory:");
  awx = new FakeIssuing();
  proxyRefuses = false;
  cardGet = { card_id: "x", brand: "VISA", card_status: "ACTIVE" };
  merchantPort = await freePort();
  proxy = createServer((req, res) => {
    if (req.url === "/test-proxy") return void res.writeHead(200).end("ok");
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (proxyRefuses) return void res.writeHead(403, { "content-type": "text/html" }).end("<title>Signature Verification Failed</title>");
      const f = request({ host: "127.0.0.1", port: merchantPort, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${merchantPort}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      f.end(Buffer.concat(chunks));
    });
  });
  await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", () => ok()));
  proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterEach(async () => { await new Promise<void>((ok) => proxy.close(() => ok())); });

const registered: unknown[] = [];
const deps = (client: Anthropic | null): LiveRunDeps => ({
  db, issuing: { rail: awx, sim: awx }, proxyUrl, registryUrl: "http://127.0.0.1:9999", merchantPort, client, refCommit: "16d59bdf3f8a542bc538d0962edbb80ea30a02af",
  readBack: { card: async () => cardGet, transactions: (id) => awx.listCardTransactions(id) },
  sleep: async () => {}, readBackTries: 2,
  fetchImpl: (async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith("http://127.0.0.1:9999")) {
      if (init?.method === "POST") registered.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }
    return fetch(url, init);
  }) as typeof fetch,
});

describe("the live TAP run, offline", () => {
  it("records both steps with keyId, nonce, the proxy's 200, our verdict, the GET-confirmed Airwallex id and the D24 origin", async () => {
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "metal_x402")], [buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.ok).toBe(true);
    expect(r.reference.commit).toMatch(/^16d59bd/);
    const [agent, over] = r.steps;
    expect(agent).toMatchObject({
      by: expect.stringMatching(/Sourcing agent \(claude-haiku/), plan: "packwise-starter", rail: "airwallex_card", ok: true,
      tap: { key_id: r.key_id, nonce: expect.any(String), proxy_status: 200, sig1: "verified", sig2: "verified", merchant: "accepted" },
      airwallex: { approved: true, confirmed_by_get: { approved: true, amount: "19.99", currency: "EUR" } },
      origin: { actor: "agent", agent: "sourcing", tap: { key_id: r.key_id, proxy_status: 200 } },
      note: expect.stringMatching(/metal_x402 \(refused by code: supplier's rails\).*airwallex_card/),
    });
    expect((agent!.origin as { tap: { awx_transaction_id: string } }).tap.awx_transaction_id).toBe(agent!.airwallex!.transaction_id);
    expect(over).toMatchObject({
      by: "code", plan: "packwise-pro", ok: true,
      tap: { proxy_status: 200, merchant: "accepted" },
      airwallex: { approved: false, failure_reason: expect.stringMatching(/LIMIT/), confirmed_by_get: { approved: false } },
      origin: { actor: "code", rule: expect.stringMatching(/over the card's per-purchase limit/) },
    });
    expect(over!.tap!.nonce).not.toBe(agent!.tap!.nonce);
    expect(r.card).toMatchObject({ agent: "sourcing", brand_as_returned: { brand: "VISA" } });
    // The test key went to the reference registry as the raw Ed25519 key, under the keyId the steps name.
    expect(registered.at(-1)).toMatchObject({ keys: [{ key_id: r.key_id, algorithm: "ed25519" }] });
    expect(r.labels.join(" ")).not.toMatch(/certified|endorsed/);
  });

  it("records the brand as Airwallex returns it, and says so when it returns none", async () => {
    cardGet = { card_id: "x", brand: "MASTERCARD" };
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.card!.brand_as_returned).toEqual({ brand: "MASTERCARD" });
    cardGet = { card_id: "x", card_status: "ACTIVE" };
    db = openDb(":memory:");
    awx = new FakeIssuing();
    const r2 = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r2.card!.brand_as_returned).toMatch(/no brand field.*card_id, card_status/);
  });

  it("is not ok, and charges nothing, when the proxy refuses", async () => {
    proxyRefuses = true;
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.tap).toMatchObject({ proxy_status: 403, merchant: expect.stringMatching(/refused: .*403/) });
    expect(awx.calls).not.toContain("charge");
  });

  it("is not ok when Claude does not run, and says so", async () => {
    const r = await runTapLive(deps(null));
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ ok: false, note: expect.stringMatching(/no purchase/) });
  });

  it("stops before anything when the reference is not running", async () => {
    await expect(runTapLive({ ...deps(null), proxyUrl: "http://127.0.0.1:9" })).rejects.toThrow(/reference proxy is not running/);
    expect(awx.calls).toEqual([]);
  });
});

describe("only in a fresh test world", () => {
  it("refuses live-1, the reserve, an existing ledger, and no ledger named", () => {
    expect(freshWorldProblem(undefined, false)).toMatch(/KIT11_DB/);
    expect(freshWorldProblem("data/live-1.sqlite", false)).toMatch(/live-1/);
    expect(freshWorldProblem("/x/reserve/kit11.sqlite", false)).toMatch(/reserve/);
    expect(freshWorldProblem("data/visa-tap-live.sqlite", true)).toMatch(/fresh/);
    expect(freshWorldProblem("data/visa-tap-live-2026-11-02.sqlite", false)).toBeNull();
  });
});

describe("review B1: the live world's own card, never another world's", () => {
  it("issues only the Sourcing agent's card, fresh, under a nickname of its own", async () => {
    const r = await runTapLive(deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])));
    expect(r.ok).toBe(true);
    expect(cardRows(db).map((c) => c.agent)).toEqual(["sourcing"]);
    expect(r.card!.nickname).toMatch(/^sourcing agent: warehouse and data software \(tap-\d{4}-[0-9a-f]{4}\)$/);
    expect(awx.cards).toHaveLength(1);
  });
  it("stops before any charge when the card would be adopted (another world's card with that name)", async () => {
    const holder = await awx.createCardholder({ email: CARDS.sourcing.email, firstName: "Sourcing", lastName: "Agent" });
    const other = await awx.createCard({ cardholderId: holder.id, nickname: `${CARDS.sourcing.nickname} (tap-fixed)`, createdBy: "another world", limits: { currency: "EUR", perTxCents: 5000, monthlyCents: 10000 } });
    await expect(runTapLive({ ...deps(fake([[buy("packwise-starter", "airwallex_card")], [finish]])), cardSuffix: "tap-fixed" })).rejects.toThrow(/not issued fresh.*card\.adopted.*nothing was charged/);
    expect(awx.calls).not.toContain("charge");
    expect(other.cardId).toBe(awx.cards[0]!.cardId);
  });
});

describe("review S2 and S5: a step holds only on exactly the evidence asked for", () => {
  // A ledger written by hand: the TAP row, the purchase and Airwallex's answer, then the read-back stand-in.
  const evidence = async (o: { proxyStatus?: number; reason?: string; getApproved?: boolean; getAmountCents?: number; getReason?: string } = {}) => {
    await setupCards(db, awx);
    const card = cardRows(db).find((c) => c.agent === "sourcing")!;
    const from = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
    const reason = o.reason ?? "LIMIT_EXCEEDED";
    const tap = { key_id: "k-live-1", nonce: "n".repeat(43), sig1: "verified", sig2: "verified", proxy_status: o.proxyStatus ?? 200 };
    audit(db, "system", "tap.checkout_verified", "localhost:3001", { agent: "sourcing", plan: "packwise-pro", ...tap });
    const origin = { actor: "code", rule: "over the limit", agent: "sourcing", tap };
    audit(db, "sourcing", "card.purchase_started", "packwise-pro", { origin, agent: "sourcing", amount: "45.00", currency: "EUR" });
    db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, failure_reason, purpose, source, occurred_at, recorded_at) VALUES ('awx-1', ?, 'sourcing', 'Packwise', '5734', 4500, 'EUR', 'FAILED', 0, ?, NULL, 'simulation', ?, ?)")
      .run(card.card_id, reason, new Date().toISOString(), new Date().toISOString());
    audit(db, "sourcing", "card.charge_declined", "awx-1", { origin: { ...origin, tap: { ...tap, awx_transaction_id: "awx-1" } }, agent: "sourcing", reason });
    const got: CardTransaction = { transactionId: "awx-1", cardId: card.card_id, amountCents: o.getAmountCents ?? 4500, currency: "EUR", status: "FAILED", approved: o.getApproved ?? false, failureReason: o.getReason ?? reason, merchant: "Packwise", mcc: "5734", type: "AUTHORIZATION", occurredAt: new Date().toISOString() };
    return describeStep(db, { readBack: { card: async () => ({}), transactions: async () => [got] }, readBackTries: 1 }, from,
      { step: "over the limit", by: "code", rail: "airwallex_card", note: "", expect: { approved: false, reason: PER_TX_LIMIT_REASON } }, async () => {});
  };
  it("holds on the proxy's 200, Airwallex's limit decline confirmed by GET at the planned amount", async () => {
    expect(await evidence()).toMatchObject({ ok: true, plan: "packwise-pro", airwallex: { transaction_id: "awx-1", confirmed_by_get: { amount: "45.00" } } });
  });
  it("not without the proxy's 200", async () => {
    expect((await evidence({ proxyStatus: 403 })).ok).toBe(false);
  });
  it("not when the GET does not confirm the outcome", async () => {
    expect((await evidence({ getApproved: true })).ok).toBe(false);
  });
  it("not for another decline, recorded as it is", async () => {
    const s = await evidence({ reason: "MERCHANT_CATEGORY_NOT_ALLOWED" });
    expect(s).toMatchObject({ ok: false, airwallex: { failure_reason: "MERCHANT_CATEGORY_NOT_ALLOWED" } });
    expect((await (async () => { db = openDb(":memory:"); awx = new FakeIssuing(); return evidence({ getReason: "CARD_INACTIVE" }); })()).ok).toBe(false);
  });
  it("not when the GET's amount is not the planned amount", async () => {
    expect((await evidence({ getAmountCents: 4400 })).ok).toBe(false);
  });
});

describe("review S3 and S5: the checks before anything is done", () => {
  const good = { KIT11_DB: "data/visa-tap-live-x.sqlite", AIRWALLEX_CLIENT_ID: "id", AIRWALLEX_API_KEY: "key", KIT11_ANTHROPIC_API_KEY: "key", TAP_REF_DIR: "/ref" };
  const io = (o: { head?: string; dirty?: string; exists?: string[] } = {}): PreflightIo => ({
    exists: (p) => (o.exists ?? []).includes(p),
    git: (_dir, args) => args[0] === "rev-parse" ? { status: o.head === "" ? 128 : 0, stdout: `${o.head ?? REF_COMMIT}\n` } : { status: 0, stdout: o.dirty ?? "" },
    today: () => "2026-11-02",
  });
  it("passes a fresh world with the keys and a clean clone at 16d59bd", () => {
    expect(liveRunPreflight(good, io())).toEqual({ dbPath: good.KIT11_DB, refDir: "/ref", refCommit: REF_COMMIT, out: "docs/runs/visa-tap-live-2026-11-02.json" });
  });
  it("stops without the Anthropic key, or the Airwallex keys", () => {
    expect(liveRunPreflight({ ...good, KIT11_ANTHROPIC_API_KEY: undefined }, io())).toEqual({ problem: expect.stringMatching(/Anthropic/) });
    expect(liveRunPreflight({ ...good, AIRWALLEX_API_KEY: undefined }, io())).toEqual({ problem: expect.stringMatching(/Airwallex/) });
  });
  it("stops on another commit, no clone, or changed tracked files", () => {
    expect(liveRunPreflight(good, io({ head: "0".repeat(40) }))).toEqual({ problem: expect.stringMatching(/clone at 16d59bd, tracked files unchanged: it is at 0000/) });
    expect(liveRunPreflight(good, io({ head: "" }))).toEqual({ problem: expect.stringMatching(/not a git clone/) });
    expect(liveRunPreflight({ ...good, TAP_REF_DIR: undefined }, io())).toEqual({ problem: expect.stringMatching(/TAP_REF_DIR/) });
    expect(liveRunPreflight(good, io({ dirty: " M cdn-proxy/server.js\n" }))).toEqual({ problem: expect.stringMatching(/tracked files unchanged: git status shows changes/) });
  });
  it("never overwrites a run record", () => {
    expect(liveRunPreflight(good, io({ exists: ["docs/runs/visa-tap-live-2026-11-02.json"] }))).toEqual({ problem: expect.stringMatching(/never overwritten/) });
    expect(liveRunPreflight({ ...good, RUN_OUT: "x.json" }, io({ exists: ["x.json"] }))).toEqual({ problem: expect.stringMatching(/x\.json exists/) });
  });

  // The CLI itself, with stand-in key values (nothing is called before these stops): it must run the checks above.
  const cli = (env: Record<string, string>) => spawnSync(process.execPath, ["--import", "tsx", "src/cli/visaTapLive.ts"], {
    encoding: "utf8", timeout: 60_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  const dir = mkdtempSync(join(tmpdir(), "tap-live-cli-"));
  it("CLI: stops without the Anthropic key", () => {
    const r = cli({ KIT11_DB: join(dir, "w.sqlite"), AIRWALLEX_CLIENT_ID: "stand-in", AIRWALLEX_API_KEY: "stand-in" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Anthropic key is not set/);
  }, 60_000); // the CLI is a child process (node + tsx): its start-up alone can pass vitest's 5 s default under a loaded runner
  it("CLI: stops when TAP_REF_DIR is not a clone at 16d59bd, and creates no ledger", () => {
    const r = cli({ KIT11_DB: join(dir, "w.sqlite"), AIRWALLEX_CLIENT_ID: "stand-in", AIRWALLEX_API_KEY: "stand-in", KIT11_ANTHROPIC_API_KEY: "stand-in", TAP_REF_DIR: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/clone at 16d59bd, tracked files unchanged/);
    expect(existsSync(join(dir, "w.sqlite"))).toBe(false);
  }, 60_000);
});
