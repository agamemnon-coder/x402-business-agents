// /security by category (21 Nov, Max: "security page is still not upgraded"; the design language of /proof): six
// categories, each one short line, its figures as tiles (each tile one link to its committed record, a ring where the
// figure is a share of a whole), its controls as chips linked to the code, and its depth folded. Nothing is typed in:
// every figure is an item of ./securityEvidence.ts (read from its record there), a tile of the committed evidence wall
// (docs/evidence/evidence-wall.json), or read below from its doc; every quoted line is checked word for word against
// its doc (docLine), so a doc that no longer says it is an error, never a guess.

import { outLink, repoHref, repoText } from "./productPage.js";
import { committedWall, type EvidenceWall } from "./evidenceWall.js";
import { EV_TAG_WORDS, evidenceItems, fromWall, itemHref, securityEvidence, type EvGroup, type EvItem } from "./securityEvidence.js";
import { CI_CSS, ciChecksHtml } from "./ciChecks.js";
import { picon } from "./proofIcons.js";
import { esc } from "./ui.js";

/** A doc as running text: bold and code marks out, line breaks as spaces. */
const flat = (path: string) => repoText(path).replace(/\*\*|`/g, "").replace(/\s+/g, " ");
/** A sentence a doc says, word for word, with a link to it; a doc that no longer says it: an error. */
export function says(doc: string, quote: string, anchor = ""): string {
  if (!flat(doc).includes(quote)) throw new Error(`${doc} no longer says: ${quote}`);
  return `“${esc(quote)}” ${outLink(repoHref(doc, anchor), doc.split("/").pop()!)}`;
}

export const OPA_DOC = "docs/policy-opa.md";
export const OPA_TEST = "test/policy-rego.test.ts";
/** The cases on which the Rego export and Purser's own code agree, as docs/policy-opa.md states them. */
export function opaCases(text: string = flat(OPA_DOC)): string {
  const m = /holds them equal on ([\d,]+) cases, every one identical/.exec(text);
  if (!m) throw new Error(`${OPA_DOC} no longer says on how many cases the Rego and Purser's code agree`);
  return m[1]!;
}

/** A control or rule, in a few words, linked to the code or doc that holds it (a repository path, or a page of the site). */
export interface SecPoint { text: string; to: string }
/** One category: its figures (each an evidence item), its controls, and its depth (folds, each a summary and its lines). */
export interface SecCategory { id: string; icon: string; nav: string; title: string; line: string; pill?: string; items: EvItem[]; points: SecPoint[]; folds: { id?: string; summary: string; html: string }[] }

const pointHref = (p: SecPoint) => (/^(src|cloud|worker|docs|test|policy|formal)\/|^[A-Z]+\.md$/.test(p.to) ? repoHref(p.to.split("#")[0]!, p.to.includes("#") ? `#${p.to.split("#")[1]}` : "") : p.to);

/** The "If the approver is unavailable" lines, passed in by ./security.ts (they are read there from docs/security.md). */
export interface CategoryInputs { away: string[]; awayLink: string; groups?: EvGroup[]; wall?: EvidenceWall | null }

