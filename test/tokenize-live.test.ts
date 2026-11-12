// The live commands of `npm run tokenize` (src/tokenize/live.ts), run here exactly as the CLI runs them, against the
// in-memory chain: fund, preflight, deploy, mint, finance, settle, verify. Nothing is sent twice: a crash between the
// send and the receipt is simulated for every transaction of every step, and the re-run reads the receipt and goes on.
// Both budgets hold before every request; the plan's call counts are the requests the chain counts; the live commands
// never load the in-memory chain. No network.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction, type Address, type Hex } from "viem";
import { GAS, invoiceTokenCalls, standInTokenCalls, txClient, type Request } from "../src/tokenize/client.js";
import { discountedPrice } from "../src/tokenize/flow.js";
import { LIVE_COMMANDS, liveRefusals } from "../src/tokenize/guard.js";
import { createRoleKeys, keyFile, ROLES } from "../src/tokenize/keys.js";
import { openRunLedger } from "../src/tokenize/ledger.js";
import { callLog, runLive, usdzText } from "../src/tokenize/live.js";
import type { LocalChain } from "../src/tokenize/localChain.js";
import { callsNeeded, GAS_ALLOWANCE, PREFLIGHT_MAX_CALLS, STEP_TXS, TX_STEPS, type TxStep } from "../src/tokenize/plan.js";
import { testnetFaceValue } from "../src/tokenize/record.js";
import { standInLedger } from "../src/tokenize/standIn.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { CHAIN_ID } from "../src/metal/network.js";
import { liveWorld } from "./support/tokenizeWorld.js";

const ROOT = resolve(import.meta.dirname, "..");
const FACE = centsToBaseUnits(240), PRICE = centsToBaseUnits(235);
/** The run's eleven transactions, in the order a clean run sends them. */
const ALL_KEYS = TX_STEPS.flatMap((s) => STEP_TXS[s].map((t) => ({ step: s, key: t.key })));

