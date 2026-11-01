// npm run owners -- setup | propose | status   (block 1, behind KIT11_PASSKEY_OWNERS=on; Metal testnet)
//   setup    a business account whose only owners are the two enrolled passkeys (CFO and controller), threshold 2,
//            with OpenZeppelin's WebAuthn verifier; the gas sponsor creates it and funds it with 0.60 test USD
//   propose  an owners_execute: bind a Sourcing mandate on that account (cap 0.05, budget 0.50, Stockline only). The
//            phone shows the terms and both passkeys sign the account's Execute digest; the runner relays it
//   status   the mandate as the chain has it
// No server key is an owner: the sponsor (passkey-sponsor.key.json) only pays gas and relays.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { audit } from "../audit/log.js";
import { openDb } from "../db/open.js";
import { keyPath, metalAgent } from "../metal/agentCli.js";
import { publicClient, transferUsdz, usdzBalance } from "../metal/chain.js";
import { CHAIN_ID, EXPLORER_TX } from "../metal/network.js";
import { accountAbi, factoryAbi, quorumLane } from "../metal/fourEyes.js";
import { coseP256, ownersExecuteTerms, type OwnersExecuteTerms } from "../metal/ownersExecute.js";
import { passkeySigner } from "../metal/passkeyOwner.js";
import { ACCOUNT_FACTORY, fundSponsor, passkeySponsor, PASSKEY_VERIFIER, liveRelay } from "../metal/passkeyRelay.js";
import { createProposal, nextProposalId } from "../policy/approvals.js";
import { addresses } from "../world/runtime.js";
import { centsToBaseUnits } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import { approvalHint } from "./hint.js";
import { bindCall, ingestCredential, parseCredential, parseP256Jwk, readMandateState } from "@metalntwx/metal-pay/mandates";

type TrustedIssuer = Parameters<typeof ingestCredential>[1]["trustedIssuers"][number];
const db = openDb();
const pc = publicClient();
const say = (s: string) => console.log(redactSecrets(s));
const cmd = process.argv[2] ?? "status";

