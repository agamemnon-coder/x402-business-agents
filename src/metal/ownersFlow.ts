// The passkey account's flow (npm run owners; block 1, "Face ID signs on chain"), as functions over one world: its
// ledger, Metal testnet behind the owners call budget, and the pinned metal-agent CLI. src/cli/ownersExecute.ts is the
// thin command around these; the tests run them against an in-process chain.
//
//   preflight       the plan of a live run and what it will cost in calls; at most three reads, no transaction
//   setup           the account whose only owners are the two enrolled passkeys, threshold 2, created by the gas sponsor
//                   and funded with 0.60 test USD. Self-contained: what it needs beyond the passkeys it makes itself
//                   (the sponsor's key, the payee's, the Sourcing agent's mandate key), with no transaction of its own
//   propose         bind a Sourcing mandate on the account (cap 0.05, budget 0.50, Stockline only): an owners_execute
//                   both passkeys sign on the phone
//   propose-revoke  revoke the mandate this world bound: the same kind of proposal
//   pay             the Sourcing agent's mandate key pays 0.05 inside the mandate, then tries one cent over the cap,
//                   which Metal must refuse and record on chain
//   status          the mandate as the chain has it (one read)
//
// Every send is recorded before it leaves and made at most once (src/metal/ownersTx.ts). The two payments in `pay` are
// signed and sent inside the CLI: there the payment id is what is recorded first (metal-agent pays an id at most once).

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { bindCall, readMandateState, revokeCall } from "@metalntwx/metal-pay/mandates";
import { encodeFunctionData, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { audit } from "../audit/log.js";
import { passkeyOwnersOn } from "../config/agents.js";
import { SUPPLIERS } from "../config/suppliers.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents } from "../lib/money.js";
import { createProposal, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { relayToken } from "../relay/config.js";
import { keyPath, keysDir, type CliResult } from "./agentCli.js";
import { readKeyFile } from "./chain.js";
import { credentialCreateArgs } from "./credentialArgs.js";
import { accountAbi, factoryAbi, quorumLane } from "./fourEyes.js";
import { mandateKey, plainKey } from "./keyFiles.js";
import { boundCapUnits, ingestIssued, loadCredentialFile } from "./mandate.js";
import { CHAIN_ID, EXPLORER_TX } from "./network.js";
import { countByStep, ownersRefusals, readOwnersCalls } from "./ownersBudget.js";
import type { OwnersChain } from "./ownersChain.js";
import { coseP256, ownersExecuteTerms, type OwnersExecuteTerms } from "./ownersExecute.js";
import { stepJournal, stepOnce } from "./ownersTx.js";
import { passkeySigner } from "./passkeyOwner.js";
import { ACCOUNT_FACTORY, PASSKEY_VERIFIER, RELAY_CALLS, SPONSOR_KEY } from "./passkeyRelay.js";
import { keptPullDir, pullUnder } from "./pull.js";
import { recordCapRefusalOnChain } from "./recordRefusal.js";
import { fundTestWallet, liveDeps as liveFundDeps, type FundDeps } from "./testFunds.js";

export interface OwnersWorld {
  db: DB;
  chain: OwnersChain;
  env: Record<string, string | undefined>;
  /** The pinned metal-agent CLI for a command that reaches the network (fund, mandate pull): one cli:<command> line in the call log, then run. */
  cli: (args: string[], okCodes?: number[]) => CliResult;
  /** The same CLI for `mandate credential create`, which makes no request: no call, no log line. */
  cliOffline: (args: string[]) => CliResult;
  say: (line: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Tests: where recycled test money comes from (default: the finished dry-run worlds beside this one). */
  recycle?: { deps: FundDeps; key: (world: string, file: string) => LocalAccount };
}

/** The mandate the flow binds: the Sourcing agent may pay Stockline alone, 0.05 a payment, 0.50 in all, for a week. */
export const MANDATE = { agent: "sourcing", capCents: 5, budgetCents: 50, payee: SUPPLIERS.stockline, expiresInSeconds: 7 * 86_400 } as const;
/** The Sourcing agent's own P-256 mandate key for the passkey account's mandates. */
export const AGENT_KEY = "sourcing.owners.key.json";
/** The sponsor only pays gas, and gas on Metal is a fraction of a cent: 5.00 test USD is far more than a run uses. */
export const SPONSOR_CENTS = 500;
/** The account holds the mandate's whole budget and a little more. */
export const ACCOUNT_CENTS = 60;

const CENT = centsToBaseUnits(1);
const ceilCents = (units: bigint) => Number(units / CENT + (units % CENT ? 1n : 0n));
const usdz = (units: bigint) => fromCents(Number(units / CENT));
const REPO = resolve(import.meta.dirname, "../..");
const insideRepo = (path: string) => { const p = resolve(path); return p === REPO || p.startsWith(REPO + sep); };

/** The CLI command an argument list runs, as the call log names it: `fund`, `mandate pull`. */
export function cliCommand(args: readonly string[]): string {
  return args[0] === "mandate" ? args.slice(0, args[1] === "credential" ? 3 : 2).join(" ") : (args[0] ?? "");
}

/** A CLI runner whose every run is one line in the call log first (and is refused when the budget is spent). */
export function countedCli(chain: OwnersChain, run: (args: string[], okCodes?: number[]) => CliResult): OwnersWorld["cli"] {
  return (args, okCodes) => {
    chain.logged(`cli:${cliCommand(args)}`);
    return run(args, okCodes);
  };
}

// ---- The world's own facts ------------------------------------------------------------------------------------------

/** The account's two owners: the active passkeys, as ERC-7913 signers under the WebAuthn verifier. */
export function ownersOf(db: DB): { label: string; signer: Hex }[] {
  const rows = db.prepare("SELECT label, public_key FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all() as { label: string; public_key: string }[];
  if (rows.length !== 2) throw new Error(`the passkey account needs exactly two people's passkeys (CFO and controller); ${rows.length} active`);
  return rows.map((r) => ({ label: r.label, signer: passkeySigner(PASSKEY_VERIFIER, coseP256(r.public_key)) }));
}

/** The passkey account this world created, with its owners' signers as created (older records hold none). */
export function accountOf(db: DB): { account: Address; signers: Hex[] | null } {
  const r = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'owners.account_created' ORDER BY seq DESC LIMIT 1").get() as { payload_json: string } | undefined;
  if (!r) throw new Error("no passkey account yet: npm run owners -- setup");
  const p = JSON.parse(r.payload_json) as { account: Address; signers?: Hex[] };
  return { account: p.account, signers: Array.isArray(p.signers) ? p.signers : null };
}

/** The key files the flow needs beyond the passkeys, each made when it is not there yet. No network, no transaction. */
export async function worldKeys(): Promise<{ sponsor: ReturnType<typeof plainKey>; sponsorIsNew: boolean; payee: Address; agent: { file: string; kid: string } }> {
  const sponsorIsNew = !existsSync(keyPath(SPONSOR_KEY));
  const sponsor = plainKey(SPONSOR_KEY);
  // In a bootstrapped world these are Stockline's own key and nothing is made; in a fresh one it is made here.
  const payee = plainKey(MANDATE.payee.keyFile).address;
  const agent = await mandateKey(AGENT_KEY);
  return { sponsor, sponsorIsNew, payee, agent };
}

/** The key OWNERS_DONOR_KEY names, which funds the sponsor and the account with one transfer each; null when unset. */
export function donorOf(env: Record<string, string | undefined>): ReturnType<typeof privateKeyToAccount> | null {
  const file = env.OWNERS_DONOR_KEY;
  if (!file) return null;
  if (insideRepo(file)) throw new Error("OWNERS_DONOR_KEY names a file inside the code repo; keys never live there");
  return privateKeyToAccount(readKeyFile(file).privateKey);
}

interface Filed { id: string; status: string; terms: OwnersExecuteTerms }
const filed = (db: DB): Filed[] => (db.prepare("SELECT proposal_id, status, terms_json FROM proposals WHERE kind = 'owners_execute' ORDER BY created_at, proposal_id").all() as { proposal_id: string; status: string; terms_json: string }[])
  .map((r) => ({ id: r.proposal_id, status: r.status, terms: JSON.parse(r.terms_json) as OwnersExecuteTerms }));

/** The mandate this world bound on the passkey account and has not revoked: its bind proposal. Throws when there is none. */
export function boundMandate(db: DB): Filed {
  const all = filed(db);
  const bind = all.filter((p) => p.status === "EXECUTED" && p.terms.action.what === "bind").at(-1);
  if (!bind) throw new Error("this world has bound no mandate on the passkey account yet (npm run owners -- propose, then both passkeys sign)");
  const revoked = all.find((p) => p.status === "EXECUTED" && p.terms.action.what === "revoke" && p.terms.action.mandate.toLowerCase() === bind.terms.action.mandate.toLowerCase());
  if (revoked) throw new Error(`the mandate ${bind.id} bound was revoked by ${revoked.id}`);
  return bind;
}

// ---- setup ----------------------------------------------------------------------------------------------------------

/** One *USDZ transfer under a step key: recorded before it leaves, made at most once across runs. */
async function transferOnce(d: OwnersWorld, key: string, from: LocalAccount, to: Address, cents: number, what: string): Promise<Hex> {
  const open = stepJournal(d.db, key).open();
  if (open?.from && open.from.toLowerCase() !== from.address.toLowerCase()) throw new Error(`"${what}" was sent from ${open.from} by an earlier run (${open.tx}); carry on with that same key`);
  const r = await stepOnce(d, key, { what, detail: { to, cents }, from: from.address, sign: (as) => d.chain.signTransfer(from, to, centsToBaseUnits(cents), { nonce: as.nonce }) });
  if (!r.ok) throw new Error(`${what}: the transfer ${r.tx} reverted`);
  return r.tx;
}

/** Test money recycled from finished dry runs (KIT11_RECYCLE=on, src/metal/testFunds.ts), behind the call budget. */
async function recycle(d: OwnersWorld, address: Address): Promise<void> {
  const keyOf = d.recycle?.key ?? ((world: string, file: string) => privateKeyToAccount(readKeyFile(join(dirname(keysDir()), world, file)).privateKey));
  const stepKey = (world: string, file: string) => `setup:recycle:${world}:${file}:${address}`;
  const give = (world: string, file: string, cents: number) => transferOnce(d, stepKey(world, file), keyOf(world, file), address, cents, `recycle ${fromCents(cents)} test USD from ${world}`);
  // A recycled transfer an earlier run left open is carried on first, so the plan below is made on settled balances.
  const started = d.db.prepare("SELECT DISTINCT subject FROM audit_log WHERE event = 'owners.tx_sent' AND subject LIKE 'setup:recycle:%'").all() as { subject: string }[];
  for (const { subject } of started) {
    const open = stepJournal(d.db, subject).open();
    const [, , world, file] = subject.split(":");
    if (open?.detail && world && file) await give(world, file, Number(open.detail.cents));
  }
  await fundTestWallet(address, SPONSOR_CENTS, { label: "passkey owners' gas sponsor", deps: {
    ...(d.recycle?.deps ?? liveFundDeps()), recycle: true,
    balance: (a) => d.chain.balance(a),
    faucet: () => { d.cli(["fund", address]); },
    transfer: (world, file, _to, amount) => {
      if (stepJournal(d.db, stepKey(world, file)).done()?.ok) throw new Error(`${world} already gave to this world's gas sponsor; name a donor key (OWNERS_DONOR_KEY) or use the faucet`);
      return give(world, file, baseUnitsToCents(amount));
    },
  } });
}

/** Gas money for the sponsor: one transfer from the donor key when one is named; else recycled test money or the faucet, as before. */
async function fundSponsor(d: OwnersWorld, keys: Awaited<ReturnType<typeof worldKeys>>): Promise<Hex | null> {
  const address = keys.sponsor.address;
  const want = centsToBaseUnits(SPONSOR_CENTS);
  const donor = donorOf(d.env);
  if (donor) {
    const key = `setup:fund-sponsor:${address}`;
    const j = stepJournal(d.db, key);
    const done = j.done();
    if (done?.ok) return done.tx;
    const open = j.open();
    let cents: number;
    if (open?.detail) cents = Number(open.detail.cents);
    else {
      // A key made in this very run holds nothing: no need to ask the chain.
      const have = keys.sponsorIsNew ? 0n : await d.chain.balance(address);
      if (have >= want) return null;
      cents = ceilCents(want - have);
    }
    return transferOnce(d, key, donor, address, cents, `fund the gas sponsor with ${fromCents(cents)} test USD from the donor key`);
  }
  if (d.env.KIT11_RECYCLE === "on") { await recycle(d, address); return null; }
  // The faucet when low; a 429 ("retry in N s", the faucet's per-client limit) is waited out, up to 4 times.
  for (let i = 0; (await d.chain.balance(address)) < want; i++) {
    try {
      d.cli(["fund", address]);
    } catch (e) {
      const wait = /retry in (\d+) s/.exec((e as Error).message);
      if (!wait || i >= 3) throw e;
      await d.sleep((Number(wait[1]) + 3) * 1000);
    }
  }
  return null;
}

/** 0.60 test USD for the account: from the donor key when one is named, else from the sponsor. */
async function fundAccount(d: OwnersWorld, account: Address, keys: Awaited<ReturnType<typeof worldKeys>>, isNew: boolean): Promise<Hex | null> {
  const key = `setup:fund-account:${account}`;
  const j = stepJournal(d.db, key);
  const done = j.done();
  if (done?.ok) return done.tx;
  const open = j.open();
  let cents: number;
  if (open?.detail) cents = Number(open.detail.cents);
  else {
    // An account created in this very run holds nothing.
    const have = isNew ? 0n : await d.chain.balance(account);
    if (have >= centsToBaseUnits(ACCOUNT_CENTS)) return null;
    cents = ceilCents(centsToBaseUnits(ACCOUNT_CENTS) - have);
  }
  return transferOnce(d, key, donorOf(d.env) ?? keys.sponsor, account, cents, `fund the passkey account with ${fromCents(cents)} test USD`);
}

export async function setup(d: OwnersWorld): Promise<{ account: Address; created: Hex | null; existed: boolean }> {
  d.chain.step("setup");
  const owners = ownersOf(d.db);
  const signers = owners.map((x) => x.signer);
  const who = owners.map((x) => `${x.label}'s passkey`).join(" and ");
  const keys = await worldKeys();
  d.say(`KEYS             gas sponsor ${keys.sponsor.address}; payee ${MANDATE.payee.name} ${keys.payee}; the Sourcing agent's mandate key ${keys.agent.kid} (key files in the keys folder; none of them is an owner)`);
  const made = d.db.prepare("SELECT 1 FROM audit_log WHERE event = 'owners.account_created'").get() ? accountOf(d.db) : null;
  if (made?.signers && made.signers.length === 2 && signers.every((s) => made.signers!.includes(s))) {
    // This world made the account for exactly these two passkeys: nothing to do, and no call.
    d.say(`ACCOUNT          ${made.account}: owners ${who}, threshold 2; no server key is an owner (existed)`);
    return { account: made.account, created: null, existed: true };
  }
  if (!(await d.chain.hasCode(PASSKEY_VERIFIER))) throw new Error(`no WebAuthn verifier at ${PASSKEY_VERIFIER} on this network`);
  const sponsorTx = await fundSponsor(d, keys);
  const config = [signers, signers.map(() => 1n), 2n] as const;
  const account = (await d.chain.read({ address: ACCOUNT_FACTORY, abi: factoryAbi, functionName: "predictAccount", args: config })) as Address;
  const createKey = `setup:create-account:${account}`;
  const data = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [[...signers], signers.map(() => 1n), 2n] });
  const j = stepJournal(d.db, createKey);
  let created: Hex | null = j.done()?.ok ? j.done()!.tx : null;
  let isNew = false;
  // A creation an earlier run sent is carried on from its record; otherwise the chain says whether the account is there.
  if (!created && (j.open() || !(await d.chain.hasCode(account)))) {
    const r = await stepOnce(d, createKey, {
      what: "create the passkey account (two passkey owners, threshold 2)", from: keys.sponsor.address,
      gas: () => d.chain.gasFor(keys.sponsor.address, ACCOUNT_FACTORY, data, "creating the passkey account"),
      sign: (as) => d.chain.signCall(keys.sponsor, ACCOUNT_FACTORY, data, { nonce: as.nonce, gas: as.gas! }),
      reason: () => d.chain.why(keys.sponsor.address, ACCOUNT_FACTORY, data),
    });
    if (!r.ok) throw new Error(`creating the passkey account reverted (${r.tx}): ${r.reason}`);
    created = r.tx;
    isNew = r.fresh;
  }
  const accountTx = await fundAccount(d, account, keys, isNew);
  audit(d.db, "owner-signer", "owners.account_created", account, {
    account, owners: owners.map((x) => x.label), signers, threshold: "2", verifier: PASSKEY_VERIFIER, tx: created,
    sponsor: keys.sponsor.address, payee: keys.payee, agent_key: keys.agent.kid, funded: { sponsor: sponsorTx, account: accountTx },
  }, d.now());
  d.say(`ACCOUNT          ${account}: owners ${who}, threshold 2; no server key is an owner${created ? `\n                 ${EXPLORER_TX}${created}` : " (existed)"}`);
  return { account, created, existed: !created };
}

// ---- propose and propose-revoke -------------------------------------------------------------------------------------

/** Files the owners_execute for one account call: a fresh two-owner nonce lane (one read), fifteen minutes to sign, the deadline two minutes later. */
async function file(d: OwnersWorld, id: string, account: Address, signers: Hex[], call: { to: Address; data: Hex }, action: OwnersExecuteTerms["action"]): Promise<{ proposal: ProposalRow; terms: OwnersExecuteTerms }> {
  const lane = quorumLane();
  const nonce = (lane << 64n) | ((await d.chain.read({ address: account, abi: accountAbi, functionName: "nonces", args: [account, lane] })) as bigint);
  const expires = new Date(d.now().getTime() + 15 * 60_000);
  expires.setUTCMilliseconds(0);
  const terms = ownersExecuteTerms({
    proposal_id: id, expires_at: expires.toISOString().replace(".000Z", "Z"), account, chain_id: String(CHAIN_ID), owners: signers,
    calls: [{ target: call.to, value: "0", call_data: call.data }], nonce: String(nonce), valid_until: String(Math.floor(expires.getTime() / 1000) + 120), action,
  });
  return { proposal: createProposal(d.db, { terms, createdBy: "treasury" }, d.now()), terms };
}

export async function propose(d: OwnersWorld): Promise<{ proposal: ProposalRow; terms: OwnersExecuteTerms }> {
  d.chain.step("propose");
  const made = accountOf(d.db);
  const signers = made.signers ?? ownersOf(d.db).map((x) => x.signer);
  const keys = await worldKeys();
  const id = nextProposalId(d.db);
  const cred = keyPath(`owners/${id}.credential.json`);
  mkdirSync(dirname(cred), { recursive: true });
  const c = d.cliOffline([
    ...credentialCreateArgs({ principal: made.account, capCents: MANDATE.capCents, budgetCents: MANDATE.budgetCents, payees: [{ address: keys.payee, name: MANDATE.payee.name }], expiresInSeconds: MANDATE.expiresInSeconds, description: `kit11 ${id} sourcing on the passkey account` }),
    "--key", keyPath(SPONSOR_KEY), "--out", cred, "--mandate-key-file", keys.agent.file,
  ]);
  const issuerFile = c.fields.get("issuer-public-file")?.[0];
  if (!issuerFile) throw new Error("the credential was created without an issuer file");
  const ingested = await ingestIssued(cred, issuerFile, made.account);
  const call = bindCall(ingested);
  const out = await file(d, id, made.account, signers, call, {
    what: "bind", agent: MANDATE.agent, cap: fromCents(MANDATE.capCents), budget: fromCents(MANDATE.budgetCents), payee: keys.payee, payee_name: MANDATE.payee.name, mandate: ingested.reference,
  });
  d.say(`PROPOSED         ${id}: bind the sourcing mandate on ${made.account}, cap ${fromCents(MANDATE.capCents)}, budget ${fromCents(MANDATE.budgetCents)}, ${MANDATE.payee.name} only`);
  return out;
}

export async function proposeRevoke(d: OwnersWorld): Promise<{ proposal: ProposalRow; terms: OwnersExecuteTerms }> {
  d.chain.step("propose-revoke");
  const bind = boundMandate(d.db);
  const mandate = bind.terms.action.mandate;
  const waiting = filed(d.db).find((p) => p.terms.action.what === "revoke" && p.terms.action.mandate.toLowerCase() === mandate.toLowerCase() && ["PENDING_APPROVAL", "APPROVED", "EXECUTING"].includes(p.status) && Date.parse(p.terms.expires_at) > d.now().getTime());
  if (waiting) throw new Error(`${waiting.id} already asks to revoke this mandate (${waiting.status.toLowerCase().replace("_", " ")}); sign that one`);
  const made = accountOf(d.db);
  if (made.account.toLowerCase() !== bind.terms.account.toLowerCase()) throw new Error(`${bind.id} bound its mandate on ${bind.terms.account}, not on this world's passkey account ${made.account}`);
  const id = nextProposalId(d.db);
  const call = revokeCall(made.account, mandate);
  // The same words as the bind, so the phone shows which mandate goes: its agent, its limits and its payee.
  const out = await file(d, id, made.account, bind.terms.owners, call, { ...bind.terms.action, what: "revoke" });
  d.say(`PROPOSED         ${id}: revoke the sourcing mandate ${mandate.slice(0, 18)}… that ${bind.id} bound on ${made.account}`);
  return out;
}

// ---- pay ------------------------------------------------------------------------------------------------------------

/** Who decided the two payments of `pay`: the person's command, by code's fixed plan. No agent's Claude run decided them. */
const PAY_ORIGIN = { actor: "code", rule: "npm run owners -- pay: one payment inside the mandate and one over its cap, started by a person", agent: MANDATE.agent } as const;

/** How metal-agent recorded a payment id's pull under a mandate (its kept `<nonce>.done` file, CLI 0.3.3), or null. */
function keptOutcome(reference: Hex, paymentId: string): { outcome: string; tx: string | null; reason: string | null } | null {
  const dir = keptPullDir(join(keysDir(), "home"), reference, paymentId);
  const done = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".done")).sort() : [];
  for (const f of done.reverse()) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as { outcome?: string; lines?: string[] };
      const line = (k: string) => r.lines?.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? null;
      if (r.outcome) return { outcome: r.outcome, tx: line("transaction"), reason: line("reason") };
    } catch { /* not a record this version wrote: the CLI itself is asked */ }
  }
  return null;
}

