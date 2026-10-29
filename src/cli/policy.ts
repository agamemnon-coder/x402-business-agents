// npm run policy                                   the CFO policy now
// npm run policy -- set <key> <value> [--reason …]  propose a change (value "none" removes an agent limit)
// npm run policy -- from-text "<your words>"        Opus drafts rules from plain words; code checks them; one proposal
// A change is a policy_change proposal: approve it on the phone with the passkey (npm run relay) or on the laptop
// page; it takes effect when it runs, and every change is in the audit log.

import { Tools } from "../claude/tools.js";
import { openDb } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { draftPolicyFromText } from "../policy/fromText.js";
import { currentPolicy } from "../policy/rules.js";

const args = process.argv.slice(2);
const db = openDb();
if (args[0] === "set") {
  const [, key, raw] = args;
  const at = args.indexOf("--reason");
  if (!key || raw === undefined) {
    console.error("usage: npm run policy -- set <key> <value> [--reason text]   (keys: npm run policy)");
    process.exit(2);
  }
  const p = proposePolicyChange(db, { changes: [{ key, to: raw === "none" ? "" : raw }], reason: at >= 0 ? (args[at + 1] ?? "") : "CFO policy change" }, "human");
  console.log(`${p.proposal_id} policy change, hash ${p.terms_sha256.slice(0, 8)}, expires ${p.expires_at}; approve on the phone (/approve/${p.proposal_id}) or the laptop page`);
} else if (args[0] === "from-text") {
  const r = await draftPolicyFromText(db, new Tools(db), args.slice(1).join(" "));
  console.log(`read by ${r.model ?? "no model (KIT11_ANTHROPIC_API_KEY not set)"}`);
  for (const a of r.accepted) console.log(`rule     "${a.quote}" -> ${a.label}: ${a.from || "not set"} -> ${a.to}`);
  for (const x of r.refused) console.log(`refused  "${x.quote}" (${x.key} -> ${x.to}): ${x.why}`);
  for (const n of r.not_mapped) console.log(`not mapped  "${n.quote}": ${n.why}`);
  for (const q of r.questions) console.log(`question ${q}`);
  console.log(r.proposal ? `${r.proposal.proposal_id} policy change, hash ${r.proposal.terms_sha256.slice(0, 8)}, expires ${r.proposal.expires_at}; nothing changes until you approve it with Face ID (/approve/${r.proposal.proposal_id})` : "no proposal: nothing in the text became a rule");
} else {
  for (const e of currentPolicy(db)) console.log(`${e.key.padEnd(44)} ${e.display.padEnd(44)} ${e.label}`);
}
