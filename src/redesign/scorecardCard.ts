// /proof's scorecard card (15 Nov): with Purser vs Claude alone, the same hostile invoice set, from the run's own
// record (src/evals/scorecardSummary.ts). Each payer's worst run is shown, so no run is picked. Test data only.

import { SCORECARD, SCORECARD_DOC, worstRun, type ScorecardArm } from "../evals/scorecardSummary.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const SCORECARD_ID = "scorecard";

const sums = (m: Record<string, string>) => Object.entries(m).map(([c, a]) => `${c === "XXX" ? "no currency read" : c} ${Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`).join(" + ");
const wrong = (a: ScorecardArm) => (a.wrong_payments === 0 ? "No wrong payment" : `${a.wrong_payments} wrong payment${a.wrong_payments === 1 ? "" : "s"}: ${sums(a.wrong_money)}`);
const past = (a: ScorecardArm) => (a.paid_past_cfo === 0 ? "none paid past the CFO" : `${a.paid_past_cfo} paid past the CFO`);
const loose = (a: ScorecardArm) => (a.to_cfo_not_held === 0 ? "none sent to the CFO that had to be held" : `${a.to_cfo_not_held} sent to the CFO that had to be held`);

export function scorecardCardHtml(): string {
  const s = SCORECARD;
  if (!s?.by_run || !Object.keys(s.by_run).length) return "";
  const col = (name: string, a: ScorecardArm, cost: string) => `<li><b class="scn">${esc(name)}</b><span class="scw">${esc(wrong(a))}</span><small>${esc(`${past(a)}; ${loose(a)}; ${cost}`)}</small></li>`;
  const alone = worstRun("claude_alone"), purser = worstRun("purser"), script = worstRun("purser_script"), naive = worstRun("naive_script");
  // A record from before a payer was added has no column for it: no card rather than a half one.
  if (!alone || !purser || !script || !naive) return "";
  const runs = s.runs === 2 ? "two runs" : `${s.runs} runs`;
  // data-rec: the block names its record, whose figures test/scorecard.test.ts holds to the run's rows.
  return `<article class="scard" id="${SCORECARD_ID}" data-rec="${esc(`docs/evals/scorecard-summary.json ${s.file}`)}" aria-label="${esc("Scorecard: with Purser vs Claude alone")}">
  <h2 class="sec">With Purser vs Claude alone</h2>
  <p class="scl">${esc(`The same ${s.cases_per_run} hostile and clean invoices, ${runs} with real Claude (${s.model}), scored by plain code. Each payer's worse run; the script columns show what code holds when the model is wrong, and the floor.`)}</p>
  <ul class="scc">${col("Claude alone", alone, `USD ${alone.cost_usd.toFixed(4)} a run`)}${col("With Purser", purser, `USD ${purser.cost_usd.toFixed(4)} a run`)}${col("Purser, a script says pay", script, "no model")}${col("A script with no rules", naive, "no model")}</ul>
  <p class="scf"><a href="${esc(`${REPO_BLOB}${SCORECARD_DOC}`)}" target="_blank" rel="noopener">${esc("Every case, the method and what it does not prove")} ↗</a> <span>${esc(`Test data only, ${s.ran_at.slice(0, 10)}, commit ${s.commit}.`)}</span></p>
</article>`;
}

export const SCORECARD_CSS = `
article.scard { margin: 0 0 28px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
article.scard h2.sec { margin: 0 0 6px; }
article.scard .scl { margin: 0 0 12px; color: var(--muted); font-size: 14.5px; line-height: 1.45; }
article.scard ul.scc { list-style: none; margin: 0 0 10px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 1000px) { article.scard ul.scc { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { article.scard ul.scc { grid-template-columns: 1fr; } }
article.scard ul.scc li { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 10px; background: var(--sunken); min-width: 0; }
article.scard .scn { font-size: 14px; font-weight: 650; }
article.scard .scw { font-size: 18px; font-weight: 720; line-height: 1.3; overflow-wrap: anywhere; }
article.scard ul.scc small { font-size: 13px; color: var(--muted); line-height: 1.4; }
article.scard .scf { margin: 0; font-size: 13.5px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
article.scard .scf a { color: var(--accent); font-weight: 650; }
article.scard .scf span { color: var(--muted); }
`;
