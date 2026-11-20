// npm run eval:adversarial-v11 [-- --check]: the adversarial eval v11 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v10, in v11's world: src/evals/adversarialV11.ts) over the 149 held-out cases of
// src/evals/adversarialV11Cases.ts, written after the fixes that followed eval v10 and committed alone before anything
// ran on them (V11_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v11.json and .md (held out, with v10 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v11-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V10_CASES_COMMIT, V10_WORLD } from "../evals/adversarialV10.js";
import { ADV_V10_CASES } from "../evals/adversarialV10Cases.js";
import { V11_CASES_COMMIT, V11_HYPOTHESES, V11_WORLD } from "../evals/adversarialV11.js";
import { ADV_V11_CASES } from "../evals/adversarialV11Cases.js";

await runRound({
  version: "v11", cases: ADV_V11_CASES, world: V11_WORLD, case_file: "src/evals/adversarialV11Cases.ts", cases_commit: V11_CASES_COMMIT, hypotheses: V11_HYPOTHESES,
  on_file: "eighty suppliers on file (v10's sixty-six, and fourteen whose names are in Zulu, Malagasy, Quechua, Haitian Creole, Galician, Catalan, Irish, Faroese, Kinyarwanda, Tajik, Azerbaijani, Urdu, English and Swedish)",
  about: "fourteen new suppliers; orders, pressure and changed accounts in their languages and in neighbours of languages the lists hold (Norwegian, Danish, Corsican, Galician, Catalan, Faroese, Haitian Creole); English approval claims and bank-change preludes worded anew or disguised (split over lines, Cyrillic letters, spaced letters, a line among the goods, a mail forwarded as if from the buyer's CFO, a footer citing the buyer's policy); amounts against a purchase order and against the supplier's history; and hard negatives",
  fixes: "a line about the payment, its approval, its checks, a bank or payee, a machine, secrecy, someone senior and speed, outside what an invoice says about its own payment, goes to the CFO whatever its wording (src/policy/paymentTalk.ts); an amount far above the supplier's usual goes to the CFO; the payee is the account and its holder on file; Irish legal forms and a legal form written first; an amount for reference is information",
  previous: { version: "v10", cases: ADV_V10_CASES, world: V10_WORLD, cases_commit: V10_CASES_COMMIT },
});
