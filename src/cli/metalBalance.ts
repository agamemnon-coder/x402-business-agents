// npm run metal-balance -- <wallets.json> [--out <file.md>]: reads the test *USDZ balance of each labelled wallet and the
// block height, read-only, with a hard cap of 10 Metal RPC calls (eth_chainId is answered locally). Gas on Metal is paid
// in *USDZ, so the *USDZ balance is also the gas balance. Nothing is signed or sent; the RPC URL is never printed.
// wallets.json: [{ "label": "...", "address": "0x...", "source": "the record that names it" }]

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, erc20Abi, getAddress, type Address } from "viem";
import { baseUnitsToCents, centsToBaseUnits, fromCents } from "../lib/money.js";
import { budgetedTransport } from "../metal/hold.js";
import { CHAIN_ID, USDZ, rpcUrl } from "../metal/network.js";

export const METAL_BALANCE_MAX_CALLS = 10;

export interface Wallet { label: string; address: string; source: string }
export interface BalanceRow extends Wallet { usdz: string }

export async function readBalances(wallets: Wallet[], read: { block(): Promise<bigint>; balance(a: Address): Promise<bigint> }, max = METAL_BALANCE_MAX_CALLS): Promise<{ block: bigint; rows: BalanceRow[] }> {
  if (wallets.length + 1 > max) throw new Error(`${wallets.length} wallets and the block need ${wallets.length + 1} calls; the cap is ${max}`);
  const block = await read.block();
  const rows: BalanceRow[] = [];
  for (const w of wallets) {
    const units = await read.balance(getAddress(w.address));
    rows.push({ ...w, address: getAddress(w.address), usdz: fromCents(baseUnitsToCents(units - (units % centsToBaseUnits(1)))) });
  }
  return { block, rows };
}

export function balanceRecord(at: Date, block: bigint, rows: BalanceRow[], calls: number): string {
  return [
    `# Metal testnet balances, read-only (${at.toISOString().slice(0, 10)})`,
    "",
    `Read at ${at.toISOString().replace(/\.\d+Z$/, "Z")} UTC, block ${block}, chain id ${CHAIN_ID} (Metal testnet). Test money only.`,
    `Made by \`npm run metal-balance\` (\`src/cli/metalBalance.ts\`): ${calls} read-only RPC calls, cap ${METAL_BALANCE_MAX_CALLS}. Nothing was signed or sent, no faucet was asked.`,
    "Gas on Metal is paid in *USDZ, so each balance below is also that wallet's gas. Balances are rounded down to the cent.",
    "",
    "| Wallet | Address | *USDZ | Named in |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.label} | \`${r.address}\` | ${r.usdz} | ${r.source} |`),
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag, out] = process.argv.slice(2);
  if (!file || (flag && flag !== "--out")) { console.error("usage: npm run metal-balance -- <wallets.json> [--out <file.md>]"); process.exit(2); }
  const wallets = JSON.parse(readFileSync(file, "utf8")) as Wallet[];
  const b = budgetedTransport(rpcUrl(), METAL_BALANCE_MAX_CALLS);
  const client = createPublicClient({ transport: b.transport });
  const at = new Date();
  const { block, rows } = await readBalances(wallets, {
    block: () => client.getBlockNumber(),
    balance: (a) => client.readContract({ address: USDZ, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
  });
  const md = balanceRecord(at, block, rows, b.used());
  if (out) writeFileSync(out, md);
  console.log(md);
}
