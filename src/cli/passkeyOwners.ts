// npm run passkey-owners: block 1, "Face ID signs on chain", live on Metal testnet in its own test world (KIT11_KEYS_DIR,
// default ../x402-business-agents-keys/passkey-owners). A business account whose two owners are passkeys (ERC-7913
// signers: OpenZeppelin's ERC7913WebAuthnVerifier, deployed here, and each passkey's P-256 key), threshold two. No
// secp256k1 key is an owner: the sponsor only pays gas and relays. Each step recorded:
//   1. the verifier deployed (the committed artifact, OpenZeppelin 5.6.1) and checked with eth_call: a good WebAuthn
//      signature returns verify's selector, the same over another challenge returns 0xffffffff;
//   2. the account created with the two passkey owners;
//   3. a 0.10 payment from the account: the CFO's passkey alone, the CFO plus a stranger's passkey, both over another
//      challenge, both with an expired deadline: each sent and reverted on chain; both passkeys: paid; the same signed
//      batch sent again: reverted (nonce used);
//   4. a mandate bound with both passkeys through Metal's own authorizeMandateCall; with the CFO's alone: reverted;
//   5. that mandate revoked with both passkeys.
// The passkeys here are SOFTWARE STAND-INS (src/metal/softPasskey.ts): the same WebAuthn format a phone produces, keys
// in the test keys dir. Test money only; keys are never printed. Writes docs/runs/passkey-owners.json (RUN_OUT renames).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { resolve } from "node:path";
import { createWalletClient, custom, encodeDeployData, encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";

process.env.KIT11_KEYS_DIR ??= resolve(import.meta.dirname, "../../../x402-business-agents-keys/passkey-owners");
const { keyPath, metalAgent } = await import("../metal/agentCli.js");
const { publicClient, transferUsdz, usdzBalance } = await import("../metal/chain.js");
// Shared with the owners path (npm run owners): key files, the agent's payment, a credential's ingest, a revert decoded.
const { plainKey: eoa } = await import("../metal/keyFiles.js");
const { pullUnder } = await import("../metal/pull.js");
const { ingestIssued } = await import("../metal/mandate.js");
const { whyRefused: decodedRefusal } = await import("../metal/accountErrors.js");
const { CHAIN_ID, EXPLORER_TX, USDZ } = await import("../metal/network.js");
const { accountAbi, executeDigest, executionData, factoryAbi, quorumLane, ACCOUNT_BATCH_MODE } = await import("../metal/fourEyes.js");
const { passkeyQuorum, passkeySigner, webauthnSignature } = await import("../metal/passkeyOwner.js");
const { softPasskey } = await import("../metal/softPasskey.js");
const { loadVerifier } = await import("../metal/verifierCompile.js");
const { authorizeMandateCall, bindCall, revokeCall } = await import("@metalntwx/metal-pay/mandates");
const { centsToBaseUnits, fromCents, baseUnitsToCents } = await import("../lib/money.js");
const { redactSecrets } = await import("../lib/redact.js");

const FACTORY = "0x3dbED5DebA965A639bB0Fd40BE96b97922070FA8" as Address;
const VERIFY_SELECTOR = toFunctionSelector("verify(bytes,bytes32,bytes)");
const pc = publicClient();
const say = (s: string) => console.log(redactSecrets(s));
type Outcome = "done" | "reverted" | "returned";
const steps: { step: string; outcome: Outcome; tx: string | null; detail: string }[] = [];
const record = (step: string, outcome: Outcome, tx: string | null, detail: string) => {
  steps.push({ step, outcome, tx, detail });
  say(`${outcome.padEnd(8)} ${step}${tx ? `  ${EXPLORER_TX}${tx}` : ""}  ${detail}`);
};

/** A software stand-in passkey kept as a PKCS#8 PEM in the test keys dir (mode 600), made once. */
function passkey(file: string) {
  const p = keyPath(file);
  if (!existsSync(p)) writeFileSync(p, softPasskey().privateKey.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  return softPasskey(createPrivateKey(readFileSync(p, "utf8")));
}
const sponsor = eoa("sponsor.key.json");
const payee = eoa("payee.key.json");
const cfo = passkey("cfo.passkey.pem");
const controller = passkey("controller.passkey.pem");
const stranger = passkey("stranger.passkey.pem");
const wallet = createWalletClient({ account: sponsor, chain: pc.chain, transport: custom(pc) });

async function send(to: Address | null, data: Hex, gas?: bigint) {
  const g = gas ?? ((await pc.estimateGas({ account: sponsor.address, ...(to ? { to } : {}), data })) * 6n) / 5n;
  const tx = await wallet.sendTransaction({ ...(to ? { to } : {}), data, gas: g, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, chain: pc.chain, account: sponsor });
  const r = await pc.waitForTransactionReceipt({ hash: tx });
  return { tx, ok: r.status === "success", gasUsed: r.gasUsed, gas: g, address: r.contractAddress ?? null };
}
/** The account's own error for a call it refuses, decoded (src/metal/accountErrors.ts), from one read-only call. */
function whyRefused(to: Address, data: Hex): Promise<string> {
  return decodedRefusal(() => pc.call({ account: sponsor.address, to, data })).then((why) => why ?? "the simulation passed", (e: Error) => `the simulation failed (${redactSecrets(e.message.split("\n")[0]!).slice(0, 120)})`);
}

// 0. Gas for the sponsor.
if ((await usdzBalance(sponsor.address)) < centsToBaseUnits(2000)) { metalAgent(["fund", sponsor.address]); say("sponsor funded from the faucet"); }

// 1. The verifier: deployed once from the committed artifact, its address kept in the test keys dir.
const art = loadVerifier();
const verifierFile = keyPath("verifier.address");
let verifier = existsSync(verifierFile) ? (readFileSync(verifierFile, "utf8").trim() as Address) : null;
if (!verifier || (await pc.getCode({ address: verifier })) === undefined) {
  const d = await send(null, encodeDeployData({ abi: art.abi, bytecode: art.bytecode }));
  verifier = d.address as Address;
  writeFileSync(verifierFile, `${verifier}\n`);
  record(`deploy OpenZeppelin ${art.openzeppelin} ERC7913WebAuthnVerifier (artifact sha256 ${art.bytecode_sha256.slice(0, 12)}…)`, d.ok ? "done" : "reverted", d.tx, `verifier ${verifier}; ${d.gasUsed} gas`);
} else say(`verifier ${verifier} (deployed earlier)`);
const verifyAbi = parseAbi(["function verify(bytes key, bytes32 hash, bytes signature) view returns (bytes4)"]);
const probe = `0x${"42".repeat(32)}` as Hex;
const goodSig = webauthnSignature(probe, cfo.assert(probe));
const keyBytes = `0x${cfo.key.qx.slice(2)}${cfo.key.qy.slice(2)}` as Hex;
const good = await pc.readContract({ address: verifier, abi: verifyAbi, functionName: "verify", args: [keyBytes, probe, goodSig] });
const gasVerify = await pc.estimateGas({ account: sponsor.address, to: verifier, data: encodeFunctionData({ abi: verifyAbi, functionName: "verify", args: [keyBytes, probe, goodSig] }) });
record("verify a passkey's WebAuthn signature with eth_call", "returned", null, `${good === VERIFY_SELECTOR ? "valid (verify's selector)" : `UNEXPECTED: ${good}`}; estimate ${gasVerify} gas incl. Metal's base cost`);
const other = await pc.readContract({ address: verifier, abi: verifyAbi, functionName: "verify", args: [keyBytes, `0x${"43".repeat(32)}`, goodSig] });
record("the same signature over another hash", "returned", null, other === "0xffffffff" ? "refused (0xffffffff)" : `UNEXPECTED: ${other}`);

// 2. The account: owners the two passkeys, threshold two.
const sCfo = passkeySigner(verifier, cfo.key), sCtl = passkeySigner(verifier, controller.key), sStr = passkeySigner(verifier, stranger.key);
const config = [[sCfo, sCtl], [1n, 1n], 2n] as const;
const account = (await pc.readContract({ address: FACTORY, abi: factoryAbi, functionName: "predictAccount", args: [[...config[0]], [...config[1]], config[2]] })) as Address;
if (!(await pc.getCode({ address: account }))) {
  const r = await send(FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [[...config[0]], [...config[1]], config[2]] }));
  record("create the business account: owners the CFO's and the controller's passkeys, threshold 2, no key on a server", r.ok ? "done" : "reverted", r.tx, `account ${account}`);
} else say(`account ${account} exists (two passkey owners, threshold 2)`);
if ((await usdzBalance(account)) < centsToBaseUnits(50)) {
  const tx = await transferUsdz(keyPath("sponsor.key.json"), account, centsToBaseUnits(100) - (await usdzBalance(account)));
  record("fund the account to 1.00 test USD", "done", tx, "");
}

