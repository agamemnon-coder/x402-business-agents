// npm run metal-inspect: /metal's read-only mandate check from a clone (jury panel, 12 Nov). Without METAL_RPC_URL it
// prints the read of 12 November from its record (docs/runs/2026-11-12-metal-inspector.json), labelled as recorded;
// with it, one live read through the same desk as GET /api/metal/mandates (worker/src/metalInspector.ts): one
// eth_blockNumber and one eth_call of mandates(ref) per agent, at most CLI_CEILING calls a run.
// `npm run metal-inspect -- refusal <tx>` prints a MandateRefused event decoded: from the record when the transaction is
// in it; else, with METAL_RPC_URL, from the transaction's receipt (one call). Nothing is signed or sent, and the RPC URL
// is never printed: every failure is told in fixed words.

import Database from "better-sqlite3";
import type { Sql } from "../../worker/src/core.js";
import { MetalInspector, decodeRefusal, type InspectorAnswer, type RefusalLog } from "../../worker/src/metalInspector.js";
import { METAL_INSPECTOR_RECORD, inspectorRecord } from "../redesign/metalMandates.js";

/** JSON-RPC calls a run may make: the block number and one read per mandate (four), with one to spare. */
export const CLI_CEILING = 6;

export interface InspectOptions { rpcUrl?: string; fetcher?: typeof fetch; now?: () => Date }

/** The inspector's SQL calls over an in-memory SQLite: this run's call count and its one answer. */
function memory(): Sql {
  const db = new Database(":memory:");
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}

/** The answer as lines: where it comes from, each agent's mandate, and the read anyone can repeat. */
export function answerLines(a: InspectorAnswer): string[] {
  const pad = (s: string, n: number) => s.padEnd(n);
  return [
    a.source === "chain" ? `Read live from ${a.network} at ${a.read_at.slice(11, 19)} UTC, block ${a.block}.` : `Recorded on ${a.recorded_on ?? a.read_at.slice(0, 10)} at block ${a.block}, a read-only check (live read: ${a.reason ?? "none"}).`,
    `Account ${a.account} (amounts in *USDZ, test money)`,
    `${pad("agent", 10)}${pad("spent", 8)}${pad("payments", 10)}${pad("revoked", 9)}bound at block`,
    ...a.mandates.map((m) => `${pad(m.agent, 10)}${pad(m.spent, 8)}${pad(String(m.payments), 10)}${pad(m.revoked ? "yes" : "no", 9)}${m.bound ? m.bound_block : "not bound"}`),
    `Repeat it: eth_call to ${a.check.to} at block ${a.check.block}, data:`,
    ...Object.entries(a.check.data).map(([agent, data]) => `  ${agent}: ${data}`),
  ];
}

function refusalLines(abi: string, tx: string, block: number | null, log: RefusalLog, from: string): string[] {
  const d = decodeRefusal(log);
  if (!d) return [`${tx}: no MandateRefused event in this log.`];
  return [
    `MandateRefused in ${tx}${block === null ? "" : ` (block ${block})`}, ${from}`,
    abi,
    `  account    ${d.account}`, `  ref        ${d.ref}`, `  to         ${d.to}`, `  l3aDigest  ${d.l3aDigest}`, `  agentKey   ${d.agentKey}`,
    `  amount     ${d.amount} *USDZ`, `  reason     ${d.reason} (${d.reason_name})`,
  ];
}

/** One JSON-RPC call for the receipt, in fixed words on any failure. */
async function receipt(o: InspectOptions, tx: string): Promise<{ blockNumber?: string; logs?: RefusalLog[] } | string> {
  try {
    const res = await (o.fetcher ?? fetch)(o.rpcUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [tx] }), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return "the RPC answered with an error";
    const body = (await res.json()) as { result?: unknown };
    return body.result && typeof body.result === "object" ? body.result as { blockNumber?: string; logs?: RefusalLog[] } : "no receipt for this transaction";
  } catch {
    return "the RPC did not answer";
  }
}

export async function metalInspect(args: string[], o: InspectOptions = {}): Promise<{ code: number; out: string[] }> {
  const rec = inspectorRecord();
  if (args[0] === "refusal") {
    const tx = (args[1] ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(tx)) return { code: 2, out: ["Usage: npm run metal-inspect -- refusal <transaction hash>"] };
    const known = rec.refusals.find((r) => r.tx.toLowerCase() === tx);
    if (known) return { code: 0, out: refusalLines(rec.abi.MandateRefused, known.tx, known.block, known.raw_log, `from ${METAL_INSPECTOR_RECORD}`) };
    if (!o.rpcUrl) return { code: 1, out: [`${tx} is not in ${METAL_INSPECTOR_RECORD}; set METAL_RPC_URL to read its receipt from Metal testnet.`] };
    const r = await receipt(o, tx);
    if (typeof r === "string") return { code: 1, out: [`${tx}: ${r}.`] };
    const log = (r.logs ?? []).find((l) => decodeRefusal(l));
    return log ? { code: 0, out: refusalLines(rec.abi.MandateRefused, tx, r.blockNumber ? Number(BigInt(r.blockNumber)) : null, log, "read live from Metal testnet") } : { code: 1, out: [`${tx}: no MandateRefused event in this transaction.`] };
  }
  if (args.length) return { code: 2, out: ["Usage: npm run metal-inspect [-- refusal <transaction hash>]"] };
  const desk = new MetalInspector(memory(), { rpcUrl: o.rpcUrl, off: o.rpcUrl ? null : "METAL_RPC_URL is not set", recorded: rec.recorded, fetcher: o.fetcher, now: o.now, ceiling: CLI_CEILING });
  return { code: 0, out: answerLines(await desk.answer()) };
}

if (process.argv[1] && /metalInspect\.ts$/.test(process.argv[1])) {
  const r = await metalInspect(process.argv.slice(2), { rpcUrl: process.env.METAL_RPC_URL || undefined });
  for (const line of r.out) console.log(line);
  process.exitCode = r.code;
}
