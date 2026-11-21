// npm run eval:adversarial-v17 [-- --check]: the adversarial eval v17 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v16, in v17's world: src/evals/adversarialV17.ts) over the 146 held-out cases of
// src/evals/adversarialV17Cases.ts, written after eval v16's record and committed alone before anything ran on them
// (V17_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no key, no money.
// The first run writes docs/evals/adversarial-v17.json and .md (held out, with v16 on the same code beside it); after
// that, the held-out record is never written again and the command writes the run on today's code beside it
// (docs/evals/adversarial-v17-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V16_CASES_COMMIT, V16_WORLD } from "../evals/adversarialV16.js";
import { ADV_V16_CASES } from "../evals/adversarialV16Cases.js";
import { V17_CASES_COMMIT, V17_HYPOTHESES, V17_WORLD } from "../evals/adversarialV17.js";
import { ADV_V17_CASES } from "../evals/adversarialV17Cases.js";

await runRound({
  version: "v17", cases: ADV_V17_CASES, world: V17_WORLD, case_file: "src/evals/adversarialV17Cases.ts", cases_commit: V17_CASES_COMMIT, hypotheses: V17_HYPOTHESES, written: "21 Nov",
  on_file: "one hundred and sixty-six suppliers on file (v16's one hundred and fifty-one, and fifteen whose names are Venetian, Limburgish, Ligurian, Neapolitan, Manx, Cornish, Kurmanji Kurdish, Bashkir, Sakha, Tongan, Hawaiian, Fijian, Lingala, Kabyle and Tetum)",
  about: "fifteen new suppliers in languages no earlier round used; the kinds of line v16 paid, in other words and places (part of the money elsewhere in the subtotal, total or reference line; a wallet or a crypto address; the IBAN on file with another institution's BIC or another bank country; letters of two alphabets in a name's word or its legal form; a sentence a word a line or split between the notes and the footer; the buyer's words quoted from a mail or a chat; a request not to check as a field's value; amounts in words after a known field's label with no currency word); the kinds v16 held that it should have paid (a name on file typed with a Latin letter in Cyrillic, holders without the legal form); text read from an image, homoglyphs in the printed IBAN and the invoice number, invisible characters, reply chains quoting the buyer's CFO, a chief executive's voice in other languages, splits into three and four parts; and many legitimate but unusual invoices",
  previous: { version: "v16", cases: ADV_V16_CASES, world: V16_WORLD, cases_commit: V16_CASES_COMMIT },
});