// 3. A payment from the account, signed by passkeys.
const validUntil = (s = 900) => BigInt(Math.floor(Date.now() / 1000)) + BigInt(s);
const nonceFor = async () => { const lane = quorumLane(); return (lane << 64n) | (await pc.readContract({ address: account, abi: accountAbi, functionName: "nonces", args: [account, lane] })); };
const transfer = { target: USDZ as Address, value: 0n, callData: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payee.address, centsToBaseUnits(10)] }) };
const data = executionData([transfer]);
type Pk = ReturnType<typeof softPasskey>;
function signed(nonce: bigint, until: bigint, who: [Pk, Hex][], signOver?: Hex): Hex {
  const digest = executeDigest({ chainId: CHAIN_ID, account, data, nonce, validUntil: until });
  const over = signOver ?? digest;
  const sig = passkeyQuorum(who.map(([pk, signer]) => ({ signer, signature: webauthnSignature(over, pk.assert(over)) })));
  return encodeFunctionData({ abi: accountAbi, functionName: "executeSigned", args: [ACCOUNT_BATCH_MODE, data, nonce, until, sig] });
}
const nBoth = await nonceFor(), uBoth = validUntil();
const both = signed(nBoth, uBoth, [[cfo, sCfo], [controller, sCtl]]);
const gasBoth = ((await pc.estimateGas({ account: sponsor.address, to: account, data: both })) * 6n) / 5n;
const attempts: [string, Hex][] = [
  ["the CFO's passkey alone", signed(await nonceFor(), validUntil(), [[cfo, sCfo]])],
  ["the CFO's and a stranger's passkey", signed(await nonceFor(), validUntil(), [[cfo, sCfo], [stranger, sStr]])],
  ["both passkeys, over another challenge", signed(await nonceFor(), validUntil(), [[cfo, sCfo], [controller, sCtl]], `0x${"99".repeat(32)}`)],
  ["both passkeys, deadline passed", signed(await nonceFor(), validUntil(-60), [[cfo, sCfo], [controller, sCtl]])],
];
for (const [who, d] of attempts) {
  const why = await whyRefused(account, d);
  const r = await send(account, d, gasBoth);
  record(`pay 0.10 from the account, signed by ${who}`, r.ok ? "done" : "reverted", r.tx, r.ok ? "UNEXPECTED: paid" : `reverted on chain (${r.gasUsed} of ${r.gas} gas); the account's reason: ${why}`);
}
const before = await usdzBalance(payee.address);
const paid = await send(account, both, gasBoth);
record("pay 0.10 from the account, signed by both passkeys", paid.ok ? "done" : "reverted", paid.tx, paid.ok ? `the payee received ${fromCents(baseUnitsToCents((await usdzBalance(payee.address)) - before))}; ${paid.gasUsed} gas` : "UNEXPECTED: reverted");
const again = await send(account, both, gasBoth);
record("send the same signed payment again (replay)", again.ok ? "done" : "reverted", again.tx, again.ok ? "UNEXPECTED: paid twice" : "reverted on chain: the nonce is used");