/** The six categories, in the page's order. Every evidence item of ./securityEvidence.ts is in exactly one. */
export function securityCategories(o: CategoryInputs): SecCategory[] {
  const w = o.wall === undefined ? committedWall() : o.wall;
  const items = evidenceItems(o.groups ?? securityEvidence(w));
  const ev = (id: string) => {
    const i = items.find((x) => x.id === id);
    if (!i) throw new Error(`/security: no evidence item ${id}`);
    return i;
  };
  const opa: EvItem = { id: "c-opa", fig: opaCases(), label: "policy cases where the OPA (Rego) export decides as Purser's code", note: "An export, not a second engine: Purser enforces in its own code and at the rails. The test runs every case through both, in CI on every change; the count as the doc states it.", tag: "ci", rec: OPA_DOC, also: [repoHref(OPA_TEST), OPA_TEST.split("/").pop()!] };
  return [
    {
      id: "c-approval", icon: "scan-face", nav: "Approval", title: "Approval and signatures",
      line: "Above the limits, the CFO's passkey (Face ID) signs the SHA-256 of the exact terms. Change one cent and the signature no longer matches.",
      items: [fromWall("c-try-cent", "try-cent", w), fromWall("c-soak-cent", "soak-negatives", w), fromWall("c-hash", "approval-hash", w), ev("e-tamper")],
      points: [
        { text: "Terms re-hashed before any call", to: "src/policy/hashFirst.ts" },
        { text: "Changed terms raise an alarm", to: "src/ops/health.ts" },
        { text: "The private key stays on the phone", to: "docs/security/key-management.md#roles" },
        { text: "Check a proof file yourself", to: "verify" },
      ],
      folds: [{ id: "unavailable", summary: "If the approver is unavailable", html: `<ul class="pl">${[...o.away.map((l) => esc(l)), o.awayLink].map((l) => `<li>${l}</li>`).join("")}</ul>` }],
    },
    {
      id: "c-limits", icon: "sliders-horizontal", nav: "Limits", title: "Limits and policy",
      line: "The CFO's policy is code: it checks every proposal before anything moves, and an agent cannot change a rule.",
      items: [fromWall("c-worst", "worst-case", w), fromWall("c-alta-refused", "alta-series-refused", w), fromWall("c-held", "try-held", w), opa],
      points: [
        { text: "Limits", to: "src/policy/rules.ts" },
        { text: "Payee allowlist", to: "src/policy/fraud.ts" },
        { text: "Duplicates", to: "src/lib/invoiceKey.ts" },
        { text: "Cash floor", to: "src/ap/checkerCore.ts" },
        { text: "The policy in Rego", to: "policy/purser.rego" },
      ],
      folds: [{ summary: "The policy in OPA (Rego)", html: `<ul class="pl"><li>${says(OPA_DOC, "It is an export, not a second engine.", "#what-it-is")}</li><li>${says(OPA_DOC, "Purser still enforces in its own code and at the rails, whatever OPA answers: Purser never reads the Rego, and changing a rule in it changes nothing Purser does.", "#what-it-is")}</li><li>${outLink(repoHref(OPA_TEST), OPA_TEST)} ${outLink(repoHref("docs/cfo-policy.md"), "The CFO policy")}</li></ul>` }],
    },
    {
      id: "c-agents", icon: "bot", nav: "Agents", title: "Agents and keys",
      line: "Each agent pays under its own mandate and card limits and holds only its own key; a model holds none.",
      items: [ev("e-hostile"), fromWall("c-card-cent", "card-cent", w), fromWall("c-mandate", "alta-refusals", w), fromWall("c-passkeys", "passkeys-onchain", w)],
      points: [
        { text: "One mandate per agent", to: "docs/security.md#least-privilege" },
        { text: "No agent can use an owner key", to: "test/no-owner-key.test.ts" },
        { text: "A pause revokes the mandate", to: "src/policy/pause.ts" },
        { text: "Keys rotated and revoked", to: "docs/security/key-management.md#rotation" },
      ],
      folds: [{ summary: "Least privilege, in the docs' words", html: `<ul class="pl"><li>${says("docs/security.md", "No agent has or can use an owner key", "#least-privilege")}</li><li>${says("docs/security.md", "Models: no key, URL, credential or tool.", "#least-privilege")}</li><li>${says("docs/security/key-management.md", "Each person: their passkey's private key, which never leaves their device; Purser holds the public key only.", "#roles")}</li><li>${says("docs/security/key-management.md", "API keys, admin keys and enrolment secrets as SHA-256 only", "#storage-and-distribution")}</li></ul>` }],
    },
    {
      id: "c-money", icon: "arrow-left-right", nav: "Money", title: "Money movement", pill: "Test money only",
      line: "Each payment takes an atomic hold, runs once under its signed request id, and moves test money only: the Airwallex sandbox and Alta testnet.",
      items: [fromWall("c-holds", "holds-at-once", w), ev("e-formal"), fromWall("c-two-locks", "two-locks", w), fromWall("c-replay", "awx-replay", w)],
      points: [
        { text: "Idempotent creates", to: "src/policy/saga.ts" },
        { text: "A webhook never moves money", to: "src/policy/airwallexEvents.ts" },
        { text: "Hash-chained audit log", to: "src/audit/log.ts" },
        { text: "Three independent locks", to: "#ar-locks" },
      ],
      folds: [],
    },
    {
      id: "c-testing", icon: "flask-conical", nav: "Testing", title: "Testing and assurance",
      line: "Attacked, fuzzed, model-checked and proven on purpose; every change runs the checks in CI.",
      items: [ev("e-zerotrust"), ev("e-redteam"), ev("e-chaos"), ev("e-fuzz"), fromWall("c-dafny", "formal-dafny", w), ev("e-mutation"), ev("e-scan"), ev("e-pinned")],
      points: [],
      folds: [{ id: "ci-fold", summary: "Checked on every change", html: ciChecksHtml() }],
    },
    {
      id: "c-data", icon: "database", nav: "Data", title: "Data, privacy and governance",
      line: "Each company's data is kept apart and its tokens sealed; audit evidence is never rewritten. The threat model and the controls are written down.",
      items: [ev("e-stride"), ev("e-mapping"), ev("e-requirements"), ev("e-openssf"), ev("e-continuity"), ev("e-report")],
      points: [
        { text: "Each company apart", to: "cloud/src/tenant.ts" },
        { text: "Tokens sealed (AES-256-GCM)", to: "cloud/src/sealed.ts" },
        { text: "GDPR rights in the product", to: "privacy" },
        { text: "Report a vulnerability", to: "SECURITY.md" },
      ],
      folds: [{ summary: "Retention, in the doc's words", html: `<ul class="pl"><li>${says("docs/privacy/retention.md", "Never rewrite audit evidence.", "#principles")}</li><li>${says("docs/privacy/retention.md", "Touch one company only.", "#principles")}</li><li>${says("docs/privacy/data-inventory.md", "An engineering inventory, not legal advice.")}</li></ul>` }],
    },
  ];
}

