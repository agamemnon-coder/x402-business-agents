// npm run compliance-policy: programmable compliance on Metal testnet, live (enterprise item 2). In a separate test
// world (KIT11_KEYS_DIR, default ../x402-business-agents-keys/compliance) with test keys and test money:
//   1. deploys ComplianceSendPolicy (contracts/, the committed artifact) with Purser's compliance key as the signer and
//      the payer key as the only operator, and funds it with 2.00 test USD;
//   2. screens the payee (inside signDecision, src/compliance/screening.ts), signs the decision, and pays 0.50: paid;
//      Purser also signs a decision and then cancels it on chain;
//   3. runs the red team's attacks, each simulated for the contract's reason and then sent with the gas the good
//      payment used, so each refusal stands on chain as a reverted transaction:
//      no decision, a decision by another key, the same decision twice, a decision for another payee, a raised amount,
//      an expired decision, a valid decision sent by someone else, a malleated signature, a decision for another
//      contract, a cancelled decision, and a sanctioned payee (Purser refuses to sign; a self-made decision is refused by the chain);
//   4. stores Metal's finality certificate for every transaction. Writes docs/runs/compliance-policy.json (RUN_OUT names another run, so earlier records stay).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BaseError, ContractFunctionRevertedError, createWalletClient, custom, encodeDeployData, encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/compliance");
const { keyPath, metalAgent } = await import("../metal/agentCli.js");
const { publicClient, readKeyFile, transferUsdz, usdzBalance } = await import("../metal/chain.js");
const { CHAIN_ID, EXPLORER_TX, USDZ } = await import("../metal/network.js");
const { loadArtifact } = await import("../compliance/compile.js");
const { DECISION_TYPES, policyDomain, screenPayee, signCancel, signDecision } = await import("../compliance/screening.js");
const { openDb } = await import("../db/open.js");
const { certifyTxs, finalityOf } = await import("../metal/finality.js");
const { baseUnitsToCents, centsToBaseUnits, fromCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");

const art = loadArtifact();
const pc = publicClient();
const say = (s: string) => console.log(redactSecrets(s));
type Outcome = "done" | "refused" | "reverted";
const steps: { step: string; outcome: Outcome; tx: string | null; detail: string }[] = [];
const record = (step: string, outcome: Outcome, tx: string | null, detail: string) => {
  steps.push({ step, outcome, tx, detail });
  say(`${outcome.padEnd(8)} ${step}${tx ? `  ${EXPLORER_TX}${tx}` : ""}  ${detail}`);
};
function key(file: string): PrivateKeyAccount {
  if (!existsSync(keyPath(file))) metalAgent(["key", "create", "--out", keyPath(file)]);
  return privateKeyToAccount(readKeyFile(keyPath(file)).privateKey);
}
const operator = key("operator.key.json");
const compliance = key("compliance.key.json");
const attacker = key("attacker.key.json");
const payee = key("payee.key.json").address;
const sanctioned = key("sanctioned-stand-in.key.json").address;
const lists = { approved: [payee, sanctioned], sanctioned: [sanctioned], version: "purser-test-list-2026-10-30 (a stand-in address, not a real sanctions list)" };

const walletOf = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain: pc.chain, transport: custom(pc) });
async function sendTx(from: PrivateKeyAccount, to: Address | null, data: Hex, gas?: bigint): Promise<{ tx: Hex; ok: boolean; gasUsed: bigint; gas: bigint }> {
  const g = gas ?? ((await pc.estimateGas({ account: from.address, to: to ?? undefined, data })) * 6n) / 5n;
  const tx = await walletOf(from).sendTransaction({ to, data, gas: g, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, chain: pc.chain, account: from });
  const r = await pc.waitForTransactionReceipt({ hash: tx });
  return { tx, ok: r.status === "success", gasUsed: r.gasUsed, gas: g };
}
/** The contract's custom error for a call, from a simulation. */
async function reason(contract: Address, from: Address, args: readonly unknown[]): Promise<string> {
  try {
    await pc.simulateContract({ address: contract, abi: art.abi, functionName: "send", args, account: from });
    return "the simulation passed";
  } catch (e) {
    const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    return rev instanceof ContractFunctionRevertedError ? rev.data?.errorName ?? rev.shortMessage : redactSecrets(((e as Error).message ?? "").split("\n")[0]!.slice(0, 120));
  }
}