export interface PayResult { inside: { outcome: string; tx: string | null; reason: string | null }; over: { refused: boolean; tx: string | null; reason: string } }

export async function pay(d: OwnersWorld): Promise<PayResult> {
  d.chain.step("pay");
  const bind = boundMandate(d.db);
  const a = bind.terms.action;
  const m = loadCredentialFile("sourcing", keyPath(`owners/${bind.id}.credential.json`));
  if (m.reference.toLowerCase() !== a.mandate.toLowerCase()) throw new Error(`the credential kept for ${bind.id} is not the mandate it bound`);
  const payee = a.payee as Address;
  const capCents = baseUnitsToCents(boundCapUnits(m));
  const insideCents = MANDATE.capCents;
  if (insideCents > capCents) throw new Error(`${fromCents(insideCents)} is over this mandate's cap of ${fromCents(capCents)}`);
  const overCents = capCents + 1;
  const base = { proposal_id: bind.id, mandate: a.mandate, account: bind.terms.account, to: payee, payee_name: a.payee_name, origin: PAY_ORIGIN };
  const outcomeOf = (id: string) => d.db.prepare("SELECT event, payload_json FROM audit_log WHERE subject = ? AND event IN ('owners.paid', 'owners.refused_on_chain') ORDER BY seq DESC LIMIT 1").get(id) as { event: string; payload_json: string } | undefined;

  // 1. Inside the mandate. The payment id is recorded before the CLI starts; metal-agent pays an id at most once.
  const insideId = `owners-${bind.id}-inside`;
  let inside: PayResult["inside"];
  const paid = outcomeOf(insideId);
  if (paid) {
    const p = JSON.parse(paid.payload_json) as { tx: string | null };
    inside = { outcome: "PAID", tx: p.tx, reason: null };
    d.say(`PAID             ${fromCents(insideCents)} to ${a.payee_name} inside the mandate (recorded earlier)${p.tx ? `\n                 ${EXPLORER_TX}${p.tx}` : ""}`);
  } else {
    audit(d.db, "sourcing", "owners.pay_started", insideId, { ...base, amount: fromCents(insideCents), kind: "inside the mandate" }, d.now());
    const r = await pullUnder(m, (args, ok) => d.cli(args, ok))({ agent: "sourcing", to: payee, amountCents: insideCents, paymentId: insideId });
    inside = { outcome: r.outcome, tx: r.tx, reason: r.reason };
    if (r.outcome === "PAID") {
      audit(d.db, "sourcing", "owners.paid", insideId, { ...base, amount: fromCents(insideCents), tx: r.tx, signed_by: "the Sourcing agent's mandate key alone; no owner signed", ...(r.already ? { already: true } : {}) }, d.now());
      d.say(`PAID             ${fromCents(insideCents)} to ${a.payee_name} inside the mandate: the mandate key alone signed${r.tx ? `\n                 ${EXPLORER_TX}${r.tx}` : ""}`);
    } else {
      audit(d.db, "sourcing", "owners.pay_not_paid", insideId, { ...base, amount: fromCents(insideCents), outcome: r.outcome, reason: r.reason, tx: r.tx }, d.now());
      throw new Error(`the payment of ${fromCents(insideCents)} inside the mandate was not paid: ${r.outcome.toLowerCase()}${r.reason ? ` (${r.reason})` : ""}; the over-cap attempt was not made`);
    }
  }

  // 2. One cent over the cap written in the credential (which the chain bound): Metal must refuse it, and records the refusal.
  const overId = `owners-${bind.id}-over-cap`;
  let over: PayResult["over"];
  const refused = outcomeOf(overId);
  const kept = refused ? null : keptOutcome(m.reference, overId);
  if (refused) {
    const p = JSON.parse(refused.payload_json) as { tx: string | null; reason: string };
    over = { refused: true, tx: p.tx, reason: p.reason };
  } else if (kept?.outcome === "refused" && kept.tx && kept.reason) {
    // An earlier run's CLI finished and this ledger did not get its answer: taken from metal-agent's own record, nothing is sent again.
    over = { refused: true, tx: kept.tx, reason: kept.reason };
    audit(d.db, "sourcing", "owners.refused_on_chain", overId, { ...base, amount: fromCents(overCents), cap: fromCents(capCents), tx: kept.tx, reason: kept.reason, read_from: "metal-agent's kept record of an earlier run" }, d.now());
  } else {
    audit(d.db, "sourcing", "owners.pay_started", overId, { ...base, amount: fromCents(overCents), kind: "one cent over the cap" }, d.now());
    try {
      const r = await recordCapRefusalOnChain(m, payee, overCents, overId, keyPath(SPONSOR_KEY), undefined, { client: d.chain.client, run: (args, ok) => d.cli(args, ok) });
      over = { refused: true, tx: r.tx, reason: r.reason };
    } catch (e) {
      audit(d.db, "sourcing", "owners.over_cap_not_refused", overId, { ...base, amount: fromCents(overCents), cap: fromCents(capCents), error: (e as Error).message.slice(0, 300) }, d.now());
      throw e;
    }
    audit(d.db, "sourcing", "owners.refused_on_chain", overId, { ...base, amount: fromCents(overCents), cap: fromCents(capCents), tx: over.tx, reason: over.reason, gas_paid_by: "the gas sponsor, which owns nothing" }, d.now());
  }
  d.say(`REFUSED          ${fromCents(overCents)} to ${a.payee_name}, one cent over the ${fromCents(capCents)} cap: ${over.reason}${over.tx ? `\n                 recorded on chain: ${EXPLORER_TX}${over.tx}` : ""}`);
  return { inside, over };
}

