// npm run verify: re-checks everything from sources a judge can reach without trusting this app.
// - the audit log's hash chain, recomputed from the genesis hash;
// - every credential ever issued (replaced ones included) with `metal-agent mandate verify`;
// - every refund and sweep pull against the credential that made it;
// - every disputed sale's payment with its signed order (verifyMandatePayment);
// - every approval made with a passkey, from the stored signature and the pinned public key (offline);
// - the policy version every decision was made under, and that its stored rules still hash to it;
// - every sale paid by Metal clearing, its signed payment checked again with Metal's clearing service;
// - with Airwallex keys: every booked deposit, conversion and transfer against Airwallex (read-only).
// Prints one line per check and exits 1 if any fails.

import type { Address } from "viem";
import { salesBySeq, verifyOrders } from "../agents/disputes.js";
import { fromEnv, Airwallex } from "../airwallex/client.js";
import { getVia, verifyAirwallex } from "../airwallex/verify.js";
import { checkAnchor, verifyAuditChain, type AuditRowStored } from "../audit/log.js";
import { approvalMethodChecks, reverifyPasskeyApprovals } from "../passkey/webauthn.js";
import { openDb } from "../db/open.js";
import { policyVersionChecks } from "../policy/versions.js";
import { keyPath, metalAgent } from "../metal/agentCli.js";
import { credentialFiles, loadCredentialFile, type MandateAgent } from "../metal/mandate.js";
import { addresses } from "../world/runtime.js";
import { verifyClearingPayment, type ClearingPaid } from "@metalntwx/metal-pay";
import type { PaymentRequirements } from "@x402/core/types";
import { clearingDeployment } from "../metal/clearing.js";
import { rpcUrl } from "../metal/network.js";
import { redactSecrets } from "../lib/redact.js";

const db = openDb();
let failed = 0;
const line = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

const chain = verifyAuditChain(db);
line(chain.ok, "audit log hash chain", chain.ok ? `${chain.rows} rows, head ${chain.head}` : `row ${chain.seq}: ${chain.reason}`);
// An anchor printed earlier (audit report, run log) also catches a cut-off tail or a full rehash (review L1).
const anchorArg = process.argv.indexOf("--anchor") >= 0 ? process.argv[process.argv.indexOf("--anchor") + 1] : process.env.KIT11_AUDIT_ANCHOR;
if (anchorArg) {
  const m = /^(\d+):([0-9a-f]{64})$/.exec(anchorArg);
  const a = m ? checkAnchor(db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[], { seq: Number(m[1]), hash: m[2]! }) : { ok: false as const, reason: "an anchor is <seq>:<64 hex>" };
  line(a.ok, "audit log anchor", a.ok ? `row ${m![1]} still has hash ${m![2]!.slice(0, 12)}…` : a.reason);
}

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

// Sales paid by Metal clearing: the buyer's signed payment, checked again with Metal's clearing service.
const cleared = db.prepare("SELECT sale_id, payer, requirements_json, clearing_json FROM sales WHERE scheme = 'bajillion' AND status = 'DELIVERED'").all() as
  { sale_id: number; payer: string; requirements_json: string | null; clearing_json: string | null }[];
if (cleared.length) {
  const d = await clearingDeployment();
  let good = 0;
  const bad: string[] = [];
  for (const sale of cleared) {
    try {
      const { paid } = JSON.parse(sale.clearing_json ?? "{}") as { paid?: ClearingPaid | null };
      if (!paid || !sale.requirements_json || !d) throw new Error("no stored payment");
      const v = await verifyClearingPayment(paid, JSON.parse(sale.requirements_json) as PaymentRequirements, { rpcUrl: rpcUrl(), serviceUrl: d.serviceUrl, settlement: d.settlement });
      if (v.payer.toLowerCase() !== sale.payer.toLowerCase()) throw new Error(`paid by ${v.payer.slice(0, 12)}…, recorded as ${sale.payer.slice(0, 12)}…`);
      good++;
    } catch (e) {
      bad.push(`sale ${sale.sale_id}: ${redactSecrets((e as Error).message).slice(0, 120)}`);
    }
  }
  line(bad.length === 0, "clearing sales", `${good}/${cleared.length} receipts confirmed by Metal's clearing service${bad.length ? `; ${bad.slice(0, 3).join("; ")}` : ""}`);
}

for (const c of await reverifyPasskeyApprovals(db)) line(c.ok, c.what, c.detail);
for (const c of approvalMethodChecks(db)) line(c.ok, c.what, c.detail);
// Which policy every decision was made under, and that each recorded version's rules still hash to it (B4).
for (const c of policyVersionChecks(db)) line(c.ok, c.what, c.detail);

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