// 0. Gas for the operator and the attacker; the contract deployed and funded.
for (const a of [operator, attacker]) if ((await usdzBalance(a.address)) < centsToBaseUnits(1000)) { metalAgent(["fund", a.address]); say(`${a === operator ? "operator" : "attacker"} funded from the faucet`); }
const deployData = encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [USDZ, compliance.address, operator.address] });
const dep = await sendTx(operator, null, deployData);
const contract = (await pc.getTransactionReceipt({ hash: dep.tx })).contractAddress as Address;
record("deploy ComplianceSendPolicy: signer = Purser's compliance key, operator = the payer key", dep.ok ? "done" : "reverted", dep.tx, `contract ${contract}`);
const fund = await transferUsdz(keyPath("operator.key.json"), contract, centsToBaseUnits(200));
record("fund the contract with 2.00 test USD", "done", fund, "");

const now = BigInt(Math.floor(Date.now() / 1000));
const pid = (label: string) => keccak256(toHex(`purser:${contract}:${label}`));
const amount = centsToBaseUnits(50);
const validUntil = now + 3000n;
/** Purser's decision for the payee: screened inside signDecision, which signs nothing for a payee that fails. */
const decide = (paymentId: Hex, a: { amt?: bigint; until?: bigint; contractFor?: Address } = {}) =>
  signDecision(compliance, { chainId: CHAIN_ID, contract: a.contractFor ?? contract, payee, lists, paymentId, amount: a.amt ?? amount, validUntil: a.until ?? validUntil, now });
/** A decision made by some other key, as an attacker would: same typed data, wrong signer. */
const forge = (key: PrivateKeyAccount, m: { paymentId: Hex; to: Address; amount: bigint; validUntil: bigint; screeningRef: Hex }) =>
  key.signTypedData({ domain: policyDomain(CHAIN_ID, contract), types: DECISION_TYPES, primaryType: "Decision", message: m });
const sendData = (a: readonly unknown[]) => encodeFunctionData({ abi: art.abi, functionName: "send", args: a });
const args = (paymentId: Hex, to: Address, amt: bigint, until: bigint, ref: Hex, sig: Hex) => [paymentId, to, amt, until, ref, sig] as const;

// 1. The good payment: screened, decided, paid.
const good = await decide(pid("good"));
const before = await usdzBalance(payee);
const ok = await sendTx(operator, contract, sendData(args(pid("good"), payee, amount, validUntil, good.screening.ref, good.signature)));
record(`pay 0.50 to the screened payee with Purser's signed decision (screened: ${good.screening.cleared ? "cleared" : "refused"})`, ok.ok ? "done" : "reverted", ok.tx, ok.ok ? `the payee received ${fromCents(baseUnitsToCents((await usdzBalance(payee)) - before))}` : "UNEXPECTED: reverted");
const gas = ok.gas;

// 2. Purser withdraws a decision before it is used: anyone may submit the signed cancellation; it only stops a payment.
const withdrawn = await decide(pid("withdrawn"));
const cancelData = encodeFunctionData({ abi: art.abi, functionName: "cancel", args: [pid("withdrawn"), await signCancel(compliance, { chainId: CHAIN_ID, contract, paymentId: pid("withdrawn") })] });
const c = await sendTx(operator, contract, cancelData);
record("Purser cancels an unused decision (signed by the compliance key)", c.ok ? "done" : "reverted", c.tx, c.ok ? "the payment id is spent; the decision can no longer pay" : "UNEXPECTED: reverted");

