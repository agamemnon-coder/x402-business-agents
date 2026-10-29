// npm run fail -- f2: failure test F2(b), live on Metal testnet. A refund over the support mandate's
// per-payment cap (0.10) is refused before anything is sent, and the mandate's spend does not move.
// F1, F3(b), F4, F5, F6, F8 and F9 run as unit tests (npm test); F2(a) and F3(a) are part of S1 and S2.

import { openDb } from "../db/open.js";
import { baseUnitsToCents, fromCents } from "../lib/money.js";
import { metalAgent } from "../metal/agentCli.js";
import { activeMandate, mandateSpent } from "../metal/mandate.js";
import { addresses } from "../world/runtime.js";

const which = process.argv[2];
if (which !== "f2") {
  console.error("usage: npm run fail -- f2");
  process.exit(2);
}
const addr = addresses(openDb());
const m = await activeMandate("support");
const before = await mandateSpent(m);
const r = metalAgent(["mandate", "pull", "--credential", m.credentialPath, "--mandate-key-file", m.keyFile, "--to", addr.customer, "--amount", "0.11", "--payment-id", `f2-over-cap-${Date.now()}`], [0, 1, 3, 4]);
const after = await mandateSpent(m);
const reason = r.fields.get("reason")?.[0] ?? r.out.trim().split("\n").at(-1) ?? "";
const pass = r.code === 1 && /mandate_cap_exceeded/.test(r.out) && after === before;
console.log(`F2(b) support pull 0.11 against cap 0.10: exit ${r.code}, ${reason}`);
console.log(`      spent before ${fromCents(baseUnitsToCents(before))}, after ${fromCents(baseUnitsToCents(after))}`);
console.log(pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
