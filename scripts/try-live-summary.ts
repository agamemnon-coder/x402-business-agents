// The figures of docs/runs/2026-11-19-live-try.md, from the raw records scripts/try-live-record.ts wrote (run-<n>.json in
// docs/runs/2026-11-19-live-try/): per run, what Claude was asked (from the engine's own events), the Airwallex sandbox
// transfers and their SCHEDULED → PAID path, the approval's hash, the refusal, the hold, the proof's checks and the step
// times; then the aggregates (p50 and p95 by nearest rank). Writes summary.json beside the runs and prints the tables.
//   npx tsx scripts/try-live-summary.ts [dir]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "docs/runs/2026-11-19-live-try";
interface Ev { seq: number; ts: string; actor: string; event: string; subject: string | null; fields: Record<string, unknown> }
interface Answer { tab: string; path: string; status: number; body: Record<string, unknown> | null }
interface Rec {
  run: number; profile: string; viewport: { width: number }; color_scheme: string; started_at: string; finished_at: string; ok: boolean; failures: string[];
  steps_ms: Record<string, number | null>; page_says: Record<string, string | null>;
  bundle: { downloaded?: { outcome: string; verify_page: { verdict: string }; repo_verifier: { ok: boolean; checks: number } }; paid?: { verify_page_pasted: { verdict: string | null }; repo_verifier: { ok: boolean; checks: number } | null } | null };
  held: { invoice?: { invoice_no?: string; total?: string; status?: string } | null; cash?: Record<string, unknown> | null; payout_events?: string[] };
  answers: Answer[]; events: { main: Ev[]; cash: Ev[] }; console_errors: string[]; outside_requests: string[];
}

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : null; };
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** Every Claude call a company's events name: the reader's (read, classify, review) and each agent's turns. */
function claudeCalls(evs: Ev[], tab: string) {
  const asking = new Map(evs.filter((e) => e.event === "claude.asking").map((e) => [e.subject, e.ts]));
  const reads = evs.filter((e) => e.event === "claude.read").map((e) => {
    const at = asking.get(e.subject);
    return {
      tab, kind: "reader", role: str(e.fields.role) ?? (e.subject ?? "").split(":")[0]!.replace(/^ap\./, ""), agent: "reader", model: str(e.fields.model), source: str(e.fields.source),
      request_ids: e.fields.request_id ? [String(e.fields.request_id)] : [], turns: 1, cost_usd_micros: num(e.fields.cost_usd_micros) ?? 0,
      latency_ms: at ? Date.parse(e.ts) - Date.parse(at) : null, latency_from: "claude.asking → claude.read event times", status: "done",
    };
  });
  const runs = evs.filter((e) => e.event === "agent.run").map((e) => {
    const turnIds = [...new Set(evs.filter((t) => t.event === "agent.tool" && t.subject === e.subject && t.fields.request_id).map((t) => String(t.fields.request_id)))];
    return {
      tab, kind: "agent", role: e.subject ?? "", agent: str(e.fields.agent) ?? e.actor, model: str(e.fields.model), source: "claude",
      request_ids: turnIds, turns: num(e.fields.turns) ?? turnIds.length, cost_usd_micros: num(e.fields.cost_usd_micros) ?? 0,
      latency_ms: num(e.fields.latency_ms), latency_from: "agent.run latency_ms", status: str(e.fields.status), claude_ms: str(e.fields.claude_ms),
    };
  });
  return [...reads, ...runs];
}

/** Where the invoices' reading came from, and any decision not taken by Claude (a fallback to the parser or to code). */
function fallbacks(evs: Ev[]) {
  const out: string[] = [];
  for (const e of evs) {
    if (e.event === "claude.read" && e.fields.source !== "claude") out.push(`${e.subject}: read by ${String(e.fields.source)}`);
    if (e.event === "ap.received" && e.subject !== "AP-0001" && !String(e.fields.read_by ?? "").startsWith("claude:")) out.push(`${e.subject}: received, read by ${String(e.fields.read_by)}`);
    if (/^ap\.(checker_decided|payer_proposed|coded)$/.test(e.event) && e.fields.source !== "claude") out.push(`${e.subject}: ${e.event} by ${String(e.fields.source)}`);
    if (e.event === "agent.run" && e.fields.status !== "done") out.push(`${e.subject}: agent run ${String(e.fields.status)}`);
  }
  return out;
}

