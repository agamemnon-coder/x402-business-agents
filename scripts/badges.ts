// npm run badges: the shields.io endpoint badges in docs/badges/, each from its committed record (src/proof/badges.ts).
// Run it again after a record changes; test/badges.test.ts fails while a badge is behind its record. A badge whose
// record is gone is removed.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { BADGE_DIR, BADGE_RECORDS, badgeFile, badgeJson, badges, type BadgeName } from "../src/proof/badges.js";

mkdirSync(BADGE_DIR, { recursive: true });
const made = badges();
for (const { name, badge } of made) writeFileSync(badgeFile(name), badgeJson(badge));
for (const name of Object.keys(BADGE_RECORDS) as BadgeName[]) {
  if (!made.some((m) => m.name === name) && existsSync(badgeFile(name))) rmSync(badgeFile(name));
}
for (const { name, badge } of made) console.log(`${badgeFile(name)}: ${badge.label}: ${badge.message} (${badge.record})`);
const skipped = (Object.keys(BADGE_RECORDS) as BadgeName[]).filter((name) => !made.some((m) => m.name === name));
if (skipped.length) console.log(`no record, no badge: ${skipped.map((s) => `${s} (${BADGE_RECORDS[s]})`).join(", ")}`);