describe("tokenize live: a clean run on the in-memory chain", () => {
  it("funds, deploys, mints, finances, settles and verifies; each command makes exactly the requests the plan counts", async () => {
    const w = await liveWorld();
    const expectNeeded = (step: TxStep | "verify") => callsNeeded(step, w.statusOf);
    const counts: Record<string, number> = {};

    const pre = await w.run("preflight");
    // No keys yet: only the chain id and the donor's balance are read. Not ready, nothing sent.
    expect(pre.code).toBe(1);
    expect(pre.requests).toEqual(["eth_chainId", "eth_call"]);
    expect(pre.text).toMatch(/NOT READY {2}no key yet for issuer, creditor, financier, payer; run `npm run tokenize -- fund`/);
    expect(existsSync(w.env.KIT11_KEYS_DIR!)).toBe(false);

    // At the moment each transaction goes out, the run's ledger already holds its hash and its signed bytes.
    const atSend: { hash: Hex; inLedger: string | undefined }[] = [];
    const watching: Request = async (a) => {
      if (a.method === "eth_sendRawTransaction") {
        const raw = a.params![0] as Hex, hash = keccak256(raw);
        const row = new Database(w.env.TOKENIZE_DB!, { readonly: true }).prepare("SELECT status FROM tokenize_txs WHERE hash = ? AND raw = ?").get(hash, raw) as { status: string } | undefined;
        atSend.push({ hash, inLedger: row?.status });
      }
      return w.chain.request(a);
    };
    for (const step of [...TX_STEPS, "verify" as const]) {
      const need = expectNeeded(step);
      const o = await w.run(step, {}, watching);
      expect({ step, code: o.code, text: o.text }).toMatchObject({ step, code: 0 });
      expect({ step, requests: o.requests.length }).toEqual({ step, requests: need });
      counts[step] = o.requests.length;
    }
    expect(atSend).toHaveLength(11);
    expect(atSend.map((x) => x.inLedger)).toEqual(Array.from({ length: 11 }, () => "signed"));
    expect(atSend.map((x) => x.hash)).toEqual(w.chain.mined.slice(w.baseline));
    // The numbers the runbook and preflight give: 14 for funding at most, 4, 4, 10, 6 and 1.
    expect(counts).toEqual({ fund: 14, deploy: 4, mint: 4, finance: 10, settle: 6, verify: 1 });

    // Eleven transactions on the chain, one per key, each recorded as done.
    expect(w.chain.mined.length - w.baseline).toBe(11);
    const txs = w.txs();
    expect(txs.map((t) => t.key)).toEqual(ALL_KEYS.map((k) => k.key));
    expect(txs.every((t) => t.status === "success" && t.gas_used !== null && t.block !== null)).toBe(true);
    expect(txs.map((t) => t.hash)).toEqual(w.chain.mined.slice(w.baseline));

    // The money: the creditor got the price, the financier (holder) the face value, the payer paid it.
    const g = GAS_ALLOWANCE;
    expect(await w.balance(w.role("creditor").address)).toBe(g + PRICE);
    expect(await w.balance(w.role("financier").address)).toBe(g + FACE);
    expect(await w.balance(w.role("payer").address)).toBe(g);
    expect(await w.balance(w.role("issuer").address)).toBe(g);
    const s = w.state();
    expect(JSON.parse(s.financed!)).toMatchObject({ seller: w.role("creditor").address, financier: w.role("financier").address, price: PRICE.toString() });
    expect(JSON.parse(s.settled!)).toMatchObject({ holder: w.role("financier").address, face_value: FACE.toString() });
    expect(JSON.parse(s.verify!)).toMatchObject({ ok: true, mismatches: [], token_id_is_document_hash: true, settled_on_chain: true });
    expect(s.ref_salt).toBeUndefined(); // the salt of the party references never leaves the ledger

    // The call log: one line per request, each with both counters; its line count is the run's total.
    const log = callLog(w.env.TOKENIZE_CALL_LOG!).lines();
    expect(log).toHaveLength(2 + 14 + 4 + 4 + 10 + 6 + 1);
    expect(log[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z preflight eth_chainId 1\/6 1\/200$/);
    expect(log.at(-1)).toMatch(/ verify eth_call 1\/20 41\/200$/);

    // Every command, run again: nothing is sent, and no request is made for a finished transaction.
    for (const step of TX_STEPS) {
      const again = await w.run(step);
      expect({ step, code: again.code }).toEqual({ step, code: 0 });
      expect(again.requests.filter((m) => m === "eth_sendRawTransaction")).toEqual([]);
      expect(again.requests).toEqual(step === "fund" ? ["eth_call", "eth_call", "eth_call", "eth_call"] : []);
    }
    expect(w.chain.mined.length - w.baseline).toBe(11);
  }, 120_000);

  it("fixed gas (TOKENIZE_GAS=fixed) makes no estimate call: five requests fewer, the same result", async () => {
    const w = await liveWorld();
    const fixed = { TOKENIZE_GAS: "fixed" };
    const counts: Record<string, number> = {};
    for (const step of [...TX_STEPS, "verify" as const]) {
      const need = callsNeeded(step, w.statusOf, { estimate: false });
      const o = await w.run(step, fixed);
      expect({ step, code: o.code, text: o.text }).toMatchObject({ step, code: 0 });
      expect(o.requests).not.toContain("eth_estimateGas");
      expect(o.requests.length).toBe(need);
      counts[step] = o.requests.length;
    }
    expect(counts).toEqual({ fund: 14, deploy: 3, mint: 3, finance: 8, settle: 5, verify: 1 });
    // Every limit is its fixed value.
    const sent: Record<string, bigint> = {};
    for (const t of w.txs()) sent[t.key] = BigInt(t.gas);
    expect(sent).toMatchObject({ deploy: GAS.deploy, mint: GAS.mint, offer: GAS.offer, "financier-approve": GAS.approve, accept: GAS.accept, "payer-approve": GAS.approve, settle: GAS.settle, "fund-issuer": GAS.transfer });
  }, 120_000);
});

describe("tokenize live: fund", () => {
  it("creates the four key files (mode 600, directory 700), prints the plan before anything is sent, and sends each role exactly what it needs", async () => {
    const w = await liveWorld();
    const events: string[] = [];
    const out: string[] = [];
    const code = await runLive("fund", { env: w.env, io: { say: (s) => { out.push(s); events.push(`say:${s.split(" ")[0]}`); }, err: (s) => out.push(s) }, settlement: w.settlement, sleep: async () => {},
      request: async (a) => { events.push(a.method); return w.chain.request(a); } });
    expect({ code, out: out.join("\n") }).toMatchObject({ code: 0 });
    // The keys.
    const dir = w.env.KIT11_KEYS_DIR!;
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir).sort()).toEqual(["creditor.key.json", "financier.key.json", "issuer.key.json", "payer.key.json"]);
    for (const r of ROLES) {
      expect(statSync(keyFile(dir, r)).mode & 0o777).toBe(0o600);
      const k = JSON.parse(readFileSync(keyFile(dir, r), "utf8")) as { address: string; privateKey: Hex };
      expect(Object.keys(k).sort()).toEqual(["address", "privateKey"]);
      expect(privateKeyToAccount(k.privateKey).address).toBe(k.address);
    }
    expect(out.join("\n")).toMatch(/KEYS {5}created issuer, creditor, financier, payer in KIT11_KEYS_DIR \(mode 600\)/);
    // No private key is ever printed.
    for (const r of ROLES) expect(out.join("\n")).not.toContain((JSON.parse(readFileSync(keyFile(dir, r), "utf8")) as { privateKey: string }).privateKey.slice(2));
    // The plan is printed after the four balance reads and before the first send.
    const firstSend = events.indexOf("eth_sendRawTransaction"), lastPlan = events.lastIndexOf("say:PLAN");
    expect(events.slice(0, 4).filter((e) => e === "eth_call")).toHaveLength(0); // the invoice lines come first, offline
    expect(lastPlan).toBeGreaterThan(0);
    expect(lastPlan).toBeLessThan(firstSend);
    expect(events.filter((e) => e === "say:PLAN")).toHaveLength(5);
    expect(out.join("\n")).toMatch(/PLAN {5}4 transfers, 4\.79 \*USDZ in all, from the donor 0x/);
    // Exactly what the run needs: the price and the face value, plus the gas allowance for each role.
    expect(await w.balance(w.role("issuer").address)).toBe(GAS_ALLOWANCE);
    expect(await w.balance(w.role("creditor").address)).toBe(GAS_ALLOWANCE);
    expect(await w.balance(w.role("financier").address)).toBe(PRICE + GAS_ALLOWANCE);
    expect(await w.balance(w.role("payer").address)).toBe(FACE + GAS_ALLOWANCE);
    // Each transfer is a plain call to the token with the limit Purser's working transfers use, and no estimate.
    expect(events).not.toContain("eth_estimateGas");
    expect(w.txs().map((t) => [t.key, t.gas])).toEqual(ROLES.map((r) => [`fund-${r}`, GAS.transfer.toString()]));
  }, 60_000);

  it("is idempotent: a role that already holds enough is skipped after one balance read, and only the short one is topped up", async () => {
    const w = await liveWorld();
    expect((await w.run("fund")).code).toBe(0);
    const again = await w.run("fund");
    expect(again.code).toBe(0);
    expect(again.requests).toEqual(["eth_call", "eth_call", "eth_call", "eth_call"]);
    expect(again.text).toMatch(/issuer {4}0x[0-9a-fA-F]{40} holds 0\.01 \*USDZ: enough, skipped/);
    expect(again.text).toMatch(/financier 0x[0-9a-fA-F]{40} holds 2\.36 \*USDZ: enough, skipped/);
    expect(again.text).not.toMatch(/created/);

    // A second world whose keys were partly funded another way: only what is missing is sent.
    const v = await liveWorld();
    createRoleKeys(v.env.KIT11_KEYS_DIR!);
    const pay = (to: Address, amount: bigint) => standInTokenCalls(v.setup).mint(v.minter, v.settlement, to, amount);
    await pay(v.role("issuer").address, centsToBaseUnits(50));
    await pay(v.role("financier").address, centsToBaseUnits(100));
    const before = v.chain.mined.length;
    const o = await v.run("fund");
    expect(o.code).toBe(0);
    expect(v.chain.mined.length - before).toBe(3);
    expect(v.txs().map((t) => t.key)).toEqual(["fund-creditor", "fund-financier", "fund-payer"]);
    expect(await v.balance(v.role("issuer").address)).toBe(centsToBaseUnits(50));
    expect(await v.balance(v.role("financier").address)).toBe(PRICE + GAS_ALLOWANCE); // topped up to what it needs, not more
    expect(o.requests).toHaveLength(4 + 1 + 1 + 3 * 2);
  }, 60_000);

  it("settles a recorded transfer before it signs a new one from the donor, whatever the order of the roles", async () => {
    const w = await liveWorld();
    // The issuer is funded another way; the creditor's transfer is recorded but never reaches the node.
    createRoleKeys(w.env.KIT11_KEYS_DIR!);
    await standInTokenCalls(w.setup).mint(w.minter, w.settlement, w.role("issuer").address, GAS_ALLOWANCE);
    const lost = failing(w.chain, { nthSend: 1, where: "before-send" });
    const stopped = await w.run("fund", {}, lost.request);
    expect(stopped.code).toBe(3);
    expect(w.txs().map((t) => [t.key, t.status, t.nonce])).toEqual([["fund-creditor", "signed", 0]]);
    // Meanwhile the issuer's money is gone: on the next run it needs a transfer too, and it comes first in the list.
    await invoiceTokenCalls(w.setup).transfer(w.role("issuer"), w.settlement, w.minter.address, GAS_ALLOWANCE, { key: "x", label: "drain" });
    const again = await w.run("fund");
    expect({ code: again.code, text: again.text }).toMatchObject({ code: 0 });
    // The creditor's recorded bytes went out first and landed with their nonce; the new transfers follow it.
    expect(w.txs().map((t) => [t.key, t.status, t.nonce])).toEqual([["fund-creditor", "success", 0], ["fund-issuer", "success", 1], ["fund-financier", "success", 2], ["fund-payer", "success", 3]]);
    expect(w.chain.mined.slice(-4)).toEqual(w.txs().map((t) => t.hash));
    for (const r of ROLES) expect(await w.balance(w.role(r).address)).toBeGreaterThanOrEqual(GAS_ALLOWANCE);
    expect(await w.balance(w.role("creditor").address)).toBe(GAS_ALLOWANCE);
  }, 60_000);

  it("refuses before any transfer when the donor holds too little, the donor is a role key, or the invoice is not approved", async () => {
    const w = await liveWorld();
    // The donor's money moves away first.
    const drain = txClient({ request: w.chain.request, chainId: CHAIN_ID, sleep: async () => {} });
    await invoiceTokenCalls(drain).transfer(w.donor, w.settlement, w.minter.address, centsToBaseUnits(9_900), { key: "x", label: "drain" });
    const before = w.chain.mined.length;
    const poor = await w.run("fund");
    expect(poor.code).toBe(2);
    expect(poor.text).toMatch(/the donor holds 1\.00 \*USDZ; the transfers need 4\.79 plus gas; nothing sent/);
    expect(w.chain.mined.length).toBe(before);

    const v = await liveWorld();
    createRoleKeys(v.env.KIT11_KEYS_DIR!);
    const own = await v.run("fund", { TOKENIZE_DONOR_KEY: keyFile(v.env.KIT11_KEYS_DIR!, "payer") });
    expect(own.code).toBe(2);
    expect(own.text).toMatch(/TOKENIZE_DONOR_KEY is one of the run's own role keys/);
    expect(own.requests).toEqual([]);

    // An invoice nobody approved: refused offline, before a key is made or a request sent.
    const none = await standInLedger({ approve: false });
    const noneDb = join(v.dir, "unapproved.sqlite");
    writeFileSync(noneDb, none.db.serialize());
    const u = await liveWorld();
    const refused = await u.run("fund", { TOKENIZE_SOURCE_DB: noneDb, TOKENIZE_PROPOSAL: none.proposalId });
    expect(refused.code).toBe(2);
    expect(refused.text).toMatch(/not tokenized: P-0001 has no approval/);
    expect(refused.requests).toEqual([]);
    expect(existsSync(u.env.KIT11_KEYS_DIR!)).toBe(false);
  }, 60_000);
});

