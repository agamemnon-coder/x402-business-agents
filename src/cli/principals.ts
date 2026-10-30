// npm run principals -- list | revoke <agent> "<reason>" | expire <agent> <ISO time> | rotate <agent>
// Agent identities (backend review B5). Revoking or shortening is a restriction and takes effect at once, like the
// emergency stop; it is the CFO's to undo. rotate writes the new key to a key file (mode 0600) in the keys folder and
// prints only where it is: the key itself never reaches the screen, a log or git.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "../db/open.js";
import { keyPath } from "../metal/agentCli.js";
import { expirePrincipal, listPrincipals, revokePrincipal, rotatePrincipalKey } from "../policy/principals.js";

const [cmd = "list", agent, arg] = process.argv.slice(2);
const db = openDb();
const by = process.env.USER ?? "cfo";

if (cmd === "list") {
  for (const p of listPrincipals(db)) {
    const c = p.capabilities;
    console.log(`${p.id.padEnd(22)} ${p.active ? "ACTIVE " : p.status === "REVOKED" ? "REVOKED" : "EXPIRED"}  rails ${c.rails.join(",")}  ${c.currencies.join(",")}  pays ${c.payees.join(",")}  tools ${c.tools.join(",")}${p.expires_at ? `  until ${p.expires_at}` : ""}${p.key_version ? `  key v${p.key_version}` : ""}`);
  }
} else if (cmd === "revoke" && agent && arg) {
  revokePrincipal(db, agent, arg, by);
  console.log(`${agent} revoked: it is refused before any payment, and its card is frozen at the next card sync. The other agents carry on.`);
} else if (cmd === "expire" && agent && arg && !Number.isNaN(Date.parse(arg))) {
  expirePrincipal(db, agent, new Date(arg), by);
  console.log(`${agent} ends at ${new Date(arg).toISOString()}.`);
} else if (cmd === "rotate" && agent) {
  const { key, version } = rotatePrincipalKey(db, agent, by);
  const file = keyPath(`principal-${agent.replace(/[^a-z0-9-]/gi, "_")}.key`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  console.log(`${agent} key v${version} written to ${file} (the old key no longer works). Give the agent KIT11_AGENT_KEY from that file.`);
} else {
  console.error('usage: npm run principals -- list | revoke <agent> "<reason>" | expire <agent> <ISO time> | rotate <agent>');
  process.exit(2);
}
