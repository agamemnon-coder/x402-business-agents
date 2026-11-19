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
// 19 Nov, second pass (the owner: "clearer and tighter"): one word a tag; the wall's lead says sandbox and testnet are live.
export const TAG_WORDS: Record<WallTag, string> = { sandbox: "Sandbox", testnet: "Testnet", test: "Test world", check: "Re-checked", ci: "CI" };
/** The wall's legend, in sight above the tiles: what the tags mean, and what was simulated everywhere. */
export const WALL_LEGEND = "Sandbox and testnet: live runs, test money; a sandbox PAID is simulated. Test world: offline evals. Tap a tile for its record.";
/** The groups' names in the wall's sticky nav. */
export const WALL_NAV: Record<string, string> = { "ev-rails": "Live on the rails", "ev-forged": "Cannot be forged", "ev-ai": "AI under control", "ev-built": "Built to last", "ev-scale": "/try timed" };
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

/** The README's line under the judge path: four headline figures of the wall, each as the wall has it, and its link. */
export const README_WALL_PREFIX = "**Evidence wall, from the records:** ";
export const README_WALL_KEYS = ["soak-paid", "try-transfers", "tamper-matrix", "awx-endpoints"] as const;
/** The README's few words for each figure (its word budget); the figures are the wall's. */
const README_WORDS: Record<(typeof README_WALL_KEYS)[number], string> = { "soak-paid": "soak payments read back", "try-transfers": "/try payouts PAID", "tamper-matrix": "forged copies refused", "awx-endpoints": "Airwallex endpoints live" };
export function readmeWallLine(w: EvidenceWall | null = committedWall()): string {
  const tiles = new Map((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const parts = README_WALL_KEYS.filter((k) => tiles.has(k)).map((k) => `${tiles.get(k)!.fig} ${README_WORDS[k]}`);
  return `${README_WALL_PREFIX}${parts.join(" · ")} · [every figure, with its record](${SITE}/proof#${WALL_ID})`;
}
/**
 * The README with its evidence block under the demo's thumbnail: the map's picture (readmeMapLine in ./evidenceMap.ts),
 * then the wall's line; an old copy of either is taken out first, wherever it was.
 */
export const README_MAP_PREFIX = '<a href="https://kit11.max-31b.workers.dev/proof#evidence"><picture>';
export function withReadmeWallLine(readme: string, line: string = readmeWallLine(), mapLine?: string): string {
  let lines = readme.split("\n");
  const drop = (i: number) => { lines.splice(i, 1); if (lines[i] === "" && lines[i - 1] === "") lines.splice(i, 1); };
  for (const prefix of [README_WALL_PREFIX, README_MAP_PREFIX]) { const i = lines.findIndex((l) => l.startsWith(prefix)); if (i >= 0) drop(i); }
  const thumb = lines.findIndex((l) => l.includes("docs/assets/readme/demo-thumb.jpg"));
  const judge = lines.findIndex((l) => l.startsWith("**1. [Watch the demo"));
  const at = thumb >= 0 ? thumb : judge;
  if (at < 0) return readme;
  lines = [...lines.slice(0, at + 1), "", ...(mapLine ? [mapLine, ""] : []), line, ...(lines[at + 1] === "" ? [] : [""]), ...lines.slice(at + 1)];
  return lines.join("\n");
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

/**
 * The wall (19 Nov, second pass: "clearer and tighter"): a sticky nav of its groups, then one row a group: its name, its
 * tiles (the figure, a few words, the tag, the link; what the figure counts in the link's title), and the group's notes
 * folded under its name.
 */
export function evidenceWallHtml(w: EvidenceWall | null = committedWall()): string {
  if (!w?.groups.length) return "";
  const tile = (t: WallTile) => `<li class="ew-t${t.tone ? ` ${t.tone}` : ""}" data-wall="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}" title="${esc(t.note)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}><b class="ew-f">${esc(t.fig)}</b><span class="ew-l">${esc(t.label)}</span><span class="ew-k"><span class="ew-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><span class="ew-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a></li>`;
  const notes = (g: WallGroup) => `<details class="ew-more"><summary>What each counts</summary><ul>${g.tiles.map((t) => `<li${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><b>${esc(t.fig)}</b> ${esc(t.label)}: ${esc(t.note)}</li>`).join("")}</ul></details>`;
  return `<section class="ewall" id="${WALL_ID}" aria-labelledby="ew-h" data-rec="${esc(WALL_FILE)}">
  <h2 id="ew-h">${esc(WALL_TITLE)}</h2>
  <p class="ew-lead">${esc(WALL_LEGEND)}</p>
  <nav class="ew-nav" aria-label="${esc("Evidence groups")}">${w.groups.map((g) => `<a href="#${esc(g.id)}">${esc(WALL_NAV[g.id] ?? g.title)}</a>`).join("")}</nav>
  ${w.groups.map((g) => `<div class="ew-g" id="${esc(g.id)}"><div class="ew-gh"><h3>${esc(g.title)}</h3>${notes(g)}</div><ul class="ew-ts">${g.tiles.map(tile).join("")}</ul></div>`).join("\n  ")}
</section>`;
}

/**
 * A partner page's strip (19 Nov, the owner: "show the evidence where judges look"): a few of the wall's own tiles, as
 * the wall shows them (the same figures from docs/evidence/evidence-wall.json, each linking to its record), a link to
 * the wall's group on /proof, and any line the page owes beside them (on /airwallex, the one endpoint not live and why).
 */
export const PARTNER_STRIPS: Record<"airwallex" | "alta" | "visa", { title: string; group: string; keys: string[]; legend: string }> = {
  airwallex: { title: "Live on Airwallex", group: "ev-rails", keys: ["soak-paid", "try-transfers", "spend-bills", "soak-fx", "awx-endpoints", "late-failure"], legend: "Airwallex sandbox, test money; a sandbox PAID is the sandbox's simulation. Each tile opens its record." },
  alta: { title: "Live on Alta", group: "ev-rails", keys: ["alta-refusal", "alta-payments", "passkeys-onchain", "clearing-load"], legend: "Alta testnet, test money. Each tile opens its record." },
  visa: { title: "Visa via Airwallex's Airi, as recorded", group: "ev-rails", keys: ["visa-airi", "visa-refused"], legend: "Airwallex sandbox, Airi's test card, test money. Each tile opens its record." },
};

export function evidenceStripHtml(partner: keyof typeof PARTNER_STRIPS, o: { note?: string } = {}, w: EvidenceWall | null = committedWall()): string {
  const spec = PARTNER_STRIPS[partner];
  const tiles = new Map((w?.groups ?? []).flatMap((g) => g.tiles.map((t) => [t.key, t] as const)));
  const shown = spec.keys.map((k) => tiles.get(k)).filter((t): t is WallTile => !!t);
  if (!shown.length) return "";
  const tile = (t: WallTile) => `<li class="ew-t${t.tone ? ` ${t.tone}` : ""}" data-wall="${esc(t.key)}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}" title="${esc(t.note)}"${isExternal(t.href) ? ' target="_blank" rel="noopener"' : ""}><b class="ew-f">${esc(t.fig)}</b><span class="ew-l">${esc(t.label)}</span><span class="ew-k"><span class="ew-tag ${t.tag}">${esc(TAG_WORDS[t.tag])}</span><span class="ew-r" aria-hidden="true">${isExternal(t.href) ? "↗" : "→"}</span></span></a></li>`;
  return `<section class="ewall pstrip" id="live-${partner}" aria-labelledby="ps-${partner}" data-rec="${esc(WALL_FILE)}">
  <div class="ps-h"><h2 id="ps-${partner}">${esc(spec.title)}</h2><a href="proof#${esc(spec.group)}">${esc("All the evidence")} →</a></div>
  <ul class="ew-ts">${shown.map(tile).join("")}</ul>
  <p class="ps-n">${esc(`${spec.legend}${o.note ? ` ${o.note}` : ""}`)}</p>
</section>`;
}

/** /airwallex's line on the endpoints not live: each, and why, from the coverage report and its live record. */
export function notLiveLine(cover: { endpoints: { endpoint: string; status: string }[] } | null, record: { results?: { method?: string; endpoint?: string; live?: boolean; outcome?: string }[] } | null): string {
  const out = (cover?.endpoints ?? []).filter((e) => e.status !== "LIVE");
  if (!out.length) return "";
  const why = (ep: string) => {
    const r = (record?.results ?? []).find((x) => `${x.method} ${x.endpoint}` === ep && x.live === false);
    return r?.outcome ? r.outcome.replace(/^not run: /, "").split(/ \(|; /)[0]!.replace(/\.$/, "") : null;
  };
  return `Not live: ${out.map((e) => `${e.endpoint}${why(e.endpoint) ? ` (${why(e.endpoint)})` : ""}`).join("; ")}.`;
}

export const EVIDENCE_WALL_CSS = `
.ewall { margin: 6px 0 28px; }
.ewall > h2 { font-size: clamp(22px, 2.2vw, 28px); font-weight: 750; letter-spacing: -.01em; margin: 0 0 4px; }
.ewall .ew-lead { margin: 0 0 10px; font-size: 14px; line-height: 1.45; color: var(--muted); max-width: 60em; }
/* The groups' nav, sticky under the site's header; it scrolls sideways inside itself on a phone. */
.ewall .ew-nav { position: sticky; top: 64px; z-index: 30; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 0 12px; padding: 6px 0; background: var(--bg); }
.ewall .ew-nav::-webkit-scrollbar { display: none; }
.ewall .ew-nav a { flex: none; display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; }
.ewall .ew-nav a:hover, .ewall .ew-nav a:focus-visible { border-color: var(--accent); color: var(--accent); }
.ewall .ew-g { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 8px 16px; padding: 12px 0; border-top: 1px solid var(--border); scroll-margin-top: 130px; }
.ewall .ew-g h3 { font-size: 16px; font-weight: 720; line-height: 1.3; margin: 4px 0 2px; }
.ewall details.ew-more > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 44px; font-size: 13.5px; font-weight: 650; color: var(--accent); list-style: none; }
.ewall details.ew-more > summary::-webkit-details-marker { display: none; }
.ewall details.ew-more > summary::after { content: " ▾"; } .ewall details.ew-more[open] > summary::after { content: " ▴"; }
.ewall details.ew-more ul { list-style: none; margin: 4px 0 8px; padding: 0; display: grid; gap: 6px; font-size: 13px; line-height: 1.4; color: var(--muted); }
.ewall details.ew-more b { color: var(--text); font-variant-numeric: tabular-nums; }
.ewall ul.ew-ts { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.ewall li.ew-t { --pc: var(--accent); min-width: 0; }
.ewall li.ew-t.awx { --pc: var(--awx); } .ewall li.ew-t.metal { --pc: var(--metal); } .ewall li.ew-t.claude { --pc: var(--claude); } .ewall li.ew-t.ok { --pc: var(--ok); }
.ewall li.ew-t a { display: flex; flex-direction: column; gap: 2px; height: 100%; min-height: 44px; padding: 10px 12px 8px; border: 1px solid var(--border); border-left: 3px solid var(--pc); border-radius: 10px; background: var(--surface); color: inherit; text-decoration: none; }
.ewall li.ew-t a:hover, .ewall li.ew-t a:focus-visible { border-color: var(--pc); }
.ewall .ew-f { font-size: 22px; line-height: 1.15; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ewall .ew-l { font-size: 13px; font-weight: 600; line-height: 1.3; flex: 1; }
.ewall .ew-k { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
.ewall .ew-tag { font-size: 11.5px; font-weight: 650; padding: 1px 7px; border-radius: 999px; background: var(--sunken); color: var(--muted); white-space: nowrap; }
.ewall .ew-tag.sandbox, .ewall .ew-tag.testnet { background: var(--ok-soft); color: var(--ok); }
.ewall .ew-r { font-size: 13px; font-weight: 650; color: var(--pc); }
@media (max-width: 760px) {
  .ewall .ew-g { grid-template-columns: minmax(0, 1fr); gap: 0 0; }
  .ewall .ew-gh { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ewall ul.ew-ts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* A partner page's strip: the wall's tiles, no nav, no groups. */
.ewall.pstrip { margin: 14px 0 22px; }
.ewall.pstrip .ps-h { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; }
.ewall.pstrip .ps-h h2 { font-size: 20px; font-weight: 740; margin: 0 0 8px; }
.ewall.pstrip .ps-h a { display: inline-flex; align-items: center; min-height: 44px; font-size: 14px; font-weight: 650; color: var(--accent); text-decoration: none; }
.ewall.pstrip ul.ew-ts { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
.ewall.pstrip .ps-n { margin: 8px 0 0; font-size: 13px; line-height: 1.45; color: var(--muted); }
@media (max-width: 420px) { .ewall li.ew-t a { padding: 9px 10px 7px; } .ewall .ew-f { font-size: 20px; } .ewall .ew-l { font-size: 12.5px; } }
`;
