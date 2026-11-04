// Research spike (B1), not part of the demo. On Metal testnet, a receiver accepts *USDZ only from an allowed sender and quarantines the rest,
// then accepts the quarantined credit after review. Throwaway keys in the keys repo (b1-spike); prints no URL or key.
// Run: npx tsx src/cli/receive-policy-spike.ts (needs METAL_RPC_URL). Result: docs/metal-award.md section 5.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createWalletClient, custom, encodeAbiParameters, keccak256, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient, readKeyFile, transferUsdz, usdzBalance } from "../metal/chain.js";
import { metalAgent } from "../metal/agentCli.js";
import { USDZ, EXPLORER_TX } from "../metal/network.js";

const DIR = process.env.KIT11_SPIKE_KEYS_DIR ?? "../x402-business-agents-keys/b1-spike";
mkdirSync(DIR, { recursive: true });
const POLICY = "0x0000000000000000000000000000000000000f4d" as const;
const abi = parseAbi([
  "function setPolicy(bool allowlistOnly, bool tokenFilter, uint8 refusal, uint8 recovery, address authority)",
  "function setAllowedSenders(address[] senders, bool allowed)",
  "function policyOf(address account) view returns (bool allowlistOnly, bool tokenFilter, uint8 refusal, uint8 recovery, address authority)",
  "function reasonFor(address token, address from, address to, uint256 amount) view returns (uint8)",
  "function open(bytes32 receiptId) view returns (bool)",
  "function claim((uint256 nonce,address token,address originator,address receiver,address authority,uint256 amount) receipt,address to)",
  "event Quarantined(bytes32 indexed receiptId,address indexed receiver,address indexed originator,(uint256 nonce,address token,address originator,address receiver,address authority,uint256 amount) receipt,uint8 reason)",
  "event Claimed(bytes32 indexed receiptId,address indexed to)",
]);
const pc = publicClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown> = {};
const log = (k: string, v: unknown) => { out[k] = v; console.log(k, typeof v === "bigint" ? v.toString() : v); };

function key(name: string): { file: string; address: Address } {
  const file = `${DIR}/${name}.key.json`;
  if (!existsSync(file)) metalAgent(["key", "create", "--out", file]);
  return { file, address: readKeyFile(file).address };
}
async function fund(address: Address): Promise<void> {
  if ((await usdzBalance(address)) > 0n) return;
  for (let i = 0; ; i++) {
    try { metalAgent(["fund", address]); break; } catch (e) {
      if (i < 4 && /rate.?limit|try again|retry|wait/i.test((e as Error).message)) { await sleep(65_000); continue; }
      throw e;
    }
  }
  for (let i = 0; i < 30 && (await usdzBalance(address)) === 0n; i++) await sleep(2000);
}
async function call(file: string, functionName: "setPolicy" | "setAllowedSenders" | "claim", args: readonly unknown[]): Promise<Hex> {
  const account = privateKeyToAccount(readKeyFile(file).privateKey);
  const walletClient = createWalletClient({ account, chain: pc.chain, transport: custom(pc) });
  const { writeMip20Contract } = await import("@metalntwx/metal-ts");
  const hash = await writeMip20Contract({ walletClient, publicClient: pc, abi, address: POLICY, functionName, args,
    gasToken: USDZ, gasFallback: 300_000n, gasLimit: 300_000n, maxFeePerGas: 1n } as never);
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} ${hash} reverted`);
  return hash;
}

const R = key("receiver"), A = key("allowed"), U = key("unknown");
log("receiver", R.address); log("allowed", A.address); log("unknown", U.address);
for (const k of [R, A, U]) await fund(k.address);
log("setPolicy", EXPLORER_TX + await call(R.file, "setPolicy", [true, false, 1, 1, "0x0000000000000000000000000000000000000000"]));
log("setAllowedSenders", EXPLORER_TX + await call(R.file, "setAllowedSenders", [[A.address], true]));
log("policyOf", (await pc.readContract({ address: POLICY, abi, functionName: "policyOf", args: [R.address] })).map(String));
const CENT = 10n ** 16n;
log("reasonFor(allowed)", await pc.readContract({ address: POLICY, abi, functionName: "reasonFor", args: [USDZ, A.address, R.address, CENT] }));
log("reasonFor(unknown)", await pc.readContract({ address: POLICY, abi, functionName: "reasonFor", args: [USDZ, U.address, R.address, CENT] }));

let before = await usdzBalance(R.address);
log("allowed->receiver", EXPLORER_TX + await transferUsdz(A.file, R.address, CENT));
log("receiver credited (allowed)", (await usdzBalance(R.address)) - before);

before = await usdzBalance(R.address);
const qtx = await transferUsdz(U.file, R.address, 2n * CENT);
log("unknown->receiver", EXPLORER_TX + qtx);
log("receiver credited (unknown)", (await usdzBalance(R.address)) - before);
const receipt = await pc.getTransactionReceipt({ hash: qtx });
const [q] = parseEventLogs({ abi, eventName: "Quarantined", strict: true, logs: receipt.logs.filter((l) => l.address.toLowerCase() === POLICY) });
if (!q) throw new Error("no Quarantined event");
const rc = q.args.receipt;
const id = keccak256(encodeAbiParameters([{ type: "tuple", components: [
  { name: "nonce", type: "uint256" }, { name: "token", type: "address" }, { name: "originator", type: "address" },
  { name: "receiver", type: "address" }, { name: "authority", type: "address" }, { name: "amount", type: "uint256" }] }], [rc]));
log("quarantine reason", q.args.reason); log("receiptId matches", id === q.args.receiptId); log("receipt", { ...rc, nonce: rc.nonce.toString(), amount: rc.amount.toString() });
log("open before claim", await pc.readContract({ address: POLICY, abi, functionName: "open", args: [id] }));

before = await usdzBalance(R.address);
const ctx = await call(R.file, "claim", [rc, R.address]);
log("claim (accept after review)", EXPLORER_TX + ctx);
log("receiver credited (claim)", (await usdzBalance(R.address)) - before);
log("open after claim", await pc.readContract({ address: POLICY, abi, functionName: "open", args: [id] }));
writeFileSync(`${DIR}/result.json`, JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
