// docs/evidence/proof-index.md (owner, 20 Nov): every figure on /proof, its value, its record and how to check it, in
// one table, built from the page as the Worker serves it (proofPage) by src/proof/figureTrace.ts. Nothing is typed in:
// the rows are the page's figures, the records are the page's own data-rec and links, the field is found in the record,
// and the check is the command that re-checks that record, where one exists. test/proof-index.test.ts holds the
// committed file equal to a fresh build, so the table cannot drift from the page. Build time only.

import { distinctive, fieldOf, figures, gap, recordsOf, type Figure } from "./figureTrace.js";

/**
 * The command that re-checks a record, first match wins. Offline unless it says otherwise; a record no command
 * re-checks has none here, and its row gives the field instead.
 */
export const CHECKS: readonly { test: RegExp; how: string }[] = [
  { test: /^docs\/runs\/2026-11-07-awx-1\/receipt-P-0002\.json$/, how: "`npm run verify-approval` (offline: the passkey's signature over these exact terms)" },
  { test: /^docs\/runs\/[^/]+\/receipt-[^/]+\.json$/, how: "`npm run verify-receipt -- {file}` (offline)" },
  { test: /^docs\/runs\/\d{4}-\d{2}-\d{2}-anchor\.json$/, how: "`npm run verify-anchor -- {file}` (reads the anchor transaction on Alta testnet; needs METAL_RPC_URL)" },
  { test: /^docs\/runs\/2026-11-19-alta-merkle\.json$/, how: "`npm run approvals:merkle` (recomputes the root from the soak and bills records, offline)" },
  { test: /^docs\/runs\/(?:\d{4}-\d{2}-\d{2}-airwallex-(?:soak|bills|late-failure|deposits|switch-on|batch-transfer(?:-2)?|financial-transactions|payee-check)|airwallex-(?:cards|transfer-approval|vic-payment-intents)-\d{4}-\d{2}-\d{2}|airwallex-readback)\.json$/, how: "`npm run airwallex-trail` (every call and every transfer's signed hash, re-checked offline)" },
  { test: /^docs\/demo\/airwallex-run\.json$/, how: "`npm run airwallex-trail` (offline); the run log docs/runs/2026-11-07-awx-1.md" },
  { test: /^docs\/demo\/main-run\.json$/, how: "`npm run judge` serves the site from this record, offline" },
  { test: /^docs\/evidence\/evidence-wall\.json$/, how: "`npm run evidence:wall` rebuilds it from the records it names (offline)" },
  { test: /^docs\/evidence\/verification-[\d-]+\.json$/, how: "`npm run verify-all` (live: reads Alta testnet and the deployed site)" },
  { test: /^docs\/evidence\/tamper-matrix\.json$/, how: "`npm run tamper-matrix` (offline)" },
  { test: /^docs\/evidence\/fuzzing\.json$/, how: "`npm run fuzz` (offline)" },
  { test: /^docs\/evidence\/chaos-money\.json$/, how: "`npm run chaos:money` (offline)" },
  { test: /^docs\/evidence\/redteam-api\.json$/, how: "`npm run redteam:api` (on this computer)" },
  { test: /^docs\/evidence\/airwallex-api-coverage\.json$/, how: "`npm run airwallex:coverage` (offline)" },
  { test: /^docs\/evidence\/site-quality\.json$/, how: "`npm run site:quality`" },
  { test: /^docs\/evidence\/scorecard\.json$/, how: "`npm run scorecard` (reads api.securityscorecards.dev)" },
  { test: /^docs\/assets\/test-summary\.json$/, how: "`npx vitest run`, then `npm run test-count`" },
  { test: /^docs\/evals\/adversarial-(v\d)/, how: "`npm run eval:adversarial-$1` (offline)" },
  { test: /^docs\/evals\/agents\.json$/, how: "`npm run agent-evals`" },
  { test: /^docs\/evals\/ap-hostile/, how: "`npm run ap-hostile-eval`" },
  { test: /^docs\/evals\/autonomy-redteam\.json$/, how: "`npm run autonomy-redteam`" },
  { test: /^docs\/redteam\/report\.json$/, how: "`npm run redteam`" },
  { test: /^docs\/redteam\/night-/, how: "`npm run redteam-night`" },
  { test: /^docs\/demo\/reliability\.json$/, how: "`npm run reliability`" },
];

