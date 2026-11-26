// npm run mandates -- list
// npm run mandates -- grant <id> --purpose "<task>" --total 5000.00 --payees "Name A|Name B" --until 2026-11-30
//                         [--from 2026-11-01] [--month 2026-11] [--kinds invoice_payment,supplier_payment] [--currency EUR]
//                         [--agent treasury] [--reason "<why>"]
// npm run mandates -- narrow <id> [--total …] [--payees …] [--until …] [--from …] [--month …] [--kinds …]
// npm run mandates -- revoke <id> "<reason>"
// npm run mandates -- token <id> [hours]
// Task mandates (src/policy/taskMandates.ts). Granting or widening one is a policy change: proposed here, it counts only
// once the CFO approves it with the passkey (on the phone, /approve/<id>). Narrowing and revoking take effect at once.
// A token is short-lived (src/policy/taskTokens.ts); it is printed once, and only its hash is kept.
import { openDb } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { mandateWords, type MandateKind, type TaskMandate } from "../policy/taskMandateCore.js";
import { grantChange, listTaskMandates, mandateInForce, narrowTaskMandate, revokeTaskMandate } from "../policy/taskMandates.js";
import { issueTaskToken } from "../policy/taskTokens.js";

const [cmd = "list", id, ...rest] = process.argv.slice(2);
const opt = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const db = openDb();
const by = process.env.USER ?? "cfo";
const usage = () => { console.error("usage: npm run mandates -- list | grant <id> --purpose … --total … --payees \"A|B\" --until YYYY-MM-DD | narrow <id> … | revoke <id> \"<reason>\" | token <id> [hours]"); process.exit(2); };

/** The mandate the options describe, over `base` (a narrowing keeps what it does not name). */
function fromOptions(base: Partial<TaskMandate>): TaskMandate {
  const today = new Date().toISOString().slice(0, 10);
  const month = opt("month");
  return {
    agent: opt("agent") ?? base.agent ?? "treasury", purpose: opt("purpose") ?? base.purpose ?? "",
    kinds: (opt("kinds")?.split(",") as MandateKind[] | undefined) ?? base.kinds ?? ["invoice_payment", "supplier_payment"],
    invoice_month: month === undefined ? base.invoice_month ?? null : month === "any" ? null : month,
    currency: opt("currency") ?? base.currency ?? "EUR", total: opt("total") ?? base.total ?? "",
    payees: opt("payees")?.split("|").map((p) => p.trim()).filter(Boolean) ?? base.payees ?? [],
    from: opt("from") ?? base.from ?? today, until: opt("until") ?? base.until ?? "", status: base.status ?? "active",
  };
}

if (cmd === "list") {
  for (const m of listTaskMandates(db)) console.log(`${m.id.padEnd(24)} ${m.in_force ? `in force (${m.granted_by})` : "NOT in force"}  spent ${m.spent}  ${m.mandate ? mandateWords(m.mandate) : "unreadable"}`);
} else if (cmd === "grant" && id) {
  const p = proposePolicyChange(db, { changes: [grantChange(id, fromOptions(mandateInForce(db, id)?.mandate ?? {}))], reason: opt("reason") ?? `task mandate ${id}` }, "human");
  console.log(`${p.proposal_id} grants task mandate ${id}, hash ${p.terms_sha256.slice(0, 8)}; it counts only once you approve it with the passkey (/approve/${p.proposal_id})`);
} else if (cmd === "narrow" && id) {
  const rec = mandateInForce(db, id);
  if (!rec) throw new Error(`task mandate ${id} is not in force`);
  console.log(`narrowed at once: ${mandateWords(narrowTaskMandate(db, id, fromOptions(rec.mandate), by).mandate)}`);
} else if (cmd === "revoke" && id && rest[0]) {
  revokeTaskMandate(db, id, rest[0], by);
  console.log(`task mandate ${id} revoked at once, with its task tokens: the agent pays nothing alone under it again`);
} else if (cmd === "token" && id) {
  const t = issueTaskToken(db, id, new Date(), rest[0] ? Number(rest[0]) : undefined, by);
  console.log(`task token ${t.token_id} for the ${t.agent} agent under ${t.mandate_id}, until ${t.expires_at} (shown once):\n${t.token}`);
} else {
  usage();
}