// ---- status ---------------------------------------------------------------------------------------------------------

export async function status(d: OwnersWorld): Promise<{ bound: boolean; revoked: boolean; spent: bigint } | null> {
  d.chain.step("status");
  const { account } = accountOf(d.db);
  const p = filed(d.db).at(-1);
  if (!p) { d.say(`ACCOUNT          ${account}; no owners_execute yet`); return null; }
  const s = await readMandateState(d.chain.client, account, p.terms.action.mandate);
  const bound = s.boundBlock > 0n;
  d.say(`MANDATE          ${p.terms.action.mandate.slice(0, 18)}… on ${account}: proposal ${p.id} (${p.terms.action.what}) ${p.status}; bound ${bound ? "yes" : "no"}; revoked ${s.revoked ? "yes" : "no"}; spent ${usdz(s.spent)}`);
  return { bound, revoked: s.revoked, spent: s.spent };
}

/** The call log in one line, for the end of every command: what this world has used of its budget. */
export function callsLine(d: Pick<OwnersWorld, "chain">, usedBefore: number): string {
  const b = d.chain.budget;
  const used = b.used();
  return `CALLS            ${used} of ${b.budget} used in this world (this command: ${used - usedBefore}); a cli: line is one whole run of the metal-agent CLI, whose own requests are not counted one by one`;
}

