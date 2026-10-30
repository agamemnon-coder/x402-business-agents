// npm run four-eyes: four eyes on chain, live on Metal testnet (enterprise item 1). A separate test world with its own
// test keys (KIT11_KEYS_DIR, default ../x402-business-agents-keys/four-eyes): a business account whose owners are the
// CFO's key and the controller's key with a threshold of two, and one agent mandate on it. Then, each step recorded:
//   1. the mandate bound with the CFO's signature alone: refused by the account; with both: bound;
//   2. the agent pays inside its mandate alone; above the cap the chain refuses it;
//   3. a large payment from the account with the CFO alone, and with the CFO plus a stranger: each sent, each reverted
//      on chain; with the CFO and the controller: paid;
//   4. the mandate revoked with the CFO alone: reverted on chain; with both: revoked;
//   5. Metal's finality certificate for every transaction above (src/metal/finality.ts).
// A refused transaction is sent with the gas its two-signature twin needs, so it cannot fail for want of gas.
// Test money only (*USDZ on testnet); the keys are test keys and never printed. Writes docs/runs/four-eyes.json.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, custom, encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/four-eyes");
const { keyPath, metalAgent, CliError } = await import("../metal/agentCli.js");
const { publicClient, readKeyFile, transferUsdz, usdzBalance } = await import("../metal/chain.js");
const { CHAIN_ID, EXPLORER_TX, USDZ } = await import("../metal/network.js");
const { accountAbi, accountConfig, factoryAbi, quorumLane, signedExecution } = await import("../metal/fourEyes.js");
const { revokeCall } = await import("@metalntwx/metal-pay/mandates");
const { openDb } = await import("../db/open.js");
const { certifyTxs, finalityOf } = await import("../metal/finality.js");
const { baseUnitsToCents, centsToBaseUnits, fromCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");

const FACTORY = "0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8" as Address;
const pc = publicClient();
const say = (s: string) => console.log(redactSecrets(s));
const steps: { step: string; outcome: "done" | "refused" | "reverted"; tx: string | null; detail: string }[] = [];
const record = (step: string, outcome: "done" | "refused" | "reverted", tx: string | null, detail: string) => {
  steps.push({ step, outcome, tx, detail });
  say(`${outcome.padEnd(8)} ${step}${tx ? `  ${EXPLORER_TX}${tx}` : ""}  ${detail}`);
};

function key(file: string): PrivateKeyAccount {
  if (!existsSync(keyPath(file))) metalAgent(["key", "create", "--out", keyPath(file)]);
  return privateKeyToAccount(readKeyFile(keyPath(file)).privateKey);
}
const sponsor = key("sponsor.key.json");
const cfo = key("cfo.key.json");
const controller = key("controller.key.json");
const stranger = key("stranger.key.json");
const payee = key("payee.key.json");
const wallet = createWalletClient({ account: sponsor, chain: pc.chain, transport: custom(pc) });

/** Sends a call from the sponsor; `gas` set means sent as is, so a call the chain refuses lands as a reverted transaction. */
async function send(to: Address, data: Hex, gas?: bigint): Promise<{ tx: Hex; ok: boolean }> {
  const g = gas ?? ((await pc.estimateGas({ account: sponsor.address, to, data })) * 6n) / 5n;
  const tx = await wallet.sendTransaction({ to, data, gas: g, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, chain: pc.chain, account: sponsor });
  const r = await pc.waitForTransactionReceipt({ hash: tx });
  return { tx, ok: r.status === "success" };
}
/** Why the chain refuses a call, from a simulation (a short revert reason or error name, never the RPC's URL). */
async function whyRefused(to: Address, data: Hex): Promise<string> {
  try {
    await pc.call({ account: sponsor.address, to, data });
    return "the simulation passed";
  } catch (e) {
    const m = (e as { shortMessage?: string; message: string }).shortMessage ?? (e as Error).message;
    return redactSecrets(m.split("\n")[0]!.slice(0, 160));
  }
}

// 0. Gas for the sponsor (faucet), the 2-of-2 account, and 3.00 test USD in it.
if ((await usdzBalance(sponsor.address)) < centsToBaseUnits(2000)) { metalAgent(["fund", sponsor.address]); say("sponsor funded from the faucet"); }
const config = accountConfig([cfo.address, controller.address], 2);
const account = (await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: "predictAccount", args: config })) as Address;
const code = await pc.getCode({ address: account });
if (!code || code === "0x") {
  const r = await send(FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: config }));
  record("create the business account: owners CFO and controller, threshold 2", r.ok ? "done" : "reverted", r.tx, `account ${account}`);
} else say(`account ${account} exists (owners CFO and controller, threshold 2)`);
if ((await usdzBalance(account)) < centsToBaseUnits(150)) {
  const tx = await transferUsdz(keyPath("sponsor.key.json"), account, centsToBaseUnits(300) - (await usdzBalance(account)));
  record("fund the account to 3.00 test USD", "done", tx, "");
}