// 4. A mandate bound with both passkeys, through Metal's own authorizeMandateCall.
const cred = keyPath("agent.credential.json");
let issuerFile = keyPath("issuer.public.path");
if (!existsSync(cred)) {
  const c = metalAgent(["mandate", "credential", "create", "--principal", account, "--cap", "0.05", "--budget", "0.50", "--payee", `${payee.address},Stockline (test payee)`, "--expires-in", String(7 * 86400), "--description", "kit11 passkey-owners agent", "--key", keyPath("sponsor.key.json"), "--out", cred]);
  writeFileSync(issuerFile, `${c.fields.get("issuer-public-file")?.[0] ?? ""}\n`);
}
issuerFile = readFileSync(issuerFile, "utf8").trim();
const ingested = await ingestIssued(cred, issuerFile, account);
const quorumOf = (who: [Pk, Hex][]) => async (digest: Hex) => passkeyQuorum(who.map(([pk, signer]) => ({ signer, signature: webauthnSignature(digest, pk.assert(digest)) })));
const bound = metalAgent(["mandate", "status", "--credential", cred]).fields.get("bound")?.[0] === "yes";
if (!bound) {
  const alone = await authorizeMandateCall(pc, FACTORY, bindCall(ingested), validUntil(), quorumOf([[cfo, sCfo]]));
  const okBind = await authorizeMandateCall(pc, FACTORY, bindCall(ingested), validUntil(), quorumOf([[cfo, sCfo], [controller, sCtl]]));
  const r1 = await send(alone.to, alone.data, okBind.gas);
  record("bind the agent's mandate with the CFO's passkey alone", r1.ok ? "done" : "reverted", r1.tx, r1.ok ? "UNEXPECTED: bound" : "reverted on chain");
  const r2 = await send(okBind.to, okBind.data, okBind.gas);
  record("bind the agent's mandate with both passkeys (Metal's authorizeMandateCall)", r2.ok ? "done" : "reverted", r2.tx, r2.ok ? `mandate ${ingested.reference.slice(0, 18)}…; cap 0.05, budget 0.50; ${r2.gasUsed} gas` : "UNEXPECTED: reverted");
}
// The mandate key metal-agent wrote beside the credential signs; no owner does.
const small = await pullUnder({ credentialPath: cred, keyFile: keyPath("agent.credential.key.json"), reference: ingested.reference })({ agent: "sourcing", to: payee.address, amountCents: 5, paymentId: `passkey-owners-${Date.now()}` });
record("the agent pays 0.05 inside the passkey-approved mandate, no owner signs", small.outcome === "PAID" ? "done" : "reverted", small.tx, small.outcome === "PAID" ? "paid with the mandate key alone" : `${small.outcome.toLowerCase()}${small.reason ? `: ${small.reason}` : ""}`.slice(0, 120));