const files = readdirSync(dir).filter((f) => /^run-\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)));
const runs = files.map((f) => {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Rec;
  const main = r.events.main, cash = r.events.cash;
  const calls = [...claudeCalls(main, "main"), ...claudeCalls(cash, "cash")];
  const pays = r.answers.filter((a) => a.tab === "main" && /\/pay$/.test(a.path));
  const signed = pays.find((a) => a.body?.outcome === "paid")?.body ?? null;
  const refused = pays.find((a) => a.body?.outcome === "refused")?.body ?? null;
  const transfers = pays.map((a) => a.body?.airwallex_payout as Record<string, unknown> | undefined).filter((p): p is Record<string, unknown> => !!p && p.source === "airwallex-sandbox").map((p) => {
    const id = String(p.transfer_id);
    const sched = main.find((e) => e.event === "airwallex.transfer" && e.fields.transfer_id === id);
    const paid = main.find((e) => e.event === "airwallex.simulated" && e.fields.transfer_id === id);
    const sim = r.answers.find((a) => /payout\/simulate$/.test(a.path) && (a.body?.note as Record<string, unknown> | undefined)?.transfer_id === id);
    return {
      transfer_id: id, amount: `${String(p.currency)} ${String(p.amount)}`, airwallex_request_id: str(p.request_id), approval_sha256: str(p.terms_sha256),
      path: [{ status: str(sched?.fields.status) ?? str(p.status), at: sched?.ts ?? null }, { status: str(paid?.fields.status) ?? str((sim?.body?.note as Record<string, unknown> | undefined)?.status), at: paid?.ts ?? null }],
      scheduled_to_paid_ms: sched && paid ? Date.parse(paid.ts) - Date.parse(sched.ts) : null,
    };
  });
  const big = transfers.find((t) => t.amount === "EUR 1850.00");
  const layers = (refused?.layers ?? {}) as { signature?: { reason?: string }; executor?: { said?: string } };
  return {
    run: r.run, profile: `${r.profile} ${r.viewport.width} ${r.color_scheme}`, started_at: r.started_at, finished_at: r.finished_at, ok: r.ok, failures: r.failures,
    claude: {
      calls, entries: calls.length, api_requests: calls.reduce((k, c) => k + c.turns, 0), with_request_id: calls.filter((c) => c.request_ids.length).length,
      reader_calls_without_request_id: calls.filter((c) => c.kind === "reader" && !c.request_ids.length).length,
      request_ids: [...new Set(calls.flatMap((c) => c.request_ids))], cost_usd_micros: calls.reduce((k, c) => k + c.cost_usd_micros, 0),
      main_entries: calls.filter((c) => c.tab === "main").length, main_cost_usd_micros: calls.filter((c) => c.tab === "main").reduce((k, c) => k + c.cost_usd_micros, 0), page_said: r.page_says.calls_line,
      models: [...new Set(calls.map((c) => c.model))], fallbacks: [...fallbacks(main), ...fallbacks(cash)],
    },
    airwallex: transfers,
    approval: { approval_sha256: str(signed?.signed_sha256), equals_transfer_metadata: !!big && big.approval_sha256 === str(signed?.signed_sha256), approved: main.find((e) => e.event === "proposal.approved")?.ts ?? null },
    refusal: refused ? { outcome: refused.outcome, signature: layers.signature?.reason ?? null, executor: layers.executor?.said ?? null, changed: refused.changed, signed_sha256: refused.signed_sha256, sent_sha256: refused.sent_sha256, transfers_before: refused.transfers_before, transfers_after: refused.transfers_after, page: r.page_says.refusal_head } : null,
    held: { invoice: r.held.invoice ?? null, outcome: r.held.cash?.outcome ?? null, rule: r.held.cash?.rule ?? null, why: r.held.cash?.why ?? null, short_by: r.held.cash?.short_by ?? null, decided_by: r.held.cash?.decided_by ?? null, payout_events: r.held.payout_events ?? null },
    bundle: { downloaded: r.bundle.downloaded ? { outcome: r.bundle.downloaded.outcome, verify_page: r.bundle.downloaded.verify_page.verdict, repo_verifier: r.bundle.downloaded.repo_verifier } : null, paid: r.bundle.paid ? { verify_page: r.bundle.paid.verify_page_pasted.verdict, repo_verifier: r.bundle.paid.repo_verifier } : null },
    steps_ms: r.steps_ms, page_says: r.page_says, console_errors: r.console_errors.length, outside_requests: r.outside_requests.length,
  };
});