// 1. The agent's mandate: cap 0.05 a payment, budget 1.00, one payee.
const cred = keyPath("agent.credential.json");
if (!existsSync(cred)) metalAgent(["mandate", "credential", "create", "--principal", account, "--cap", "0.05", "--budget", "1.00", "--payee", `${payee.address},Stockline (test payee)`, "--expires-in", String(30 * 86400), "--description", "kit11 four-eyes agent", "--key", keyPath("sponsor.key.json"), "--out", cred]);
const status = metalAgent(["mandate", "status", "--credential", cred]);
let reference = status.fields.get("reference")?.[0] ?? status.fields.get("mandate")?.[0] ?? "";
if (status.fields.get("bound")?.[0] !== "yes") {
  try {
    metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath("sponsor.key.json"), "--signer-key", keyPath("cfo.key.json")]);
    record("bind the mandate with the CFO's signature alone", "done", null, "UNEXPECTED: the account accepted one signature");
  } catch (e) {
    record("bind the mandate with the CFO's signature alone", "refused", null, `the account refused it: ${(e instanceof CliError ? e.result.out : (e as Error).message).split("\n").find((l) => /fail|revert|error/i.test(l))?.slice(0, 160) ?? "refused"}`);
  }
  const b = metalAgent(["mandate", "bind", "--credential", cred, "--key", keyPath("sponsor.key.json"), "--signer-key", keyPath("cfo.key.json"), "--signer-key", keyPath("controller.key.json")]);
  reference = b.fields.get("bound")?.[0] ?? reference;
  record("bind the mandate with the CFO's and the controller's signatures", "done", b.fields.get("transaction")?.[0] ?? null, `mandate ${reference.slice(0, 18)}…`);
}

// 2. The agent alone, inside and above its mandate.
const small = metalAgent(["mandate", "pull", "--credential", cred, "--to", payee.address, "--amount", "0.05", "--payment-id", `four-eyes-small-${Date.now()}`], [0, 1]);
record("the agent pays 0.05 inside its mandate, no owner signs", small.code === 0 ? "done" : "refused", small.fields.get("transaction")?.[0] ?? null, small.code === 0 ? "paid with the mandate key alone" : small.out.split("\n")[0]!.slice(0, 120));
const big = metalAgent(["mandate", "pull", "--credential", cred, "--to", payee.address, "--amount", "1.00", "--payment-id", `four-eyes-big-${Date.now()}`, "--record-refusal", "--key", keyPath("sponsor.key.json")], [0, 1]);
record("the agent tries 1.00, above its 0.05 cap", big.code === 0 ? "done" : "refused", big.fields.get("transaction")?.[0] ?? null, big.code === 0 ? "UNEXPECTED: paid" : `refused: ${(big.fields.get("refused")?.[0] ?? big.fields.get("reason")?.[0] ?? big.out.split("\n")[0]!).slice(0, 120)}`);

// 3. A large payment from the account itself: 1.00 to the payee, which only the owners can send.
const validUntil = () => BigInt(Math.floor(Date.now() / 1000)) + 900n;
const nonceFor = async () => { const lane = quorumLane(); return (lane << 64n) | (await pc.readContract({ address: account, abi: accountAbi, functionName: "nonces", args: [account, lane] })); };
const transfer = { target: USDZ as Address, value: 0n, callData: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payee.address, centsToBaseUnits(100)] }) };
const both = await signedExecution({ chainId: CHAIN_ID, account, calls: [transfer], nonce: await nonceFor(), validUntil: validUntil(), signers: [cfo, controller] });
const gasBoth = ((await pc.estimateGas({ account: sponsor.address, to: account, data: both })) * 6n) / 5n;
for (const [who, signers] of [["the CFO alone", [cfo]], ["the CFO and a stranger's key", [cfo, stranger]]] as const) {
  const data = await signedExecution({ chainId: CHAIN_ID, account, calls: [transfer], nonce: await nonceFor(), validUntil: validUntil(), signers });
  const why = await whyRefused(account, data);
  const r = await send(account, data, gasBoth);
  record(`pay 1.00 from the account, signed by ${who}`, r.ok ? "done" : "reverted", r.tx, r.ok ? "UNEXPECTED: paid" : `reverted on chain with the gas the two-owner payment uses; the account's reason: ${why}`);
}
const before = await usdzBalance(payee.address);
const paid = await send(account, both, gasBoth);
record("pay 1.00 from the account, signed by the CFO and the controller", paid.ok ? "done" : "reverted", paid.tx, paid.ok ? `the payee received ${fromCents(baseUnitsToCents((await usdzBalance(payee.address)) - before))}` : "UNEXPECTED: reverted");

