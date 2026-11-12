// Builds the run record ../2026-11-12-metal-inspector.json from check.mts's output (calls.json, summary.json).
//   node docs/runs/2026-11-12-metal-inspector/make-record.mjs <check.mts out dir> <record.json>
import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2], out = process.argv[3];
const s = JSON.parse(readFileSync(`${dir}/summary.json`, "utf8"));
const c = JSON.parse(readFileSync(`${dir}/calls.json`, "utf8"));
const money = (units) => { const u = BigInt(units), cents = u / 10n ** 16n; if (u % 10n ** 16n !== 0n) throw new Error(`not a whole cent: ${units}`); return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`; };
const iso = (hexOrDec) => new Date(Number(BigInt(hexOrDec)) * 1000).toISOString();
const rawLog = (l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex });
const logTime = (tx) => { for (const call of c.calls) { const r = call.response?.result; if (r && r.transactionHash === tx && r.logs?.[0]?.blockTimestamp) return iso(r.logs[0].blockTimestamp); } return null; };
const event = (e, names) => ({ name: e.decoded.eventName, arg_names: names, arg_values: names.map((n) => e.decoded.args[n]) });
const REFUSED = ["ref", "to", "l3aDigest", "agentKey", "amount", "reason"];
const refusal = (run, purchase, x) => { const e = x.events[0]; return { run, ...(purchase ? { purchase } : {}), tx: x.tx, block: x.receipt.blockNumber, block_time: logTime(x.tx), status: x.receipt.status, sent_by: x.receipt.from, account: x.receipt.to, gas_used: x.receipt.gasUsed, event: { ...event(e, REFUSED), mandate: e.decoded.args.ref, payee: e.decoded.args.to, amount: money(e.decoded.args.amount), reason: e.decoded.args.reason, reason_name: s.abi.reasons[e.decoded.args.reason] }, raw_log: rawLog(e.raw) }; };
const binding = (agent, kind, x) => { const e = x.bound[0], a = e.decoded.args, p = a.terms.payees[0]; return { agent, kind, tx: x.tx, block: x.receipt.blockNumber, block_time: logTime(x.tx), status: x.receipt.status, sent_by: x.receipt.from, account: x.receipt.to, ref: a.ref, ...(x.replaced?.[0] ? { predecessor: x.replaced[0].decoded.args.predecessor, predecessor_revoked: (x.revoked ?? []).some((r) => r.decoded.args.ref === x.replaced[0].decoded.args.predecessor) } : {}), mandate_hash: a.hashC, terms: { asset: a.constraints.token, asset_name: JSON.parse(a.terms.instrument).description, currency: a.terms.currency, per_payment_cap: money(a.constraints.perPaymentCap), budget: money(a.constraints.budget), expiry: Number(a.constraints.expiry), expiry_iso: iso(a.constraints.expiry), payee: { account: p.account, name: JSON.parse(p.object).name }, payees: a.terms.payees.length, kid: a.terms.kid }, raw_log: rawLog(e.raw) }; };
const byMethod = {}; for (const x of c.calls) byMethod[x.request.method] = (byMethod[x.request.method] ?? 0) + 1;
const record = {
  title: "Read-only verification for the mandate inspector on /metal (12 November 2026)",
  network: "Metal testnet", chain_id: 63825,
  started_at: s.started_at, finished_at: s.finished_at,
  budget: { cap: s.cap, used: c.calls.length, by_method: byMethod },
  note: "Every call is a read (eth_getTransactionReceipt, eth_blockNumber, eth_call); nothing was signed or sent. The RPC URL is a credential and is not in this file. Receipts are kept without their logsBloom.",
  account: { address: s.business_account, name: "Northwind's account", source: "docs/demo/main-run.json, snapshot.world.business" },
  abi: {
    mandates: "function mandates(bytes32 ref) view returns ((address principal, bool revoked, bytes32 agentX, bytes32 agentY, string kid, bytes32 openSdHash, uint64 boundBlock, uint64 occurrences, uint128 spent))",
    mandates_selector: s.abi.selector,
    MandateRefused: "event MandateRefused(bytes32 indexed ref, address indexed to, bytes20 l3aDigest, bytes agentKey, uint256 amount, uint8 reason)",
    MandateBound: "event MandateBound(bytes32 indexed ref, bytes32 hashC, bytes32 issuerKey, bytes agentKey, (address token, uint256 perPaymentCap, uint256 budget, uint256 expiry, uint256 recurrenceStart, uint256 recurrenceEnd, uint256 maxOccurrences) constraints, (string kid, string instrument, string currency, uint256 unitsPerMinor, (address account, bytes32 sdHash, string object)[] payees, bytes32 openSdHash) terms)",
    topic0: { MandateRefused: s.abi.topic0.refused, MandateBound: s.abi.topic0.bound, MandateReplaced: s.abi.topic0.replaced, MandateRevoked: s.abi.topic0.revoked },
    reasons: s.abi.reasons,
    source: "@metalntwx/metal-pay (mandateBindingAbi)",
  },
  calls: c.calls.map((x) => { const r = x.response.result; const result = r && typeof r === "object" ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== "logsBloom")) : r; return { n: x.n, purpose: x.purpose, method: x.request.method, params: x.request.params, sent_at: x.sent_at, ms: x.ms, result }; }),
  refusals: [refusal("main run, 3 November 2026", "24", s.refusal_main_run), refusal("four-eyes world, 30 October 2026 (a separate run)", null, s.refusal_oct30)],
  bindings: [binding("treasury", "replace", s.treasury_replace), binding("support", "bind", s.support_bind)],
  reference_derivation: { rule: s.reference_derivation.rule, principal: s.reference_derivation.principal, derived_for_treasury: s.reference_derivation.derived_for_treasury, on_chain: s.reference_derivation.on_chain, ledger_mandate_hash: s.reference_derivation.ledger_credential_hash, event_hashC: s.reference_derivation.event_hashC, holds: s.reference_derivation.holds },
  sourcing_reference: s.sourcing_reference,
  read: { block: s.read.block, block_hex: s.read.block_hex, read_at: s.read.read_at, mandates: s.read.mandates.map((m) => ({ agent: m.agent, ref: m.ref, call: m.call, result_hex: m.result_hex, principal: m.decoded.principal, bound: m.bound, revoked: m.revoked, spent: money(m.spent_units), spent_units: m.spent_units, occurrences: Number(m.occurrences), bound_block: Number(m.bound_block), kid: m.decoded.kid })) },
};
writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`);
console.log("written", out, JSON.stringify(record).length, "bytes");
console.log(JSON.stringify({ budget: record.budget, refusals: record.refusals.map((r) => [r.run, r.block, r.block_time, r.event.amount, r.event.reason_name, r.sent_by]), bindings: record.bindings.map((b) => [b.agent, b.kind, b.block, b.block_time, b.terms.per_payment_cap, b.terms.budget, b.terms.expiry_iso, b.terms.payee.name, b.terms.asset_name, b.predecessor ?? null, b.predecessor_revoked ?? null]), read: record.read.mandates.map((m) => [m.agent, m.bound, m.revoked, m.spent, m.occurrences, m.bound_block]) }, null, 1));
