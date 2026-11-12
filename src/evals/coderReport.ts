// The Coder evals' run record (docs/evals/coder.json, written by npm run coder-evals) and its section of
// docs/agent-evals.md. The section is rendered here, by one pure function, from the record alone: no number in it is
// typed by hand (test/coder-report.test.ts checks the committed file against this function).

import type { Coding, CoderRule } from "../ap/coderCore.js";
import type { ExpectedLine } from "./coderCases.js";

/** One case run once on one model. */
export interface CoderEvalRow {
  case: string;
  model: string;
  /** Which run of this case on this model, from 1. */
  run: number;
  expected: ExpectedLine[];
  /** The agent's own accepted answer, before code's rules; null when it gave none. */
  raw: Coding | null;
  /** What code let into the books. */
  enforced: {
    status: "coded" | "needs_review";
    source: "claude" | "fallback";
    overridden_by: CoderRule | null;
    refused_because: string | null;
    lines: { line_no: number; account: string; vat_code: string | null; cost_centre: string }[];
  };
  /** The model gave no answer code could take (no call, a failure, a refusal, out of turns): code's fallback decided. */
  no_answer: boolean;
  run_status: string;
  run_note: string | null;
  turns: number;
  cost_usd_micros: number;
  latency_ms: number;
  /** Each field of the enforced coding against the expectation, on every line. */
  correct: { account: boolean; vat_code: boolean; cost_centre: boolean };
}

export interface CoderEvalRecord {
  ran_at: string;
  commit: string;
  /** The checkout had changes outside the run's own files. */
  dirty: boolean;
  runs: number;
  max_usd: number;
  models: string[];
  /** The cases the run set out to do. */
  cases: string[];
  /** CODER_MODEL when the run started. */
  coder_model: string;
  /** Why the run stopped before it did every case, or null. */
  stopped: string | null;
  rows: CoderEvalRow[];
}

export interface CoderModelSummary {
  model: string;
  invoices: number;
  /** It ran every case of the record, every run. */
  complete: boolean;
  /** Shares from 0 to 1. */
  account: number;
  vat_code: number;
  cost_centre: number;
  /** The agent's answers code refused, by rule. */
  refused: Partial<Record<CoderRule, number>>;
  no_answer: number;
  cost_per_invoice_micros: number;
  p50_ms: number;
  p95_ms: number;
}

/** The share a model must reach on account class and on VAT code to be the default. */
export const CODER_BAR = 0.95;

/** The first line of the section: where it starts in docs/agent-evals.md. */
export const CODER_SECTION_MARK = "<!-- coder-evals: written by src/evals/coderReport.ts from docs/evals/coder.json; not edited by hand -->";

/** The value at a percentile, nearest rank. */
const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]! : 0);
const share = (rows: CoderEvalRow[], f: keyof CoderEvalRow["correct"]) => (rows.length ? rows.filter((r) => r.correct[f]).length / rows.length : 0);

