// The vault's folder tree as an image (master list 512), computed from the code, never drawn by hand: the paths come from
// src/vault/layout.ts (invoicePath, paymentPath, monthReportPath, vatPath, yearReportPath) for the two invoices of the
// awx-1 run (docs/runs/2026-11-07-awx-1.md: number, supplier, amount, the day they were paid), and the colours from the
// site's design tokens (src/redesign/ui.ts). `npm run vault:tree` writes docs/media/vault-tree-{light,dark}.svg;
// test/vault-tree.test.ts fails when a committed file differs from what the code draws, or a folder name from layout.ts.

import { readFileSync } from "node:fs";
import { TOKENS } from "../redesign/ui.js";
import { invoicePath, monthReportPath, paymentPath, vatPath, yearReportPath } from "./layout.js";

export const VAULT_TREE_RECORD = "docs/runs/2026-11-07-awx-1.md";
export const VAULT_TREE_FILES = { light: "docs/media/vault-tree-light.svg", dark: "docs/media/vault-tree-dark.svg" } as const;
/** The example company: the test world the runs play (docs/demo/main-run.json, "company"). */
export const VAULT_COMPANY_RECORD = "docs/demo/main-run.json";

export interface TreeInvoice { invoice_no: string; vendor: string; currency: string; total: string; date: string }

const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

/** The invoices of the run log, as Claude read them ("read (Sonnet: SLL-2026-11, Stockline Data GmbH, EUR 240.00, ...)"), paid that day. */
export function treeInvoices(md: string = read(VAULT_TREE_RECORD)): TreeInvoice[] {
  const day = /(\d{4}-\d{2}-\d{2})/.exec(VAULT_TREE_RECORD)![1]!;
  return [...md.matchAll(/read \(Sonnet: ([A-Z]+-\d{4}-\d{2}), ([^,]+), ([A-Z]{3}) ([\d,]+\.\d{2})/g)]
    .map((m) => ({ invoice_no: m[1]!, vendor: m[2]!.trim(), currency: m[3]!, total: m[4]!.replace(/,/g, ""), date: day }));
}

export const treeCompany = () => (JSON.parse(read(VAULT_COMPANY_RECORD)) as { company: string }).company;

/** Every file path the tree shows, from layout.ts. */
export function treePaths(company = treeCompany(), invoices = treeInvoices()): string[] {
  const first = invoices[0];
  if (!first) throw new Error(`no invoice read from ${VAULT_TREE_RECORD}`);
  const year = Number(first.date.slice(0, 4));
  const q = `${first.date.slice(0, 4)}Q${Math.ceil(Number(first.date.slice(5, 7)) / 3)}`;
  return [
    ...invoices.map((i) => invoicePath(company, { ...i, blocked: false })),
    ...invoices.map((i) => paymentPath(company, i)),
    monthReportPath(company, first.date.slice(0, 7)),
    vatPath(company, q),
    yearReportPath(company, year),
  ];
}

interface Node { name: string; kids: Map<string, Node> }
/** The paths as a tree; folders first, then files, each in name order. */
export function treeOf(paths: string[]): Node {
  const root: Node = { name: "", kids: new Map() };
  for (const p of paths) {
    let n = root;
    for (const seg of p.split("/")) { if (!n.kids.has(seg)) n.kids.set(seg, { name: seg, kids: new Map() }); n = n.kids.get(seg)!; }
  }
  return root;
}
const sorted = (n: Node) => [...n.kids.values()].sort((a, b) => (Number(b.kids.size > 0) - Number(a.kids.size > 0)) || a.name.localeCompare(b.name));

function palette(theme: "light" | "dark"): Record<string, string> {
  const block = (css: string | undefined) => Object.fromEntries([...(css ?? "").matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  const light = block(/:root \{([\s\S]*?)\n\}/.exec(TOKENS)?.[1]);
  const all = theme === "dark" ? { ...light, ...block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(TOKENS)?.[1]) } : light;
  for (const k of ["bg", "surface", "border", "text", "muted", "accent", "awx"]) if (!all[k]) throw new Error(`design token --${k} missing`);
  return all;
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const LINE = 26, INDENT = 22, PAD = 24;

/** The SVG, one theme. */
export function vaultTreeSvg(theme: "light" | "dark", paths: string[] = treePaths()): string {
  const c = palette(theme);
  const rows: { depth: number; name: string; folder: boolean; last: boolean[] }[] = [];
  const walk = (n: Node, depth: number, last: boolean[]) => {
    const kids = sorted(n);
    kids.forEach((k, i) => { const l = [...last, i === kids.length - 1]; rows.push({ depth, name: k.name, folder: k.kids.size > 0, last: l }); walk(k, depth + 1, l); });
  };
  walk(treeOf(paths), 0, []);
  const longest = Math.max(...rows.map((r) => r.depth * INDENT + r.name.length * 7.4));
  const w = Math.ceil(PAD * 2 + 28 + longest), h = PAD * 2 + rows.length * LINE;
  const body = rows.map((r, i) => {
    const y = PAD + i * LINE + LINE / 2, x = PAD + r.depth * INDENT;
    // The guide lines: a vertical for each open ancestor, an elbow to this row.
    const guides = r.last.slice(0, -1).map((done, d) => done ? "" : `<line x1="${PAD + d * INDENT + 7}" y1="${y - LINE / 2}" x2="${PAD + d * INDENT + 7}" y2="${y + LINE / 2}"/>`).join("");
    const elbow = r.depth > 0 ? `<path d="M${x - INDENT + 7} ${y - LINE / 2}V${r.last[r.last.length - 1] ? y : y + LINE / 2}M${x - INDENT + 7} ${y}H${x - 2}"/>` : "";
    const glyph = r.folder
      ? `<path class="f" d="M${x} ${y - 6}h5l2 2h7v9h-14z"/>`
      : `<path class="d" d="M${x + 2} ${y - 7}h7l3 3v11h-10z"/>`;
    const cls = r.folder ? (["Inkoopfacturen", "Betalingen", "Rapporten"].includes(r.name) ? "t k" : "t fo") : "t fi";
    return `<g class="g">${guides}${elbow}</g>${glyph}<text class="${cls}" x="${x + 22}" y="${y + 4.5}">${xml(r.name)}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="vt-title">
<title id="vt-title">The vault's folders: company, year, quarter, then Inkoopfacturen, Betalingen and Rapporten (computed from src/vault/layout.ts)</title>
<style>
.bg { fill: ${c.surface}; stroke: ${c.border}; }
.g line, .g path { stroke: ${c.border}; stroke-width: 1.2; fill: none; }
.f { fill: ${c["accent-soft"] ?? c.surface}; stroke: ${c.accent}; stroke-width: 1.2; }
.d { fill: ${c.surface}; stroke: ${c.muted}; stroke-width: 1.2; }
.t { font: 13px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.fo { fill: ${c.text}; font-weight: 600; } .k { fill: ${c.accent}; font-weight: 650; } .fi { fill: ${c.muted}; }
</style>
<rect class="bg" x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12"/>
${body}
</svg>
`;
}
