// npm run rebalance -- --from treasury --to support --amount 0.50 --reason "…": proposes moving part of one agent's
// lifetime budget to another (block 6; also after a pause and resume). Nothing changes until the CFO approves it with
// Face ID (both passkeys when four eyes is on); the runner then replaces the mandates on chain.
import { proposeRebalance } from "../agents/treasury.js";
import type { Agent } from "../config/policy.js";
import { openDb } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { addresses, sellPrice, upstreamPrice } from "../world/runtime.js";

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const from = arg("--from") as Agent | undefined, to = arg("--to") as Agent | undefined, amount = arg("--amount"), reason = arg("--reason");
const AGENTS: Agent[] = ["sourcing", "support", "treasury"];
if (!from || !to || !AGENTS.includes(from) || !AGENTS.includes(to) || !amount || !/^\d+\.\d{2}$/.test(amount) || !reason) {
  console.error('usage: npm run rebalance -- --from <sourcing|support|treasury> --to <agent> --amount 0.50 --reason "why"');
  process.exit(2);
}
const db = openDb();
const p = await proposeRebalance(db, addresses(db), { from, to, cents: toCents(amount) }, reason, toCents(sellPrice(db)), toCents(upstreamPrice(db)));
console.log(`${p.proposal_id} rebalance: ${amount} from ${from} to ${to}, hash ${p.terms_sha256.slice(0, 8)}; approve or reject it on the phone with Face ID`);
