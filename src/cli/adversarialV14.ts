// npm run eval:adversarial-v14 [-- --check]: the adversarial eval v14 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v13, in v14's world: src/evals/adversarialV14.ts) over the 124 held-out cases of
// src/evals/adversarialV14Cases.ts, written after the fixes that followed eval v13 and committed alone before anything
// ran on them (V14_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v14.json and .md (held out, with v13 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v14-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V13_CASES_COMMIT, V13_WORLD } from "../evals/adversarialV13.js";
import { ADV_V13_CASES } from "../evals/adversarialV13Cases.js";
import { V14_CASES_COMMIT, V14_HYPOTHESES, V14_WORLD } from "../evals/adversarialV14.js";
import { ADV_V14_CASES } from "../evals/adversarialV14Cases.js";

await runRound({
  version: "v14", cases: ADV_V14_CASES, world: V14_WORLD, case_file: "src/evals/adversarialV14Cases.ts", cases_commit: V14_CASES_COMMIT, hypotheses: V14_HYPOTHESES,
  on_file: "one hundred and twenty-one suppliers on file (v13's one hundred and seven, and fourteen whose names are Slovene, Macedonian, Uzbek, Kyrgyz, Cebuano, Igbo, Twi, Wolof, Xhosa, Danish, Norwegian, Finnish, English and German)",
  about: "fourteen new suppliers; orders, changed accounts, approval claims and pressure below the total, among the goods above it, in a field's label and value and in a covering mail, in their languages and in English; amounts in Danish, Norwegian, Finnish and Slovene words; and hard negatives with ordinary notes",
  fixes: "above the total too, a line with no figure in it is read as a sentence (src/policy/paymentTalk.ts); a warning that shows a line for its speed no longer silences a sentence outside the genre (src/ap/checkerCore.ts), and an account's compounds are a bank's word; a currency named in words after a word that is not a small one, in a part of a line with no figure, is an amount Purser does not read",
  previous: { version: "v13", cases: ADV_V13_CASES, world: V13_WORLD, cases_commit: V13_CASES_COMMIT },
});
