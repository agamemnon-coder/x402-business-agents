// A world for the live tokenize commands with no network: the in-memory chain (src/tokenize/localChain.ts), a *USDZ
// stand-in token, a donor key that holds test money, a source ledger file with one invoice a labelled virtual test
// passkey approved, and a temp directory for the run's ledger, call log and keys. `run` runs a command exactly as the
// CLI does (src/tokenize/live.ts). Used by test/tokenize-live.test.ts, test/tokenize-record.test.ts and the browser
// check of /metal (test/browser/pages.check.ts), which shows the block for a record made here.
//
// Every directory made here holds generated key files and ledgers: each is tracked, and whoever uses this module
// removes them when done (removeTokenizeWorlds, in an afterAll of each test file and at the end of the browser check).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { invoiceTokenCalls, standInTokenCalls, txClient, type Request } from "../../src/tokenize/client.js";
import type { LiveCommand } from "../../src/tokenize/guard.js";
import { readRoleKey, type Role } from "../../src/tokenize/keys.js";
import { openRunLedger } from "../../src/tokenize/ledger.js";
import { runLive } from "../../src/tokenize/live.js";
import { localChain, type LocalChain } from "../../src/tokenize/localChain.js";
import { TX_STEPS, type TxStep } from "../../src/tokenize/plan.js";
import { buildRunRecord, type TokenizeRunRecord } from "../../src/tokenize/runRecord.js";
import { standInLedger, STAND_IN_FIXTURE } from "../../src/tokenize/standIn.js";
import { centsToBaseUnits } from "../../src/lib/money.js";
import { CHAIN_ID } from "../../src/metal/network.js";

export const ROOT = resolve(import.meta.dirname, "../..");

const made: string[] = [];
/** A temp directory that removeTokenizeWorlds will delete. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
/** Deletes every temp directory made through this module (keys, ledgers, call logs). */
export function removeTokenizeWorlds(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  source = undefined;
}

let source: Promise<{ file: string; proposalId: string }> | undefined;
/** One approved invoice, written to a file as a live run's source ledger is. Made once per process. */
export function sourceLedger(): Promise<{ file: string; proposalId: string }> {
  source ??= (async () => {
    const l = await standInLedger();
    const file = join(tempDir("tokenize-source-"), "source.sqlite");
    writeFileSync(file, l.db.serialize());
    return { file, proposalId: l.proposalId };
  })();
  return source;
}

export interface Out { code: number; out: string[]; errs: string[]; text: string; requests: string[] }

export async function liveWorld() {
  const src = await sourceLedger();
  const dir = tempDir("tokenize-live-");
  const chain: LocalChain = await localChain();
  // Outside the commands (not on their budget): the *USDZ stand-in and a donor that holds test money.
  const setup = txClient({ request: chain.request, chainId: CHAIN_ID, sleep: async () => {} });
  const minter = privateKeyToAccount(generatePrivateKey());
  const settlement = await standInTokenCalls(setup).deploy(minter);
  const donorKey = generatePrivateKey(), donor = privateKeyToAccount(donorKey);
  const donorFile = join(dir, "donor.key.json");
  writeFileSync(donorFile, JSON.stringify({ address: donor.address, privateKey: donorKey }), { mode: 0o600 });
  await standInTokenCalls(setup).mint(minter, settlement, donor.address, centsToBaseUnits(10_000));
  const baseline = chain.mined.length;
  const env: Record<string, string> = {
    TOKENIZE_GO: "yes", TOKENIZE_CALL_BUDGET: "20", TOKENIZE_CALL_BUDGET_TOTAL: "200", TOKENIZE_CALL_LOG: join(dir, "calls.log"),
    TOKENIZE_DB: join(dir, "tokenize-test.sqlite"), METAL_RPC_URL: "https://rpc.invalid/never-asked", KIT11_KEYS_DIR: join(dir, "keys"),
    TOKENIZE_SOURCE_DB: src.file, TOKENIZE_PROPOSAL: src.proposalId, TOKENIZE_DOCUMENT: join(ROOT, "fixtures", STAND_IN_FIXTURE), TOKENIZE_DONOR_KEY: donorFile,
  };
  const run = async (cmd: LiveCommand, over: Record<string, string | undefined> = {}, request: Request = chain.request): Promise<Out> => {
    const out: string[] = [], errs: string[] = [], requests: string[] = [];
    const counted: Request = async (a) => { requests.push(a.method); return request(a); };
    const code = await runLive(cmd, { env: { ...env, ...over }, io: { say: (s) => out.push(s), err: (s) => errs.push(s) }, request: counted, settlement, sleep: async () => {} });
    return { code, out, errs, text: [...out, ...errs].join("\n"), requests };
  };
  const read = invoiceTokenCalls(setup);
  const balance = (who: Address) => read.balanceOf(settlement, who);
  const ledger = () => openRunLedger(env.TOKENIZE_DB!, { readonly: true });
  const statusOf = (key: string) => { if (!existsSync(env.TOKENIZE_DB!)) return undefined; const l = ledger(); try { return l.journal.last(key)?.status; } finally { l.close(); } };
  const state = () => { const l = ledger(); try { return l.state(); } finally { l.close(); } };
  const txs = () => { const l = ledger(); try { return l.txs(); } finally { l.close(); } };
  const role = (r: Role) => readRoleKey(env.KIT11_KEYS_DIR!, r);
  /** The steps before `step`, run cleanly; with no step, the whole run and its verify. */
  const upTo = async (step?: TxStep | "verify") => {
    for (const s of [...TX_STEPS, "verify" as const]) {
      if (s === step) return;
      const o = await run(s);
      if (o.code !== 0) throw new Error(`${s} exited ${o.code}:\n${o.text}`);
    }
  };
  return { dir, chain, settlement, donor, env, run, balance, statusOf, state, txs, role, upTo, baseline, setup, minter, source: src };
}

/**
 * The record of a whole run made here, on the in-memory chain: the same code a live run's record comes from. Its
 * hashes are this chain's, not Alta's: for tests and the browser check only, never written to docs/runs.
 */
export async function sampleRunRecord(now = () => new Date("2026-11-12T10:00:00.000Z")): Promise<{ record: TokenizeRunRecord; file: string; repo: string }> {
  const w = await liveWorld();
  await w.upTo();
  const repo = join(w.dir, "repo");
  mkdirSync(join(repo, "docs/runs"), { recursive: true });
  const record = buildRunRecord({ env: w.env, now, repo });
  return { record, file: `docs/runs/${record.date}-tokenize.json`, repo };
}
