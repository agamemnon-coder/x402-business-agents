// The one-cent-over run record (15 Nov): reads Purser Cloud's GET /v1/cards/edge/latest (public: sandbox, test money, the
// card's last four digits only) and writes docs/runs/airwallex-card-cent-<YYYY-MM-DD>.json, word for word as Airwallex
// answered. Nothing is made up: with no run, or one that is not exactly L and L + 0.01 on a card whose limit is L, it
// writes nothing and says why. /airwallex and /proof read the newest such file (src/redesign/cardCent.ts).
//   npm run card-cent:record [-- <cloud origin>]
import { writeFileSync } from "node:fs";
import { centHolds, centLine, CENT_PREFIX, type CentRecord } from "../src/redesign/cardCent.js";

const origin = (process.argv[2] ?? "https://purser-try.max-31b.workers.dev").replace(/\/$/, "");
const res = await fetch(`${origin}/v1/cards/edge/latest`, { headers: { accept: "application/json" } });
if (res.status === 404) { console.log("No one-cent-over test has run yet: nothing written."); process.exit(1); }
if (!res.ok) { console.log(`The cloud answered HTTP ${res.status}: nothing written.`); process.exit(1); }
const rec = (await res.json()) as CentRecord;
const line = centLine(rec);
if (!line) { console.log("The latest run is not exactly the limit and one cent over: nothing written."); process.exit(1); }
if (JSON.stringify(rec).match(/\b\d{13,19}\b/)) { console.log("The answer holds a long number that could be a card number: nothing written."); process.exit(1); }
const file = `docs/runs/${CENT_PREFIX}-${rec.ran_at.slice(0, 10)}.json`;
writeFileSync(file, `${JSON.stringify({ ...rec, read_from: `${origin}/v1/cards/edge/latest` }, null, 2)}\n`);
console.log(`${file}: ${line}${centHolds(rec) ? "" : " (the limit did not hold to the cent: said so on the pages)"}`);
