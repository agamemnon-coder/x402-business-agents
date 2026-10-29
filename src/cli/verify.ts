// npm run verify: re-checks everything from sources a judge can reach without trusting this app.
// - the audit log's hash chain, recomputed from the genesis hash;
// - every credential ever issued (replaced ones included) with `metal-agent mandate verify`;
// - every refund and sweep pull against the credential that made it;
// - every disputed sale's payment with its signed order (verifyMandatePayment);
// - every approval made with a passkey, from the stored signature and the pinned public key (offline);
// - with Airwallex keys: every booked deposit, conversion and transfer against Airwallex (read-only).
// Prints one line per check and exits 1 if any fails.

import type { Address } from "viem";
import { salesBySeq, verifyOrders } from "../agents/disputes.js";
import { fromEnv, Airwallex } from "../airwallex/client.js";
import { getVia, verifyAirwallex } from "../airwallex/verify.js";
import { verifyAuditChain } from "../audit/log.js";
import { reverifyPasskeyApprovals } from "../passkey/webauthn.js";
import { openDb } from "../db/open.js";
import { keyPath, metalAgent } from "../metal/agentCli.js";
import { credentialFiles, loadCredentialFile, type MandateAgent } from "../metal/mandate.js";
import { addresses } from "../world/runtime.js";

const db = openDb();
let failed = 0;
const line = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

const chain = verifyAuditChain(db);
line(chain.ok, "audit log hash chain", chain.ok ? `${chain.rows} rows, head ${chain.head}` : `row ${chain.seq}: ${chain.reason}`);

const issuer = (agent: MandateAgent) => keyPath(agent === "customer" ? "owner-customer.key.issuer.public.json" : "owner-business.key.issuer.public.json");
function verifyCredential(agent: MandateAgent, path: string, tx?: string) {
  const r = metalAgent(["mandate", "verify", "--credential", path, "--issuer", issuer(agent), ...(tx ? ["--tx", tx] : [])], [0, 1]);
  const ok = r.fields.get("verified")?.[0] === "yes";
  return { ok, detail: ok ? "" : (r.out.split("\n").find((l) => / fail:/.test(l)) ?? r.out.trim().split("\n").at(-1) ?? "") };
}

const files = new Map<string, { agent: MandateAgent; path: string }>();
for (const agent of ["sourcing", "support", "treasury", "customer"] as const) {
  for (const path of credentialFiles(agent)) {
    const v = verifyCredential(agent, path);
    line(v.ok, `mandate ${path.split("/").pop()}`, v.detail);
    files.set(loadCredentialFile(agent, path).credentialHash.toLowerCase(), { agent, path });
  }
}

// Pulls (refunds, sweeps) are checked against the credential whose mandate made them.
const pulls = [
  ...(db.prepare("SELECT 'refund-' || sale_id AS id, tx_hash FROM refunds WHERE outcome = 'PAID'").all() as { id: string; tx_hash: string }[]).map((r) => ({ ...r, agent: "support" as const })),
  ...(db.prepare("SELECT payment_id AS id, tx_hash FROM sweeps WHERE outcome = 'PAID'").all() as { id: string; tx_hash: string }[]).map((r) => ({ ...r, agent: "treasury" as const })),
];
for (const p of pulls) {
  const candidates = [...files.values()].filter((f) => f.agent === p.agent);
  const hit = candidates.map((c) => ({ c, v: verifyCredential(p.agent, c.path, p.tx_hash) })).find((x) => x.v.ok);
  line(hit !== undefined, `pull ${p.id}`, hit ? `${p.tx_hash.slice(0, 12)}… under ${hit.c.path.split("/").pop()}` : `${p.tx_hash} matches no ${p.agent} credential`);
}

const disputes = db.prepare("SELECT dispute_id, claims_json FROM disputes").all() as { dispute_id: string; claims_json: string }[];
const addr = addresses(db);
for (const d of disputes) {
  const refs = (JSON.parse(d.claims_json) as { sale_refs: number[] }).sale_refs;
  const evidence = await verifyOrders(salesBySeq(db, refs), addr.customer as Address);
  const good = evidence.filter((e) => e.signed_order && e.within_mandate && e.payer_is_customer).length;
  line(good === evidence.length, `dispute ${d.dispute_id} orders`, `${good}/${evidence.length} signed by the customer's mandate key, inside its mandate`);
}

for (const c of await reverifyPasskeyApprovals(db)) line(c.ok, c.what, c.detail);

const awx = fromEnv();
if (awx) {
  for (const c of await verifyAirwallex(db, getVia(new Airwallex(awx)))) {
    if (c.level === "note") console.log(`note  ${c.what}  ${c.detail}`);
    else line(c.level === "ok", c.what, c.detail);
  }
} else {
  console.log("skip  airwallex  AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY not set");
}

console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
