// A whole owners world for tests, in process and offline: a ledger in memory with two enrolled passkeys (software
// authenticators, the WebAuthn a phone produces), a keys folder in a temp directory, the stand-in chain behind a real
// call budget and log, and a stand-in for the metal-agent CLI's network commands (the faucet's grant, a mandate pull).
// Its offline commands (key create, mandate credential create) are the real pinned CLI.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openDb, type DB } from "../../src/db/open.js";
import { termsHash } from "../../src/lib/terms.js";
import { centsToBaseUnits } from "../../src/lib/money.js";
import { metalAgent, type CliResult } from "../../src/metal/agentCli.js";
import { callBudget, readOwnersCalls } from "../../src/metal/ownersBudget.js";
import { ownersChain } from "../../src/metal/ownersChain.js";
import { approvalHashOf, type OwnersExecuteTerms } from "../../src/metal/ownersExecute.js";
import { countedCli, type OwnersWorld } from "../../src/metal/ownersFlow.js";
import { ownersRelay } from "../../src/metal/passkeyRelay.js";
import { executeOwnersExecute } from "../../src/executors/ownersExecute.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../../src/passkey/ledger.js";
import { processAssertion, processRegistration } from "../../src/passkey/process.js";
import { challengeFor } from "../../src/passkey/webauthn.js";
import { FakeAuthenticator } from "../../src/redteam/authenticator.js";
import { fakeMetal, type FakeMetal } from "./fakeMetal.js";

const RP = "kit11.example.workers.dev";
const ORIGIN = `https://${RP}`;
export const T0 = new Date("2026-11-12T10:00:00Z");
let tickets = 0;

async function enrol(db: DB, label: string, add: boolean): Promise<FakeAuthenticator> {
  const auth = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: ORIGIN, ...(add ? { addPerson: label } : {}) }, T0);
  await processRegistration(db, { ticket: `r-${++tickets}`, kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: auth.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), received_at: T0.toISOString() }, { label }, T0);
  confirmPasskey(db, fingerprintOf(auth.spkiSha256), T0);
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
  /** What the stand-in CLI answers a pull for a payment id: paid, or refused on chain. */
  pulls: { refuseOverCap: boolean };
  donor: ReturnType<typeof privateKeyToAccount>;
  /** A fresh process of the same world: a new budgeted chain over the same node, ledger, keys and call log. */
  again(o?: { budget?: number; pollsMs?: number[] }): OwnersWorld;
  /** The logged calls since `from`, as "step:method". */
  calls(from?: number): string[];
  /** Both passkeys sign the proposal's on-chain digest on their phones. */
  signBoth(id: string): Promise<void>;
  /** The runner relays an approved proposal over this world's chain. */
  relay(id: string): Promise<Hex>;
  close(): void;
}

