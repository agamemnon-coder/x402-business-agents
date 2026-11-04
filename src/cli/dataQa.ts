// npm run data-qa: every payment in the ledger (KIT11_DB), up to one audit row, against Airwallex (read-only GETs),
// Metal (eth_ reads) and the Books; writes docs/data-qa.md (or --out). The ledger is opened read-only. Without
// Airwallex keys or a Metal RPC that side is skipped with a note. The RPC URL is a credential: every line printed or
// written goes through redactSecrets.
//   --upto <seq>  last audit row to read (default: the recorded run's, from docs/demo/snapshot.json, when this ledger
//                 holds that row with the same hash; otherwise every row)
//   --out <path>  where to write the report

import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, parseEventLogs, type Hash } from "viem";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { publicClient } from "../metal/chain.js";
import { USDZ } from "../metal/network.js";
import { redactSecrets } from "../lib/redact.js";
import { ledgerPayments, renderReport, runDataQa, type ChainReceipt, type QaSources } from "../finance/dataQa.js";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const path = process.env.KIT11_DB ?? "data/kit11.sqlite";
const out = arg("--out") ?? "docs/data-qa.md";
const db = new Database(path, { readonly: true, fileMustExist: true });

const recorded = (JSON.parse(readFileSync(new URL("../../docs/demo/snapshot.json", import.meta.url), "utf8")) as { run: string; snapshot: { audit: { rows: number; head: string } } });
const max = (db.prepare("SELECT MAX(seq) AS m FROM audit_log").get() as { m: number | null }).m ?? 0;
const atRecorded = db.prepare("SELECT row_hash FROM audit_log WHERE seq = ?").get(recorded.snapshot.audit.rows) as { row_hash: string } | undefined;
const isRecorded = atRecorded?.row_hash === recorded.snapshot.audit.head;
const upto = Number(arg("--upto") ?? (isRecorded ? recorded.snapshot.audit.rows : max));
const anchor = isRecorded
  ? `row ${recorded.snapshot.audit.rows} has the head the pages show for ${recorded.run}, \`${recorded.snapshot.audit.head.slice(0, 12)}…\`; ${max - recorded.snapshot.audit.rows} later rows left out`
  : `this ledger does not hold the recorded run's head at row ${recorded.snapshot.audit.rows}`;

const sources: QaSources = {};
let airwallex = "not checked: AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY are not set.";
const cfg = fromEnv();
if (cfg) {
  const api = new Airwallex(cfg);
  try {
    await api.call("GET", "/balances/current");
    sources.awx = (p, q) => api.call("GET", p, undefined, q);
    airwallex = "sandbox reached with the environment's keys; GET requests only.";
  } catch (e) {
    airwallex = `not checked: the sandbox did not answer (${redactSecrets(e instanceof Error ? e.message : String(e))}).`;
    sources.awxMissing = "Airwallex unreachable";
  }
} else sources.awxMissing = "no Airwallex credentials in the environment";

let metal = "not checked: METAL_RPC_URL is not set.";
if (process.env.METAL_RPC_URL) {
  const pc = publicClient();
  try {
    const head = await pc.getBlockNumber();
    sources.receipt = async (tx): Promise<ChainReceipt | null> => {
      const r = await pc.getTransactionReceipt({ hash: tx as Hash }).catch((e: unknown) => {
        if (e instanceof Error && /could not be found|not found/i.test(e.message)) return null;
        throw new Error(redactSecrets(e instanceof Error ? e.message.split("\n")[0]! : String(e)));
      });
      if (!r) return null;
      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: r.logs }).map((l) => ({ token: l.address, from: l.args.from, to: l.args.to, value: l.args.value }));
      return { status: r.status, block: Number(r.blockNumber), from: r.from, transfers };
    };
    metal = `Metal testnet reached (head block ${head}); eth_ reads only.`;
  } catch (e) {
    metal = `not checked: the RPC did not answer (${redactSecrets(e instanceof Error ? e.message.split("\n")[0]! : String(e))}).`;
    sources.metalMissing = "Metal RPC unreachable";
  }
} else sources.metalMissing = "no Metal RPC in the environment";

const payments = ledgerPayments(db, upto);
const checks = await runDataQa(db, payments, sources, { usdz: USDZ, scrub: (s) => redactSecrets(s) });
const report = redactSecrets(renderReport(payments, checks, {
  ledger: path, upto, rows: Math.min(upto, max), anchor, generatedAt: new Date().toISOString(), airwallex, metal,
}));
writeFileSync(out, report);

const n = (o: string) => checks.filter((c) => c.outcome === o).length;
console.log(redactSecrets(`${payments.length} payments, ${checks.length} checks: ${n("match")} matched, ${n("difference")} differences, ${n("skipped")} skipped`));
console.log(redactSecrets(`Airwallex: ${airwallex}`));
console.log(redactSecrets(`Metal: ${metal}`));
for (const c of checks.filter((x) => x.outcome === "difference")) console.log(redactSecrets(`DIFFERENCE  ${c.kind} ${c.id} (${c.side}): ${c.detail}`));
console.log(`report: ${out}`);
process.exit(n("difference") ? 1 : 0);