function owners(): { label: string; signer: Hex }[] {
  const rows = db.prepare("SELECT label, public_key FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all() as { label: string; public_key: string }[];
  if (rows.length !== 2) throw new Error(`the passkey account needs exactly two people's passkeys (CFO and controller); ${rows.length} active`);
  return rows.map((r) => ({ label: r.label, signer: passkeySigner(PASSKEY_VERIFIER, coseP256(r.public_key)) }));
}
function account(): Address {
  const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'owners.account_created' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
  if (!r) throw new Error("no passkey account yet: npm run owners -- setup");
  return (JSON.parse(r.payload_json) as { account: Address }).account;
}

if (cmd === "setup") {
  if (!(await pc.getCode({ address: PASSKEY_VERIFIER }))) throw new Error(`no WebAuthn verifier at ${PASSKEY_VERIFIER} on this network`);
  const o = owners();
  const config = [o.map((x) => x.signer), o.map(() => 1n), 2n] as const;
  const acct = (await pc.readContract({ address: ACCOUNT_FACTORY, abi: factoryAbi, functionName: "predictAccount", args: [[...config[0]], [...config[1]], config[2]] })) as Address;
  await fundSponsor();
  const relay = liveRelay();
  let tx: Hex | null = null;
  if (!(await pc.getCode({ address: acct }))) {
    const r = await relay(ACCOUNT_FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [[...config[0]], [...config[1]], config[2]] }));
    if (!r.ok) throw new Error(`creating the passkey account reverted (${r.tx})`);
    tx = r.tx;
  }
  if ((await usdzBalance(acct)) < centsToBaseUnits(60)) await transferUsdz(keyPath("passkey-sponsor.key.json"), acct, centsToBaseUnits(60));
  audit(db, "owner-signer", "owners.account_created", acct, { account: acct, owners: o.map((x) => x.label), threshold: "2", verifier: PASSKEY_VERIFIER, tx }, new Date());
  say(`ACCOUNT          ${acct}: owners ${o.map((x) => `${x.label}'s passkey`).join(" and ")}, threshold 2; no server key is an owner${tx ? `\n                 ${EXPLORER_TX}${tx}` : " (existed)"}`);
} else if (cmd === "propose") {
  const acct = account();
  const o = owners();
  const supplier = addresses(db).supplier;
  const id = nextProposalId(db);
  const cred = keyPath(`owners/${id}.credential.json`);
  mkdirSync(dirname(cred), { recursive: true });
  passkeySponsor();
  const c = metalAgent(["mandate", "credential", "create", "--principal", acct, "--cap", "0.05", "--budget", "0.50", "--payee", `${supplier},Stockline`, "--expires-in", String(7 * 86400), "--description", `kit11 ${id} sourcing on the passkey account`, "--key", keyPath("passkey-sponsor.key.json"), "--out", cred]);
  const issuerFile = c.fields.get("issuer-public-file")?.[0];
  if (!issuerFile) throw new Error("the credential was created without an issuer file");
  const iss = JSON.parse(readFileSync(issuerFile, "utf8")) as { iss: string; kid: string; jwk: unknown };
  const ingested = await ingestCredential(parseCredential(JSON.parse(readFileSync(cred, "utf8"))), { trustedIssuers: [{ iss: iss.iss, kid: iss.kid, jwk: parseP256Jwk(iss.jwk, issuerFile) } as TrustedIssuer], account: acct });
  const call = bindCall(ingested);
  const lane = quorumLane();
  const nonce = (lane << 64n) | (await pc.readContract({ address: acct, abi: accountAbi, functionName: "nonces", args: [acct, lane] }));
  const expires = new Date(Date.now() + 15 * 60_000);
  expires.setUTCMilliseconds(0);
  const terms: OwnersExecuteTerms = ownersExecuteTerms({
    proposal_id: id, expires_at: expires.toISOString().replace(".000Z", "Z"), account: acct, chain_id: String(CHAIN_ID), owners: o.map((x) => x.signer),
    calls: [{ target: call.to, value: "0", call_data: call.data }], nonce: String(nonce), valid_until: String(Math.floor(expires.getTime() / 1000) + 120),
    action: { what: "bind", agent: "sourcing", cap: "0.05", budget: "0.50", payee: supplier, payee_name: "Stockline", mandate: ingested.reference },
  });
  const p = createProposal(db, { terms, createdBy: "treasury" });
  say(`PROPOSED         ${p.proposal_id}: bind the sourcing mandate on ${acct}, cap 0.05, budget 0.50, Stockline only`);
  say(`                 both passkeys sign the account's Execute digest ${terms.onchain_digest.slice(0, 18)}…; ${approvalHint(db, p.proposal_id, p.terms_sha256.slice(0, 8))}`);
} else if (cmd === "status") {
  const acct = account();
  const r = db.prepare("SELECT terms_json, status FROM proposals WHERE kind = 'owners_execute' ORDER BY created_at DESC LIMIT 1").get() as { terms_json: string; status: string } | undefined;
  if (!r) { say(`ACCOUNT          ${acct}; no owners_execute yet`); process.exit(0); }
  const t = JSON.parse(r.terms_json) as OwnersExecuteTerms;
  const id = t.proposal_id;
  const st = metalAgent(["mandate", "status", "--credential", keyPath(`owners/${id}.credential.json`)]);
  const s = await readMandateState(pc, acct, t.action.mandate);
  say(`MANDATE          ${t.action.mandate.slice(0, 18)}… on ${acct}: proposal ${r.status}; bound ${st.fields.get("bound")?.[0] ?? "?"}; revoked ${s.revoked ? "yes" : "no"}; spent ${s.spent}`);
} else {
  console.error("usage: npm run owners -- setup | propose | status");
  process.exit(2);
}