// ---- preflight and the plan -----------------------------------------------------------------------------------------

export interface PlanStep {
  step: string;
  command: string;
  transactions: string[];
  /** JSON-RPC requests Purser makes and counts one by one: the fewest (every receipt in its first poll) and the most (every receipt in its last). */
  requests: { min: number; max: number };
  /** Runs of the metal-agent CLI, one log line each; the requests inside are not counted. */
  cli_runs: number;
  phone: string;
}

const NOTHING = "nothing";

/**
 * The live run, step by step, with what each sends and what it costs in calls. `polls` is how often a receipt is read
 * at most. The numbers follow from what the code does (test/owners-flow.test.ts runs each step and compares).
 */
export function ownersPlan(o: { funding: "donor" | "faucet" | "recycle"; polls: number }): PlanStep[] {
  const receipt = { min: 1, max: o.polls };
  // A transfer: the sender's nonce, the send, the receipt. An account call: a gas estimate before those.
  const transfer = { min: 2 + receipt.min, max: 2 + receipt.max };
  const call = { min: RELAY_CALLS, max: RELAY_CALLS - 1 + receipt.max };
  const sum = (...xs: { min: number; max: number }[]) => ({ min: xs.reduce((n, x) => n + x.min, 0), max: xs.reduce((n, x) => n + x.max, 0) });
  const exactly = (n: number) => ({ min: n, max: n });
  const sign = (title: string) => `Open the approval link within 15 minutes. Check: "${title}", 0.50 USDZ budget, up to 0.05 per payment, Stockline only. Tap "Approve with Face ID" and look at the phone. It shows "1 of 2 approvals"; then the second approver signs.`;
  const setup = o.funding === "donor"
    // The verifier's code, the transfer to the sponsor, the account's address, its code, the creation, the transfer to the account.
    ? { requests: sum(exactly(3), transfer, call, transfer), cli_runs: 0, transactions: ["donor key → gas sponsor, 5.00 test USD", "create the account (gas sponsor → account factory)", "donor key → account, 0.60 test USD"] }
    : o.funding === "faucet"
      // As above, with the sponsor's balance read before and after the faucet's grant, and the account funded by the sponsor.
      ? { requests: sum(exactly(5), call, transfer), cli_runs: 1, transactions: ["the faucet's grant to the gas sponsor (sent by the faucet)", "create the account (gas sponsor → account factory)", "gas sponsor → account, 0.60 test USD"] }
      // Recycling reads each finished world's balance and sends one transfer per world that gives: at least one of each.
      : { requests: sum(exactly(5), transfer, call, transfer), cli_runs: 0, transactions: ["finished dry-run world(s) → gas sponsor (one transfer per world that gives; more worlds, more calls)", "create the account (gas sponsor → account factory)", "gas sponsor → account, 0.60 test USD"] };
  return [
    { step: "1 preflight", command: "npm run owners -- preflight", transactions: [], requests: exactly(o.funding === "donor" ? 3 : 2), cli_runs: 0, phone: NOTHING },
    { step: "2 the owner's passkey", command: "npm run relay -- --enrol, then npm run passkey -- confirm <fingerprint>", transactions: [], requests: exactly(0), cli_runs: 0,
      phone: 'Open the viewer link once. Open the enrol page and type the code. Tap "Create passkey with Face ID" and look at the phone. Read the fingerprint it shows aloud.' },
    { step: "3 the second approver", command: "npm run passkey -- add <name>, then confirm its fingerprint", transactions: [], requests: exactly(0), cli_runs: 0, phone: "nothing (the second approver enrols on a second device)" },
    { step: "4 setup", command: "npm run owners -- setup", ...setup, phone: NOTHING },
    { step: "5 propose the bind", command: "npm run owners -- propose", transactions: [], requests: exactly(1), cli_runs: 0, phone: sign("Bind the sourcing mandate, signed on chain") },
    { step: "5 the runner relays it", command: "npm run relay (running)", transactions: ["executeSigned: the account binds the mandate (gas sponsor → account)"], requests: call, cli_runs: 0, phone: NOTHING },
    { step: "6 pay", command: "npm run owners -- pay", transactions: ["0.05 to Stockline inside the mandate (signed by the mandate key, sent by Metal's facilitator)", "0.06, over the cap: refused, and the refusal recorded on chain (sent by the gas sponsor)"], requests: exactly(1), cli_runs: 2, phone: NOTHING },
    { step: "7 propose the revoke", command: "npm run owners -- propose-revoke", transactions: [], requests: exactly(1), cli_runs: 0, phone: sign("Revoke the sourcing mandate, signed on chain") },
    { step: "7 the runner relays it", command: "npm run relay (running)", transactions: ["executeSigned: the account revokes the mandate (gas sponsor → account)"], requests: call, cli_runs: 0, phone: NOTHING },
    { step: "8 status", command: "npm run owners -- status", transactions: [], requests: exactly(1), cli_runs: 0, phone: NOTHING },
  ];
}

