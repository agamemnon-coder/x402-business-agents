// The short summary at the top of /proof, /runs and /visa (jury pass, 13 Nov: "a short 4-card summary at the top,
// details folded; far less visible text"). Four cards, each one figure, a few words and a link to where its record is
// shown in full. Every value is handed in by the page, from its run records; this module only draws them.
import { esc, icon } from "./ui.js";

export interface SummaryCard {
  icon: string;
  /** The figure, short ("2 of 2", "PAID", "24/24"). */
  fig: string;
  title: string;
  /** One sentence at most. */
  text: string;
  href: string;
  tone?: "ok" | "bad";
  /** The record(s) its values come from, space-separated (data-rec, as every block from a separate record carries). */
  rec?: string;
}

export function summaryHtml(cards: SummaryCard[], label: string): string {
  if (!cards.length) return "";
  return `<ul class="sumc" aria-label="${esc(label)}">${cards.map((c) => `<li${c.tone ? ` class="${c.tone}"` : ""}${c.rec ? ` data-rec="${esc(c.rec)}"` : ""}><a href="${esc(c.href)}"${/^https?:/.test(c.href) ? ' target="_blank" rel="noopener"' : ""}><span class="sc-ic">${icon(c.icon, 18)}</span><b class="sc-f">${esc(c.fig)}</b><b class="sc-t">${esc(c.title)}</b><small>${esc(c.text)}</small></a></li>`).join("")}</ul>`;
}

/** The fold every detail goes into under the summary. */
export function detailsFold(id: string, summary: string, inner: string): string {
  return `<details class="deep sumd" id="${esc(id)}"><summary>${esc(summary)}</summary>${inner}</details>`;
}

export const SUMMARY_CSS = `
ul.sumc { list-style: none; margin: 14px 0 18px; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
@media (max-width: 520px) { ul.sumc { grid-template-columns: 1fr; } }
ul.sumc a { display: grid; grid-template-columns: auto 1fr; column-gap: 10px; row-gap: 2px; align-items: center; height: 100%; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: inherit; text-decoration: none; }
ul.sumc a:hover, ul.sumc a:focus-visible { border-color: var(--accent); }
ul.sumc .sc-ic { grid-row: 1 / span 2; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ul.sumc li.ok .sc-ic { background: var(--ok-soft); color: var(--ok); } ul.sumc li.bad .sc-ic { background: var(--bad-soft); color: var(--bad); }
ul.sumc .sc-f { font-size: 22px; line-height: 1.1; font-weight: 750; font-variant-numeric: tabular-nums; }
ul.sumc .sc-t { font-size: 15px; line-height: 1.25; }
ul.sumc small { grid-column: 1 / -1; margin-top: 6px; font-size: 13.5px; line-height: 1.35; color: var(--muted); }
details.sumd > summary { font-weight: 650; }
`;
