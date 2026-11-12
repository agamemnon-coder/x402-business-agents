// npm run owners, the flow of a live Face ID run, against an in-process chain. Breaks if the flow needs a
// bootstrapped world again; if setup sends anything beyond its own three transactions or makes a call a second time;
// if funding from a named donor key is more than one counted transfer each; if a re-run after a stop sends twice; if
// preflight sends anything, reads more than three times or prints a number the code does not follow; if a revoke is
// proposed for anything but the mandate this world bound; or if a payment over the cap could be paid, or is paid twice.
// Software passkeys, a stand-in chain and a stand-in for the CLI's network commands; the CLI's offline commands are real.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mandateBindingAbi } from "@metalntwx/metal-pay/mandates";
import { centsToBaseUnits } from "../src/lib/money.js";
import { approvalHashOf, checkOwnersTerms, OWNER_CALL_SELECTORS, type OwnersExecuteTerms } from "../src/metal/ownersExecute.js";
import { OwnersBudgetSpent, readOwnersCalls } from "../src/metal/ownersBudget.js";
import { ACCOUNT_CENTS, AGENT_KEY, callsLine, cliCommand, ownersPlan, pay, planTotals, preflight, preflightRefusals, propose, proposeRevoke, setup, SPONSOR_CENTS, status } from "../src/metal/ownersFlow.js";
import { ACCOUNT_FACTORY, PASSKEY_VERIFIER } from "../src/metal/passkeyRelay.js";
import { keptPullDir } from "../src/metal/pull.js";
import { USDZ } from "../src/metal/network.js";
import { ownersWorld, T0, type TestWorld } from "./support/ownersWorld.js";

// A proposal's credential is made by the real pinned CLI (offline), a child process each time: slow on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });
const REPO = resolve(import.meta.dirname, "..");
let w: TestWorld;
afterEach(() => w?.close());
/** A world whose chain already has the WebAuthn verifier, as Metal testnet has. */
async function world(o: Parameters<typeof ownersWorld>[0] = {}): Promise<TestWorld> {
  w = await ownersWorld(o);
  w.node.code.set(PASSKEY_VERIFIER.toLowerCase(), "0x60");
  return w;
}
const events = (name: string): ({ subject: string } & Record<string, unknown>)[] => (w.db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(name) as { subject: string; payload_json: string }[]).map((r) => ({ ...(JSON.parse(r.payload_json) as Record<string, unknown>), subject: r.subject }));
const keyAddress = (file: string) => (JSON.parse(readFileSync(join(w.keys, file), "utf8")) as { address: Address }).address;
const balance = (a: string) => w.node.balances.get(a.toLowerCase()) ?? 0n;
/** Setup, a bind proposed, signed by both passkeys and relayed: the mandate is bound. */
async function bound(): Promise<{ id: string; terms: OwnersExecuteTerms; account: Address }> {
  const { account } = await setup(w.d);
  const { proposal, terms } = await propose(w.again());
  await w.signBoth(proposal.proposal_id);
  await w.relay(proposal.proposal_id);
  return { id: proposal.proposal_id, terms, account };
}