// 3. The attacks. Each is a call the chain must refuse.
const otherContract = "0x000000000000000000000000000000000000dEaD" as Address;
const highS = (sig: Hex): Hex => {
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const sv = BigInt(`0x${sig.slice(66, 130)}`);
  const v = parseInt(sig.slice(130, 132), 16);
  return `${sig.slice(0, 66)}${(N - sv).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as Hex;
};
const ref = good.screening.ref;
const redirect = await decide(pid("redirect"));
const raise = await decide(pid("raise"));
const expired = await decide(pid("expired"), { until: now - 60n });
const thief = await decide(pid("thief"));
const malleable = await decide(pid("malleable"));
const domain = await decide(pid("domain"), { contractFor: otherContract });
const attacks: { name: string; from: PrivateKeyAccount; a: readonly unknown[] }[] = [
  { name: "no decision at all", from: operator, a: args(pid("none"), payee, amount, validUntil, ref, "0x") },
  { name: "a decision signed by another key (the attacker's)", from: operator, a: args(pid("forged"), payee, amount, validUntil, ref, await forge(attacker, { paymentId: pid("forged"), to: payee, amount, validUntil, screeningRef: ref })) },
  { name: "the same decision a second time (replay)", from: operator, a: args(pid("good"), payee, amount, validUntil, ref, good.signature) },
  { name: "the payee's decision used to pay the attacker", from: operator, a: args(pid("redirect"), attacker.address, amount, validUntil, redirect.screening.ref, redirect.signature) },
  { name: "the amount raised from 0.50 to 1.50 under the same decision", from: operator, a: args(pid("raise"), payee, centsToBaseUnits(150), validUntil, raise.screening.ref, raise.signature) },
  { name: "an expired decision", from: operator, a: args(pid("expired"), payee, amount, now - 60n, expired.screening.ref, expired.signature) },
  { name: "a valid decision submitted by someone else (the attacker's key)", from: attacker, a: args(pid("thief"), payee, amount, validUntil, thief.screening.ref, thief.signature) },
  { name: "the valid decision's signature malleated (high s)", from: operator, a: args(pid("malleable"), payee, amount, validUntil, malleable.screening.ref, highS(malleable.signature)) },
  { name: "a decision Purser signed for another contract", from: operator, a: args(pid("domain"), payee, amount, validUntil, domain.screening.ref, domain.signature) },
  { name: "a decision Purser cancelled", from: operator, a: args(pid("withdrawn"), payee, amount, validUntil, withdrawn.screening.ref, withdrawn.signature) },
];
// The sanctioned payee: Purser's screening refuses, so the compliance key signs nothing; the attacker makes its own.
let refusedToSign = "";
try { await signDecision(compliance, { chainId: CHAIN_ID, contract, payee: sanctioned, lists, paymentId: pid("sanctioned"), amount, validUntil, now }); } catch (e) { refusedToSign = (e as Error).message; }
record("Purser screens a sanctioned payee (a stand-in address on the test list)", refusedToSign ? "refused" : "done", null, refusedToSign ? `no decision signed: ${refusedToSign.split(": ").slice(1).join(": ")}` : "UNEXPECTED: signed");
const sanctionRef = screenPayee(sanctioned, lists, now).ref;
attacks.push({ name: "pay the sanctioned payee with a decision the attacker made itself", from: operator, a: args(pid("sanctioned"), sanctioned, amount, validUntil, sanctionRef,
  await forge(attacker, { paymentId: pid("sanctioned"), to: sanctioned, amount, validUntil, screeningRef: sanctionRef })) });

for (const at of attacks) {
  const why = await reason(contract, at.from.address, at.a);
  const r = await sendTx(at.from, contract, sendData(at.a), gas);
  record(`attack: ${at.name}`, r.ok ? "done" : "reverted", r.tx, r.ok ? "UNEXPECTED: paid" : `reverted on chain (${why}); used ${r.gasUsed} of ${r.gas} gas`);
}
const left = await usdzBalance(contract);
say(`the contract holds ${fromCents(baseUnitsToCents(left))}: only the good payment left it`);

// 3. Finality certificates for every transaction.
mkdirSync(resolve(import.meta.dirname, "../../data"), { recursive: true });
const db = openDb(resolve(import.meta.dirname, `../../data/${process.env.RUN_OUT ?? "compliance-policy"}.sqlite`));
const txs = steps.map((s) => s.tx).filter((t): t is string => !!t);
for (let i = 0; i < 12; i++) { if ((await certifyTxs(db, txs)).pending === 0) break; await new Promise((r) => setTimeout(r, 5000)); }
const out = {
  ran_at: new Date().toISOString(), network: "Metal testnet", contract, compiler: art.compiler, source_sha256: art.source_sha256,
  compliance_signer: compliance.address, operator: operator.address, payee, sanctioned_stand_in: sanctioned, list: lists.version,
  contract_balance_after: fromCents(baseUnitsToCents(left)),
  steps: steps.map((s) => ({ ...s, finality: s.tx ? (() => { const f = finalityOf(db, s.tx); return f ? { status: f.status, block: f.block_number, signers: f.check?.quorum.signers ?? null, participants: f.check?.quorum.participants ?? null } : null; })() : null })),
};
writeFileSync(resolve(import.meta.dirname, `../../docs/runs/${process.env.RUN_OUT ?? "compliance-policy"}.json`), JSON.stringify(out, null, 2) + "\n");
say(`\n${steps.filter((s) => s.detail.startsWith("UNEXPECTED")).length} unexpected; ${out.steps.filter((s) => s.finality?.status === "REPORTED").length} of ${txs.length} transactions with a reported finality certificate; docs/runs/compliance-policy.json`);
