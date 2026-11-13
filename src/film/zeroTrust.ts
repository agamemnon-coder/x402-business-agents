// The zero-trust report's figures for film v10 (docs/zero-trust/report.json, written by npm run zero-trust): the film
// says and shows the attack count as the report holds it, so a new attack in the report changes the film's words.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const report = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../docs/zero-trust/report.json"), "utf8")) as { attacks_run: number; attacks_stopped: number; attacks_where_money_moved: number; layers: number; min_depth: number };
if (report.attacks_stopped !== report.attacks_run || report.attacks_where_money_moved !== 0) throw new Error("film: the zero-trust report no longer says every attack was stopped with no money moved");
/** The attacks run in the test harness (all stopped, money moved in none). */
export const ZT_ATTACKS = report.attacks_run;
export const ZT_LAYERS = report.layers;
export const ZT_MIN_DEPTH = report.min_depth;