/** Where a figure is a share of a whole ("All 66", "Both", "370 of 380"), that share; else null (the tile shows an icon). */
export function shareOf(fig: string): number | null {
  if (/^(All [\d,]+|Both)$/.test(fig)) return 1;
  const m = /^([\d,]+) of ([\d,]+)$/.exec(fig);
  if (!m) return null;
  const a = Number(m[1]!.replace(/,/g, "")), b = Number(m[2]!.replace(/,/g, ""));
  return b > 0 ? a / b : null;
}
const R = 15, C = 2 * Math.PI * R;
/** The tile's drawing: a ring filled to the figure's share (a tick inside when whole), or the category's icon. */
function visual(fig: string, ic: string): string {
  const s = shareOf(fig);
  if (s === null) return `<span class="sc-v ic" aria-hidden="true">${picon(ic, 18)}</span>`;
  const off = (C * (1 - s)).toFixed(2);
  return `<span class="sc-v ring" aria-hidden="true"><svg viewBox="0 0 36 36" width="36" height="36"><circle class="tr" cx="18" cy="18" r="${R}"/><circle class="ar" cx="18" cy="18" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${off}" transform="rotate(-90 18 18)"/>${s === 1 ? `<path class="ck" d="M12.5 18.5l3.6 3.6 7.4-7.6"/>` : ""}</svg></span>`;
}

/** A figure's tile: one link to its record (the whole tile), the figure, its words and where it ran. */
export const tileHtml = (i: EvItem, ic: string) => `<li id="${esc(i.id)}"><a class="sc-t" href="${esc(itemHref(i))}" target="_blank" rel="noopener" data-rec="${esc(i.rec)}">${visual(i.fig, ic)}<b class="sc-f">${esc(i.fig)}</b><span class="sc-l">${esc(i.label)}</span><span class="sc-tag t-${i.tag}">${esc(EV_TAG_WORDS[i.tag])}</span></a></li>`;