// 5. Revoked with both passkeys.
const rv = await authorizeMandateCall(pc, FACTORY, revokeCall(account, ingested.reference), validUntil(), quorumOf([[cfo, sCfo], [controller, sCtl]]));
const r3 = await send(rv.to, rv.data, rv.gas);
record("revoke the mandate with both passkeys", r3.ok ? "done" : "reverted", r3.tx, r3.ok ? "revoked" : "UNEXPECTED: reverted");

mkdirSync(resolve(import.meta.dirname, "../../docs/runs"), { recursive: true });
const out = {
  ran_at: new Date().toISOString(), network: "Metal testnet", stand_in: "software passkeys (src/metal/softPasskey.ts), the WebAuthn format a phone produces; not a phone",
  verifier, verifier_artifact: { openzeppelin: art.openzeppelin, compiler: art.compiler, evm: art.evmVersion, bytecode_sha256: art.bytecode_sha256 },
  account, threshold: 2, owners: ["CFO passkey", "controller passkey"], steps,
};
writeFileSync(resolve(process.env.RUN_OUT_DIR ?? resolve(import.meta.dirname, "../../docs/runs"), `${process.env.RUN_OUT ?? "passkey-owners"}.json`), JSON.stringify(out, null, 2) + "\n");
say(`\n${steps.filter((s) => s.detail.startsWith("UNEXPECTED")).length} unexpected; docs/runs/${process.env.RUN_OUT ?? "passkey-owners"}.json`);
