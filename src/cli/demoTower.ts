// npm run demo-tower -- <copy of the recorded ledger>: adds the control tower (design 4.1) to the recorded dashboard
// (docs/demo/snapshot.json), computed from a read-only copy of the recorded run's ledger, without re-recording the rest.
// Refuses unless the tower's Metal figures equal the recorded treasury's: the same run, the same numbers.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { towerView } from "../dashboard/tower.js";

const ledger = process.argv[2];
if (!ledger) { console.error("usage: npm run demo-tower -- <copy of the recorded ledger>"); process.exit(2); }
const file = resolve(import.meta.dirname, "../../docs/demo/snapshot.json");
const rec = JSON.parse(readFileSync(file, "utf8")) as { snapshot: { budgets: { agents: never[] }; cards: never[]; treasury: { metal: { sales: string; upstream: string; refunds: string; net: string } }; tower?: unknown } };
const t = towerView(openDb(ledger), { budgets: rec.snapshot.budgets.agents, cards: rec.snapshot.cards });
const m = rec.snapshot.treasury.metal;
const same = t.pnl.usdz.sales === m.sales && t.pnl.usdz.upstream === m.upstream && t.pnl.usdz.refunds === m.refunds && t.pnl.usdz.net === m.net;
if (!same) { console.error(`not the recorded run: tower ${JSON.stringify(t.pnl.usdz)} vs recorded ${JSON.stringify(m)}`); process.exit(1); }
rec.snapshot.tower = t;
writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
console.log(`tower added: sales ${t.pnl.usdz.sales}, net ${t.pnl.usdz.net} *USDZ; EUR out ${t.pnl.eur.out}; enforced ${t.enforced.map((e) => `${e.who} ${e.count}`).join(", ")}`);
