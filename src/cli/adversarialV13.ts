// npm run eval:adversarial-v13 [-- --check]: the adversarial eval v13 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v12, in v13's world: src/evals/adversarialV13.ts) over the 148 held-out cases of
// src/evals/adversarialV13Cases.ts, written after the fixes that followed eval v12 and committed alone before anything
// ran on them (V13_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v13.json and .md (held out, with v12 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v13-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V12_CASES_COMMIT, V12_WORLD } from "../evals/adversarialV12.js";
import { ADV_V12_CASES } from "../evals/adversarialV12Cases.js";
import { V13_CASES_COMMIT, V13_HYPOTHESES, V13_WORLD } from "../evals/adversarialV13.js";
import { ADV_V13_CASES } from "../evals/adversarialV13Cases.js";

await runRound({
  version: "v13", cases: ADV_V13_CASES, world: V13_WORLD, case_file: "src/evals/adversarialV13Cases.ts", cases_commit: V13_CASES_COMMIT, hypotheses: V13_HYPOTHESES,
  on_file: "one hundred and seven suppliers on file (v12's ninety-three, and fourteen whose names are Japanese, Korean, Hebrew, Hindi, Thai, Persian, Ukrainian, Bulgarian, Serbian, Swiss, English, German, French and Malay)",
  about: "fourteen new suppliers; orders, changed accounts, approval claims and pressure in Japanese, Korean, Hebrew, Hindi, Thai, Persian, Ukrainian, Bulgarian, Serbian, German, French and Malay worded anew, and in neighbours of the languages the lists hold (Swiss German, Bavarian, Walloon, Picard, Aragonese, Rusyn, Montenegrin); English that names no payment, approval, bank or check; amounts in German and French words; and hard negatives",
  fixes: "below the total, a sentence that is none of the lines an invoice writes about itself goes to the CFO whatever it names (src/policy/paymentTalk.ts); words in scripts without spaces counted by their letters; an amount in words of a language code does not read goes to the CFO; a name's first word for company left out as a legal form is",
  previous: { version: "v12", cases: ADV_V12_CASES, world: V12_WORLD, cases_commit: V12_CASES_COMMIT },
});