/** What each figure is: its note in its record's words, with its record and any second link. */
const notesHtml = (items: EvItem[]) => `<ul class="pl">${items.map((i) => `<li><b>${esc(i.fig)}</b> ${esc(i.label)}. ${esc(i.note)} ${outLink(repoHref(i.rec, i.anchor ?? ""), i.rec.split("/").pop()!)}${i.also ? ` ${outLink(i.also[0], i.also[1])}` : ""}</li>`).join("")}</ul>`;

const pointHtml = (p: SecPoint) => {
  const href = pointHref(p), out = /^https?:/.test(href);
  return `<li><a href="${esc(href)}"${out ? ' target="_blank" rel="noopener"' : ""}>${picon("check", 14)}${esc(p.text)}${out ? " ↗" : ""}</a></li>`;
};

/** One category, as markup. */
export function categoryHtml(c: SecCategory): string {
  const folds = [{ summary: "What each figure is", html: notesHtml(c.items) }, ...c.folds];
  return `<section class="card sc n${c.items.length}" id="${esc(c.id)}" aria-labelledby="${esc(c.id)}-h">
  <div class="sc-h"><span class="sc-ic" aria-hidden="true">${picon(c.icon, 22)}</span><h2 id="${esc(c.id)}-h">${esc(c.title)}</h2>${c.pill ? `<span class="pill note">${esc(c.pill)}</span>` : ""}</div>
  <p class="sc-a">${esc(c.line)}</p>
  <ul class="sc-ts">${c.items.map((i) => tileHtml(i, c.icon)).join("")}</ul>
  ${c.points.length ? `<ul class="sc-pts" aria-label="${esc("Controls, each linked to its code")}">${c.points.map(pointHtml).join("")}</ul>` : ""}
  <div class="sc-folds">${folds.map((f) => `<details class="fold"${f.id ? ` id="${esc(f.id)}"` : ""}><summary>${esc(f.summary)}</summary>${f.html}</details>`).join("")}</div>
</section>`;
}

/** The categories' nav: one chip each, under the hero. */
export const categoryNavHtml = (cs: SecCategory[]) => `<nav class="sc-nav" aria-label="${esc("Security, by category")}">${cs.map((c) => `<a href="#${esc(c.id)}"><span aria-hidden="true">${picon(c.icon, 15)}</span>${esc(c.nav)}</a>`).join("")}</nav>`;

/** The six categories: the two pairs of four figures side by side from 1000 px, the larger two across the page. */
export function categoriesHtml(cs: SecCategory[]): string {
  return `<div class="sc-grid" id="categories">${cs.map(categoryHtml).join("\n")}</div>`;
}