describe("owners setup in a fresh world (no npm run bootstrap)", () => {
  it("makes the keys it needs itself, sends its own three transactions and nothing else, and needs no ledger of a bootstrapped world", async () => {
    await world();
    const before = readdirSync(w.keys);
    const r = await setup(w.d);
    // The sponsor's key, the payee's and the Sourcing agent's mandate key: key files in the keys folder, owner-readable only.
    expect(before.filter((f) => f.endsWith(".json"))).toEqual([]);
    for (const f of ["passkey-sponsor.key.json", "supplier.key.json", AGENT_KEY]) {
      expect(existsSync(join(w.keys, f)), f).toBe(true);
      expect(statSync(join(w.keys, f)).mode & 0o077, f).toBe(0);
    }
    expect((JSON.parse(readFileSync(join(w.keys, AGENT_KEY), "utf8")) as { publicJwk: { crv: string } }).publicJwk.crv).toBe("P-256");
    expect(w.keys.startsWith(REPO)).toBe(false);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM metal_accounts").get()).toEqual({ n: 0 });
    // Three transactions: the donor funds the sponsor, the sponsor creates the account, the donor funds the account.
    const sponsor = keyAddress("passkey-sponsor.key.json");
    expect(w.node.sent().map((t) => [t.from.toLowerCase(), t.to.toLowerCase()])).toEqual([
      [w.donor.address.toLowerCase(), USDZ.toLowerCase()], [sponsor.toLowerCase(), ACCOUNT_FACTORY.toLowerCase()], [w.donor.address.toLowerCase(), USDZ.toLowerCase()],
    ]);
    expect(w.node.code.has(r.account.toLowerCase())).toBe(true);
    expect(balance(sponsor)).toBe(centsToBaseUnits(SPONSOR_CENTS));
    expect(balance(r.account)).toBe(centsToBaseUnits(ACCOUNT_CENTS));
    expect(balance(w.donor.address)).toBe(centsToBaseUnits(9900 - SPONSOR_CENTS - ACCOUNT_CENTS));
    expect(w.cliRuns).toEqual([]);
    expect(events("owners.account_created")).toEqual([expect.objectContaining({ account: r.account, owners: ["controller", "max"], threshold: "2", tx: r.created, sponsor, payee: keyAddress("supplier.key.json"), funded: { sponsor: expect.stringMatching(/^0x/), account: expect.stringMatching(/^0x/) } })]);
    expect(w.said.join("\n")).toMatch(/threshold 2; no server key is an owner/);
  });

  it("funds from the named donor key with one counted transfer each: thirteen calls in all, each in the log", async () => {
    await world();
    await setup(w.d);
    expect(w.calls()).toEqual([
      "setup:eth_getCode",
      "setup:eth_getTransactionCount", "setup:eth_sendRawTransaction", "setup:eth_getTransactionReceipt",
      "setup:eth_call", "setup:eth_getCode",
      "setup:eth_estimateGas", "setup:eth_getTransactionCount", "setup:eth_sendRawTransaction", "setup:eth_getTransactionReceipt",
      "setup:eth_getTransactionCount", "setup:eth_sendRawTransaction", "setup:eth_getTransactionReceipt",
    ]);
    expect(w.node.methods()).toEqual(w.calls().map((c) => c.split(":")[1]));
    expect(events("owners.tx_sent").map((e) => String(e.subject).split(":").slice(0, 2).join(":"))).toEqual(["setup:fund-sponsor", "setup:create-account", "setup:fund-account"]);
  });

  it("run again, it costs no call and sends nothing", async () => {
    await world();
    const first = await setup(w.d);
    const calls = readOwnersCalls(w.log).length;
    const second = await setup(w.again());
    expect(second).toEqual({ account: first.account, created: null, existed: true });
    expect(readOwnersCalls(w.log).length).toBe(calls);
    expect(w.node.sent()).toHaveLength(3);
    expect(w.said.at(-1)).toMatch(/\(existed\)$/);
  });

  it("stopped after the account's creation was sent, the next run carries on from the recorded hash and sends each transaction once", async () => {
    await world();
    let sends = 0;
    const flaky = w.again();
    const rpc = w.node.rpc;
    // The answer to the second send (the creation) is lost: the node has the transaction, this run does not know.
    w.node.rpc = async (a) => { if (a.method === "eth_sendRawTransaction" && ++sends === 2) w.node.state.sendFault = "lose-answer"; return rpc(a); };
    const d = { ...flaky, chain: (await import("../src/metal/ownersChain.js")).ownersChain({ budget: flaky.chain.budget, rpc: (a) => w.node.rpc(a), sleep: async () => {}, pollsMs: [1] }) };
    await expect(setup(d)).rejects.toThrow(/socket hang up/);
    expect(events("owners.account_created")).toEqual([]);
    const r = await setup(w.again());
    expect(w.node.sent()).toHaveLength(3);
    expect(r.created).toBe(w.node.sent()[1]!.hash);
    expect(events("owners.account_created")).toHaveLength(1);
  });

  it("without a donor key the faucet funds the sponsor (one CLI run, logged) and the sponsor funds the account", async () => {
    await world({ donor: false });
    const r = await setup(w.d);
    const sponsor = keyAddress("passkey-sponsor.key.json");
    expect(w.cliRuns).toEqual([["fund", sponsor]]);
    expect(w.calls().slice(0, 4)).toEqual(["setup:eth_getCode", "setup:eth_call", "setup:cli:fund", "setup:eth_call"]);
    expect(w.node.sent().map((t) => t.from.toLowerCase())).toEqual([sponsor.toLowerCase(), sponsor.toLowerCase()]);
    expect(balance(r.account)).toBe(centsToBaseUnits(ACCOUNT_CENTS));
  });

  it("with KIT11_RECYCLE=on test money comes from a finished dry run, counted call by call and recorded before it is sent", async () => {
    await world({ donor: false, env: { KIT11_RECYCLE: "on" } });
    const old = privateKeyToAccount(generatePrivateKey());
    w.node.balances.set(old.address.toLowerCase(), centsToBaseUnits(4000));
    const rows: string[] = [];
    const d = { ...w.d, recycle: { key: () => old, deps: {
      recycle: true, current: "faceid-1", worlds: () => [{ name: "dry-3", ageMs: 7_200_000 }], address: () => old.address,
      balance: async () => { throw new Error("the budgeted chain reads balances"); }, transfer: async () => { throw new Error("the budgeted chain sends"); }, faucet: () => { throw new Error("no faucet when recycling"); }, log: (row: string) => { rows.push(row); },
    } } };
    await setup(d);
    const sponsor = keyAddress("passkey-sponsor.key.json");
    expect(balance(sponsor)).toBe(centsToBaseUnits(SPONSOR_CENTS - ACCOUNT_CENTS));
    expect(w.node.sent()[0]).toMatchObject({ from: old.address });
    expect(events("owners.tx_sent")[0]).toMatchObject({ subject: `setup:recycle:dry-3:owner-customer.key.json:${sponsor}`, tx: w.node.sent()[0]!.hash });
    expect(rows).toHaveLength(1);
    expect(w.cliRuns).toEqual([]);
    expect(w.node.methods()).toEqual(w.calls().map((c) => c.split(":")[1]));
  });

  it("stops at the budget and sends nothing past it", async () => {
    await world({ budget: 5 });
    await expect(setup(w.d)).rejects.toThrow(OwnersBudgetSpent);
    expect(readOwnersCalls(w.log)).toHaveLength(5);
    expect(w.node.requests).toHaveLength(5);
  });
});