describe("tokenize live: deploy refuses early when the roles are not funded", () => {
  it("creates no key and makes no request without fund; with keys but no funding it refuses too, until preflight has seen the money", async () => {
    const w = await liveWorld();
    const bare = await w.run("deploy");
    expect(bare.code).toBe(2);
    expect(bare.text).toMatch(/no key for issuer, creditor, financier, payer in KIT11_KEYS_DIR: run `npm run tokenize -- fund` first/);
    expect(bare.requests).toEqual([]);
    expect(existsSync(w.env.KIT11_KEYS_DIR!)).toBe(false); // no key was created
    for (const cmd of ["mint", "finance", "settle"] as const) expect((await w.run(cmd)).requests).toEqual([]);

    createRoleKeys(w.env.KIT11_KEYS_DIR!);
    const unfunded = await w.run("deploy");
    expect(unfunded.code).toBe(2);
    expect(unfunded.text).toMatch(/does not show the four roles funded: run `npm run tokenize -- fund` first/);
    expect(unfunded.requests).toEqual([]);

    // preflight reads the balances: short, so still not funded.
    const short = await w.run("preflight");
    expect(short.code).toBe(1);
    expect(short.text).toMatch(/financier 0x[0-9a-fA-F]{40} holds 0\.00 \*USDZ, needs 2\.36: short; fund sends 2\.36/);
    expect(short.text).toMatch(/payer {5}0x[0-9a-fA-F]{40} holds 0\.00 \*USDZ, needs 2\.41: short; fund sends 2\.41/);
    expect(short.text).toMatch(/DONOR {4}0x[0-9a-fA-F]{40} holds 100\.00 \*USDZ; fund would send 4\.79: ok/);
    expect(short.requests).toHaveLength(PREFLIGHT_MAX_CALLS);
    expect((await w.run("deploy")).code).toBe(2);

    // Funded another way (not by the fund command): preflight sees it and records it, and deploy goes.
    const pay = (to: Address, amount: bigint) => standInTokenCalls(w.setup).mint(w.minter, w.settlement, to, amount);
    for (const r of ROLES) await pay(w.role(r).address, centsToBaseUnits(300));
    const ready = await w.run("preflight");
    expect({ code: ready.code, text: ready.text }).toMatchObject({ code: 0 });
    expect(ready.text).toMatch(/READY {4}the four roles hold what they need and the budget covers the steps still to run; nothing was sent/);
    expect(ready.requests).toEqual(["eth_chainId", "eth_call", "eth_call", "eth_call", "eth_call"]);
    expect((await w.run("deploy")).code).toBe(0);
  }, 60_000);

  it("refuses keys other than the ones this run's ledger recorded", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    const other = join(w.dir, "other-keys");
    createRoleKeys(other);
    const o = await w.run("deploy", { KIT11_KEYS_DIR: other });
    expect(o.code).toBe(2);
    expect(o.text).toMatch(/KIT11_KEYS_DIR holds another key for issuer, creditor, financier, payer than this run's ledger recorded; nothing sent/);
    expect(o.requests).toEqual([]);
  }, 60_000);
});