/** A world with two enrolled passkeys and a donor key holding 99.00 test USD. Sets KIT11_KEYS_DIR and KIT11_PASSKEY_OWNERS for the test; close() restores them. */
export async function ownersWorld(o: { budget?: number; pollsMs?: number[]; donor?: boolean; env?: Record<string, string> } = {}): Promise<TestWorld> {
  const dir = mkdtempSync(join(tmpdir(), "owners-world-"));
  const keys = join(dir, "keys");
  mkdirSync(keys);
  const log = join(dir, "calls.jsonl");
  const before = { keys: process.env.KIT11_KEYS_DIR, on: process.env.KIT11_PASSKEY_OWNERS };
  process.env.KIT11_KEYS_DIR = keys;
  process.env.KIT11_PASSKEY_OWNERS = "on";
  const db = openDb(":memory:");
  const auths = [await enrol(db, "max", false), await enrol(db, "controller", true)];
  const node = fakeMetal();
  const donorKey = generatePrivateKey();
  const donor = privateKeyToAccount(donorKey);
  const donorFile = join(dir, "donor.key.json");
  writeFileSync(donorFile, JSON.stringify({ address: donor.address, privateKey: donorKey }), { mode: 0o600 });
  node.balances.set(donor.address.toLowerCase(), centsToBaseUnits(9900));
  const said: string[] = [];
  const cliRuns: string[][] = [];
  const pulls = { refuseOverCap: true };
  const paidIds = new Map<string, string>();
  // The CLI's network commands, answered as metal-agent 0.3.3 prints them.
  const network = (args: string[]): CliResult => {
    cliRuns.push(args);
    const arg = (k: string) => args[args.indexOf(k) + 1]!;
    const result = (code: number, lines: string[]): CliResult => ({ code, out: lines.join("\n"), fields: new Map(lines.map((l) => { const i = l.indexOf(" "); return [l.slice(0, i), [l.slice(i + 1)]] as const; })) });
    if (args[0] === "fund") {
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
      if (paidIds.has(id)) return result(0, ["already paid, nothing sent", `transaction ${paidIds.get(id)}`, "outcome paid"]);
      paidIds.set(id, tx);
      return result(0, [`transaction ${tx}`, "outcome paid", `amount ${arg("--amount")}`]);
    }
    throw new Error(`the stand-in CLI does not run ${args.slice(0, 2).join(" ")}`);
  };
  const env = { OWNERS_GO: "yes", OWNERS_CALL_BUDGET: String(o.budget ?? 200), OWNERS_CALL_LOG: log, KIT11_KEYS_DIR: keys, KIT11_PASSKEY_OWNERS: "on", ...(o.donor === false ? {} : { OWNERS_DONOR_KEY: donorFile }), ...(o.env ?? {}) };
  const make = (m: { budget?: number; pollsMs?: number[] } = {}): OwnersWorld => {
    const chain = ownersChain({ budget: callBudget({ budget: m.budget ?? o.budget ?? 200, file: log }), rpc: node.rpc, sleep: async () => {}, pollsMs: m.pollsMs ?? o.pollsMs ?? [1, 1, 1, 1] });
    return { db, chain, env, say: (l) => said.push(l), now: () => T0, sleep: async () => {}, cli: countedCli(chain, network), cliOffline: (args) => metalAgent(args) };
  };
  const d = make();
  let signed = 0;
  const terms = (id: string) => db.prepare("SELECT kind, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { kind: string; terms_json: string; terms_sha256: string };
  return {
    d, db, node, dir, keys, log, said, cliRuns, pulls, donor,
    again: make,
    calls: (from = 0) => readOwnersCalls(log).slice(from).map((c) => `${c.step}:${c.method}`),
    async signBoth(id) {
      const p = terms(id);
      const t = JSON.parse(p.terms_json) as OwnersExecuteTerms;
      for (const [i, auth] of auths.entries()) {
        const out = await processAssertion(db, { ticket: `t-${++tickets}`, kind: "assertion", proposal_id: id, body: JSON.stringify({ proposal_id: id, terms_sha256: termsHash(t), credential: auth.sign({ challenge: challengeFor(approvalHashOf(p)), origin: ORIGIN, rpId: RP, counter: ++signed }) }), received_at: T0.toISOString() }, T0);
        if (out.status !== (i === 0 ? "cosigned" : "approved")) throw new Error(`passkey ${i + 1} on ${id}: ${out.status} ${out.message ?? ""}`);
      }
    },
    async relay(id) {
      const w = make();
      w.chain.step(`execute ${id}`);
      const sponsor = privateKeyToAccount((JSON.parse(readFileSync(join(keys, "passkey-sponsor.key.json"), "utf8")) as { privateKey: Hex }).privateKey);
      const { tx } = await executeOwnersExecute(db, id, ownersRelay(w.chain, sponsor), T0);
      // What the account did, as the chain would hold it after the call: the mandate bound, or revoked.
      const t = JSON.parse(terms(id).terms_json) as OwnersExecuteTerms;
      const ref = t.action.mandate.toLowerCase();
      const m = node.mandates.get(ref);
      node.mandates.set(ref, { principal: t.account as Address, boundBlock: 5n, spent: m?.spent ?? 0n, occurrences: m?.occurrences ?? 0n, revoked: t.action.what === "revoke" });
      return tx;
    },
    close() {
      for (const [k, v] of [["KIT11_KEYS_DIR", before.keys], ["KIT11_PASSKEY_OWNERS", before.on]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
