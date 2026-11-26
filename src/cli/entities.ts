// npm run entities -- list
// npm run entities -- add <id> --name "Northwind Outdoor Ltd" --country GB --account acct_… [--currency GBP]
// npm run entities -- allow <entity> <agent> [--reason "<why>"]
// The company's legal entities (src/policy/entities.ts), without editing a setting by hand. Adding an entity opens it to
// no agent. Letting an agent pay from it is the CFO policy's pay_from.<entity>.<agent> allowed: a policy change, filed
// here, that counts only once the CFO approves it with the passkey (on the phone, /approve/<id>); until then the agent
// pays nothing from that entity.
import { pathToFileURL } from "node:url";
import { AGENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import { ENTITY_ID, entityOf, listEntities, mayPayFrom, payFromKey, registerEntity } from "../policy/entities.js";

/** An entity's home currency where its country says it plainly; any other country names it with --currency. */
const HOME: Record<string, string> = {
  AT: "EUR", BE: "EUR", DE: "EUR", ES: "EUR", FI: "EUR", FR: "EUR", IE: "EUR", IT: "EUR", LU: "EUR", NL: "EUR", PT: "EUR",
  GB: "GBP", US: "USD", CH: "CHF", SE: "SEK", DK: "DKK", NO: "NOK", PL: "PLN", AU: "AUD", SG: "SGD", HK: "HKD", JP: "JPY", CA: "CAD",
};

export const ENTITIES_USAGE = "usage: npm run entities -- list | add <id> --name \"<legal name>\" --country NL --account acct_… [--currency EUR] | allow <entity> <agent> [--reason \"<why>\"]";

/** Runs one entities command on `db` and answers what it prints; a refusal throws with its reason. */
export function entitiesCommand(db: DB, argv: string[], now = new Date()): string {
  const [cmd = "list", a, b, ...rest] = argv;
  const opts = [a, b, ...rest].filter((x): x is string => x !== undefined);
  const opt = (name: string) => { const i = opts.indexOf(`--${name}`); return i >= 0 ? opts[i + 1] : undefined; };
  if (cmd === "list") {
    const held = listEntities(db);
    if (!held.length) return "no legal entities: the company pays as one entity (npm run entities -- add <id> … adds one)";
    return held.map((e) => {
      const open = AGENTS.filter((ag) => mayPayFrom(db, ag, e.id));
      return `${e.id.padEnd(16)} ${e.name || "(unreadable)"} · ${e.country} · ${e.currency} · account ${e.funding_account} · may pay from it: ${open.length ? open.join(", ") : "no agent"}`;
    }).join("\n");
  }
  if (cmd === "add" && a && !a.startsWith("--")) {
    const country = (opt("country") ?? "").toUpperCase();
    const currency = (opt("currency") ?? HOME[country] ?? "").toUpperCase();
    if (!currency) throw new Error(`no home currency known for ${JSON.stringify(country)}: name it with --currency`);
    registerEntity(db, "human", { id: a, name: opt("name") ?? "", country, currency, funding_account: opt("account") ?? "" }, now);
    const e = entityOf(db, a)!;
    return `added ${e.name} (${e.id}, ${e.country}, ${e.currency}), funded from ${e.funding_account} only. No agent may pay from it until the CFO allows it with Face ID: npm run entities -- allow ${e.id} <agent>`;
  }
  if (cmd === "allow" && a && b) {
    if (!ENTITY_ID.test(a) || !entityOf(db, a)) throw new Error(`the company holds no entity ${JSON.stringify(a)} (npm run entities -- list)`);
    if (!(AGENTS as readonly string[]).includes(b)) throw new Error(`${JSON.stringify(b)} is not an agent; the agents are ${AGENTS.join(", ")}`);
    if (mayPayFrom(db, b, a)) return `the ${b} agent may already pay from ${a}: the CFO signed ${payFromKey(a, b)} allowed`;
    const p = proposePolicyChange(db, { changes: [{ key: payFromKey(a, b), to: "allowed" }], reason: opt("reason") ?? `let the ${b} agent pay from ${a}` }, "human", now);
    return `${p.proposal_id} lets the ${b} agent pay from ${a} (${payFromKey(a, b)} allowed), hash ${p.terms_sha256.slice(0, 8)}; it counts only once the CFO approves it with the passkey (/approve/${p.proposal_id})`;
  }
  throw new Error(ENTITIES_USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { openDb } = await import("../db/open.js");
  try {
    console.log(entitiesCommand(openDb(), process.argv.slice(2)));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