/** Per model: accuracy of the enforced coding, refusals, answers missing, cost and time; and the model the run chooses. */
export function coderSummary(r: CoderEvalRecord): { models: CoderModelSummary[]; chosen: string | null } {
  const models = r.models.filter((m) => r.rows.some((x) => x.model === m)).map((model): CoderModelSummary => {
    const rows = r.rows.filter((x) => x.model === model);
    const refused: Partial<Record<CoderRule, number>> = {};
    for (const x of rows) if (x.raw && x.enforced.overridden_by) refused[x.enforced.overridden_by] = (refused[x.enforced.overridden_by] ?? 0) + 1;
    const times = rows.map((x) => x.latency_ms).sort((a, b) => a - b);
    return {
      model, invoices: rows.length,
      complete: r.cases.every((c) => rows.filter((x) => x.case === c).length >= r.runs),
      account: share(rows, "account"), vat_code: share(rows, "vat_code"), cost_centre: share(rows, "cost_centre"),
      refused, no_answer: rows.filter((x) => x.no_answer).length,
      cost_per_invoice_micros: Math.round(rows.reduce((s, x) => s + x.cost_usd_micros, 0) / rows.length),
      p50_ms: percentile(times, 0.5), p95_ms: percentile(times, 0.95),
    };
  });
  const passing = models.filter((m) => m.complete && m.account >= CODER_BAR && m.vat_code >= CODER_BAR).sort((a, b) => a.cost_per_invoice_micros - b.cost_per_invoice_micros);
  return { models, chosen: passing[0]?.model ?? null };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (micros: number) => (micros / 1e6).toFixed(4);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ");

/** One mistake of the enforced coding, in a sentence: what was booked, what was expected, and what the agent said. */
function mistake(x: CoderEvalRow): string {
  const lines = x.enforced.lines;
  const exp = (i: number) => x.expected.length === 1 ? x.expected[0]! : x.expected[i];
  const got = (f: (l: CoderEvalRow["enforced"]["lines"][number]) => string) => (lines.length ? lines.map(f).join(" / ") : "nothing coded");
  const want = (f: (e: ExpectedLine) => string) => (x.expected.length === 1 || lines.length === 0 ? x.expected.map(f) : lines.map((_, i) => (exp(i) ? f(exp(i)!) : "no line"))).join(" / ");
  const parts: string[] = [];
  if (!x.correct.account) parts.push(`account ${got((l) => l.account)}, expected ${want((e) => e.accounts.join(" or "))}`);
  if (!x.correct.vat_code) parts.push(`VAT code ${got((l) => l.vat_code ?? "none")}, expected ${want((e) => e.vat_code ?? "none")}`);
  if (!x.correct.cost_centre) parts.push(`cost centre ${got((l) => l.cost_centre)}, expected ${want((e) => e.cost_centres.join(" or "))}`);
  const raw = x.raw ? x.raw.lines.map((l) => `${l.account} / ${l.vat_code ?? "none"}`).join("; ") : "";
  const why = x.raw && x.enforced.overridden_by ? ` The agent answered ${raw}; code refused it (${x.enforced.overridden_by}: ${x.enforced.refused_because ?? "no reason recorded"}).`
    : x.no_answer ? ` The agent gave no answer (${x.run_status}${x.run_note ? `: ${x.run_note}` : ""}); code's fallback decided.`
      : " This was the agent's own answer, and code's rules let it in.";
  return cell(`- ${x.case}, ${x.model}: ${parts.join("; ")}.${why}`);
}

/** The section of docs/agent-evals.md, from the record alone. */
export function coderEvalSection(r: CoderEvalRecord): string {
  const s = coderSummary(r);
  const chosen = s.models.find((m) => m.model === s.chosen);
  const wrong = r.rows.filter((x) => !x.correct.account || !x.correct.vat_code || !x.correct.cost_centre);
  return [
    CODER_SECTION_MARK,
    "## The Coder agent: coding supplier invoices with real models",
    "",
    `Last run ${r.ran_at.slice(0, 16).replace("T", " ")} UTC on commit ${r.commit}${r.dirty ? " (with changes not yet committed)" : ""}, with \`npm run coder-evals\` (\`src/cli/coderEvals.ts\`), ${r.runs} run${r.runs === 1 ? "" : "s"} per case and model, at most ${r.max_usd} USD. ${r.cases.length} test invoices (\`src/evals/coderCases.ts\`: the repository's fixtures and made-up suppliers), each filed through the real inbox and coded by the runner's own Coder (\`codeInvoice\`) on a fresh ledger, with the real model. What is scored is what code let into the books (the enforced coding), against what a bookkeeper expects per line. A coding code refused is replaced by code's own fallback, which is scored like any other.`,
    ...(r.stopped ? ["", `The run stopped early: ${r.stopped}.`] : []),
    "",
    "| Model | Invoices | Account class | VAT code | Cost centre | Agent's coding refused by code (by rule) | Code decided, no answer | Cost per invoice (USD) | Time p50 / p95 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...s.models.map((m) => {
      const refused = Object.entries(m.refused).sort(([a], [b]) => a.localeCompare(b));
      const n = refused.reduce((t, [, k]) => t + (k ?? 0), 0);
      return `| ${m.model} | ${m.invoices} | ${pct(m.account)} | ${pct(m.vat_code)} | ${pct(m.cost_centre)} | ${n}${n ? ` (${refused.map(([rule, k]) => `${rule} ${k}`).join(", ")})` : ""} | ${m.no_answer} | ${usd(m.cost_per_invoice_micros)} | ${secs(m.p50_ms)} / ${secs(m.p95_ms)} |`;
    }),
    "",
    chosen
      ? `Default model: ${chosen.model}, the cheapest per invoice that reached at least ${CODER_BAR * 100}% on account class (${pct(chosen.account)}) and on VAT code (${pct(chosen.vat_code)}) over every case. CODER_MODEL in \`src/ap/coderCore.ts\` is set to it.`
      : `No model reached ${CODER_BAR * 100}% on both account class and VAT code over every case, so the default model was not changed: CODER_MODEL stays ${r.coder_model}.`,
    "",
    "### Every mistake",
    "",
    ...(wrong.length ? wrong.map(mistake) : ["None: every enforced coding was what the bookkeeper expected."]),
    "",
  ].join("\n");
}

/** The file with the section at its end: an earlier section is replaced, and none is added without a record. */
export function withCoderSection(md: string, r: CoderEvalRecord | null): string {
  const at = md.indexOf(CODER_SECTION_MARK);
  const base = at >= 0 ? md.slice(0, at).replace(/\n+$/, "\n") : md;
  return r ? `${base}\n${coderEvalSection(r)}` : base;
}