const stepNames = [...new Set(runs.flatMap((r) => Object.keys(r.steps_ms)))];
const steps = Object.fromEntries(stepNames.map((k) => {
  const xs = runs.map((r) => r.steps_ms[k]).filter((x): x is number => typeof x === "number");
  return [k, { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null }];
}));
const allCalls = runs.flatMap((r) => r.claude.calls);
const agg = {
  runs: runs.length, ok: runs.filter((r) => r.ok).length, desktop: runs.filter((r) => r.profile.startsWith("desktop")).length, phone: runs.filter((r) => r.profile.startsWith("phone")).length,
  first_start: runs[0]?.started_at ?? null, last_finish: runs.at(-1)?.finished_at ?? null,
  steps,
  claude: {
    entries: allCalls.length, api_requests: runs.reduce((k, r) => k + r.claude.api_requests, 0), distinct_request_ids: new Set(runs.flatMap((r) => r.claude.request_ids)).size,
    reader_calls_without_request_id: runs.reduce((k, r) => k + r.claude.reader_calls_without_request_id, 0), cost_usd_micros: runs.reduce((k, r) => k + r.claude.cost_usd_micros, 0),
    models: [...new Set(allCalls.map((c) => c.model))], fallbacks: runs.reduce((k, r) => k + r.claude.fallbacks.length, 0),
    latency_ms: Object.fromEntries([...new Set(allCalls.map((c) => `${c.kind}:${c.kind === "reader" ? c.role : c.agent}`))].map((k) => {
      const xs = allCalls.filter((c) => `${c.kind}:${c.kind === "reader" ? c.role : c.agent}` === k).map((c) => c.latency_ms).filter((x): x is number => typeof x === "number");
      return [k, { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95) }];
    })),
  },
  airwallex: {
    transfers: runs.reduce((k, r) => k + r.airwallex.length, 0), paid: runs.reduce((k, r) => k + r.airwallex.filter((t) => t.path[1]?.status === "PAID").length, 0),
    scheduled_to_paid_ms: (() => { const xs = runs.flatMap((r) => r.airwallex.map((t) => t.scheduled_to_paid_ms)).filter((x): x is number => typeof x === "number"); return { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95) }; })(),
  },
  approvals_matching_transfer: runs.filter((r) => r.approval.equals_transfer_metadata).length,
  refused: runs.filter((r) => r.refusal?.outcome === "refused" && r.refusal.transfers_before === r.refusal.transfers_after).length,
  held: runs.filter((r) => r.held.outcome === "hold" && (r.held.payout_events?.length ?? 1) === 0).length,
  bundles_valid_on_verify: runs.filter((r) => /^VALID/.test(r.bundle.downloaded?.verify_page ?? "")).length,
  paid_bundles_valid_on_verify: runs.filter((r) => /^VALID/.test(r.bundle.paid?.verify_page ?? "")).length,
  console_errors: runs.reduce((k, r) => k + r.console_errors, 0), outside_requests: runs.reduce((k, r) => k + r.outside_requests, 0),
};
writeFileSync(join(dir, "summary.json"), JSON.stringify({ what: "Figures of docs/runs/2026-11-19-live-try.md, computed by scripts/try-live-summary.ts from run-<n>.json here.", aggregate: agg, runs }, null, 1) + "\n");
console.log(JSON.stringify(agg, null, 1));
const t = (iso: string | null) => (iso ? iso.slice(11, 19) : "–");
const s = (ms: number | null | undefined) => (typeof ms === "number" ? (ms / 1000).toFixed(1) : "–");
console.log("\n| Run | Viewport | Started (UTC) | Result | Claude: entries / API requests / cost | Airwallex transfers (SCHEDULED → PAID) | approval_sha256 | Proof on /verify | Start | Auto-pay | Sign | Pay | Paid on screen |");
for (const r of runs) {
  console.log(`| ${r.run} | ${r.profile} | ${t(r.started_at)} | ${r.ok ? "all ok" : `FAILED: ${r.failures.join("; ")}`} | ${r.claude.entries} / ${r.claude.api_requests} / USD ${(r.claude.cost_usd_micros / 1e6).toFixed(4)} | ${r.airwallex.map((x) => `${x.amount}: \`${x.transfer_id}\` ${x.path.map((p) => `${p.status} ${t(p.at)}`).join(" → ")}`).join("<br>")} | \`${(r.approval.approval_sha256 ?? "").slice(0, 16)}…\` | ${r.bundle.downloaded?.verify_page ?? "–"} | ${s(r.steps_ms.start_ms)} | ${s(r.steps_ms.autopay_ms)} | ${s(r.steps_ms.sign_ms)} | ${s(r.steps_ms.pay_ms)} | ${s(r.steps_ms.sign_to_paid_on_screen_ms)} |`);
}
