// npm run owners, the flow of a live Face ID run, against an in-process chain. Breaks if the flow needs a
// bootstrapped world again; if setup sends anything beyond its own three transactions or makes a call a second time;
// if funding from a named donor key is more than one counted transfer each; if a re-run after a stop sends twice; if
// preflight sends anything, reads more than three times or prints a number the code does not follow; if a revoke is
// proposed for anything but the mandate this world bound; or if a payment over the cap could be paid, or is paid twice.
// Software passkeys, a stand-in chain and a stand-in for the CLI's network commands; the CLI's offline commands are real.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mandateBindingAbi } from "@metalntwx/metal-pay/mandates";
import { centsToBaseUnits } from "../src/lib/money.js";
import { approvalHashOf, checkOwnersTerms, OWNER_CALL_SELECTORS, type OwnersExecuteTerms } from "../src/metal/ownersExecute.js";
import { OwnersBudgetSpent, readOwnersCalls } from "../src/metal/ownersBudget.js";
import { keysDir } from "../src/metal/agentCli.js";
import { ACCOUNT_CENTS, AGENT_KEY, boundMandate, callsLine, cliCommand, DEADLINE_SECONDS, donorOf, limitsOf, MANDATE, ownersPlan, pay, planTotals, preflight, preflightRefusals, propose, proposeReplace, proposeRevoke, REPLACE, setup, SIGN_MINUTES, SPONSOR_CENTS, status } from "../src/metal/ownersFlow.js";
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

  it("names a labelled virtual test passkey as virtual in its account line, and a person's passkey as a passkey only", async () => {
    await world({ labels: ["max", "test-controller"] });
    await setup(w.d);
    const line = w.said.find((l) => l.startsWith("ACCOUNT")) ?? "";
    expect(line).toMatch(/max's passkey and test-controller's passkey \(a virtual test passkey\), threshold 2/);
    expect(line).not.toMatch(/max's passkey \(/);
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

  it("names a donor key file it cannot use by its path alone: nothing the file holds reaches the message", async () => {
    await world();
    const key = generatePrivateKey();
    // A bare hex key, JSON without the key file's fields, and JSON that is no object.
    for (const [name, text] of [["donor.hex", `${key.slice(2)}\n`], ["donor.other.json", JSON.stringify({ secret: key })], ["donor.null.json", "null"]] as const) {
      const file = join(w.dir, name);
      writeFileSync(file, text, { mode: 0o600 });
      let said = "";
      try { donorOf({ OWNERS_DONOR_KEY: file }); } catch (e) { said = (e as Error).message; }
      expect(said, name).toBe(`not a metal-agent key file: ${file}`);
      expect(said, name).not.toContain(key.slice(2, 10));
    }
    expect(() => donorOf({ OWNERS_DONOR_KEY: join(w.dir, "not-there.json") })).toThrow(/^the key file .*not-there\.json cannot be read \(ENOENT\)$/);
  });

  it("follows links: a keys folder or a donor key that only links into the repository is refused as one inside it", async () => {
    await world();
    const env = (over: Record<string, string>) => ({ ...w.d.env, METAL_RPC_URL: "https://rpc.example/v1/key", KIT11_RELAY_URL: "https://kit11.example.workers.dev", KIT11_RELAY_TOKEN: "t".repeat(64), ...over });
    expect(preflightRefusals(env({}))).toEqual([]);
    // A link to a folder of the repository, a path below such a link, and a link to a place in the repository that is not there yet.
    symlinkSync(join(REPO, "test"), join(w.dir, "keys-link"));
    symlinkSync(join(REPO, "keys-not-there"), join(w.dir, "keys-dangling"));
    for (const dir of [join(w.dir, "keys-link"), join(w.dir, "keys-link", "deeper", "keys"), join(w.dir, "keys-dangling")]) {
      expect(preflightRefusals(env({ KIT11_KEYS_DIR: dir })), dir).toEqual([expect.stringMatching(/KIT11_KEYS_DIR outside the code repository/)]);
      expect(() => keysDir({ KIT11_KEYS_DIR: dir }), dir).toThrow(/KIT11_KEYS_DIR must be outside the code repo/);
    }
    // Nothing was made in the repository while checking.
    for (const made of ["test/home", "test/deeper", "keys-not-there"]) expect(existsSync(join(REPO, made)), made).toBe(false);
    const donorLink = join(w.dir, "donor-link.json");
    symlinkSync(join(REPO, "package.json"), donorLink);
    expect(preflightRefusals(env({ OWNERS_DONOR_KEY: donorLink }))).toEqual([expect.stringMatching(/OWNERS_DONOR_KEY outside the code repository/)]);
    expect(() => donorOf({ OWNERS_DONOR_KEY: donorLink })).toThrow(/OWNERS_DONOR_KEY names a file inside the code repo/);
    // A link that stays outside the repository is a keys folder like any other.
    symlinkSync(w.keys, join(w.dir, "keys-outside"));
    expect(preflightRefusals(env({ KIT11_KEYS_DIR: join(w.dir, "keys-outside") }))).toEqual([]);
    expect(keysDir({ KIT11_KEYS_DIR: join(w.dir, "keys-outside") })).toBe(join(w.dir, "keys-outside"));
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

describe("owners setup, recycling in a ledger another keys folder started", () => {
  it("a recycled transfer left open to another address than this world's gas sponsor is not carried on here, and not signed anew", async () => {
    await world({ donor: false, env: { KIT11_RECYCLE: "on" } });
    const old = privateKeyToAccount(generatePrivateKey());
    w.node.balances.set(old.address.toLowerCase(), centsToBaseUnits(4000));
    const recycle = { key: () => old, deps: {
      recycle: true, current: "faceid-1", worlds: () => [{ name: "dry-3", ageMs: 7_200_000 }], address: () => old.address as Address,
      balance: async () => 0n, transfer: async () => "0x" as Hex, faucet: () => {}, log: () => {},
    } };
    w.node.state.sendFault = "drop";
    await expect(setup({ ...w.d, recycle })).rejects.toThrow(/fetch failed/);
    const first = keyAddress("passkey-sponsor.key.json");
    expect(events("owners.tx_sent")).toEqual([expect.objectContaining({ subject: `setup:recycle:dry-3:owner-customer.key.json:${first}` })]);
    // The ledger is carried on with a keys folder that has no sponsor key: setup makes a new one, with another address.
    rmSync(join(w.keys, "passkey-sponsor.key.json"));
    await expect(setup({ ...w.again(), recycle })).rejects.toThrow(new RegExp(`an earlier run left a recycled transfer open to ${first}, which is not this world's gas sponsor 0x[0-9a-fA-F]{40}.*nothing was sent`));
    expect(keyAddress("passkey-sponsor.key.json")).not.toBe(first);
    expect(w.node.sent()).toEqual([]);
    expect(events("owners.tx_sent")).toHaveLength(1);
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

describe("owners propose, one mandate at a time", () => {
  it("binds only when no mandate is live or on its way: otherwise it refuses before any call and points to the replace or the revoke", async () => {
    await world();
    await setup(w.d);
    const { proposal } = await propose(w.again());
    const id = proposal.proposal_id;
    let calls = readOwnersCalls(w.log).length;
    const refused = async (why: RegExp, limits?: { capCents: number; budgetCents: number }) => {
      await expect(propose(w.again(), limits)).rejects.toThrow(why);
      expect(readOwnersCalls(w.log)).toHaveLength(calls);
      expect(w.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
      expect(readdirSync(join(w.keys, "owners"))).toEqual([`${id}.credential.json`]);
    };
    // Waiting for its signatures, then approved.
    await refused(new RegExp(`^refused: ${id} already asks to bind a mandate on this account \\(pending approval\\); sign that one, or wait until it runs out.*nothing was called$`));
    await w.signBoth(id);
    await refused(new RegExp(`${id} already asks to bind a mandate on this account \\(approved\\)`));
    // Sent, no receipt yet, and its fifteen minutes over: it can still land.
    w.node.state.receiptAfter = Infinity;
    await expect(w.relay(id)).rejects.toThrow(/stays executing/);
    calls = readOwnersCalls(w.log).length;
    w.clock.now = new Date(T0.getTime() + 16 * 60_000);
    await refused(new RegExp(`${id} already asks to bind a mandate on this account \\(executing\\); start the runner again, so it reads how that one ended`));
    w.node.state.receiptAfter = 0;
    await w.relay(id, { resume: true });
    calls = readOwnersCalls(w.log).length;
    // Bound: a second bind would leave two live mandates, and one revoke would end only one of them.
    await refused(new RegExp(`^refused: ${id} bound a mandate on this account that is live \\(cap 0\\.05, budget 0\\.50\\). To change it: npm run owners -- propose-replace <cap> <budget>; to end it: npm run owners -- propose-revoke; nothing was called$`));
    await refused(/bound a mandate on this account that is live/, { capCents: 10, budgetCents: 50 });
    expect([...w.node.mandates.values()].filter((m) => m.boundBlock > 0n && !m.revoked)).toHaveLength(1);
  });

  it("a credential an earlier run left under the same proposal number for other terms is moved aside before the read: not used, not deleted", async () => {
    await world();
    await setup(w.d);
    // A run with the standard limits stopped after its credential was made and before the proposal was filed.
    let clock = 0;
    await expect(propose({ ...w.again(), now: () => { if (clock++ >= 0) throw new Error("stopped here"); return T0; } })).rejects.toThrow(/stopped here/);
    const kept = readFileSync(join(w.keys, "owners", "P-0001.credential.json"), "utf8");
    const [from, told] = [readOwnersCalls(w.log).length, w.said.length];
    const { proposal, terms } = await propose(w.again(), { capCents: 10, budgetCents: 40 });
    expect(proposal.proposal_id).toBe("P-0001");
    expect(terms.action).toMatchObject({ what: "bind", cap: "0.10", budget: "0.40" });
    expect(w.calls(from)).toEqual(["propose:eth_call"]);
    const files = readdirSync(join(w.keys, "owners")).sort();
    expect(files).toEqual(["P-0001.credential.json", expect.stringMatching(/^P-0001\.credential\.json\.set-aside-/)]);
    expect(readFileSync(join(w.keys, "owners", files[1]!), "utf8")).toBe(kept);
    expect(readFileSync(join(w.keys, "owners", files[0]!), "utf8")).not.toBe(kept);
    expect(w.said.slice(told).join("\n")).toMatch(new RegExp(`^NOTE +a credential an earlier run kept for P-0001 is for other terms: moved aside as ${files[1]!.replaceAll(".", "\\.")}, and a new one is made$`, "m"));
  });
});

describe("the stand-in account", () => {
  it("runs the call it is sent, not a proposal's words: a revoke of a mandate it does not hold reverts on chain, and the proposal fails", async () => {
    await world();
    const b = await bound();
    expect(w.node.mandates.get(b.terms.action.mandate.toLowerCase())).toMatchObject({ principal: b.account, revoked: false, spent: 0n });
    const revoke = await proposeRevoke(w.again());
    await w.signBoth(revoke.proposal.proposal_id);
    // The chain holds no such mandate (as if another one had been bound than the words say).
    w.node.mandates.clear();
    await expect(w.relay(revoke.proposal.proposal_id)).rejects.toThrow(/the account reverted executeSigned/);
    expect(w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(revoke.proposal.proposal_id)).toEqual({ status: "FAILED" });
    expect(boundMandate(w.db).id).toBe(b.id);
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

/** The bound mandate replaced by one with these limits: proposed, signed by both passkeys and relayed. */
async function replaced(capCents: number, budgetCents: number): Promise<{ id: string; terms: OwnersExecuteTerms }> {
  const { proposal, terms } = await proposeReplace(w.again(), { capCents, budgetCents });
  await w.signBoth(proposal.proposal_id);
  await w.relay(proposal.proposal_id);
  return { id: proposal.proposal_id, terms };
}

describe("owners propose-replace", () => {
  it("builds the replace of the mandate this world bound, with the new limits: a new credential for the same payee and agent key, and one read", async () => {
    await world();
    await expect(proposeReplace(w.d, { capCents: 10, budgetCents: 50 })).rejects.toThrow(/no passkey account|bound no mandate/);
    const b = await bound();
    const from = readOwnersCalls(w.log).length;
    const { proposal, terms } = await proposeReplace(w.again(), { capCents: 10, budgetCents: 50 });
    expect(proposal).toMatchObject({ kind: "owners_execute", status: "PENDING_APPROVAL" });
    expect(() => checkOwnersTerms(terms)).not.toThrow();
    expect(() => approvalHashOf(proposal)).not.toThrow();
    // The action as filed: the bind's words with the new limits, the new mandate, and what it replaces.
    expect(terms.action).toEqual({ what: "replace", agent: "sourcing", cap: "0.10", budget: "0.50", payee: b.terms.action.payee, payee_name: "Stockline", mandate: expect.stringMatching(/^0x[0-9a-f]{64}$/), replaces: b.terms.action.mandate, was_cap: "0.05", was_budget: "0.50" });
    expect(terms.action.mandate).not.toBe(b.terms.action.mandate);
    expect(terms.owners).toEqual(b.terms.owners);
    expect(terms.calls[0]!.target).toBe(b.account);
    const call = decodeFunctionData({ abi: mandateBindingAbi, data: terms.calls[0]!.call_data });
    expect(call.functionName).toBe("replace");
    const [predecessor, , , agentKey] = call.args as unknown as [Hex, Hex, Hex, Hex];
    expect(predecessor).toBe(b.terms.action.mandate);
    // The same agent key as the mandate it replaces: the Sourcing agent's own.
    expect(agentKey).toBe((decodeFunctionData({ abi: mandateBindingAbi, data: b.terms.calls[0]!.call_data }).args as unknown as [Hex, Hex, Hex])[2]);
    expect(existsSync(join(w.keys, "owners", `${proposal.proposal_id}.credential.json`))).toBe(true);
    // One read (the account's nonce lane); the credential is made offline.
    expect(w.calls(from)).toEqual(["propose-replace:eth_call"]);
    expect(w.cliRuns).toEqual([]);
    expect(w.said.at(-2)).toBe(`PROPOSED         ${proposal.proposal_id}: replace the sourcing mandate ${b.terms.action.mandate.slice(0, 18)}… that ${b.id} bound on ${b.account}: cap 0.05 → 0.10, budget 0.50 → 0.50, Stockline only; what was spent under it carries over`);
    expect(w.said.at(-1)).toMatch(new RegExp(`Execute digest ${terms.onchain_digest.slice(0, 18)}… within 15 minutes: .*/approve/${proposal.proposal_id} \\(npm run relay prints the address\\)$`));
    // One change of this mandate at a time.
    await expect(proposeReplace(w.again(), { capCents: 20, budgetCents: 50 })).rejects.toThrow(new RegExp(`${proposal.proposal_id} already asks to replace this mandate`));
    await expect(proposeRevoke(w.again())).rejects.toThrow(new RegExp(`${proposal.proposal_id} already asks to replace this mandate`));
  });

  it("a change that was sent and has no receipt yet still stands in the way after its fifteen minutes: it can land until its signed deadline", async () => {
    await world();
    await bound();
    const rp = await proposeReplace(w.again(), { capCents: 10, budgetCents: 50 });
    await w.signBoth(rp.proposal.proposal_id);
    w.node.state.receiptAfter = Infinity;
    await expect(w.relay(rp.proposal.proposal_id)).rejects.toThrow(/stays executing/);
    w.clock.now = new Date(T0.getTime() + 16 * 60_000);
    const calls = readOwnersCalls(w.log).length;
    const waits = new RegExp(`${rp.proposal.proposal_id} already asks to replace this mandate \\(executing\\); start the runner again, so it reads how that one ended`);
    await expect(proposeReplace(w.again(), { capCents: 20, budgetCents: 50 })).rejects.toThrow(waits);
    await expect(proposeRevoke(w.again())).rejects.toThrow(waits);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 2 });
  });

  it("refuses, before any call, limits under which the amount Metal refused could not be paid next", async () => {
    await world();
    await bound();
    await pay(w.again()); // 0.05 paid, 0.06 refused on chain
    const [calls, credentials] = [readOwnersCalls(w.log).length, readdirSync(join(w.keys, "owners")).length];
    await expect(proposeReplace(w.again(), { capCents: 6, budgetCents: 10 })).rejects.toThrow(/^refused: the budget 0\.10 is below the 0\.05 already paid under this mandate plus the 0\.06 Metal refused before \(0\.11 in all\): the next npm run owners -- pay could not pay it; nothing was called$/);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(readdirSync(join(w.keys, "owners"))).toHaveLength(credentials);
    // The least that pays it is taken, and the next pay pays it.
    await replaced(6, 11);
    expect((await pay(w.again())).afterRefusal).toMatchObject({ amount: "0.06", outcome: "PAID" });
    // After a revoke, a bind with amounts of its own is for the refused amount too; without amounts it is the standard mandate again.
    w.close();
    await world();
    await bound();
    await pay(w.again());
    const revoke = await proposeRevoke(w.again());
    await w.signBoth(revoke.proposal.proposal_id);
    await w.relay(revoke.proposal.proposal_id);
    const before = readOwnersCalls(w.log).length;
    await expect(propose(w.again(), { capCents: 5, budgetCents: 50 })).rejects.toThrow(/^refused: the cap 0\.05 is below the 0\.06 Metal refused before: the next npm run owners -- pay could not pay it \(without amounts, propose binds the standard mandate again\); nothing was called$/);
    expect(readOwnersCalls(w.log)).toHaveLength(before);
    expect((await propose(w.again())).terms.action).toMatchObject({ what: "bind", cap: "0.05", budget: "0.50" });
  });

  it("refuses, before any call, limits the chain or this small account would not take", async () => {
    await world();
    await bound();
    const [calls, credentials] = [readOwnersCalls(w.log).length, readdirSync(join(w.keys, "owners")).length];
    const refused = (capCents: number, budgetCents: number, why: RegExp) => expect(proposeReplace(w.again(), { capCents, budgetCents })).rejects.toThrow(why);
    await refused(5, 50, /the new cap 0\.05 is not above the 0\.05 the mandate has now/);
    await refused(4, 50, /not above/);
    await refused(10, 9, /the budget 0\.09 is below the cap 0\.10/);
    await refused(10, ACCOUNT_CENTS + 1, /the budget 0\.61 is above the 0\.60 this account was funded with/);
    await refused(10.5, 50, /whole cents/);
    // What the ledger says was paid under the mandate carries into its successor: a budget not above it would be refused on chain (SuccessorExhausted).
    const { audit } = await import("../src/audit/log.js");
    const b = boundMandate(w.db);
    audit(w.db, "sourcing", "owners.paid", "owners-test-paid", { mandate: b.terms.action.mandate, amount: "0.45", tx: null }, T0);
    await refused(10, 45, /the budget 0\.45 is not above the 0\.45 already paid under this mandate, which the new one carries/);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(readdirSync(join(w.keys, "owners"))).toHaveLength(credentials);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
    // A waiting revoke of the same mandate stands in the way too.
    const revoke = await proposeRevoke(w.again());
    await refused(10, 50, new RegExp(`${revoke.proposal.proposal_id} already asks to revoke this mandate`));
  });

  it("reads amounts as the command takes them: two decimals, nothing else", () => {
    expect(limitsOf("0.10", "0.50")).toEqual({ capCents: 10, budgetCents: 50 });
    expect(limitsOf(undefined, undefined)).toBeNull();
    for (const [cap, budget] of [["0.1", "0.50"], ["0.10", undefined], ["ten", "0.50"], ["-0.10", "0.50"], ["0.10", "1e3"], ["0.00", "0.50"], ["0.10", "0.50 "]] as const) {
      expect(() => limitsOf(cap, budget), `${cap} ${budget}`).toThrow(/amounts like 0\.10 0\.50/);
    }
  });

  it("once both passkeys signed it and the account ran it, the replaced mandate is the bound one: revoke, pay and status follow it", async () => {
    await world();
    const b = await bound();
    const r = await replaced(10, 50);
    expect(boundMandate(w.db)).toMatchObject({ id: r.id });
    expect(w.node.mandates.get(b.terms.action.mandate.toLowerCase())).toMatchObject({ revoked: true });
    expect(await status(w.again())).toMatchObject({ bound: true, revoked: false });
    expect(w.said.at(-1)).toMatch(new RegExp(`proposal ${r.id} \\(replace\\) EXECUTED; bound yes; revoked no`));
    // A second replace builds on the first; a revoke ends the mandate bound now, not the one it replaced.
    const again = await proposeReplace(w.again(), { capCents: 20, budgetCents: 60 });
    expect(again.terms.action).toMatchObject({ replaces: r.terms.action.mandate, was_cap: "0.10", was_budget: "0.50", cap: "0.20", budget: "0.60" });
    w.clock.now = new Date(T0.getTime() + 16 * 60_000); // that one runs out unsigned
    const revoke = await proposeRevoke(w.again());
    // The revoke's words are the bound mandate's limits and payee; what the replace replaced is no part of them.
    expect(revoke.terms.action).toEqual({ what: "revoke", agent: "sourcing", cap: "0.10", budget: "0.50", payee: r.terms.action.payee, payee_name: "Stockline", mandate: r.terms.action.mandate });
    expect(decodeFunctionData({ abi: mandateBindingAbi, data: revoke.terms.calls[0]!.call_data })).toMatchObject({ functionName: "revoke", args: [r.terms.action.mandate] });
    await w.signBoth(revoke.proposal.proposal_id);
    await w.relay(revoke.proposal.proposal_id);
    await expect(proposeReplace(w.again(), { capCents: 30, budgetCents: 60 })).rejects.toThrow(/was revoked by/);
    await expect(pay(w.again())).rejects.toThrow(/was revoked/);
  });
});

describe("owners propose with limits of its own", () => {
  it("binds a mandate with the cap and budget given, and refuses what the account would not take", async () => {
    await world();
    await setup(w.d);
    const calls = readOwnersCalls(w.log).length;
    await expect(propose(w.again(), { capCents: 10, budgetCents: 9 })).rejects.toThrow(/the budget 0\.09 is below the cap 0\.10/);
    await expect(propose(w.again(), { capCents: 10, budgetCents: 61 })).rejects.toThrow(/above the 0\.60 this account was funded with/);
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    const { terms } = await propose(w.again(), { capCents: 10, budgetCents: 40 });
    expect(terms.action).toMatchObject({ what: "bind", cap: "0.10", budget: "0.40" });
    expect(() => checkOwnersTerms(terms)).not.toThrow();
    expect(w.said.at(-2)).toMatch(/bind the sourcing mandate on 0x[0-9a-fA-F]{40}, cap 0\.10, budget 0\.40, Stockline only$/);
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
    expect(r.afterRefusal).toBeNull();
    // Two runs of the CLI: 0.05 with the mandate key alone, then 0.06 with the refusal recorded by the gas sponsor.
    const arg = (run: string[], k: string) => run[run.indexOf(k) + 1];
    expect(w.cliRuns.map((run) => [cliCommand(run), arg(run, "--amount"), arg(run, "--to"), arg(run, "--payment-id"), run.includes("--record-refusal")])).toEqual([
      ["mandate pull", "0.05", payee, `owners-${b.id}-inside`, false], ["mandate pull", "0.06", payee, `owners-${b.id}-over-cap`, true],
    ]);
    expect(arg(w.cliRuns[0]!, "--mandate-key-file")).toBe(join(w.keys, AGENT_KEY));
    expect(arg(w.cliRuns[1]!, "--key")).toBe(join(w.keys, "passkey-sponsor.key.json"));
    expect(w.calls(from)).toEqual(["pay:cli:mandate pull", "pay:eth_call", "pay:cli:mandate pull"]);
    expect(events("owners.paid")).toEqual([expect.objectContaining({ subject: `owners-${b.id}-inside`, amount: "0.05", to: payee, tx: r.inside!.tx, mandate: b.terms.action.mandate })]);
    expect(events("owners.refused_on_chain")).toEqual([expect.objectContaining({ subject: `owners-${b.id}-over-cap`, amount: "0.06", cap: "0.05", tx: r.over!.tx, reason: r.over!.reason })]);
    // The payment id is in the ledger before the CLI starts.
    expect(events("owners.pay_started").map((e) => e.subject)).toEqual([`owners-${b.id}-inside`, `owners-${b.id}-over-cap`]);
  });

  it("run again, it pays nothing and records no second refusal", async () => {
    await world();
    await bound();
    await pay(w.again());
    const [runs, calls] = [w.cliRuns.length, readOwnersCalls(w.log).length];
    const again = await pay(w.again());
    expect(again.inside!.outcome).toBe("PAID");
    expect(again.over!.refused).toBe(true);
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

  it("with a cap below 0.05 the payment inside the mandate is the cap itself, and one cent over it is refused", async () => {
    await world();
    await setup(w.d);
    const { proposal } = await propose(w.again(), { capCents: 3, budgetCents: 30 });
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    const r = await pay(w.again());
    expect(r.inside).toMatchObject({ outcome: "PAID" });
    expect(r.over).toMatchObject({ refused: true });
    const arg = (run: string[], k: string) => run[run.indexOf(k) + 1];
    expect(w.cliRuns.map((run) => arg(run, "--amount"))).toEqual(["0.03", "0.04"]);
    expect(events("owners.paid")).toEqual([expect.objectContaining({ amount: "0.03" })]);
    expect(events("owners.refused_on_chain")).toEqual([expect.objectContaining({ amount: "0.04", cap: "0.03" })]);
    expect(w.said.join("\n")).toMatch(/^PAID +0\.03 to Stockline inside the mandate/m);
  });

  it("stopped by the budget at the read before the attempt over the cap, it is a budget stop and no failed refusal; however often it runs, a payment id is started once", async () => {
    await world();
    const b = await bound();
    // The process stops after the CLI paid; then the budget holds one more line: the read of the mandate is over it.
    const d = w.again();
    await expect(pay({ ...d, cli: (args, ok) => { d.cli(args, ok); throw new Error("the process stopped here"); } })).rejects.toThrow(/stopped here/);
    const used = readOwnersCalls(w.log).length;
    let stop: unknown;
    try { await pay(w.again({ budget: used + 1 })); } catch (e) { stop = e; }
    expect(stop).toBeInstanceOf(OwnersBudgetSpent);
    expect((stop as Error).message).toMatch(new RegExp(`^the owners call budget of ${used + 1} lines is spent .*eth_call \\(pay\\) was not sent`));
    expect(events("owners.over_cap_not_refused")).toEqual([]);
    expect(w.cliRuns.filter((run) => run.includes("--record-refusal"))).toEqual([]);
    const r = await pay(w.again());
    expect(r.over).toMatchObject({ refused: true });
    expect(events("owners.pay_started").map((e) => e.subject)).toEqual([`owners-${b.id}-inside`, `owners-${b.id}-over-cap`]);
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

describe("owners pay, once the owners raised the cap", () => {
  const arg = (run: string[], k: string) => run[run.indexOf(k) + 1];

  it("pays exactly the amount Metal refused before, once, under the replaced mandate, and tries nothing over the new cap", async () => {
    await world();
    const b = await bound();
    const first = await pay(w.again());
    const r = await replaced(10, 50);
    const [from, runs, told] = [readOwnersCalls(w.log).length, w.cliRuns.length, w.said.length];
    const again = await pay(w.again());
    const payee = keyAddress("supplier.key.json");
    const id = `owners-${r.id}-after-${b.id}`;
    expect(again).toEqual({ inside: null, over: null, afterRefusal: { amount: "0.06", outcome: "PAID", tx: expect.stringMatching(/^0x[0-9a-f]{64}$/), refused: { tx: first.over!.tx, proposal_id: b.id, payment_id: `owners-${b.id}-over-cap` } } });
    // One run of the CLI: 0.06 to the same payee, under the new credential, with the mandate key alone.
    expect(w.cliRuns.slice(runs).map((run) => [cliCommand(run), arg(run, "--amount"), arg(run, "--to"), arg(run, "--payment-id"), arg(run, "--credential"), run.includes("--record-refusal"), run.includes("--key")])).toEqual([
      ["mandate pull", "0.06", payee, id, join(w.keys, "owners", `${r.id}.credential.json`), false, false],
    ]);
    expect(w.calls(from)).toEqual(["pay:cli:mandate pull"]);
    // The ledger: the payment id before the CLI started, then the payment, naming the refusal it makes good.
    expect(events("owners.pay_started").at(-1)).toMatchObject({ subject: id, amount: "0.06", kind: "the amount Metal refused before" });
    expect(events("owners.paid").at(-1)).toMatchObject({
      subject: id, proposal_id: r.id, mandate: r.terms.action.mandate, amount: "0.06", to: payee, tx: again.afterRefusal!.tx,
      after_refusal: { tx: first.over!.tx, proposal_id: b.id, payment_id: `owners-${b.id}-over-cap`, cap_then: "0.05", cap_now: "0.10" },
      origin: { actor: "code", agent: "sourcing", rule: expect.stringMatching(/the amount Metal refused before/) },
    });
    expect(again.afterRefusal!.tx).not.toBe(first.over!.tx);
    expect(events("owners.refused_on_chain")).toHaveLength(1);
    expect(w.said.slice(told).join("\n")).toMatch(new RegExp(`^PAID +0\\.06 to Stockline: the payment Metal refused before, now inside the 0\\.10 cap ${r.id} set; the mandate key alone signed\n +refused on chain then: \\S+${first.over!.tx}\n +paid now: \\S+${again.afterRefusal!.tx}$`));
    expect(w.node.mandates.get(r.terms.action.mandate.toLowerCase())).toMatchObject({ spent: centsToBaseUnits(11) });

    // Run again: nothing is paid, nothing is tried over the new cap, no call.
    const [calls, cli] = [readOwnersCalls(w.log).length, w.cliRuns.length];
    const third = await pay(w.again());
    expect(third.afterRefusal).toMatchObject({ outcome: "PAID", tx: again.afterRefusal!.tx });
    expect(readOwnersCalls(w.log)).toHaveLength(calls);
    expect(w.cliRuns).toHaveLength(cli);
    expect(events("owners.paid")).toHaveLength(2);
    expect(w.said.at(-1)).toMatch(/recorded earlier/);
  });

  it("stopped after the CLI paid and before the ledger had it, the next run asks the CLI, which pays an id once", async () => {
    await world();
    const b = await bound();
    await pay(w.again());
    const r = await replaced(10, 50);
    const d = w.again();
    await expect(pay({ ...d, cli: (args, ok) => { d.cli(args, ok); throw new Error("the process stopped here"); } })).rejects.toThrow(/stopped here/);
    expect(events("owners.paid")).toHaveLength(1);
    const again = await pay(w.again());
    expect(again.afterRefusal).toMatchObject({ outcome: "PAID", amount: "0.06" });
    expect(events("owners.paid").at(-1)).toMatchObject({ subject: `owners-${r.id}-after-${b.id}`, already: true });
    // Paid once: the mandate's spend on the stand-in chain is 0.05 and 0.06, not 0.06 twice.
    expect(w.node.mandates.get(r.terms.action.mandate.toLowerCase())).toMatchObject({ spent: centsToBaseUnits(11), occurrences: 2n });
    expect(events("owners.pay_started").filter((e) => e.subject === `owners-${r.id}-after-${b.id}`)).toHaveLength(1);
  });

  it("the same when the cap was raised by a revoke and a new bind", async () => {
    await world();
    const b = await bound();
    const first = await pay(w.again());
    const revoke = await proposeRevoke(w.again());
    await w.signBoth(revoke.proposal.proposal_id);
    await w.relay(revoke.proposal.proposal_id);
    const { proposal } = await propose(w.again(), { capCents: 10, budgetCents: 50 });
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    const runs = w.cliRuns.length;
    const again = await pay(w.again());
    expect(again.afterRefusal).toMatchObject({ amount: "0.06", outcome: "PAID", refused: { tx: first.over!.tx, proposal_id: b.id } });
    expect(w.cliRuns.slice(runs).map((run) => [arg(run, "--amount"), arg(run, "--payment-id"), arg(run, "--credential")])).toEqual([["0.06", `owners-${proposal.proposal_id}-after-${b.id}`, join(w.keys, "owners", `${proposal.proposal_id}.credential.json`)]]);
  });

  it("a refusal still over the cap is left alone: pay does what it does for any bound mandate", async () => {
    await world();
    await bound();
    await pay(w.again());
    const revoke = await proposeRevoke(w.again());
    await w.signBoth(revoke.proposal.proposal_id);
    await w.relay(revoke.proposal.proposal_id);
    // Bound again with the same 0.05 cap: 0.06 is still over it.
    const { proposal } = await propose(w.again());
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    const runs = w.cliRuns.length;
    const r = await pay(w.again());
    expect(r.afterRefusal).toBeNull();
    expect(r.inside).toMatchObject({ outcome: "PAID" });
    expect(r.over).toMatchObject({ refused: true });
    expect(w.cliRuns.slice(runs).map((run) => [arg(run, "--amount"), arg(run, "--payment-id")])).toEqual([["0.05", `owners-${proposal.proposal_id}-inside`], ["0.06", `owners-${proposal.proposal_id}-over-cap`]]);
  });

  it("when Metal does not pay it, the ledger says so and nothing is called paid", async () => {
    await world();
    await bound();
    await pay(w.again());
    // 0.45 more spent under the mandate on chain than this ledger knows: 0.06 would pass the 0.50 budget.
    const r = await replaced(10, 50);
    const ref = r.terms.action.mandate.toLowerCase();
    w.node.mandates.set(ref, { ...w.node.mandates.get(ref)!, spent: centsToBaseUnits(45) });
    await expect(pay(w.again())).rejects.toThrow(/the payment of 0\.06 Metal refused before was not paid now: refused \(mandate_budget_spent/);
    expect(events("owners.pay_not_paid").at(-1)).toMatchObject({ amount: "0.06", outcome: "REFUSED", reason: expect.stringMatching(/mandate_budget_spent/) });
    expect(events("owners.paid")).toHaveLength(1);
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
    expect(callsLine(w.d, from)).toMatch(new RegExp(`^CALLS +${from + 1} of 200 lines in the call log used in this world \\(this command: 1\\)`));
    // Stopped by the budget at its one read, it is the budget's own stop, however the client wrapped it.
    await expect(status(w.again({ budget: from + 1 }))).rejects.toThrow(OwnersBudgetSpent);
  });

  it("reports the mandate that is bound, whatever was filed last; with none that ran it says so and reads nothing", async () => {
    await world();
    await setup(w.d);
    const { proposal } = await propose(w.again());
    let from = readOwnersCalls(w.log).length;
    expect(await status(w.again())).toBeNull();
    expect(readOwnersCalls(w.log)).toHaveLength(from);
    expect(w.said.at(-1)).toMatch(/^ACCOUNT +0x[0-9a-fA-F]{40}; no owners_execute has run yet$/);
    await w.signBoth(proposal.proposal_id);
    await w.relay(proposal.proposal_id);
    // A replace that nobody signed and that ran out names a mandate the chain never bound.
    await proposeReplace(w.again(), { capCents: 10, budgetCents: 50 });
    w.clock.now = new Date(T0.getTime() + 16 * 60_000);
    from = readOwnersCalls(w.log).length;
    expect(await status(w.again())).toMatchObject({ bound: true, revoked: false });
    expect(w.said.at(-1)).toMatch(new RegExp(`proposal ${proposal.proposal_id} \\(bind\\) EXECUTED; bound yes; revoked no`));
    expect(w.calls(from)).toEqual(["status:eth_call"]);
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
    // The world is named, never taken by default: without the ledger's or the keys folder's name nothing is opened or made.
    expect(preflightRefusals(ready({ KIT11_DB: undefined }))).toEqual([expect.stringMatching(/^KIT11_DB \(this world's ledger/)]);
    expect(preflightRefusals(ready({ KIT11_KEYS_DIR: undefined }))).toEqual([expect.stringMatching(/^KIT11_KEYS_DIR \(this world's keys folder/)]);
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
    expect(text).toContain('on the phone: Open the approval link within 15 minutes. Check: "Bind the sourcing mandate, signed on chain", "0.50 USDZ in total" and the payee Stockline; under "Details", "Up to 0.05 per payment". Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.');
    // The replace: the scene's own amounts, the ones the command is typed with.
    expect(text).toMatch(/7 propose the replace +npm run owners -- propose-replace 0\.10 0\.50\n +calls: 1 request; transactions: none\n +on the phone: Open the approval link within 15 minutes\. Check: "Replace the sourcing mandate, signed on chain", under "Per payment" "0\.10 USDZ \(0\.05 before\)", and the payee Stockline; under "Details", "0\.50 in total \(0\.50 before\)"\. Tap/);
    expect(text).toMatch(/7 pay again +npm run owners -- pay\n +calls: 0 requests and 1 CLI run; transactions: 0\.06 to Stockline, the amount refused in step 6, now inside the new cap \(signed by the mandate key, sent by Metal's facilitator\)\n +on the phone: nothing/);
    expect(text).toMatch(/TOTAL +9 transactions; 36 to 54 lines in the call log \(3 of them CLI runs\)/);
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
    expect(r.problems).toEqual([expect.stringMatching(/no WebAuthn verifier/), expect.stringMatching(/holds 3\.00 test USD, not enough/), expect.stringMatching(/budget of 20 \(3 used, 17 left\) is below the 51 lines .*and below the 33 it takes at least/)]);
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
      await step("7 propose the replace", async () => { id = (await proposeReplace(w.again(), REPLACE)).proposal.proposal_id; });
      await w.signBoth(id);
      await step("7 the runner relays it", () => w.relay(id));
      await step("7 pay again", () => pay(w.again()));
      await step("8 propose the revoke", async () => { id = (await proposeRevoke(w.again())).proposal.proposal_id; });
      await w.signBoth(id);
      await step("8 the runner relays it", () => w.relay(id));
      await step("9 status", () => status(w.again()));
      const t = planTotals(plan);
      expect(used()).toBe(t.lines[pick]);
      expect(w.node.sent().length + w.cliRuns.length).toBe(t.transactions);
      w.close();
    }
  });

  it("ends with the record, which costs no call, and offers both ways to a second approver", () => {
    const plan = ownersPlan({ funding: "donor", polls: 4 });
    expect(plan.at(-1)).toEqual({ step: "9 record", command: "npm run owners -- record", transactions: [], requests: { min: 0, max: 0 }, cli_runs: 0, phone: "nothing" });
    // The scene in order: bind, pay and the refusal, the replace and the refused amount paid, the revoke; then status and the record.
    expect(plan.map((s) => s.step)).toEqual([
      "1 preflight", "2 the owner's passkey", "3 the second approver", "4 setup", "5 propose the bind", "5 the runner relays it", "6 pay",
      "7 propose the replace", "7 the runner relays it", "7 pay again", "8 propose the revoke", "8 the runner relays it", "9 status", "9 record",
    ]);
    expect(planTotals(plan)).toEqual({ transactions: 9, cli_runs: 3, lines: { min: 36, max: 54 } });
    // The replace is the scene's own (REPLACE), in the command and in what the phone shows, for the replace and for the revoke after it.
    expect(REPLACE).toEqual({ capCents: 10, budgetCents: 50 });
    const sign = (check: string) => `Open the approval link within ${SIGN_MINUTES} minutes. Check: ${check}. Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.`;
    expect(plan.find((s) => s.step === "5 propose the bind")!.phone).toBe(sign('"Bind the sourcing mandate, signed on chain", "0.50 USDZ in total" and the payee Stockline; under "Details", "Up to 0.05 per payment"'));
    expect(plan.find((s) => s.step === "7 propose the replace")).toMatchObject({ command: "npm run owners -- propose-replace 0.10 0.50", phone: sign('"Replace the sourcing mandate, signed on chain", under "Per payment" "0.10 USDZ (0.05 before)", and the payee Stockline; under "Details", "0.50 in total (0.50 before)"') });
    expect(plan.find((s) => s.step === "8 propose the revoke")!.phone).toBe(sign('"Revoke the sourcing mandate, signed on chain" and the payee Stockline; under "Details", "It ends the mandate that allowed up to 0.10 per payment, 0.50 in total"'));
    // Another replace than the scene's is planned with its own amounts.
    const other = ownersPlan({ funding: "donor", polls: 4, replace: { capCents: 20, budgetCents: 60 } });
    expect(other.find((s) => s.step === "7 propose the replace")).toMatchObject({ command: "npm run owners -- propose-replace 0.20 0.60", phone: expect.stringContaining('under "Per payment" "0.20 USDZ (0.05 before)", and the payee Stockline; under "Details", "0.60 in total (0.50 before)"') });
    expect(other.find((s) => s.step === "8 propose the revoke")!.phone).toContain('"It ends the mandate that allowed up to 0.20 per payment, 0.60 in total"');
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

describe("what the plan tells the owner to check, against the approval page and the proposals themselves", () => {
  it("quotes the page's own words for the scene's three proposals, and the times a proposal really carries", async () => {
    const { describeTerms } = await import("../src/approve/client.js");
    await world();
    const b = await bound();
    const quoted = (step: string) => [...ownersPlan({ funding: "donor", polls: 4 }).find((s) => s.step === step)!.phone.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((q) => !/^(Details|Per payment|Approve with Face ID|1 of 2 approvals)$/.test(q));
    /** Everything the page shows of these terms before and under "Details": the title, the amount's label and value, the payee, the sentence. */
    const shown = (terms: OwnersExecuteTerms) => { const f = describeTerms(terms as never, {}); return [f.title, f.amountLabel ?? "Amount", f.amount, f.recipient, f.sentence].join("\n"); };
    for (const q of quoted("5 propose the bind")) expect(shown(b.terms), q).toContain(q);
    await pay(w.again());
    const replace = await proposeReplace(w.again(), REPLACE);
    expect(quoted("7 propose the replace")).toHaveLength(3);
    for (const q of quoted("7 propose the replace")) expect(shown(replace.terms), q).toContain(q);
    expect(describeTerms(replace.terms as never, {}).amountLabel).toBe("Per payment");
    await w.signBoth(replace.proposal.proposal_id);
    await w.relay(replace.proposal.proposal_id);
    const revoke = await proposeRevoke(w.again());
    for (const q of quoted("8 propose the revoke")) expect(shown(revoke.terms), q).toContain(q);
    // Fifteen minutes to sign, and the signed deadline two minutes later: the constants are what a proposal carries.
    expect([SIGN_MINUTES, DEADLINE_SECONDS]).toEqual([15, 120]);
    expect(Date.parse(revoke.terms.expires_at) - w.clock.now.getTime()).toBe(SIGN_MINUTES * 60_000);
    expect(Number(revoke.terms.valid_until) - Date.parse(revoke.terms.expires_at) / 1000).toBe(DEADLINE_SECONDS);
    expect(MANDATE.capCents).toBeLessThan(REPLACE.capCents);
  });

  it("files each proposal as started by a person's command, not planned by an agent", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    await world();
    const b = await bound();
    const replace = await proposeReplace(w.again(), REPLACE);
    await w.signBoth(replace.proposal.proposal_id);
    await w.relay(replace.proposal.proposal_id);
    const revoke = await proposeRevoke(w.again());
    expect(events("proposal.created").map((e) => e.origin)).toEqual(["propose", "propose-replace", "propose-revoke"].map((c) => ({ actor: "cfo-command", command: `npm run owners -- ${c}`, moves_money: false })));
    // The role that owns the proposal stays (four eyes reads it); the feed names the command, not an agent.
    expect((w.db.prepare("SELECT DISTINCT created_by FROM proposals").all() as { created_by: string }[]).map((r) => r.created_by)).toEqual(["treasury"]);
    expect(b.id).not.toBe(revoke.proposal.proposal_id);
    const line = buildSnapshot(w.db).feed.find((f) => f.event === "proposal.created" && f.text.includes(revoke.proposal.proposal_id))!.text;
    expect(line).toMatch(new RegExp(`${revoke.proposal.proposal_id} .*with npm run owners -- propose-revoke$`));
    expect(line).not.toMatch(/agent proposed/i);
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
    expect(feed.find((f) => f.event === "owners.paid")).toMatchObject({ text: "The Sourcing agent paid 0.05 USDZ to Stockline inside its mandate on the passkey account: its mandate key signed, no owner did", tone: "ok", tx: r.inside!.tx });
    expect(feed.find((f) => f.event === "owners.refused_on_chain")).toMatchObject({ text: "Metal refused 0.06 USDZ to Stockline, over the mandate's 0.05 cap, and recorded the refusal on chain", tone: "refusal", tx: r.over!.tx });
  });

  it("reads right for a replace and for the refused amount paid after it", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    await world();
    await bound();
    await pay(w.again());
    const r = await replaced(10, 50);
    const again = await pay(w.again());
    const feed = buildSnapshot(w.db).feed;
    expect(feed.find((f) => f.event === "owners.executed" && f.text.includes(r.id))).toMatchObject({ text: `Both passkeys signed ${r.id} on chain and the account ran it: replace the sourcing mandate (up to 0.10 a payment, 0.50 in total); the runner only relayed it`, tone: "ok" });
    expect(feed.find((f) => f.event === "owners.paid" && f.text.includes("0.06"))).toMatchObject({ text: "The Sourcing agent paid 0.06 USDZ to Stockline inside its mandate on the passkey account: its mandate key signed, no owner did", tone: "ok", tx: again.afterRefusal!.tx });
    expect(feed.filter((f) => f.event.startsWith("owners.")).filter((f) => f.text.startsWith("owners."))).toEqual([]);
  });

  it("says in plain words that the account refused a call, with its reason", async () => {
    const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
    const { audit } = await import("../src/audit/log.js");
    await world();
    audit(w.db, "owner-signer", "owners.reverted", "P-0007", { account: "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea", tx: `0x${"ab".repeat(32)}`, reason: "AlreadyRevoked()" }, T0);
    expect(buildSnapshot(w.db).feed.find((f) => f.event === "owners.reverted")).toMatchObject({ text: "The account refused P-0007 on chain: AlreadyRevoked()", tone: "refusal", tx: `0x${"ab".repeat(32)}` });
  });
});
