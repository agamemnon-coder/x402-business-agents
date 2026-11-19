// /proof's evidence wall, as rendered from docs/evidence/evidence-wall.json; its figures are computed in
// ./evidenceWallData.ts. (The owner, 19 Nov: "show all our data and proof"): every figure read from a committed record
// here, grouped (live on the rails, cannot be forged, AI under control, built to last, the recorded /try walks), each a
// tile with one big figure, one line, what was live or simulated, and a link to its record. Figures already in the band
// above it on /proof (tests, live runs, Airwallex calls, Alta transactions, Claude request ids, refusals) are not
// repeated here. `npm run evidence:wall` (scripts/evidence-wall.ts) writes the wall to docs/evidence/evidence-wall.json;
// /proof renders that file, and test/evidence-wall.test.ts fails when it is behind its records. A later recording of the
// /try walks (src/redesign/liveTry.ts) is added to the walks' figures by running the script again. Test money only.

import { readFileSync } from "node:fs";
import { esc } from "./ui.js";

export const WALL_FILE = "docs/evidence/evidence-wall.json";
export const WALL_ID = "evidence";
export const WALL_TITLE = "The evidence wall";

const ROOT = new URL("../../", import.meta.url);

/** What a tile's figure is: live at a partner's sandbox, live on Alta's testnet, a test world (no partner), a re-check of the records, or CI. */
export type WallTag = "sandbox" | "testnet" | "test" | "check" | "ci";
export const TAG_WORDS: Record<WallTag, string> = { sandbox: "Live, sandbox", testnet: "Live, testnet", test: "Test world", check: "Re-checked", ci: "CI" };
/** The partner whose colour the tile carries, if one. */
export type WallTone = "awx" | "metal" | "claude" | "ok" | "";
export interface WallTile { key: string; fig: string; label: string; note: string; tag: WallTag; tone: WallTone; href: string; rec: string }
export interface WallGroup { id: string; title: string; tiles: WallTile[] }
export interface EvidenceWall { what: string; made_by: string; groups: WallGroup[] }

/** The wall as committed (what /proof renders), or null without the file. */
export function committedWall(): EvidenceWall | null {
  try { return JSON.parse(readFileSync(new URL(WALL_FILE, ROOT), "utf8")) as EvidenceWall; } catch { return null; }
}

const isExternal = (h: string) => /^https?:/.test(h);

/** The heading of llms.txt's generated section, which npm run evidence:wall rewrites up to the next heading. */
export const LLMS_WALL_HEADING = "## The evidence wall, from the records";
const SITE = "https://kit11.max-31b.workers.dev";

/** llms.txt's section: the wall in plain text, one line a figure with its link (a page's own link made absolute). */
export function evidenceWallLlms(w: EvidenceWall | null = committedWall()): string {
  if (!w?.groups.length) return "";
  const abs = (h: string) => (isExternal(h) ? h : `${SITE}/${h}`);
  const tagWords = (t: WallTag) => (t === "ci" ? TAG_WORDS[t] : TAG_WORDS[t].toLowerCase());
  // A tile's note, inside a line: no closing full stop, and a plain first word in lower case (not a name or a figure).
  const inLine = (n: string) => n.replace(/\.$/, "").replace(/^(The|Its|On|A|Each|Every|Downloaded|Simulated|Inside|Median|List)\b/, (w) => w.toLowerCase());
  return [
    LLMS_WALL_HEADING,
    "",
    `Written by npm run evidence:wall from the committed records; the same figures, each linked to its record, are on ${SITE}/proof#${WALL_ID}. Test money only; what was simulated is said on each line.`,
    ...w.groups.flatMap((g) => ["", `${g.title}:`, ...g.tiles.map((t) => `- ${t.fig} ${t.label} (${tagWords(t.tag)}; ${inLine(t.note)}): ${abs(t.href)}`)]),
  ].join("\n");
}