/** The plan's totals: transactions, and lines in the call log at the least and at the most. */
export function planTotals(plan: readonly PlanStep[]): { transactions: number; lines: { min: number; max: number }; cli_runs: number } {
  const cli_runs = plan.reduce((n, s) => n + s.cli_runs, 0);
  return { transactions: plan.reduce((n, s) => n + s.transactions.length, 0), cli_runs, lines: { min: plan.reduce((n, s) => n + s.requests.min, 0) + cli_runs, max: plan.reduce((n, s) => n + s.requests.max, 0) + cli_runs } };
}

/** What a live run lacks before preflight may make a single call. Nothing here reads the network. */
export function preflightRefusals(env: Record<string, string | undefined>): string[] {
  const why = ownersRefusals(env);
  if (!env.METAL_RPC_URL) why.push("METAL_RPC_URL (the Metal testnet endpoint)");
  if (!env.KIT11_RELAY_URL && !(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)) why.push("the relay's address: KIT11_RELAY_URL, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN so it can be looked up");
  else if (env.KIT11_RELAY_URL && !URL.canParse(env.KIT11_RELAY_URL)) why.push("KIT11_RELAY_URL is not an address");
  if (!relayToken(env)) why.push("the relay's token: KIT11_RELAY_TOKEN (or CLOUDFLARE_API_TOKEN, from which it is derived)");
  try { keysDir(env as NodeJS.ProcessEnv); } catch { why.push("KIT11_KEYS_DIR outside the code repository (it points inside it now)"); }
  if (env.OWNERS_DONOR_KEY && insideRepo(env.OWNERS_DONOR_KEY)) why.push("OWNERS_DONOR_KEY outside the code repository (it names a file inside it now)");
  if (env.OWNERS_DONOR_KEY && !insideRepo(env.OWNERS_DONOR_KEY) && !existsSync(env.OWNERS_DONOR_KEY)) why.push("OWNERS_DONOR_KEY names a key file that is not there");
  if (!passkeyOwnersOn(env as NodeJS.ProcessEnv)) why.push("KIT11_PASSKEY_OWNERS=on (the runner refuses an owners_execute without it)");
  return why;
}