/** A request that fails once at a chosen point, as a crash or a dropped connection does. */
function failing(chain: LocalChain, at: { nthSend: number; where: "before-send" | "after-send" }) {
  let sends = 0, armed = false, fired = false;
  const request: Request = async (a) => {
    if (a.method === "eth_sendRawTransaction") {
      sends++;
      if (sends === at.nthSend && !fired) {
        if (at.where === "before-send") { fired = true; throw new Error("simulated: the connection dropped before the node got it"); }
        const out = await chain.request(a);
        armed = true;
        return out;
      }
    }
    if (armed && !fired && a.method === "eth_getTransactionReceipt") { fired = true; throw new Error("simulated crash between the send and the receipt"); }
    return chain.request(a);
  };
  return { request, fired: () => fired };
}

describe("tokenize live: nothing is sent twice, and a stopped step resumes", () => {
  for (const [index, { step, key }] of ALL_KEYS.entries()) {
    it(`a crash between the send and the receipt of "${key}" (${step}): the re-run reads its receipt and sends nothing again`, async () => {
      const w = await liveWorld();
      await w.upTo(step);
      const nth = STEP_TXS[step].findIndex((t) => t.key === key) + 1;
      const crash = failing(w.chain, { nthSend: nth, where: "after-send" });
      const stopped = await w.run(step, {}, crash.request);
      expect(crash.fired()).toBe(true);
      expect(stopped.code).not.toBe(0);
      // The transaction is on the chain, and the journal holds its hash, stored before it was sent: no receipt yet.
      const minedBefore = w.chain.mined.length;
      expect(minedBefore - w.baseline).toBe(index + 1);
      expect(w.statusOf(key)).toBe("signed");
      expect(w.txs().at(-1)).toMatchObject({ key, hash: w.chain.mined.at(-1), status: "signed" });

      const again = await w.run(step);
      expect({ code: again.code, text: again.text }).toMatchObject({ code: 0 });
      expect(w.statusOf(key)).toBe("success");
      expect(again.text).toMatch(/recorded earlier; its receipt read now, nothing sent again/);
      // The re-run asked for the recorded transaction's receipt before anything else it did for this step's
      // transactions, and sent only the transactions that come after it.
      const firstTxRequest = again.requests.filter((m) => m !== "eth_call")[0];
      expect(firstTxRequest).toBe("eth_getTransactionReceipt");
      const after = STEP_TXS[step].length - nth;
      expect(again.requests.filter((m) => m === "eth_sendRawTransaction")).toHaveLength(after);
      expect(w.chain.mined.length - minedBefore).toBe(after);

      // The rest of the run, to the end: eleven transactions in all, one per key, and the chain record verifies.
      for (const s of [...TX_STEPS.slice(TX_STEPS.indexOf(step) + 1), "verify" as const]) expect({ s, code: (await w.run(s)).code }).toEqual({ s, code: 0 });
      expect(w.chain.mined.length - w.baseline).toBe(11);
      expect(w.txs().map((t) => [t.key, t.status])).toEqual(ALL_KEYS.map((k) => [k.key, "success"]));
      expect(w.txs().map((t) => t.hash)).toEqual(w.chain.mined.slice(w.baseline));
    }, 60_000);
  }

  it("deploy can never deploy a second contract for the same run ledger, however often it is run or stopped", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    const crash = failing(w.chain, { nthSend: 1, where: "after-send" });
    expect((await w.run("deploy", {}, crash.request)).code).not.toBe(0);
    const deployed = () => w.chain.mined.length - w.baseline - 4;
    expect(deployed()).toBe(1);
    expect(w.state().contract).toBeUndefined(); // stopped before the address was known
    for (let i = 0; i < 3; i++) {
      const o = await w.run("deploy");
      expect(o.code).toBe(0);
      expect(o.requests.filter((m) => m === "eth_sendRawTransaction")).toEqual([]);
      expect(deployed()).toBe(1);
    }
    const contract = w.state().contract!;
    const receipt = (await w.chain.request({ method: "eth_getTransactionReceipt", params: [w.txs().find((t) => t.key === "deploy")!.hash] })) as { contractAddress: string };
    expect(contract).toBe(receipt.contractAddress);
    expect(w.txs().filter((t) => t.key === "deploy")).toHaveLength(1);
  }, 60_000);

  it("finance run again after its first transaction landed continues with the next one", async () => {
    const w = await liveWorld();
    await w.upTo("finance");
    // The offer lands, but its receipt takes five reads; that uses up the command's budget before the approve is signed.
    let empty = 4;
    const stopped = await w.run("finance", { TOKENIZE_CALL_BUDGET: "10" }, async (a) => {
      if (a.method === "eth_getTransactionReceipt" && empty > 0) { empty--; await w.chain.request(a); return null; }
      return w.chain.request(a);
    });
    expect(stopped.code).toBe(3);
    expect(stopped.text).toMatch(/STOPPED {2}the financier allows the token contract to take the price: fewer than two requests left in the budget \(the send and one receipt read\); nothing signed, nothing sent/);
    expect(stopped.requests).toEqual(["eth_estimateGas", "eth_getTransactionCount", "eth_sendRawTransaction", ...Array.from({ length: 5 }, () => "eth_getTransactionReceipt"), "eth_getTransactionCount"]);
    expect(w.statusOf("offer")).toBe("success");
    expect(w.statusOf("financier-approve")).toBeUndefined(); // never signed
    const mined = w.chain.mined.length;

    const again = await w.run("finance");
    expect({ code: again.code, text: again.text }).toMatchObject({ code: 0 });
    // Nothing for the offer: straight on to the approve and the accept.
    expect(again.requests).toEqual(["eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_estimateGas", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    expect(again.text).toMatch(/done {5}offer the token to the financier .*finished earlier; nothing sent/);
    expect(w.chain.mined.length - mined).toBe(2);
    expect(w.txs().filter((t) => ["offer", "financier-approve", "accept"].includes(t.key)).map((t) => [t.key, t.status])).toEqual([["offer", "success"], ["financier-approve", "success"], ["accept", "success"]]);
    expect(await w.balance(w.role("creditor").address)).toBe(GAS_ALLOWANCE + PRICE);
  }, 60_000);

  it("a transaction that was recorded but never reached the node is sent again as the very same bytes, once", async () => {
    const w = await liveWorld();
    await w.upTo("mint");
    const lost = failing(w.chain, { nthSend: 1, where: "before-send" });
    const stopped = await w.run("mint", {}, lost.request);
    expect(stopped.code).toBe(3);
    expect(stopped.text).toMatch(/STOPPED {2}mint the invoice token 0x[0-9a-f]{64}: no receipt yet \(the send failed: simulated: the connection dropped before the node got it\)\. It is recorded; run the command again/);
    const recorded = w.txs().at(-1)!;
    expect(recorded).toMatchObject({ key: "mint", status: "signed" });
    expect(w.chain.mined).not.toContain(recorded.hash);

    const sentRaw: Hex[] = [];
    const again = await w.run("mint", {}, async (a) => { if (a.method === "eth_sendRawTransaction") sentRaw.push(a.params![0] as Hex); return w.chain.request(a); });
    expect({ code: again.code, text: again.text }).toMatchObject({ code: 0 });
    // The receipt was asked first; there was none, so the same signed bytes went out: same hash, same nonce.
    expect(again.requests).toEqual(["eth_getTransactionReceipt", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    expect(sentRaw).toHaveLength(1);
    const raw = new Database(w.env.TOKENIZE_DB!, { readonly: true }).prepare("SELECT raw FROM tokenize_txs WHERE key = 'mint'").get() as { raw: Hex };
    expect(sentRaw[0]).toBe(raw.raw);
    expect(w.chain.mined.at(-1)).toBe(recorded.hash);
    expect(w.txs().filter((t) => t.key === "mint")).toHaveLength(1);
    expect(parseTransaction(sentRaw[0] as `0x02${string}`).nonce).toBe(recorded.nonce);
    // Sending the same bytes a third time changes nothing: the chain refuses a used nonce.
    await expect(w.chain.request({ method: "eth_sendRawTransaction", params: [sentRaw[0]] })).rejects.toThrow(/nonce too low/);
  }, 60_000);

  it("a receipt that is not there yet stops the step (exit 3) without a second send; the next run finds it", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    let hide = true;
    const slow: Request = async (a) => (a.method === "eth_getTransactionReceipt" && hide ? (await w.chain.request(a), null) : w.chain.request(a));
    const stopped = await w.run("deploy", {}, slow);
    expect(stopped.code).toBe(3);
    expect(stopped.text).toMatch(/deploy PurserInvoiceToken 0x[0-9a-f]{64}: no receipt yet\. It is recorded; run the command again: it reads the receipt first and sends nothing new/);
    expect(stopped.requests.filter((m) => m === "eth_getTransactionReceipt")).toHaveLength(6); // six polls, one read each
    // Still hidden on the next run: the same bytes are offered again (the chain already has them), and it stops again.
    const still = await w.run("deploy", {}, slow);
    expect(still.code).toBe(3);
    expect(still.text).toMatch(/sending the same signed bytes again, the node said: nonce too low/);
    hide = false;
    const found = await w.run("deploy");
    expect(found.code).toBe(0);
    expect(found.requests).toEqual(["eth_getTransactionReceipt"]);
    expect(w.txs().filter((t) => t.key === "deploy")).toHaveLength(1);
    expect(w.chain.mined.length - w.baseline).toBe(5);
  }, 60_000);

  it("a transaction that reverted on chain is not sent again, unless the operator says so", async () => {
    const w = await liveWorld();
    await w.upTo("finance");
    // The financier's money is gone, and with fixed gas there is no estimate to refuse the accept beforehand.
    const financier = w.role("financier");
    await invoiceTokenCalls(w.setup).transfer(financier, w.settlement, w.minter.address, PRICE, { key: "x", label: "drain" });
    const reverted = await w.run("finance", { TOKENIZE_GAS: "fixed" });
    expect(reverted.code).toBe(1);
    expect(reverted.text).toMatch(/FAILED {3}the financier pays the advance and takes the token reverted on chain: https:\/\/testnet\.metalntwx\.com\/tx\/0x[0-9a-f]{64}\. Nothing is sent again for it unless TOKENIZE_RESEND_REVERTED=yes/);
    expect(w.statusOf("accept")).toBe("reverted");
    const mined = w.chain.mined.length;
    const refused = await w.run("finance", { TOKENIZE_GAS: "fixed" });
    expect(refused.code).toBe(1);
    expect(refused.requests).toEqual([]);
    expect(w.chain.mined.length).toBe(mined);
    // The money is back and the operator decides to send it again: a new transaction, the old one stays in the record.
    await standInTokenCalls(w.setup).mint(w.minter, w.settlement, financier.address, PRICE);
    // The plan counts the estimate a resend asks: 4 calls (the estimate, the nonce, the send, the receipt), fixed gas or not.
    expect(callsNeeded("finance", w.statusOf, { estimate: false })).toBe(4);
    const resent = await w.run("finance", { TOKENIZE_GAS: "fixed", TOKENIZE_RESEND_REVERTED: "yes" });
    expect({ code: resent.code, text: resent.text }).toMatchObject({ code: 0 });
    expect(resent.requests).toEqual(["eth_estimateGas", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    expect(w.txs().filter((t) => t.key === "accept").map((t) => t.status)).toEqual(["reverted", "success"]);
  }, 60_000);

  it("with the estimate, a call the chain would refuse stops before anything is signed (exit 2)", async () => {
    const w = await liveWorld();
    await w.upTo("finance");
    const financier = w.role("financier");
    await invoiceTokenCalls(w.setup).transfer(financier, w.settlement, w.minter.address, PRICE, { key: "x", label: "drain" });
    const mined = w.chain.mined.length;
    const o = await w.run("finance");
    expect(o.code).toBe(2);
    expect(o.text).toMatch(/REFUSED {2}the financier pays the advance and takes the token: the chain would refuse it \(reverted\); nothing signed, nothing sent/);
    expect(w.statusOf("accept")).toBeUndefined();
    expect(w.chain.mined.length - mined).toBe(2); // the offer and the approve landed; the accept was never signed
  }, 60_000);
});

describe("tokenize live: budgets", () => {
  it("refuses a step before its first request when the command's budget cannot cover the least it needs", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    const o = await w.run("deploy", { TOKENIZE_CALL_BUDGET: "3" });
    expect(o.code).toBe(2);
    expect(o.text).toMatch(/deploy needs at least 4 more Metal RPC calls and the budgets allow 3 .*nothing sent/);
    expect(o.requests).toEqual([]);
    expect(w.statusOf("deploy")).toBeUndefined();
  }, 60_000);

  it("holds the whole run's budget across commands: the call log's total stops the next command", async () => {
    const w = await liveWorld();
    expect((await w.run("fund", { TOKENIZE_CALL_BUDGET_TOTAL: "14" })).code).toBe(0);
    expect(callLog(w.env.TOKENIZE_CALL_LOG!).count()).toBe(14);
    const o = await w.run("deploy", { TOKENIZE_CALL_BUDGET_TOTAL: "17" });
    expect(o.code).toBe(2);
    expect(o.text).toMatch(/deploy needs at least 4 more Metal RPC calls and the budgets allow 3/);
    expect(o.requests).toEqual([]);
    // With room for exactly the least it needs, it runs, and the log stands at the total.
    const ok = await w.run("deploy", { TOKENIZE_CALL_BUDGET_TOTAL: "18" });
    expect(ok.code).toBe(0);
    expect(callLog(w.env.TOKENIZE_CALL_LOG!).count()).toBe(18);
    expect(ok.text).toMatch(/\(4 Metal RPC calls in this command; 18 of 18 in the call log\)/);
    const none = await w.run("mint", { TOKENIZE_CALL_BUDGET_TOTAL: "18" });
    expect(none.code).toBe(2);
    expect(none.requests).toEqual([]);
  }, 60_000);

  it("signs a transaction only when the send and one receipt read still fit: a budget used up meanwhile leaves nothing signed", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    const log = w.env.TOKENIZE_CALL_LOG!;
    const total = callLog(log).count() + 4;
    // Another command of the same run logs two requests while this one is estimating.
    const o = await w.run("deploy", { TOKENIZE_CALL_BUDGET_TOTAL: String(total) }, async (a) => {
      if (a.method === "eth_estimateGas") { callLog(log).append("2026-11-12T00:00:00.000Z other eth_call 1/1 0/0"); callLog(log).append("2026-11-12T00:00:00.000Z other eth_call 1/1 0/0"); }
      return w.chain.request(a);
    });
    expect(o.code).toBe(3);
    expect(o.text).toMatch(/STOPPED {2}.*(budget|fewer than two requests left)/);
    expect(w.statusOf("deploy")).toBeUndefined();
    expect(o.requests).not.toContain("eth_sendRawTransaction");
    expect(w.chain.mined.length - w.baseline).toBe(4);
  }, 60_000);
});

describe("tokenize live: preflight", () => {
  it("asks the chain id for real, makes at most six reads whatever the budget, and never sends", async () => {
    const w = await liveWorld();
    createRoleKeys(w.env.KIT11_KEYS_DIR!);
    const o = await w.run("preflight", { TOKENIZE_CALL_BUDGET: "50" });
    expect(o.requests).toEqual(["eth_chainId", "eth_call", "eth_call", "eth_call", "eth_call", "eth_call"]);
    expect(o.requests.length).toBe(PREFLIGHT_MAX_CALLS);
    expect(callLog(w.env.TOKENIZE_CALL_LOG!).lines().every((l) => / preflight \S+ \d\/6 /.test(l))).toBe(true);
    expect(w.chain.mined.length).toBe(w.baseline);
    // The offline part: the invoice as the mint will check it, the amounts, and the calls each step needs.
    expect(o.text).toMatch(/INVOICE {2}P-0001 \(invoice_payment\) SLL-2026-11B EUR 240\.00: approved by passkey [0-9A-F]{4}(-[0-9A-F]{4}){3} on \d{4}-\d\d-\d\dT[\d:.]+Z; signed terms [0-9a-f]{12}…/);
    expect(o.text).toMatch(/DOCUMENT its SHA-256 [0-9a-f]{12}… is the one in the signed terms/);
    expect(o.text).toMatch(/AMOUNTS {2}face value 2\.40 \*USDZ \(EUR 240\.00 ÷ 100; test money, no exchange rate\); price 2\.35 \*USDZ \(2% discount\); the financier is simulated/);
    expect(o.text).toMatch(/CHAIN {4}id 63825: Metal testnet/);
    for (const [step, n] of [["fund", "at most 14"], ["deploy", "at least 4"], ["mint", "at least 4"], ["finance", "at least 10"], ["settle", "at least 6"], ["verify", "at least 1"]]) expect(o.text).toMatch(new RegExp(`PLAN {5}${step} +${n} calls`));
    expect(o.text).toMatch(/PLAN {5}total {4}39 calls still to make when every receipt is there on its first read; 6 in the call log; TOKENIZE_CALL_BUDGET_TOTAL 200 leaves 194: enough/);
    // A budget below six still holds.
    const tight = await w.run("preflight", { TOKENIZE_CALL_BUDGET: "2" });
    expect(tight.code).toBe(3);
    expect(tight.requests).toEqual(["eth_chainId", "eth_call"]);
  }, 60_000);

  it("stops on the wrong chain, and refuses offline (no request at all) when the document or the approval is not right", async () => {
    const w = await liveWorld();
    const wrong = await w.run("preflight", {}, async (a) => (a.method === "eth_chainId" ? "0x1" : w.chain.request(a)));
    expect(wrong.code).toBe(1);
    expect(wrong.text).toMatch(/the RPC answers for chain 1, not Metal testnet \(63825\)/);
    expect(wrong.requests).toEqual(["eth_chainId"]);

    const changed = join(w.dir, "changed.txt");
    writeFileSync(changed, readFileSync(w.env.TOKENIZE_DOCUMENT!, "utf8").replace("EUR 240.00", "EUR 2400.00"));
    const doc = await w.run("preflight", { TOKENIZE_DOCUMENT: changed });
    expect(doc.code).toBe(2);
    expect(doc.text).toMatch(/not tokenized: the document is not the one the CFO approved/);
    expect(doc.requests).toEqual([]);

    // The source ledger's approval made by something other than a passkey.
    const cli = join(w.dir, "cli.sqlite");
    writeFileSync(cli, readFileSync(w.source.file));
    new Database(cli).prepare("UPDATE approvals SET method = 'cli'").run();
    const notPasskey = await w.run("preflight", { TOKENIZE_SOURCE_DB: cli });
    expect(notPasskey.code).toBe(2);
    expect(notPasskey.text).toMatch(/was approved by cli, not by a passkey/);
    expect(notPasskey.requests).toEqual([]);
    const missing = await w.run("preflight", { TOKENIZE_SOURCE_DB: join(w.dir, "no-such.sqlite") });
    expect(missing.code).toBe(2);
    expect(missing.requests).toEqual([]);
  }, 60_000);

  it("says NOT READY when the whole run's budget does not cover the steps still to run", async () => {
    const w = await liveWorld();
    await w.upTo("deploy");
    const used = callLog(w.env.TOKENIZE_CALL_LOG!).count();
    const o = await w.run("preflight", { TOKENIZE_CALL_BUDGET_TOTAL: String(used + 5 + 24) });
    expect(o.code).toBe(1);
    expect(o.text).toMatch(/PLAN {5}fund {5}done/);
    expect(o.text).toMatch(/leaves 24: NOT enough/);
    expect(o.text).toMatch(/NOT READY {2}the four roles hold what they need, but TOKENIZE_CALL_BUDGET_TOTAL does not cover the steps still to run/);
    expect((await w.run("preflight", { TOKENIZE_CALL_BUDGET_TOTAL: String(used + 10 + 25) })).code).toBe(0);
  }, 60_000);
});

describe("tokenize live: the guards, the checks before a mint, and verify", () => {
  it("refuses every live command without its settings, before a ledger is made or a request sent", async () => {
    const w = await liveWorld();
    for (const cmd of LIVE_COMMANDS) {
      for (const drop of ["TOKENIZE_GO", "TOKENIZE_CALL_BUDGET", "TOKENIZE_CALL_BUDGET_TOTAL", "TOKENIZE_CALL_LOG", "TOKENIZE_DB", "METAL_RPC_URL"]) {
        const o = await w.run(cmd, { [drop]: undefined });
        expect({ cmd, drop, code: o.code }).toEqual({ cmd, drop, code: 2 });
        expect(o.errs.join("\n")).toContain(drop);
        expect(o.requests).toEqual([]);
      }
    }
    expect(existsSync(w.env.TOKENIZE_DB!)).toBe(false);
    expect(existsSync(w.env.TOKENIZE_CALL_LOG!)).toBe(false);
    // Keys inside the repository are refused.
    const inside = await w.run("fund", { KIT11_KEYS_DIR: join(ROOT, "test-results", "keys") });
    expect(inside.code).toBe(2);
    expect(inside.text).toMatch(/KIT11_KEYS_DIR must be outside the code repository/);
    expect(existsSync(join(ROOT, "test-results", "keys"))).toBe(false);
  }, 60_000);

  it("mint refuses other inputs once a mint is recorded, and the steps refuse to run out of order", async () => {
    const w = await liveWorld();
    await w.upTo("mint");
    for (const cmd of ["finance", "settle", "verify"] as const) {
      const o = await w.run(cmd);
      expect({ cmd, code: o.code }).toEqual({ cmd, code: 2 });
      expect(o.text).toMatch(/no token yet: run mint first/);
      expect(o.requests).toEqual([]);
    }
    const crash = failing(w.chain, { nthSend: 1, where: "after-send" });
    await w.run("mint", {}, crash.request);
    const other = await w.run("mint", { TOKENIZE_DEBTOR: "Another Company" });
    expect(other.code).toBe(2);
    expect(other.text).toMatch(/differ from the mint this ledger already recorded; nothing sent/);
    expect(other.requests).toEqual([]);
    expect((await w.run("mint")).code).toBe(0);
    // The same invoice a second time, from another ledger on the same contract: the chain itself refuses.
    const second = { TOKENIZE_DB: join(w.dir, "tokenize-second.sqlite") };
    const l1 = openRunLedger(w.env.TOKENIZE_DB!, { readonly: true });
    const l2 = openRunLedger(second.TOKENIZE_DB);
    for (const k of ["roles", "funding", "contract"]) l2.put(k, l1.get(k)!);
    l1.close(); l2.close();
    const dup = await w.run("mint", second);
    expect(dup.code).toBe(2);
    expect(dup.text).toMatch(/mint the invoice token: the chain would refuse it \(AlreadyTokenized\); nothing signed, nothing sent/);
  }, 60_000);

  it("verify reads the chain once and names every field that differs", async () => {
    const w = await liveWorld();
    await w.upTo("verify");
    const ok = await w.run("verify");
    expect(ok.code).toBe(0);
    expect(ok.requests).toEqual(["eth_call"]);
    expect(ok.text).toMatch(/VERIFIED token id = document hash; the chain record matches the ledger and the document; the chain marks it settled/);
    // verify uses no key: it runs without the keys directory.
    expect((await w.run("verify", { KIT11_KEYS_DIR: undefined })).code).toBe(0);
    const bad = await w.run("verify", { TOKENIZE_DEBTOR: "Another Company" });
    expect(bad.code).toBe(1);
    expect(bad.text).toMatch(/MISMATCH debtorRef: chain 0x[0-9a-f]{64}, ledger 0x[0-9a-f]{64}/);
    expect(JSON.parse(w.state().verify!)).toMatchObject({ ok: false });
  }, 60_000);
});

describe("the live run's runbook (docs/runs/driver/tokenize-runbook.md)", () => {
  const runbook = () => readFileSync(join(ROOT, "docs/runs/driver/tokenize-runbook.md"), "utf8");
  const fresh = (step: TxStep | "verify", estimate = true) => callsNeeded(step, () => undefined, { estimate });

  it("gives each command's calls as the plan counts them, in the order of the run", () => {
    const rows = [...runbook().matchAll(/^\| \d+ \| `npm run tokenize -- (\w+)` \| (?:at most )?(\d+) \|/gm)].map((m) => [m[1], Number(m[2])]);
    // preflight makes 2 reads before fund (the chain id, the donor's balance) and 5 after (the chain id, four balances):
    // the tests above count both.
    expect(rows).toEqual([["preflight", 2], ["fund", fresh("fund")], ["preflight", 5], ["deploy", fresh("deploy")], ["mint", fresh("mint")], ["finance", fresh("finance")], ["settle", fresh("settle")], ["verify", fresh("verify")], ["record", 0]]);
    const all = [...TX_STEPS, "verify" as const];
    const steps = all.reduce((n, s) => n + fresh(s), 0), fixed = all.reduce((n, s) => n + fresh(s, false), 0);
    expect(runbook()).toContain(`Steps 2 and 4 to 8 need ${steps} calls; with both preflights the run needs ${steps + 2 + 5}.`);
    expect(runbook()).toContain(`skips the five estimates and\n  uses the fixed limits (the run then needs ${fixed} calls for steps 2 and 4 to 8)`);
    expect(steps - fixed).toBe(all.flatMap((s) => (s === "verify" ? [] : STEP_TXS[s])).filter((t) => t.estimate).length);
    // The amounts it expects for the invoice of the run: computed, not typed.
    const face = testnetFaceValue(24_000, 100);
    expect(runbook()).toContain(`EUR 240.00 divided by 100 is ${usdzText(face)} *USDZ; less 2% is ${usdzText(discountedPrice(face, 200))}.`);
    expect(runbook()).toContain(`face value ${usdzText(face)} *USDZ`);
    expect(runbook()).toContain(`paid ${usdzText(discountedPrice(face, 200))} *USDZ to the creditor`);
  });

  it("names every variable the guards ask for and never a value, and says what each command prints", async () => {
    const text = runbook();
    for (const cmd of LIVE_COMMANDS) for (const why of liveRefusals(cmd, {})) expect({ why, named: text.includes(/[A-Z][A-Z0-9_]{5,}/.exec(why)![0]) }).toEqual({ why, named: true });
    for (const name of ["TOKENIZE_DONOR_KEY", "TOKENIZE_GAS", "TOKENIZE_POLL_MS", "TOKENIZE_RESEND_REVERTED", "TOKENIZE_GO_NOTE", "TOKENIZE_DEVIATIONS", "TOKENIZE_APPROVAL_RECORD", "TOKENIZE_DIVISOR", "TOKENIZE_DISCOUNT_BPS", "TOKENIZE_DEBTOR", "NODE_USE_ENV_PROXY"]) expect(text).toContain(`\`${name}\``);
    // Names only: no NAME=value, no RPC address, no key, no wallet address.
    expect(text).not.toMatch(/[A-Z][A-Z0-9_]{5,}=/);
    expect(text).not.toMatch(/https?:\/\/(?!testnet\.metalntwx\.com\/tx\/0x…)/);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{8,}/);
    // The words each command ends with are the words the commands print.
    const live = readFileSync(join(ROOT, "src/tokenize/live.ts"), "utf8") + readFileSync(join(ROOT, "src/cli/tokenize.ts"), "utf8") + readFileSync(join(ROOT, "src/tokenize/standInRun.ts"), "utf8");
    for (const word of ["STAND-IN ", "NOT READY  ", "FUNDED   issuer ", "READY    the four roles hold what they need and the budget covers the steps still to run; nothing was sent", "DEPLOYED PurserInvoiceToken ", "MINTED   token ", "FINANCED the simulated financier ", "SETTLED  the debtor's wallet paid ", "VERIFIED token id = document hash; the chain record matches the ledger and the document", "RECORDED "]) {
      expect({ word, inCode: live.includes(word) }).toEqual({ word, inCode: true });
      expect({ word, inRunbook: text.includes(word.trim().split("  ")[0]!) }).toEqual({ word, inRunbook: true });
    }
    for (const code of ["REFUSED", "STOPPED", "FAILED"]) { expect(text).toContain(`\`${code}\``); expect(live).toContain(`${code}  `); }
    // One page, and its link resolves.
    expect(text.split("\n").length).toBeLessThanOrEqual(80);
    expect(existsSync(resolve(ROOT, "docs/runs/driver", "../../tokenize.md"))).toBe(true);
    expect(text).toContain("](../../tokenize.md)");
  });
});

describe("tokenize: the live commands never load the in-memory chain", () => {
  /** Every module a file loads when it is imported: its static imports, followed through src/. */
  function staticImports(entry: string, seen = new Map<string, string[]>()): Map<string, string[]> {
    if (seen.has(entry)) return seen;
    const src = readFileSync(entry, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const specs = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["']([^"']+)["']/gm), ...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
    seen.set(entry, specs);
    for (const s of specs) {
      const file = resolve(dirname(entry), s.replace(/\.js$/, ".ts"));
      if (s.startsWith(".") && existsSync(file)) staticImports(file, seen);
    }
    return seen;
  }

  it("src/cli/tokenize.ts and the live path import neither @ethereumjs nor the chain statically; only stand-in does, behind a dynamic import", () => {
    for (const entry of ["src/cli/tokenize.ts", "src/tokenize/live.ts", "src/tokenize/runRecord.ts"]) {
      const graph = staticImports(join(ROOT, entry));
      expect(graph.size).toBeGreaterThan(3);
      for (const [file, specs] of graph) {
        expect({ file: file.slice(ROOT.length + 1), ethereumjs: specs.filter((s) => s.startsWith("@ethereumjs")) }).toEqual({ file: file.slice(ROOT.length + 1), ethereumjs: [] });
        expect(file.endsWith("localChain.ts") || file.endsWith("standInRun.ts") || file.endsWith("standIn.ts")).toBe(false);
      }
    }
    // The chain is real and does import @ethereumjs: the walk above would have found it.
    expect([...staticImports(join(ROOT, "src/tokenize/standInRun.ts")).values()].flat().some((s) => s.startsWith("@ethereumjs"))).toBe(true);
    const cli = readFileSync(join(ROOT, "src/cli/tokenize.ts"), "utf8");
    expect(cli).toMatch(/if \(cmd === "stand-in"\) \{[\s\S]*?await import\("\.\.\/tokenize\/standInRun\.js"\)/);
    expect(cli).not.toMatch(/localChain|@ethereumjs/);
    // @ethereumjs stays a dev dependency: a production install runs the live commands without it.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith("@ethereumjs"))).toEqual([]);
    expect(Object.keys(pkg.devDependencies).filter((d) => d.startsWith("@ethereumjs")).sort()).toEqual(["@ethereumjs/common", "@ethereumjs/evm", "@ethereumjs/util"]);
  });
});
