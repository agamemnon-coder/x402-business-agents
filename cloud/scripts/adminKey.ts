// npm run cloud:admin-key -- --id <holder> --scopes tenants,recovery,read,try [--days 30]: a new platform admin key for
// one named person (cloud/src/adminKeys.ts; docs/runbook.md, "Platform admin keys"). The key is printed once, to this
// terminal only, for its holder to keep in their password manager; its entry (the id, the key's SHA-256, the scopes and
// the last day, never the key) goes into the Worker secret ADMIN_KEYS. Nothing is written to a file or sent anywhere.
import { parseArgs } from "node:util";
import { ADMIN_KEY_MAX_DAYS, ADMIN_SCOPES, newAdminKey, type AdminScope } from "../src/adminKeys.js";

const { values } = parseArgs({ options: { id: { type: "string" }, scopes: { type: "string" }, days: { type: "string", default: "30" } } });
if (!values.id || !values.scopes) {
  console.error(`usage: npm run cloud:admin-key -- --id <holder, e.g. max-2026q4> --scopes <${ADMIN_SCOPES.join(",")}> [--days 1..${ADMIN_KEY_MAX_DAYS}, default 30]`);
  process.exit(2);
}
const k = await newAdminKey({ id: values.id, scopes: values.scopes.split(",").map((s) => s.trim()) as AdminScope[], days: Number(values.days), now: new Date() });
console.log([
  "The key (shown once; give it to its holder only, never paste it into chat, a ticket or a file in git):",
  `  ${k.key}`,
  "",
  `Its ADMIN_KEYS entry (no secret in it; good until ${k.expires}):`,
  `  ${k.entry}`,
  "",
  "Add the entry to the entries already in ADMIN_KEYS (one per line), then:",
  "  npx wrangler secret put ADMIN_KEYS -c cloud/wrangler.try.jsonc",
].join("\n"));