export const CATEGORIES_CSS = `${CI_CSS}
.sc-nav { position: sticky; top: 65px; z-index: 30; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0; padding: 6px 0; background: var(--bg); }
.sc-nav::-webkit-scrollbar { display: none; }
.sc-nav a { flex: 1 0 auto; justify-content: center; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px 0 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font-size: 14px; font-weight: 650; text-decoration: none; white-space: nowrap; }
.sc-nav a span { display: inline-grid; place-items: center; color: var(--accent); }
.sc-nav a:hover, .sc-nav a:focus-visible { border-color: var(--accent); color: var(--accent); }
.sc-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 1000px) { .sc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sc-grid > .sc.n6, .sc-grid > .sc.n8 { grid-column: 1 / -1; } }
section.sc { display: flex; flex-direction: column; gap: 12px; padding: 22px 22px 10px; border-radius: 22px; min-width: 0; scroll-margin-top: 120px;
  background: radial-gradient(60% 50% at 100% 0%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%), var(--surface); }
.sc-h { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.sc-h h2 { margin: 0; font-size: clamp(21px, 2vw, 26px); font-weight: 760; letter-spacing: -.015em; line-height: 1.2; }
.sc-ic { flex: none; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); }
.sc .sc-a { margin: 0; font-size: 15.5px; line-height: 1.5; color: var(--muted); max-width: 52em; }
ul.sc-ts { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 700px) { .sc.n8 ul.sc-ts { grid-template-columns: repeat(4, minmax(0, 1fr)); } .sc.n6 ul.sc-ts { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 700px) and (max-width: 999px) { .sc.n4 ul.sc-ts { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
ul.sc-ts > li { min-width: 0; }
a.sc-t { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "v f" "l l" "k k"; align-items: center; column-gap: 12px; row-gap: 6px; height: 100%; box-sizing: border-box; min-height: 44px; padding: 14px; border: 1px solid var(--border); border-radius: 16px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--sunken) 45%, var(--surface)), var(--surface)); color: inherit; text-decoration: none; transition: border-color .2s, transform .2s; }
a.sc-t:hover, a.sc-t:focus-visible { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); transform: translateY(-1px); }
.sc-v { grid-area: v; color: var(--accent); }
.sc-v.ring svg { display: block; }
.sc-v .tr { fill: none; stroke: color-mix(in srgb, var(--accent) 16%, var(--sunken)); stroke-width: 4; }
.sc-v .ar { fill: none; stroke: var(--ok); stroke-width: 4; stroke-linecap: round; }
.sc-v .ck { fill: none; stroke: var(--ok); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.sc-v.ic { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: color-mix(in srgb, var(--accent) 14%, var(--sunken)); }
.sc-f { grid-area: f; font-size: clamp(22px, 2vw, 27px); font-weight: 780; letter-spacing: -.025em; line-height: 1.05; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.sc-l { grid-area: l; align-self: start; font-size: 14px; line-height: 1.4; color: var(--muted); overflow-wrap: anywhere; }
.sc-tag { grid-area: k; align-self: end; justify-self: start; font-size: 14px; font-weight: 650; padding: 1px 9px; border-radius: 999px; background: var(--surface); color: var(--muted); border: 1px solid var(--border); white-space: nowrap; }
.sc-tag.t-test, .sc-tag.t-check { color: var(--ok); }
.sc-tag.t-ci, .sc-tag.t-external, .sc-tag.t-sandbox, .sc-tag.t-testnet { color: var(--accent); }
ul.sc-pts { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
ul.sc-pts a { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; box-sizing: border-box; padding: 0 14px 0 10px; border-radius: 999px; background: var(--sunken); border: 1px solid var(--border); color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
ul.sc-pts a .i { color: var(--ok); flex: none; }
ul.sc-pts a:hover, ul.sc-pts a:focus-visible { border-color: var(--accent); }
.sc-folds { margin-top: auto; display: flex; flex-wrap: wrap; column-gap: 22px; }
.sc-folds > details.fold { flex: 1 1 100%; margin: 0; }
.sc-folds > details.fold > summary { min-height: 44px; }
.sc ul.pl li b { font-variant-numeric: tabular-nums; }
section.sc .cichk { margin: 6px 0 10px; }
section.sc .cichk code { font-size: 14px; }
.sc ul.pl a.pf { display: inline-flex; min-height: 44px; }
@media (max-width: 560px) {
  section.sc { padding: 16px 14px 6px; border-radius: 18px; gap: 10px; }
  .sc-ic { width: 40px; height: 40px; border-radius: 12px; }
  ul.sc-ts { gap: 8px; }
  a.sc-t { grid-template-columns: minmax(0, 1fr); grid-template-areas: "v" "f" "l" "k"; padding: 12px 10px 10px; row-gap: 4px; }
  .sc-v.ring svg { width: 30px; height: 30px; } .sc-v.ic { width: 30px; height: 30px; border-radius: 9px; }
  .sc-f { font-size: 21px; }
  .sc .sc-a { font-size: 15px; }
}
@media (prefers-reduced-motion: reduce) { a.sc-t { transition: none; } a.sc-t:hover { transform: none; } }`;
