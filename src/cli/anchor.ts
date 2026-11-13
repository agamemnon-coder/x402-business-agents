// npm run anchor -- --dry | --live [--key <file name in KIT11_KEYS_DIR>]
// Computes the anchor head of Purser's committed records (src/anchor/head.ts). --dry prints it and the calldata, with
// no network and no key. --live sends ONE Metal testnet transaction (test money) carrying it, from a gas-only key in
// KIT11_KEYS_DIR (default gas-sponsor.key.json), and writes docs/runs/<date>-anchor.json and .md. Needs KIT11_KEYS_DIR
// (outside the repo; no default) and METAL_RPC_URL. Neither the key nor the RPC URL is ever printed.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CHECK_COMMAND, planAnchor, sendAnchor, writeRecord } from "../anchor/anchor.js";
import { metalChain } from "../anchor/metalChain.js";
import { keyPath } from "../metal/agentCli.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const live = args.includes("--live");
if (live === args.includes("--dry")) { console.error("usage: npm run anchor -- --dry | --live [--key <key file name>]"); process.exit(2); }

const root = resolve(import.meta.dirname, "../..");
const { head, calldata } = planAnchor(root);
for (const p of head.parts) console.log(`part   ${p.name.padEnd(36)} ${String(p.height).padStart(4)}  ${p.head}  (${p.file}, ${p.kind})`);
console.log(`head   ${head.head}  height ${head.height}`);
console.log(`data   ${calldata}`);

if (!live) { console.log("\ndry run: nothing sent. `npm run anchor -- --live` sends this in one Metal testnet transaction."); process.exit(0); }

const missing = ["KIT11_KEYS_DIR", "METAL_RPC_URL"].filter((n) => !process.env[n]);
if (missing.length) { console.error(`\nnot sent: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set (docs/run-it.md)`); process.exit(2); }
const keyFile = keyPath(opt("--key") ?? "gas-sponsor.key.json");
if (!existsSync(keyFile)) { console.error(`\nnot sent: no key file ${keyFile}`); process.exit(2); }

try {
  const record = await sendAnchor(root, metalChain(keyFile));
  const files = writeRecord(root, record);
  console.log(`\nsent   ${record.tx}  block ${record.block}  from ${record.from}\n       ${record.explorer}\nwrote  ${files.json}\n       ${files.md}\ncheck  ${CHECK_COMMAND}`);
} catch (e) {
  console.error(`\nanchor failed: ${(e as Error).message.split("\n")[0]}`);
  process.exit(1);
}