/** llms.txt with its generated section put in (after the "## For judges" section when there is none yet). */
export function withWallSection(llms: string, section: string = evidenceWallLlms()): string {
  const at = llms.indexOf(`${LLMS_WALL_HEADING}\n`);
  if (at >= 0) {
    const next = llms.indexOf("\n## ", at + LLMS_WALL_HEADING.length);
    return `${llms.slice(0, at)}${section}\n${next >= 0 ? llms.slice(next) : ""}`;
  }
  const after = llms.indexOf("\n## ", llms.indexOf("## For judges") + 1);
  return after >= 0 ? `${llms.slice(0, after)}\n${section}\n${llms.slice(after)}` : `${llms.trimEnd()}\n\n${section}\n`;
}

export function evidenceWallHtml(w: EvidenceWall | null = committedWall()): string {
  if (!w?.groups.length) return "";
  const tile = (t: WallTile) => `<li class="ew-t${t.tone ? ` ${t.tone}` : ""}" data-wall="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}><b class="ew-f">${esc(t.fig)}</b><span class="ew-l">${esc(t.label)}</span><small class="ew-n">${esc(t.note)}</small><span class="ew-k"><span class="ew-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><span class="ew-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a></li>`;
  return `<section class="ewall" id="${WALL_ID}" aria-labelledby="ew-h" data-rec="${esc(WALL_FILE)}">
  <h2 id="ew-h">${esc(WALL_TITLE)}</h2>
  <p class="ew-lead">${esc("Each figure is read from its record; open a tile for it. Test money only; simulated steps are said.")}</p>
  ${w.groups.map((g) => `<div class="ew-g" id="${esc(g.id)}"><h3>${esc(g.title)}</h3><ul class="ew-ts">${g.tiles.map(tile).join("")}</ul></div>`).join("\n  ")}
</section>`;
}

export const EVIDENCE_WALL_CSS = `
.ewall { margin: 8px 0 30px; }
.ewall > h2 { font-size: clamp(22px, 2.2vw, 28px); font-weight: 750; letter-spacing: -.01em; margin: 0 0 6px; }
.ewall .ew-lead { margin: 0 0 14px; font-size: 15px; line-height: 1.5; color: var(--muted); max-width: 46em; }
.ewall .ew-g { margin: 0 0 18px; }
.ewall .ew-g h3 { font-size: 17px; font-weight: 720; margin: 0 0 8px; }
.ewall ul.ew-ts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 1100px) { .ewall ul.ew-ts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .ewall ul.ew-ts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ewall li.ew-t { --pc: var(--accent); min-width: 0; }
.ewall li.ew-t.awx { --pc: var(--awx); } .ewall li.ew-t.metal { --pc: var(--metal); } .ewall li.ew-t.claude { --pc: var(--claude); } .ewall li.ew-t.ok { --pc: var(--ok); }
.ewall li.ew-t a { display: flex; flex-direction: column; gap: 4px; height: 100%; min-height: 44px; padding: 14px 14px 12px; border: 1px solid var(--border); border-top: 3px solid var(--pc); border-radius: 14px; background: var(--surface); color: inherit; text-decoration: none; }
.ewall li.ew-t a:hover, .ewall li.ew-t a:focus-visible { border-color: var(--pc); }
.ewall .ew-f { font-size: clamp(24px, 2.4vw, 30px); line-height: 1.1; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ewall .ew-l { font-size: 14.5px; font-weight: 650; line-height: 1.35; }
.ewall .ew-n { font-size: 13px; line-height: 1.4; color: var(--muted); flex: 1; }
.ewall .ew-k { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; margin-top: 6px; }
.ewall .ew-tag { font-size: 12px; font-weight: 650; padding: 2px 8px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.ewall .ew-tag.sandbox, .ewall .ew-tag.testnet { background: var(--ok-soft); color: var(--ok); }
.ewall .ew-r { font-size: 13px; font-weight: 650; color: var(--pc); white-space: nowrap; }
@media (max-width: 420px) { .ewall li.ew-t a { padding: 12px 11px 10px; } .ewall .ew-f { font-size: 22px; } .ewall .ew-l { font-size: 13.5px; } .ewall .ew-n { font-size: 12.5px; } }
`;