// 4. Revoking the mandate is the account's own call: the owners' quorum again.
if (reference && /^0x[0-9a-fA-F]{64}$/.test(reference)) {
  const revoke = { target: account, value: 0n, callData: revokeCall(account, reference as Hex).data };
  const bothRevoke = await signedExecution({ chainId: CHAIN_ID, account, calls: [revoke], nonce: await nonceFor(), validUntil: validUntil(), signers: [cfo, controller] });
  const gasRevoke = ((await pc.estimateGas({ account: sponsor.address, to: account, data: bothRevoke })) * 6n) / 5n;
  const one = await signedExecution({ chainId: CHAIN_ID, account, calls: [revoke], nonce: await nonceFor(), validUntil: validUntil(), signers: [cfo] });
  const why = await whyRefused(account, one);
  const r1 = await send(account, one, gasRevoke);
  record("revoke the mandate with the CFO's signature alone", r1.ok ? "done" : "reverted", r1.tx, r1.ok ? "UNEXPECTED: revoked" : `reverted on chain; the account's reason: ${why}`);
  const r2 = await send(account, bothRevoke, gasRevoke);
  record("revoke the mandate with the CFO's and the controller's signatures", r2.ok ? "done" : "reverted", r2.tx, r2.ok ? "revoked" : "UNEXPECTED: reverted");
  const after = metalAgent(["mandate", "pull", "--credential", cred, "--to", payee.address, "--amount", "0.05", "--payment-id", `four-eyes-after-${Date.now()}`, "--record-refusal", "--key", keyPath("sponsor.key.json")], [0, 1]);
  record("the agent tries 0.05 after the revoke", after.code === 0 ? "done" : "refused", after.fields.get("transaction")?.[0] ?? null, after.code === 0 ? "UNEXPECTED: paid" : `refused: ${(after.out.split("\n").find((l) => /mandate_|revoked|refus/i.test(l) && !/^transaction /.test(l)) ?? after.out.split("\n")[0]!).slice(0, 140)}`);
} else say(`no mandate reference to revoke (status said: ${status.out.split("\n").slice(0, 3).join(" | ")})`);

// 5. Metal's finality certificates for every transaction above, once final.
mkdirSync(resolve(import.meta.dirname, "../../data"), { recursive: true });
const db = openDb(resolve(import.meta.dirname, "../../data/four-eyes.sqlite"));
const txs = steps.map((s) => s.tx).filter((t): t is string => !!t);
for (let i = 0; i < 12; i++) {
  const r = await certifyTxs(db, txs);
  if (r.pending === 0) break;
  await new Promise((ok) => setTimeout(ok, 5000));
}
const out = {
  ran_at: new Date().toISOString(), network: "Metal testnet", account, owners: { cfo: cfo.address, controller: controller.address }, threshold: 2,
  stranger: stranger.address, payee: payee.address, mandate: reference || null,
  steps: steps.map((s) => ({ ...s, finality: s.tx ? (() => { const f = finalityOf(db, s.tx); return f ? { status: f.status, block: f.block_number, signers: f.check?.quorum.signers ?? null, participants: f.check?.quorum.participants ?? null } : null; })() : null })),
};
writeFileSync(resolve(import.meta.dirname, "../../docs/runs/four-eyes.json"), JSON.stringify(out, null, 2) + "\n");
say(`\n${steps.filter((s) => s.detail.startsWith("UNEXPECTED")).length} unexpected; ${out.steps.filter((s) => s.finality?.status === "CERTIFIED").length} of ${txs.length} transactions certified final; docs/runs/four-eyes.json`);
