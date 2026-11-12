// A whole owners world for tests, in process and offline: a ledger in memory with two enrolled passkeys (software
// authenticators, the WebAuthn a phone produces), a keys folder in a temp directory, the stand-in chain behind a real
// call budget and log, and a stand-in for the metal-agent CLI's network commands (the faucet's grant, a mandate pull).
// Its offline commands (key create, mandate credential create) are the real pinned CLI.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTerms } from "@metalntwx/metal-pay/mandates";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openDb, type DB } from "../../src/db/open.js";
import { termsHash } from "../../src/lib/terms.js";
import { centsToBaseUnits } from "../../src/lib/money.js";
import { metalAgent, type CliResult } from "../../src/metal/agentCli.js";
import { callBudget, readOwnersCalls } from "../../src/metal/ownersBudget.js";
import { ownersChain } from "../../src/metal/ownersChain.js";
import { boundCapUnits, loadCredentialFile } from "../../src/metal/mandate.js";
import { approvalHashOf, type OwnersExecuteTerms } from "../../src/metal/ownersExecute.js";
import { countedCli, type OwnersWorld } from "../../src/metal/ownersFlow.js";
import { ownersRelay } from "../../src/metal/passkeyRelay.js";
import { executeOwnersExecute } from "../../src/executors/ownersExecute.js";
import { resuming } from "../../src/policy/approvals.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../../src/passkey/ledger.js";
import { processAssertion, processRegistration } from "../../src/passkey/process.js";
import { challengeFor } from "../../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { fakeMetal, type FakeMetal } from "./fakeMetal.js";

/** The budget written in a mandate's credential, in *USDZ base units. */
const budgetUnits = (m: ReturnType<typeof loadCredentialFile>) => extractTerms(m.credential).constraints.budget;
const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
export const T0 = new Date("2026-11-12T10:00:00Z");
let tickets = 0;

