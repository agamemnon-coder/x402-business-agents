// npm run receive-policy                status: the sweep wallet's receive policy and the payments held in quarantine
// npm run receive-policy -- setup       allow only the business account to pay the sweep wallet; anything else is held
//                                       in quarantine (funds the wallet from the faucet first if it has no *USDZ for gas)
// npm run receive-policy -- poll        record payments held since the last poll and propose return/accept for each
// npm run receive-policy -- stranger    dev test: a test key that is not the business account pays the sweep wallet
//                                       0.02 *USDZ, so the policy has something to hold (funded from the faucet)
// Metal testnet (B1). Releasing a held payment is a proposal the CFO approves with Face ID; the runner executes it.

import { formatUnits, type Address } from "viem";
import { openDb } from "../db/open.js";
import { keyPath, metalAgent } from "../metal/agentCli.js";
import { usdzBalance } from "../metal/chain.js";
import { LiveReceivePolicy } from "../metal/receivePolicy.js";
import { pollQuarantine, quarantineReason, setupReceivePolicy } from "../policy/quarantine.js";

const db = openDb();
const port = new LiveReceivePolicy();
const cmd = process.argv[2] ?? "status";
const sweep = (db.prepare("SELECT address FROM metal_accounts WHERE role = 'sweep'").get() as { address: Address } | undefined)?.address;
if (!sweep) {
  console.error("this world has no sweep wallet yet (npm run bootstrap)");
  process.exit(2);
}

if (cmd === "setup") {
  // Setting the policy is a transaction from the wallet itself; gas is paid in *USDZ.
  // The faucet allows one grant a minute per client; wait and try again when it says so.
  for (let i = 0; (await usdzBalance(sweep)) === 0n; i++) {
    try {
      metalAgent(["fund", sweep]);
      console.log(`funded the sweep wallet ${sweep} from the faucet for gas`);
    } catch (e) {
      if (i >= 3 || !/rate.?limit|too recently|retry/i.test((e as Error).message)) throw e;
      console.log("  the faucet asks us to wait; trying again in 65 s");
      await new Promise((r) => setTimeout(r, 65_000));
    }
  }
  const r = await setupReceivePolicy(db, port, keyPath("sweep.key.json"));
  console.log(r.changed ? `receive policy set on ${sweep}: ${r.txs.map((t) => `https://testnet.metalntwx.com/tx/${t}`).join(" ")}` : "receive policy already set; nothing changed");
} else if (cmd === "stranger") {
  // A dev test, labelled as such: someone other than the business account pays the sweep wallet. Test money only.
  const { existsSync } = await import("node:fs");
  const { transferUsdz } = await import("../metal/chain.js");
  const file = keyPath("stranger.key.json");
  if (!existsSync(file)) metalAgent(["key", "create", "--out", file]);
  const { address } = JSON.parse((await import("node:fs")).readFileSync(file, "utf8")) as { address: Address };
  if ((await usdzBalance(address)) === 0n) { metalAgent(["fund", address]); console.log(`funded the stranger test key ${address} from the faucet`); }
  const tx = await transferUsdz(file, sweep, 2n * 10n ** 16n);
  console.log(`dev test: a stranger paid 0.02 *USDZ to the sweep wallet: https://testnet.metalntwx.com/tx/${tx}; run poll next`);
} else if (cmd === "poll") {
  console.log(`${await pollQuarantine(db, port)} new payment(s) held in quarantine`);
} else {
  const p = await port.policyOf(sweep);
  console.log(`sweep wallet ${sweep}: ${p.allowlistOnly ? "allowlist only" : "accepts anyone"}, refusal ${p.refusal === 1 ? "quarantine" : "revert"}`);
  for (const q of db.prepare("SELECT receipt_id, originator, amount_units, reason, status, tx_hash FROM quarantines ORDER BY created_at").all() as { receipt_id: string; originator: string; amount_units: string; reason: number; status: string; tx_hash: string }[]) {
    console.log(`  ${q.status.padEnd(8)} ${formatUnits(BigInt(q.amount_units), 18)} *USDZ from ${q.originator} (${quarantineReason(q.reason)})  ${q.tx_hash}`);
  }
}