export interface Preflight { ok: boolean; problems: string[]; plan: PlanStep[] }

/** Checks the settings, then at most three reads (the chain id, the verifier's code, the donor's balance), and prints the plan. No transaction. */
export async function preflight(d: OwnersWorld, polls: number): Promise<Preflight> {
  const funding = d.env.OWNERS_DONOR_KEY ? "donor" as const : d.env.KIT11_RECYCLE === "on" ? "recycle" as const : "faucet" as const;
  const plan = ownersPlan({ funding, polls });
  const refused = preflightRefusals(d.env);
  if (refused.length) {
    for (const r of refused) d.say(`MISSING          ${r}`);
    d.say("REFUSED          preflight made no call. Set what is missing and run it again.");
    return { ok: false, problems: refused, plan };
  }
  d.chain.step("preflight");
  const problems: string[] = [];
  const check = (ok: boolean, good: string, bad: string) => { d.say(`${ok ? "ok      " : "PROBLEM "}         ${ok ? good : bad}`); if (!ok) problems.push(bad); };
  d.say(`WORLD            ledger ${d.env.KIT11_DB ?? "data/kit11.sqlite (KIT11_DB is not set: the default ledger)"}; keys ${keysDir(d.env as NodeJS.ProcessEnv)}${d.env.KIT11_KEYS_DIR ? "" : " (KIT11_KEYS_DIR is not set: the default folder)"}`);
  d.say("ok               the owner's go, the call budget and the call log are set; the relay's address and token are set; the keys are outside the repository");
  const id = await d.chain.chainId();
  check(id === CHAIN_ID, `the endpoint answers as Metal testnet (chain ${CHAIN_ID})`, `the endpoint answers as chain ${id}, not Metal testnet (${CHAIN_ID})`);
  if (id === CHAIN_ID) {
    check(await d.chain.hasCode(PASSKEY_VERIFIER), `the WebAuthn verifier is deployed at ${PASSKEY_VERIFIER}`, `no WebAuthn verifier at ${PASSKEY_VERIFIER}`);
    const donor = donorOf(d.env);
    if (donor) {
      const have = await d.chain.balance(donor.address);
      const need = centsToBaseUnits(SPONSOR_CENTS + ACCOUNT_CENTS);
      check(have > need, `the donor key ${donor.address} holds ${usdz(have)} test USD; this run takes ${fromCents(SPONSOR_CENTS + ACCOUNT_CENTS)} and a little gas`, `the donor key ${donor.address} holds ${usdz(have)} test USD, not enough for ${fromCents(SPONSOR_CENTS + ACCOUNT_CENTS)} and gas`);
    } else d.say(`note             no donor key (OWNERS_DONOR_KEY): the gas sponsor is funded ${funding === "recycle" ? "with test money recycled from finished dry runs" : "by the faucet"}, and funds the account`);
  }
  const passkeys = (d.db.prepare("SELECT label FROM passkeys WHERE status = 'ACTIVE' ORDER BY label").all() as { label: string }[]).map((r) => r.label);
  d.say(`note             ${passkeys.length} of 2 passkeys enrolled${passkeys.length ? ` (${passkeys.join(", ")})` : ""}`);
  d.say("");
  d.say("PLAN             requests are counted one by one; a CLI run is one line in the log, and the requests inside it are not counted");
  for (const s of plan) {
    d.say(`${s.step.padEnd(24)} ${s.command}`);
    d.say(`${"".padEnd(24)} calls: ${s.requests.min === s.requests.max ? s.requests.min : `${s.requests.min} to ${s.requests.max}`} request(s)${s.cli_runs ? ` and ${s.cli_runs} CLI run(s)` : ""}; transactions: ${s.transactions.length ? s.transactions.join("; ") : "none"}`);
    d.say(`${"".padEnd(24)} on the phone: ${s.phone}`);
  }
  const t = planTotals(plan);
  const b = d.chain.budget;
  // This preflight's own calls are in the log already: what is left must cover the steps after it.
  const rest = { min: t.lines.min - plan[0]!.requests.min, max: t.lines.max - plan[0]!.requests.max };
  d.say("");
  d.say(`TOTAL            ${t.transactions} transactions; ${t.lines.min} to ${t.lines.max} lines in the call log (${t.cli_runs} of them CLI runs), the higher number when every receipt takes all ${polls} polls${funding === "recycle" ? "; more when several finished worlds give" : ""}`);
  check(b.left() >= rest.max, `the budget of ${b.budget} (${b.used()} used) covers the rest of the run (${rest.min} to ${rest.max} more lines)`, `the budget of ${b.budget} (${b.used()} used, ${b.left()} left) is below the ${rest.max} lines the rest of the run can take${b.left() < rest.min ? `, and below the ${rest.min} it takes at least` : ""}: the run would stop partway`);
  d.say(problems.length ? `NOT READY        ${problems.length} problem(s) above` : "READY            nothing was sent; the next step is the owner's passkey");
  return { ok: problems.length === 0, problems, plan };
}

/** Per step, what the world's call log holds so far (for a run's record). */
export function callsSoFar(file: string): ReturnType<typeof countByStep> {
  return countByStep(readOwnersCalls(file));
}
