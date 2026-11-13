// Test money for a new test world (Max, 1 November). The Metal testnet faucet has a daily limit, and each finished
// dry run leaves about 100 *USDZ of spare test money in its customer owner's plain wallet (the faucet grants 100 a time; a
// world uses about 25). With KIT11_RECYCLE=on, a wallet that needs test money is filled from those spare wallets:
//   - only from finished dry-N worlds: a keys folder named dry-<n> whose ledger has not changed for an hour, never the
//     world being filled, so never the reserve world (live-*) or Thursday's world;
//   - only the customer owner's plain wallet in each, keeping 0.10 for its own gas; the accounts, mandates and every proof on
//     chain stay as they are, and no old ledger is opened or changed;
//   - each transfer is appended to docs/archive/runs/testgeld-recycling.md with its tx; keys stay in their folders, and
//     nothing secret is printed or logged.
// Without KIT11_RECYCLE=on the faucet is asked, as before.

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Address, Hex } from "viem";
import { centsToBaseUnits, baseUnitsToCents, fromCents } from "../lib/money.js";
import { keysDir, metalAgentAsync } from "./agentCli.js";
import { transferUsdz, usdzBalance } from "./chain.js";
import { EXPLORER_TX } from "./network.js";

// The customer owner's plain wallet only: it got 100 from the faucet and spends a cent of gas. The business owner's key
// stays untouched (only the owner signer and people's own CLIs name it: test/no-owner-key.test.ts).
const DONOR_FILES = ["owner-customer.key.json"];
const GAS_RESERVE = centsToBaseUnits(10);
const CENT = centsToBaseUnits(1);
/** Whole cents only: a donor's balance after gas can end in fractions of a cent, and a ledger amount never does. */
const floorCents = (units: bigint) => units - (units % CENT);
const usdz = (units: bigint) => fromCents(baseUnitsToCents(floorCents(units < 0n ? 0n : units)));
const FINISHED_AFTER_MS = 60 * 60_000;
const REPO = resolve(import.meta.dirname, "../..");
const LOG = join(REPO, "docs/archive/runs/testgeld-recycling.md");

export interface FundDeps {
  recycle: boolean;
  /** The keys folder name of the world being filled. */
  current: string;
  /** Every world's keys folder name and how long ago its ledger last changed (null: no ledger here). */
  worlds(): { name: string; ageMs: number | null }[];
  address(world: string, file: string): Address | null;
  balance(a: Address): Promise<bigint>;
  transfer(world: string, file: string, to: Address, amount: bigint): Promise<Hex>;
  /** Asynchronous where the caller also serves others (the world, recording a refusal on chain). */
  faucet(a: Address): void | Promise<void>;
  log(row: string): void;
}

/** The worlds that may give: finished dry-N worlds, oldest first, never the one being filled. */
export function donorWorlds(worlds: { name: string; ageMs: number | null }[], current: string): string[] {
  return worlds.filter((w) => /^dry-\d+$/.test(w.name) && w.name !== current && w.ageMs !== null && w.ageMs >= FINISHED_AFTER_MS)
    .map((w) => w.name).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
}

/** Makes sure `address` holds at least minCents of test *USDZ; returns how. Throws, moving nothing, when the finished
 *  worlds cannot cover the shortfall. */
export async function fundTestWallet(address: Address, minCents: number, opts: { label: string; deps?: FundDeps }): Promise<"enough" | "recycled" | "faucet"> {
  const d = opts.deps ?? liveDeps();
  const have = await d.balance(address);
  const want = centsToBaseUnits(minCents);
  if (have >= want) return "enough";
  if (!d.recycle) { await d.faucet(address); return "faucet"; }
  // Whole cents: the shortfall rounded up to the next cent.
  let need = want - have;
  if (need % CENT !== 0n) need = floorCents(need) + CENT;
  // Plan first, then send: never half-fill.
  const plan: { world: string; file: string; amount: bigint }[] = [];
  for (const world of donorWorlds(d.worlds(), d.current)) {
    for (const file of DONOR_FILES) {
      if (need <= 0n) break;
      const from = d.address(world, file);
      if (!from) continue;
      const spare = floorCents((await d.balance(from)) - GAS_RESERVE);
      if (spare <= 0n) continue;
      const amount = spare < need ? spare : need;
      plan.push({ world, file, amount });
      need -= amount;
    }
    if (need <= 0n) break;
  }
  if (need > 0n) throw new Error(`not enough spare test money in finished dry worlds for ${opts.label} (${usdz(need)} *USDZ short); ask the faucet or Max`);
  for (const p of plan) {
    const tx = await d.transfer(p.world, p.file, address, p.amount);
    d.log(`| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${p.world} · ${p.file.replace(".key.json", "")} | ${d.current} · ${opts.label} \`${address}\` | ${usdz(p.amount)} | [${tx.slice(0, 10)}…](${EXPLORER_TX}${tx}) |`);
  }
  return "recycled";
}

/** The live deps: the keys folders beside this world's, their ledgers, Purser's own chain client and the faucet. A caller
 *  that counts its calls (the owners path, behind its call budget) replaces balance, transfer and faucet with its own. */
export function liveDeps(): FundDeps {
  const dir = keysDir();
  const root = dirname(dir);
  return {
    recycle: process.env.KIT11_RECYCLE === "on",
    current: basename(dir),
    worlds: () => readdirSync(root).map((name) => {
      const ledger = join(REPO, "data", `${name}.sqlite`);
      if (!existsSync(ledger)) return { name, ageMs: null };
      const latest = Math.max(...[ledger, `${ledger}-wal`].filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs));
      return { name, ageMs: Date.now() - latest };
    }),
    address: (world, file) => {
      const p = join(root, world, file);
      return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { address: Address }).address : null;
    },
    balance: usdzBalance,
    transfer: (world, file, to, amount) => transferUsdz(join(root, world, file), to, amount),
    faucet: async (a) => { await metalAgentAsync(["fund", a]); },
    log: (row) => {
      if (!existsSync(LOG)) writeFileSync(LOG, "# Test money recycled from finished dry runs\n\nMax's rules (1 November): only from finished dry-N worlds, never the reserve world or Thursday's; each transfer with its tx; old ledgers and proofs unchanged; keys stay where they are. Written by `src/metal/testFunds.ts`.\n\n| UTC | From (world · wallet) | To (world · wallet, address) | *USDZ | Tx |\n|---|---|---|---|---|\n");
      appendFileSync(LOG, `${row}\n`);
    },
  };
}