/** The command that re-checks a record, its {file} filled in, or null. */
export function checkOf(record: string): string | null {
  for (const c of CHECKS) { const m = c.test.exec(record); if (m) return c.how.replace("{file}", record).replace("$1", m[1] ?? ""); }
  return null;
}

export interface IndexRow { where: string; value: string; shown: string; records: string[]; how: string }

/** The figure's place on the page: the ids of the elements around it, or "top" before any. */
const placeOf = (f: Figure) => f.where.split(">").filter(Boolean).slice(-2).join(" › ") || "top";
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One row per figure as the page shows it (a figure said twice in one place, from the same records, is one row). */
export function indexRows(html: string): IndexRow[] {
  const seen = new Set<string>(), out: IndexRow[] = [];
  for (const f of figures(html)) {
    const records = recordsOf(f), external = f.hrefs.filter((h) => /^https:/.test(h));
    const key = JSON.stringify([placeOf(f), f.token, f.text, records]);
    if (seen.has(key)) continue;
    seen.add(key);
    const d = distinctive(f.token);
    const field = d ? records.map((r) => { const at = fieldOf(d, r); return at ? `${r}: ${at}` : null; }).find(Boolean) : null;
    const commands = [...new Set(records.map(checkOf).filter((c): c is string => !!c))];
    const how = [
      ...(field ? [`field ${field}`] : []),
      ...commands,
      ...(!records.length && external.length ? [`open ${new URL(external.at(-1)!).hostname}`] : []),
      ...(gap(f) ? [`NOT TRACED: ${gap(f)}`] : []),
    ];
    out.push({ where: placeOf(f), value: f.token, shown: short(f.text), records: records.length ? records : external.slice(-1), how: how.join("; ") || "read it in the record named" });
  }
  return out;
}

/** The index as Markdown: the heading, how it is made, then the one table. */
export function proofIndexMd(html: string): string {
  const rows = indexRows(html);
  const traced = figures(html).filter((f) => !gap(f)).length, all = figures(html).length;
  const hashes = rows.filter((r) => distinctive(r.value)?.kind === "hash" || distinctive(r.value)?.kind === "id").length;
  const commanded = rows.filter((r) => /`npm run|`npx /.test(r.how)).length;
  return `# Every figure on /proof, and its record

Every figure /proof shows (a count, an amount, a percentage, a date, a hash, an id), with the record it is read from,
as the page names it: its \`data-rec\` (a file in this repository) or its link (a file here on GitHub, or Airwallex,
Alta's testnet explorer, YouTube, GitHub, scorecard.dev, bestpractices.dev). Built from the page as the Worker serves it
(\`proofPage()\`, src/redesign/proof.ts) by \`npm run proof:index\` (src/proof/proofIndex.ts); test/proof-index.test.ts
holds this file equal to a fresh build, and test/proof-trace.test.ts fails on any figure without a record, any record
that is not in the repository, and any hash, id or amount its record does not hold. Typed in by hand: nothing.

**${all} figures on the page, ${traced} with a record;** ${rows.length} rows below (a figure said twice in one place from
the same records is one row); ${hashes} hashes and ids, each found in its record; ${commanded} rows with a command that
re-checks their record. "How to check": the field of the record that holds the figure (for a hash, an id, an amount or a
long number, found there by the build), then the command that re-checks the record, where one exists. A count or a
date is read from the record the row names. Paths are from the repository root.

| # | Where on /proof | Figure | As shown | Record | How to check |
|---|---|---|---|---|---|
${rows.map((r, i) => `| ${i + 1} | ${cell(r.where)} | ${cell(r.value)} | ${cell(r.shown)} | ${cell(r.records.join(" "))} | ${cell(r.how)} |`).join("\n")}
`;
}
