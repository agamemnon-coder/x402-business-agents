// npm run eval:adversarial-v16 [-- --check]: the adversarial eval v16 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v15, in v16's world: src/evals/adversarialV16.ts) over the 128 held-out cases of
// src/evals/adversarialV16Cases.ts, written after the fixes that followed eval v15 and committed alone before anything
// ran on them (V16_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v16.json and .md (held out, with v15 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v16-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V15_CASES_COMMIT, V15_WORLD } from "../evals/adversarialV15.js";
import { ADV_V15_CASES } from "../evals/adversarialV15Cases.js";
import { V16_CASES_COMMIT, V16_HYPOTHESES, V16_WORLD } from "../evals/adversarialV16.js";
import { ADV_V16_CASES } from "../evals/adversarialV16Cases.js";

await runRound({
  version: "v16", cases: ADV_V16_CASES, world: V16_WORLD, case_file: "src/evals/adversarialV16Cases.ts", cases_commit: V16_CASES_COMMIT, hypotheses: V16_HYPOTHESES, written: "21 Nov",
  on_file: "one hundred and fifty-one suppliers on file (v15's one hundred and thirty-six, and fifteen whose names are West Frisian, Upper Sorbian, Ladino, Occitan, Friulian, Asturian, Northern Sami, Maori, Samoan, Nahuatl, Aymara, Crimean Tatar, Ossetian, Tok Pisin and Chuvash)",
  about: "fifteen new suppliers in languages no earlier round used; English in still other hands (Australian, Singaporean, a lawyer's, a telegraph's capitals); orders, changed accounts, approval claims and pressure in notes below the total and in new places (the BIC line, the VAT amount line, the heading, the date line, a sentence written down the page, a P.S., a table row, a quoted order note, the currency line, a language switched halfway, a known field's value, a priced line of goods, a markup link); amounts in Hungarian, Frisian, Occitan, Asturian and German words, one word long and after a known field's label; and many legitimate invoices with ordinary notes",
  fixes: "a name on file is that supplier as written, whatever alphabets its words mix, a modifier letter for an apostrophe or a glottal stop is no letter of a name, a word of lookalike letters in another alphabet is a lookalike and not a romanisation, and Greece's legal forms are forms (src/policy/fraudCore.ts); the invoice's BIC, bank country and printed IBAN are read against the account it asks to be paid to (src/ap/checkerCore.ts); a sentence written a few words a line or with digits for letters is read as the sentence it is, and a request not to check, review or match holds as one not to check with someone (src/policy/paymentTalk.ts, fraudCore.ts); a known field's value that is a sentence, a label that is no field before a sentence, a note's clause, an amount in words after an amount's label, money sent to someone's account and a wallet are read for what they are (src/policy/paymentTalk.ts, src/ap/amountWords.ts)",
  previous: { version: "v15", cases: ADV_V15_CASES, world: V15_WORLD, cases_commit: V15_CASES_COMMIT },
});