describe("owners setup, refused and resumed", () => {
  it("needs both passkeys and the verifier: without them it sends nothing", async () => {
    await world();
    w.db.prepare("UPDATE passkeys SET status = 'REVOKED' WHERE label = 'controller'").run();
    await expect(setup(w.d)).rejects.toThrow(/exactly two people's passkeys .*1 active/);
    expect(readdirSync(w.keys).filter((f) => f.endsWith(".json"))).toEqual([]);
    expect(w.node.requests).toEqual([]);
    w.close();
    await world();
    w.node.code.delete(PASSKEY_VERIFIER.toLowerCase());
    await expect(setup(w.d)).rejects.toThrow(/no WebAuthn verifier/);
    expect(w.node.methods()).toEqual(["eth_getCode"]);
  });

  it("refuses a donor key inside the repository", async () => {
    await world({ env: { OWNERS_DONOR_KEY: join(REPO, "donor.key.json") } });
    await expect(setup(w.d)).rejects.toThrow(/OWNERS_DONOR_KEY names a file inside the code repo/);
    expect(w.node.sent()).toEqual([]);
  });

  it("stopped while the sponsor's funding was on its way, the next run sends the identical transfer, and every transaction lands once", async () => {
    await world();
    w.node.state.sendFault = "drop";
    await expect(setup(w.d)).rejects.toThrow(/fetch failed/);
    expect(w.node.sent()).toEqual([]);
    const recorded = events("owners.tx_sent")[0]!;
    const r = await setup(w.again());
    expect(w.node.sent().map((t) => t.hash)[0]).toBe(recorded.tx);
    expect(w.node.sent()).toHaveLength(3);
    expect(balance(keyAddress("passkey-sponsor.key.json"))).toBe(centsToBaseUnits(SPONSOR_CENTS));
    expect(balance(r.account)).toBe(centsToBaseUnits(ACCOUNT_CENTS));
    // Carried on with another donor key, the open transfer is not signed again.
    w.close();
    await world();
    w.node.state.receiptAfter = Infinity;
    await expect(setup(w.d)).rejects.toThrow(/no receipt yet/);
    const other = join(w.dir, "other-donor.key.json");
    const otherKey = generatePrivateKey();
    writeFileSync(other, JSON.stringify({ address: privateKeyToAccount(otherKey).address, privateKey: otherKey }));
    const d = w.again();
    await expect(setup({ ...d, env: { ...d.env, OWNERS_DONOR_KEY: other } })).rejects.toThrow(/was sent from 0x[0-9a-fA-F]{40} by an earlier run/);
    expect(w.node.sent()).toHaveLength(1);
  });

  it("stopped while the account's funding was on its way, the next run waits for that transfer and sends no second one", async () => {
    await world();
    let sends = 0;
    const rpc = async (a: Parameters<typeof w.node.rpc>[0]) => { if (a.method === "eth_sendRawTransaction" && ++sends === 3) w.node.state.receiptAfter = Infinity; return w.node.rpc(a); };
    const d = w.again();
    const { ownersChain } = await import("../src/metal/ownersChain.js");
    await expect(setup({ ...d, chain: ownersChain({ budget: d.chain.budget, rpc, sleep: async () => {}, pollsMs: [1] }) })).rejects.toThrow(/no receipt yet/);
    w.node.state.receiptAfter = 0;
    const before = readOwnersCalls(w.log).length;
    const r = await setup(w.again());
    expect(w.node.sent()).toHaveLength(3);
    expect(balance(r.account)).toBe(centsToBaseUnits(ACCOUNT_CENTS));
    // The verifier, the account's address, then the receipt of the transfer already sent: nothing is signed.
    expect(w.calls(before)).toEqual(["setup:eth_getCode", "setup:eth_call", "setup:eth_getTransactionReceipt"]);
  });

  it("in a world set up before this record kept the owners' signers, it reads, finds everything there, and sends nothing", async () => {
    const { audit } = await import("../src/audit/log.js");
    const { encodeFunctionData } = await import("viem");
    const { factoryAbi } = await import("../src/metal/fourEyes.js");
    const { ownersOf } = await import("../src/metal/ownersFlow.js");
    const { predictedAccount } = await import("./support/fakeMetal.js");
    const { plainKey } = await import("../src/metal/keyFiles.js");
    await world();
    const signers = ownersOf(w.db).map((x) => x.signer);
    const account = predictedAccount(encodeFunctionData({ abi: factoryAbi, functionName: "predictAccount", args: [signers, [1n, 1n], 2n] }));
    w.node.code.set(account.toLowerCase(), "0x363d");
    w.node.balances.set(account.toLowerCase(), centsToBaseUnits(ACCOUNT_CENTS));
    w.node.balances.set(plainKey("passkey-sponsor.key.json").address.toLowerCase(), centsToBaseUnits(9000));
    audit(w.db, "owner-signer", "owners.account_created", account, { account, owners: ["controller", "max"], threshold: "2", verifier: PASSKEY_VERIFIER, tx: null }, T0);
    const r = await setup(w.d);
    expect(r).toMatchObject({ created: null, existed: true });
    expect(r.account.toLowerCase()).toBe(account);
    expect(w.node.sent()).toEqual([]);
    // The verifier's code, the sponsor's balance, the account's address, its code, its balance.
    expect(w.calls()).toEqual(["setup:eth_getCode", "setup:eth_call", "setup:eth_call", "setup:eth_getCode", "setup:eth_call"]);
    expect(events("owners.account_created").at(-1)).toMatchObject({ signers });
  });

  it("waits when the faucet says so, and tries again", async () => {
    await world({ donor: false });
    w.faucetErrors.push("metal-agent fund exited 1: faucet answered 429 client_rate_limited: this client asked the faucet too recently; retry in 4 s");
    const slept: number[] = [];
    await setup({ ...w.d, sleep: async (ms) => { slept.push(ms); } });
    expect(slept).toEqual([7000]);
    expect(w.calls().filter((c) => c === "setup:cli:fund")).toHaveLength(2);
    w.close();
    await world({ donor: false });
    w.faucetErrors.push("the faucet reached its daily grant limit for every client; try tomorrow");
    await expect(setup(w.d)).rejects.toThrow(/daily grant limit/);
    expect(w.node.sent()).toEqual([]);
  });

  it("recycling: a transfer left open is carried on first, and a world that gave is not asked again", async () => {
    await world({ donor: false, env: { KIT11_RECYCLE: "on" } });
    const old = privateKeyToAccount(generatePrivateKey());
    w.node.balances.set(old.address.toLowerCase(), centsToBaseUnits(4000));
    const recycle = { key: () => old, deps: {
      recycle: true, current: "faceid-1", worlds: () => [{ name: "dry-3", ageMs: 7_200_000 }], address: () => old.address as Address,
      balance: async () => 0n, transfer: async () => "0x" as Hex, faucet: () => {}, log: () => {},
    } };
    w.node.state.sendFault = "drop";
    await expect(setup({ ...w.d, recycle })).rejects.toThrow(/fetch failed/);
    const recorded = events("owners.tx_sent")[0]!.tx;
    // The next run stops at the creation; the recycled transfer has landed by then, as the transaction recorded first.
    w.node.state.reverts.set(ACCOUNT_FACTORY.toLowerCase(), "0x");
    await expect(setup({ ...w.again(), recycle })).rejects.toThrow(/would refuse creating the passkey account/);
    expect(w.node.sent().map((t) => t.hash)).toEqual([recorded]);
    // Were the sponsor short again, the same finished world is not asked a second time.
    w.node.state.reverts.clear();
    w.node.balances.set(keyAddress("passkey-sponsor.key.json").toLowerCase(), centsToBaseUnits(100));
    await expect(setup({ ...w.again(), recycle })).rejects.toThrow(/dry-3 already gave/);
    expect(w.node.sent()).toHaveLength(1);
  });
});

describe("owners propose", () => {
  it("works without a bootstrapped world: a real credential for the Sourcing agent's key, bound by one account call the terms check accepts", async () => {
    await world();
    const { account } = await setup(w.d);
    const from = readOwnersCalls(w.log).length;
    const told = w.said.length;
    const { proposal, terms } = await propose(w.again());
    expect(proposal).toMatchObject({ kind: "owners_execute", status: "PENDING_APPROVAL" });
    expect(() => approvalHashOf(proposal)).not.toThrow();
    expect(terms.action).toMatchObject({ what: "bind", agent: "sourcing", cap: "0.05", budget: "0.50", payee: keyAddress("supplier.key.json"), payee_name: "Stockline" });
    expect(terms.account).toBe(account);
    expect(terms.calls[0]!.call_data.startsWith(OWNER_CALL_SELECTORS.bind)).toBe(true);
    // The credential names the Sourcing agent's own key, the one setup made.
    const agent = JSON.parse(readFileSync(join(w.keys, AGENT_KEY), "utf8")) as { publicJwk: { x: string; y: string } };
    const [, , agentKey] = decodeFunctionData({ abi: mandateBindingAbi, data: terms.calls[0]!.call_data }).args as unknown as [Hex, Hex, Hex];
    expect(agentKey).toBe(`0x01${Buffer.from(agent.publicJwk.x, "base64url").toString("hex")}${Buffer.from(agent.publicJwk.y, "base64url").toString("hex")}`);
    // One read (the account's nonce lane); the credential is made offline and is no call.
    expect(w.calls(from)).toEqual(["propose:eth_call"]);
    expect(w.cliRuns).toEqual([]);
    // It says where both owners sign: this proposal's approval page, under the address the runner prints (no address here: it is a setting).
    expect(w.said.at(-1)).toMatch(new RegExp(`both passkeys sign the account's Execute digest ${terms.onchain_digest.slice(0, 18)}… within 15 minutes: .*/approve/${proposal.proposal_id} \\(npm run relay prints the address\\)$`));
    expect(w.said.slice(told).join("\n")).not.toMatch(/https?:\/\//);
  });

  it("stopped before the proposal was filed, it leaves nothing that blocks the next propose", async () => {
    await world();
    await setup(w.d);
    // The budget stops the one read: no credential was made for a proposal that does not exist.
    const used = readOwnersCalls(w.log).length;
    await expect(propose(w.again({ budget: used }))).rejects.toThrow(OwnersBudgetSpent);
    expect(existsSync(join(w.keys, "owners"))).toBe(false);
    // A run that stopped after the credential was made (here: at filing) left its file; the next propose uses it.
    let clock = 0;
    await expect(propose({ ...w.again(), now: () => { if (clock++ >= 0) throw new Error("stopped here"); return T0; } })).rejects.toThrow(/stopped here/);
    expect(readdirSync(join(w.keys, "owners")).sort()).toEqual(["P-0001.credential.json"]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
    const { proposal, terms } = await propose(w.again());
    expect(proposal.proposal_id).toBe("P-0001");
    expect(() => approvalHashOf(proposal)).not.toThrow();
    expect(terms.action.payee).toBe(keyAddress("supplier.key.json"));
    expect(readdirSync(join(w.keys, "owners")).sort()).toEqual(["P-0001.credential.json"]);
  });

  it("in a bootstrapped world Stockline's own key stays the payee", async () => {
    await world();
    const stocklineKey = generatePrivateKey();
    const stockline = privateKeyToAccount(stocklineKey);
    writeFileSync(join(w.keys, "supplier.key.json"), JSON.stringify({ address: stockline.address, privateKey: stocklineKey }), { mode: 0o600 });
    await setup(w.d);
    const { terms } = await propose(w.again());
    expect(terms.action.payee).toBe(stockline.address);
  });
});

describe("owners propose-revoke", () => {
  it("builds the revoke of the mandate this world bound, and nothing else", async () => {
    await world();
    await expect(proposeRevoke(w.d)).rejects.toThrow(/no passkey account|bound no mandate/);
    const b = await bound();
    const from = readOwnersCalls(w.log).length;
    const { proposal, terms } = await proposeRevoke(w.again());
    expect(() => checkOwnersTerms(terms)).not.toThrow();
    expect(() => approvalHashOf(proposal)).not.toThrow();
    expect(terms.action).toEqual({ ...b.terms.action, what: "revoke" });
    expect(terms.owners).toEqual(b.terms.owners);
    expect(decodeFunctionData({ abi: mandateBindingAbi, data: terms.calls[0]!.call_data })).toMatchObject({ functionName: "revoke", args: [b.terms.action.mandate] });
    expect(terms.calls[0]!.target).toBe(b.account);
    expect(w.calls(from)).toEqual(["propose-revoke:eth_call"]);
    expect(w.said.at(-1)).toMatch(new RegExp(`Execute digest ${terms.onchain_digest.slice(0, 18)}… within 15 minutes: .*/approve/${proposal.proposal_id} \\(npm run relay prints the address\\)$`));
    // One revoke at a time; once both passkeys signed it and the account ran it, there is nothing left to revoke.
    await expect(proposeRevoke(w.again())).rejects.toThrow(new RegExp(`${proposal.proposal_id} already asks to revoke`));
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    await expect(proposeRevoke(w.again())).rejects.toThrow(/was revoked by/);
    const s = await status(w.again());
    expect(s).toMatchObject({ bound: true, revoked: true });
  });
});

describe("owners pay", () => {
  it("pays 0.05 inside the mandate, and one cent over the cap is refused on chain; both are in the audit log with their transactions", async () => {
    await world();
    const b = await bound();
    const from = readOwnersCalls(w.log).length;
    const r = await pay(w.again());
    const payee = keyAddress("supplier.key.json");
    expect(r.inside).toMatchObject({ outcome: "PAID", tx: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(r.over).toEqual({ refused: true, tx: expect.stringMatching(/^0x[0-9a-f]{64}$/), reason: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)" });
    // Two runs of the CLI: 0.05 with the mandate key alone, then 0.06 with the refusal recorded by the gas sponsor.
    const arg = (run: string[], k: string) => run[run.indexOf(k) + 1];
    expect(w.cliRuns.map((run) => [cliCommand(run), arg(run, "--amount"), arg(run, "--to"), arg(run, "--payment-id"), run.includes("--record-refusal")])).toEqual([
      ["mandate pull", "0.05", payee, `owners-${b.id}-inside`, false], ["mandate pull", "0.06", payee, `owners-${b.id}-over-cap`, true],
    ]);
    expect(arg(w.cliRuns[0]!, "--mandate-key-file")).toBe(join(w.keys, AGENT_KEY));
    expect(arg(w.cliRuns[1]!, "--key")).toBe(join(w.keys, "passkey-sponsor.key.json"));
    expect(w.calls(from)).toEqual(["pay:cli:mandate pull", "pay:eth_call", "pay:cli:mandate pull"]);
    expect(events("owners.paid")).toEqual([expect.objectContaining({ subject: `owners-${b.id}-inside`, amount: "0.05", to: payee, tx: r.inside.tx, mandate: b.terms.action.mandate })]);
    expect(events("owners.refused_on_chain")).toEqual([expect.objectContaining({ subject: `owners-${b.id}-over-cap`, amount: "0.06", cap: "0.05", tx: r.over.tx, reason: r.over.reason })]);
    // The payment id is in the ledger before the CLI starts.
    expect(events("owners.pay_started").map((e) => e.subject)).toEqual([`owners-${b.id}-inside`, `owners-${b.id}-over-cap`]);
  });

  it("run again, it pays nothing and records no second refusal", async () => {
    await world();
    await bound();
    await pay(w.again());
    const [runs, calls] = [w.cliRuns.length, readOwnersCalls(w.log).length];
    const again = await pay(w.again());
    expect(again.inside.outcome).toBe("PAID");
    expect(again.over.refused).toBe(true);
    expect(w.cliRuns).toHaveLength(runs);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(events("owners.paid")).toHaveLength(1);
  });

  it("a refusal metal-agent recorded in an earlier run is taken from its record: no second refusal is sent", async () => {
    await world();
    const b = await bound();
    w.pulls.refuseOverCap = false; // were the CLI run again, it would be seen
    // metal-agent 0.3.3 keeps a payment id's outcome as <nonce>.done under its home, per mandate.
    const kept = keptPullDir(join(w.keys, "home"), b.terms.action.mandate, `owners-${b.id}-over-cap`);
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, `0x${"11".repeat(32)}.done`), JSON.stringify({ outcome: "refused", lines: [`transaction 0x${"7e".repeat(32)}`, "outcome refused", "reason mandate_cap_exceeded (the amount is above the mandate's per-payment cap)"] }));
    const r = await pay(w.again());
    expect(r.over).toMatchObject({ refused: true, tx: `0x${"7e".repeat(32)}` });
    expect(w.cliRuns.filter((run) => run.includes("--record-refusal"))).toEqual([]);
    expect(events("owners.refused_on_chain")[0]).toMatchObject({ read_from: expect.stringMatching(/kept record/) });
  });

  it("fails loudly when Metal does not refuse the payment over the cap", async () => {
    await world();
    await bound();
    w.pulls.refuseOverCap = false;
    await expect(pay(w.again())).rejects.toThrow(/did not report a refusal/);
    expect(events("owners.over_cap_not_refused")).toHaveLength(1);
    expect(events("owners.refused_on_chain")).toEqual([]);
  });

  it("pays nothing without a bound mandate, or after it was revoked", async () => {
    await world();
    await setup(w.d);
    await expect(pay(w.again())).rejects.toThrow(/bound no mandate/);
    const { proposal } = await propose(w.again());
    await expect(pay(w.again())).rejects.toThrow(/bound no mandate/); // proposed, not yet signed and run
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    const revoke = await proposeRevoke(w.again());
    await w.signBoth(revoke.proposal.proposal_id);
    await w.relay(revoke.proposal.proposal_id);
    await expect(pay(w.again())).rejects.toThrow(/was revoked/);
    expect(w.cliRuns).toEqual([]);
  });
});

describe("owners status", () => {
  it("reads the mandate once and says whether the chain has it bound", async () => {
    await world();
    await bound();
    const from = readOwnersCalls(w.log).length;
    const s = await status(w.again());
    expect(s).toMatchObject({ bound: true, revoked: false });
    expect(w.said.at(-1)).toMatch(/bound yes; revoked no/);
    expect(w.calls(from)).toEqual(["status:eth_call"]);
    expect(callsLine(w.d, from)).toMatch(new RegExp(`^CALLS +${from + 1} of 200 used in this world \\(this command: 1\\)`));
  });
});

describe("owners preflight", () => {
  const ready = (over: Record<string, string | undefined> = {}) => ({ ...w.d.env, METAL_RPC_URL: "https://rpc.example/v1/key", KIT11_RELAY_URL: "https://kit11.example.workers.dev", KIT11_RELAY_TOKEN: "t".repeat(64), ...over });

  it("refuses, with no call, when the relay's address or token is missing, when the keys are inside the repository, or without the owner's go", async () => {
    await world();
    expect(preflightRefusals(ready())).toEqual([]);
    expect(preflightRefusals(ready({ KIT11_RELAY_URL: undefined }))).toEqual([expect.stringMatching(/relay's address/)]);
    expect(preflightRefusals(ready({ KIT11_RELAY_URL: undefined, CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "b".repeat(40), KIT11_RELAY_TOKEN: undefined }))).toEqual([]);
    expect(preflightRefusals(ready({ KIT11_RELAY_TOKEN: undefined }))).toEqual([expect.stringMatching(/relay's token/)]);
    expect(preflightRefusals(ready({ KIT11_KEYS_DIR: join(REPO, "keys-in-repo") }))).toEqual([expect.stringMatching(/KIT11_KEYS_DIR outside the code repository/)]);
    expect(existsSync(join(REPO, "keys-in-repo"))).toBe(false);
    expect(preflightRefusals(ready({ OWNERS_DONOR_KEY: join(REPO, "donor.key.json") }))).toEqual([expect.stringMatching(/OWNERS_DONOR_KEY outside/)]);
    expect(preflightRefusals(ready({ OWNERS_GO: undefined }))).toEqual([expect.stringMatching(/OWNERS_GO=yes/)]);
    expect(preflightRefusals(ready({ KIT11_PASSKEY_OWNERS: "off" }))).toEqual([expect.stringMatching(/KIT11_PASSKEY_OWNERS=on/)]);
    const r = await preflight({ ...w.d, env: ready({ KIT11_RELAY_URL: undefined }) }, 4);
    expect(r).toMatchObject({ ok: false, problems: [expect.stringMatching(/relay's address/)] });
    expect(w.node.requests).toEqual([]);
    expect(readOwnersCalls(w.log)).toEqual([]);
    expect(w.said.join("\n")).toMatch(/preflight made no call/);
  });

  it("makes three counted reads (the chain id, the verifier's code, the donor's balance), sends nothing, and prints the plan", async () => {
    await world();
    const r = await preflight({ ...w.d, env: ready() }, 4);
    expect(r.ok).toBe(true);
    expect(w.calls()).toEqual(["preflight:eth_chainId", "preflight:eth_getCode", "preflight:eth_call"]);
    expect(w.node.methods()).toEqual(["eth_chainId", "eth_getCode", "eth_call"]);
    expect(w.node.sent()).toEqual([]);
    const text = w.said.join("\n");
    // Each step with its transactions, its calls and what the owner does on the phone; then the total.
    for (const step of r.plan) expect(text).toContain(step.step);
    expect(text).toMatch(/4 setup +npm run owners -- setup\n +calls: 13 to 22 requests; transactions: donor key → gas sponsor, 5\.00 test USD; create the account .*; donor key → account, 0\.60 test USD\n +on the phone: nothing/);
    expect(text).toMatch(/on the phone: Open the approval link within 15 minutes\. Check: "Bind the sourcing mandate, signed on chain", 0\.50 USDZ budget, up to 0\.05 per payment, Stockline only\. Tap "Approve with Face ID"/);
    expect(text).toMatch(/TOTAL +7 transactions; 30 to 45 lines in the call log \(2 of them CLI runs\)/);
    expect(text).toMatch(/the donor key 0x[0-9a-fA-F]{40} holds 99\.00 test USD; this run takes 5\.60/);
    expect(text).toMatch(/READY/);
    expect(text).not.toMatch(/rpc\.example|tttt/);
  });

  it("without a donor key it reads twice, and says who funds the sponsor", async () => {
    await world({ donor: false });
    const r = await preflight({ ...w.d, env: ready() }, 4);
    expect(r.ok).toBe(true);
    expect(w.calls()).toEqual(["preflight:eth_chainId", "preflight:eth_getCode"]);
    expect(w.said.join("\n")).toMatch(/no donor key .* funded by the faucet/);
  });

  it("names what is wrong: another chain (and then asks nothing more), no verifier, a donor that holds too little, a budget below the plan", async () => {
    await world({ budget: 20 });
    w.node.code.delete(PASSKEY_VERIFIER.toLowerCase());
    w.node.balances.set(w.donor.address.toLowerCase(), centsToBaseUnits(300));
    const r = await preflight({ ...w.d, env: ready() }, 4);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([expect.stringMatching(/no WebAuthn verifier/), expect.stringMatching(/holds 3\.00 test USD, not enough/), expect.stringMatching(/budget of 20 \(3 used, 17 left\) is below the 42 lines .*and below the 27 it takes at least/)]);
    w.close();
    await world();
    const real = w.node.rpc;
    const d = { ...w.d, env: ready(), chain: (await import("../src/metal/ownersChain.js")).ownersChain({ budget: w.d.chain.budget, rpc: async (a) => (a.method === "eth_chainId" ? "0x1" : real(a)) }) };
    const other = await preflight(d, 4);
    expect(other.problems).toEqual([expect.stringMatching(/answers as chain 1, not Metal testnet/)]);
    expect(readOwnersCalls(w.log)).toHaveLength(1);
  });

  it("prints numbers the code follows: each step of a run logs exactly what the plan says, at the least and at the most", async () => {
    for (const [pollsMs, pick] of [[[1, 1, 1, 1], "min"], [[1, 1, 1, 1], "max"]] as const) {
      await world({ pollsMs: [...pollsMs] });
      // At the most: every receipt shows only on the last poll.
      w.node.state.receiptAfter = pick === "max" ? pollsMs.length - 1 : 0;
      const plan = ownersPlan({ funding: "donor", polls: pollsMs.length });
      const lines = (step: string) => { const s = plan.find((p) => p.step === step)!; return s.requests[pick] + s.cli_runs; };
      const used = () => readOwnersCalls(w.log).length;
      let at = 0;
      const step = async (name: string, run: () => Promise<unknown>) => { await run(); expect(used() - at, `${name} (${pick})`).toBe(lines(name)); at = used(); };
      await step("1 preflight", () => preflight({ ...w.d, env: ready() }, pollsMs.length));
      await step("4 setup", () => setup(w.again()));
      let id = "";
      await step("5 propose the bind", async () => { id = (await propose(w.again())).proposal.proposal_id; });
      await w.signBoth(id);
      await step("5 the runner relays it", () => w.relay(id));
      await step("6 pay", () => pay(w.again()));
      await step("7 propose the revoke", async () => { id = (await proposeRevoke(w.again())).proposal.proposal_id; });
      await w.signBoth(id);
      await step("7 the runner relays it", () => w.relay(id));
      await step("8 status", () => status(w.again()));
      const t = planTotals(plan);
      expect(used()).toBe(t.lines[pick]);
      expect(w.node.sent().length + w.cliRuns.length).toBe(t.transactions);
      w.close();
    }
  });

  it("ends with the record, which costs no call, and offers both ways to a second approver", () => {
    const plan = ownersPlan({ funding: "donor", polls: 4 });
    expect(plan.at(-1)).toEqual({ step: "8 record", command: "npm run owners -- record", transactions: [], requests: { min: 0, max: 0 }, cli_runs: 0, phone: "nothing" });
    expect(plan.find((s) => s.step === "3 the second approver")).toMatchObject({
      command: "npm run passkey -- add <name>, then confirm its fingerprint (a second device); or npx tsx docs/runs/driver/test-controller.ts enrol (a labelled virtual approver), then confirm its fingerprint",
      phone: "nothing: the second approver enrols on their own device, or the virtual approver is driven from the runner's machine",
      requests: { min: 0, max: 0 }, cli_runs: 0, transactions: [],
    });
    // The record adds nothing to the totals preflight prints.
    expect(planTotals(plan)).toEqual(planTotals(plan.slice(0, -1)));
  });

  it("plans the faucet and the recycling paths too, with their CLI run and their extra reads", () => {
    const faucet = ownersPlan({ funding: "faucet", polls: 4 }).find((s) => s.step === "4 setup")!;
    expect(faucet).toMatchObject({ requests: { min: 12, max: 18 }, cli_runs: 1 });
    expect(ownersPlan({ funding: "recycle", polls: 4 }).find((s) => s.step === "4 setup")!.transactions[0]).toMatch(/one transfer per world that gives/);
  });
});

describe("the faucet plan against the code", () => {
  it("setup with the faucet logs what the plan says", async () => {
    await world({ donor: false });
    await setup(w.d);
    const s = ownersPlan({ funding: "faucet", polls: 4 }).find((p) => p.step === "4 setup")!;
    expect(readOwnersCalls(w.log)).toHaveLength(s.requests.min + s.cli_runs);
    expect(T0.toISOString()).toBe("2026-11-12T10:00:00.000Z");
  });
});

describe("the CFO's feed of an owners world", () => {
  it("stays calm: Purser's own transaction journal is not in it, and the payment and the refusal read in plain words with their transactions", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    await world();
    await bound();
    const r = await pay(w.again());
    const feed = buildSnapshot(w.db).feed;
    expect(feed.filter((f) => /^owners\.(tx_|unsent|waiting|pay_started)/.test(f.event))).toEqual([]);
    // No line is a raw event name: every owners line is a sentence.
    expect(feed.filter((f) => f.event.startsWith("owners.")).filter((f) => f.text.startsWith("owners."))).toEqual([]);
    expect(feed.find((f) => f.event === "owners.sent")).toMatchObject({ text: expect.stringMatching(/^P-0001, signed by both passkeys, was sent to the business account on chain$/), tx: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(feed.find((f) => f.event === "owners.paid")).toMatchObject({ text: "The Sourcing agent paid 0.05 USDZ to Stockline inside its mandate on the passkey account: its mandate key signed, no owner did", tone: "ok", tx: r.inside.tx });
    expect(feed.find((f) => f.event === "owners.refused_on_chain")).toMatchObject({ text: "Metal refused 0.06 USDZ to Stockline, over the mandate's 0.05 cap, and recorded the refusal on chain", tone: "refusal", tx: r.over.tx });
  });

  it("says in plain words that the account refused a call, with its reason", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const { audit } = await import("../src/audit/log.js");
    await world();
    audit(w.db, "owner-signer", "owners.reverted", "P-0007", { account: "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", tx: `0x${"ab".repeat(32)}`, reason: "AlreadyRevoked()" }, T0);
    expect(buildSnapshot(w.db).feed.find((f) => f.event === "owners.reverted")).toMatchObject({ text: "The account refused P-0007 on chain: AlreadyRevoked()", tone: "refusal", tx: `0x${"ab".repeat(32)}` });
  });
});
