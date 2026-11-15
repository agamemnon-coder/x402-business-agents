// /proof's worst-case AI test card (15 Nov): Purser's model slot given to a script that always says pay, on the same
// hostile and clean invoices, beside a payer with no rules; from the run's own record (src/evals/worstCase.ts). Each
// payer's worse run is shown, so no run is picked. Test data only.

import { WORST_CASE, WORST_CASE_DOC, WORST_CASE_HEADLINE, worstOf, type WorstCaseArm } from "../evals/worstCase.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const WORST_CASE_ID = "worst-case-ai";

const sums = (m: Record<string, string>) => Object.entries(m).map(([c, a]) => `${c === "XXX" ? "no currency read" : c} ${Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`).join(" + ");
const wrong = (a: WorstCaseArm) => (a.wrong_payments === 0 ? "No wrong payment" : `${a.wrong_payments} wrong payments: ${sums(a.wrong_money)}`);
const past = (a: WorstCaseArm) => (a.paid_past_cfo === 0 ? "nothing paid past the CFO" : `${a.paid_past_cfo} paid past the CFO`);

export function worstCaseCardHtml(): string {
  const s = WORST_CASE;
  const script = worstOf("purser_script"), naive = worstOf("no_rules");
  if (!s || !script || !naive) return "";
  const cent = s.cent_after_approval;
  const toCfo = script.to_cfo_not_held ? `; ${script.to_cfo_not_held} sent to the CFO to sign, the cases only a reader can catch` : "";
  // data-rec: the block names its record, whose figures test/worst-case.test.ts holds to the run's rows.
  return `<article class="wcase" id="${WORST_CASE_ID}" data-rec="${esc(`docs/evals/worst-case-summary.json ${s.record}`)}" aria-label="${esc("The worst-case AI test")}">
  <h2 class="sec">The worst-case AI test</h2>
  <p class="wch">${esc(WORST_CASE_HEADLINE)}</p>
  <p class="wcl">${esc(`Purser's AI replaced by a script that always says pay, on the same ${s.cases_per_run} hostile and clean invoices, ${s.runs === 2 ? "run twice" : `${s.runs} runs`}, scored by plain code.`)}</p>
  <ul class="wcc"><li class="ok"><b class="wcn">${esc("Purser, the AI always says pay")}</b><span class="wcw">${esc(wrong(script))}</span><small>${esc(`${past(script)}${toCfo}.`)}</small></li><li><b class="wcn">${esc("A payer with no rules")}</b><span class="wcw">${esc(wrong(naive))}</span><small>${esc(`${past(naive)}.`)}</small></li></ul>
  ${cent ? `<p class="wct">${esc(cent.refused ? "One cent changed after the CFO's approval: refused on the signed hash, nothing sent." : "One cent changed after the CFO's approval: paid.")}</p>` : ""}
  <p class="wcf"><a href="${esc(`${REPO_BLOB}${WORST_CASE_DOC}`)}" target="_blank" rel="noopener">${esc("Every case, the method and what it does not prove")} ↗</a> <span>${esc(`Test data only, ${s.ran_at.slice(0, 10)}, commit ${s.commit}.`)}</span></p>
</article>`;
}

export const WORST_CASE_CSS = `
article.wcase { margin: 0 0 28px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
article.wcase h2.sec { margin: 0 0 6px; }
article.wcase .wch { margin: 0 0 6px; font-size: 18px; font-weight: 700; line-height: 1.35; }
article.wcase .wcl, article.wcase .wct { margin: 0 0 12px; color: var(--muted); font-size: 14.5px; line-height: 1.45; }
article.wcase ul.wcc { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 560px) { article.wcase ul.wcc { grid-template-columns: 1fr; } }
article.wcase ul.wcc li { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 10px; background: var(--sunken); min-width: 0; }
article.wcase ul.wcc li.ok { box-shadow: inset 3px 0 0 var(--ok); }
article.wcase .wcn { font-size: 14px; font-weight: 650; }
article.wcase .wcw { font-size: 18px; font-weight: 720; line-height: 1.3; overflow-wrap: anywhere; }
article.wcase ul.wcc small { font-size: 13px; color: var(--muted); line-height: 1.4; }
article.wcase .wcf { margin: 0; font-size: 13.5px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
article.wcase .wcf a { color: var(--accent); font-weight: 650; }
article.wcase .wcf span { color: var(--muted); }
`;
