// npm run eval:adversarial-v15 [-- --check]: the adversarial eval v15 (src/evals/adversarialV2.ts, the same runner and
// scorer as v2 to v14, in v15's world: src/evals/adversarialV15.ts) over the 131 held-out cases of
// src/evals/adversarialV15Cases.ts, written after the fixes that followed eval v14 and committed alone before anything
// ran on them (V15_CASES_COMMIT), with the pre-registration in that file's header. Offline: no model, no network, no
// key, no money. The first run writes docs/evals/adversarial-v15.json and .md (held out, with v14 on the same code
// beside it); after that, the held-out record is never written again and the command writes the run on today's code
// beside it (docs/evals/adversarial-v15-after.json, not held out). src/evals/adversarialRound.ts runRound says how.

import { runRound } from "../evals/adversarialRound.js";
import { V14_CASES_COMMIT, V14_WORLD } from "../evals/adversarialV14.js";
import { ADV_V14_CASES } from "../evals/adversarialV14Cases.js";
import { V15_CASES_COMMIT, V15_HYPOTHESES, V15_WORLD } from "../evals/adversarialV15.js";
import { ADV_V15_CASES } from "../evals/adversarialV15Cases.js";

await runRound({
  version: "v15", cases: ADV_V15_CASES, world: V15_WORLD, case_file: "src/evals/adversarialV15Cases.ts", cases_commit: V15_CASES_COMMIT, hypotheses: V15_HYPOTHESES, written: "21 Nov",
  on_file: "one hundred and thirty-six suppliers on file (v14's one hundred and twenty-one, and fifteen whose names are Slovak, Bosnian, Belarusian, Tatar, Turkmen, Low German, Romansh, Breton, Sardinian, Scottish Gaelic, Shona, Javanese, Guarani, Papiamento and Assamese)",
  about: "fifteen new suppliers in languages no earlier round used, several of them neighbours of languages the lists hold; English in other hands; orders, changed accounts, approval claims and pressure in notes below the total and in new places (the payment reference, the due-date and VAT lines, a line of goods with a quantity, a machine-format or markup line, a payment link or QR code, a forwarded chain, a sentence split over two lines); amounts in Slovak, Bosnian, Low German, Breton, Papiamento and Javanese words, in brackets and with no currency word; and many legitimate invoices with ordinary notes",
  fixes: "a label that is none of the fields an invoice prints, before words that name nothing Purser reads, goes to the CFO, and before words that name something is read as the line it is (src/policy/paymentTalk.ts); one definition of unchanged bank details for the screen that holds a change of bank and the reading of payment talk (src/policy/multilingual.ts); a legal form written out or abbreviated is one form (src/policy/fraudCore.ts); the parser's supplier is the first line before the heading that names a company (src/ap/reading.ts)",
  previous: { version: "v14", cases: ADV_V14_CASES, world: V14_WORLD, cases_commit: V14_CASES_COMMIT },
});