async function enrol(db: DB, label: string, add: boolean, at: Date): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, ...(add ? { addPerson: label } : {}) }, at);
  await processRegistration(db, { ticket: `r-${++tickets}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: at.toISOString() }, { label }, at);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), at);
  return auth;
}

export interface TestWorld {
  d: OwnersWorld;
  db: DB;
  node: FakeMetal;
  dir: string;
  keys: string;
  log: string;
  said: string[];
  /** Every run of the stand-in for the CLI's network commands, as its argument list. */
  cliRuns: string[][];
  /** What the stand-in CLI answers a pull that asks for the refusal to be recorded: refused on chain, or (were Metal not to refuse) paid. */
  pulls: { refuseOverCap: boolean };
  /** The world's clock: every command, signature and relay happens at `clock.now`. A test moves it. */
  clock: { now: Date };
  /** Errors the stand-in faucet answers with first, one per run of `fund`, before it grants. */
  faucetErrors: string[];
  donor: ReturnType<typeof privateKeyToAccount>;
  /** A fresh process of the same world: a new budgeted chain over the same node, ledger, keys and call log. */
  again(o?: { budget?: number; pollsMs?: number[] }): OwnersWorld;
  /** The logged calls since `from`, as "step:method". */
  calls(from?: number): string[];
  /** Both passkeys sign the proposal's on-chain digest on their phones. */
  signBoth(id: string): Promise<void>;
  /** One passkey (0: the first enrolled, 1: the second) signs the proposal's on-chain digest; the runner's answer. */
  sign(id: string, who: 0 | 1): ReturnType<typeof processAssertion>;
  /** The runner relays an approved proposal over this world's chain; `resume` as the runner does at a restart (src/policy/saga.ts). */
  relay(id: string, o?: { resume?: boolean; budget?: number; pollsMs?: number[] }): Promise<Hex>;
  close(): void;
}

/**
 * A world with two enrolled passkeys and a donor key holding 99.00 test USD. Sets KIT11_KEYS_DIR and KIT11_PASSKEY_OWNERS
 * for the test; close() restores them. `labels` names the two passkeys (the first is enrolled first, the second added);
 * `dbFile` keeps the ledger in a file, for a test that runs the real command on it.
 */
export async function ownersWorld(o: { budget?: number; pollsMs?: number[]; donor?: boolean; env?: Record<string, string>; labels?: [string, string]; dbFile?: string; at?: Date } = {}): Promise<TestWorld> {
  const dir = mkdtempSync(join(tmpdir(), "owners-world-"));
  const keys = join(dir, "keys");
  mkdirSync(keys);
  const log = join(dir, "calls.jsonl");
  const before = { keys: process.env.KIT11_KEYS_DIR, on: process.env.KIT11_PASSKEY_OWNERS };
  process.env.KIT11_KEYS_DIR = keys;
  process.env.KIT11_PASSKEY_OWNERS = "on";
  const clock = { now: o.at ?? T0 };
  const db = openDb(o.dbFile ?? ":memory:");
  const [first, second] = o.labels ?? ["max", "controller"];
  const auths = [await enrol(db, first, false, clock.now), await enrol(db, second, true, clock.now)];
  const node = fakeMetal();
  const donorKey = generatePrivateKey();
  const donor = privateKeyToAccount(donorKey);
  const donorFile = join(dir, "donor.key.json");
  writeFileSync(donorFile, JSON.stringify({ address: donor.address, privateKey: donorKey }), { mode: 0o600 });
  node.balances.set(donor.address.toLowerCase(), centsToBaseUnits(9900));
  const said: string[] = [];
  const cliRuns: string[][] = [];
  const pulls = { refuseOverCap: true };
  const faucetErrors: string[] = [];
  /** Payouts made, by mandate and payment id: metal-agent pays a payment id at most once under one mandate. */
  const paidIds = new Map<string, string>();
  const refusedOf = (reason: string) => ({ NoMandate: "mandate_not_bound (no such mandate is bound on the account)", Revoked: "mandate_revoked (the mandate is revoked, or replaced: the agent pays under the credential that replaced it)", Cap: "mandate_cap_exceeded (the amount is above the mandate's per-payment cap)", Budget: "mandate_budget_spent (the amount would take the mandate past its budget)" })[reason]!;
  // The CLI's network commands, answered as metal-agent 0.3.3 prints them.
  const network = (args: string[]): CliResult => {
    cliRuns.push(args);
    const arg = (k: string) => args[args.indexOf(k) + 1]!;
    const result = (code: number, lines: string[]): CliResult => ({ code, out: lines.join("\n"), fields: new Map(lines.map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), [l.slice(i + 1)]] as const; })) });
    if (args[0] === "fund") {
      const refusal = faucetErrors.shift();
      if (refusal) throw new Error(refusal);
      const a = args[1]!.toLowerCase();
      node.balances.set(a, (node.balances.get(a) ?? 0n) + centsToBaseUnits(10_000));
      return result(0, [`funded ${args[1]} with 100.00 *USDZ from the testnet faucet`, `transaction 0x${"fa".repeat(32)}`]);
    }
    if (args[0] === "mandate" && args[1] === "pull") {
      const id = arg("--payment-id");
      const tx = `0x${Buffer.from(id).toString("hex").padEnd(64, "0").slice(0, 64)}`;
      if (args.includes("--record-refusal")) {
        return pulls.refuseOverCap
          ? result(1, [`transaction ${tx}`, "outcome refused", "reason mandate_cap_exceeded (the amount is above the mandate's per-payment cap)", `amount ${arg("--amount")}`])
          : result(0, [`transaction ${tx}`, "outcome paid", `amount ${arg("--amount")}`]);
      }
      // As Metal checks a pull: against the mandate the credential describes, as the chain has it bound.
      const m = loadCredentialFile("sourcing", arg("--credential"));
      const ref = m.reference.toLowerCase();
      const key = `${ref}:${id}`;
      if (paidIds.has(key)) return result(0, ["already paid, nothing sent", `transaction ${paidIds.get(key)}`, "outcome paid"]);
      const onChain = node.mandates.get(ref);
      const amount = centsToBaseUnits(Math.round(Number(arg("--amount")) * 100));
      const why = !onChain || onChain.boundBlock === 0n ? "NoMandate" : onChain.revoked ? "Revoked" : amount > boundCapUnits(m) ? "Cap" : onChain.spent + amount > budgetUnits(m) ? "Budget" : null;
      // A pull the mandate refuses when checked is not sent: the reason, and exit 1.
      if (why) return result(1, ["outcome refused", `reason ${refusedOf(why)}`]);
      paidIds.set(key, tx);
      node.mandates.set(ref, { ...onChain!, spent: onChain!.spent + amount, occurrences: onChain!.occurrences + 1n });
      return result(0, [`transaction ${tx}`, "outcome paid", `amount ${arg("--amount")}`]);
    }
    throw new Error(`the stand-in CLI does not run ${args.slice(0, 2).join(" ")}`);
  };
  // The ledger's name as a live run sets it (the owners commands refuse to run without one); here the ledger itself is in memory unless `dbFile` names a file.
  const env = { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: String(o.budget ?? 200), OWNERS_CALL_LOG: log, KIT11_DB: o.dbFile ?? join(dir, "world.sqlite"), KIT11_KEYS_DIR: keys, KIT11_PASSKEY_OWNERS: "on", ...(o.donor === false ? {} : { OWNERS_DONOR_KEY: donorFile }), ...(o.env ?? {}) };
  const make = (m: { budget?: number; pollsMs?: number[] } = {}): OwnersWorld => {
    const chain = ownersChain({ budget: callBudget({ budget: m.budget ?? o.budget ?? 200, file: log, now: () => clock.now }), rpc: (a) => node.rpc(a), sleep: async () => {}, pollsMs: m.pollsMs ?? o.pollsMs ?? [1, 1, 1, 1] });
    return { db, chain, env, say: (l) => said.push(l), now: () => clock.now, sleep: async () => {}, cli: countedCli(chain, network), cliOffline: (args) => metalAgent(args) };
  };
  const d = make();
  let signed = 0;
  const terms = (id: string) => db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; terms_json: string; terms_sha256: string };
  // Through the runner's own passkey processing, as an assertion from the phone arrives.
  const sign: TestWorld["sign"] = (id, who) => {
    const p = terms(id);
    const t = JSON.parse(p.terms_json) as OwnersExecuteTerms;
    return processAssertion(db, { ticket: `t-${++tickets}`, kind: "assertion", proposal_id: id, body: JSON.stringify({ proposal_id: id, terms_sha256: termsHash(t), credential: auths[who]!.sign({ challenge: challengeFor(approvalHashOf(p)), origin: ORIGIN, rpId: RP, counter: ++signed }) }), received_at: clock.now.toISOString() }, clock.now);
  };
  return {
    d, db, node, dir, keys, log, said, cliRuns, pulls, faucetErrors, donor, clock,
    again: make,
    calls: (from = 0) => readOwnersCalls(log).slice(from).map((c) => `${c.step}:${c.method}`),
    sign,
    async signBoth(id) {
      for (const i of [0, 1] as const) {
        const out = await sign(id, i);
        if (out.status !== (i === 0 ? "cosigned" : "approved")) throw new Error(`passkey ${i + 1} on ${id}: ${out.status} ${out.message ?? ""}`);
      }
    },
    async relay(id, r = {}) {
      const w = make(r);
      w.chain.step(`execute ${id}`);
      const sponsor = privateKeyToAccount((JSON.parse(readFileSync(join(keys, "passkey-sponsor.key.json"), "utf8")) as { privateKey: Hex }).privateKey);
      if (r.resume) resuming.add(id);
      // What the account does with it is the stand-in chain's own work: it reads the relayed call data (test/support/fakeMetal.ts).
      try { return (await executeOwnersExecute(db, id, ownersRelay(w.chain, sponsor), clock.now)).tx; } finally { resuming.delete(id); }
    },
    close() {
      for (const [k, v] of [["KIT11_KEYS_DIR", before.keys], ["KIT11_PASSKEY_OWNERS", before.on]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
