// The evidence wall's figures (src/redesign/evidenceWall.ts renders them on /proof), each read from a committed record
// now. npm run evidence:wall writes them to docs/evidence/evidence-wall.json; test/evidence-wall.test.ts holds that file
// to this. The /try walks' figures add up every recorded series (./liveTry.ts), so a later recording is picked up by
// running the script again.

import { existsSync, readFileSync } from "node:fs";
import { liveTryRecords, liveTryTotals, type LiveTryRecord } from "./liveTry.js";
import { REPO_BLOB } from "./metalStory.js";
import { agentRun } from "./run.js";
import { proofFacts } from "./proof.js";
import { centHolds, centRecord } from "./cardCent.js";
import { ownersRun, ownersSteps } from "./metalOnchain.js";
import { VIC3_RUN_FILE, vic3Run, vic3Summary } from "./vic3Run.js";
import { WORST_CASE, WORST_CASE_DOC, worstOf } from "../evals/worstCase.js";
import { CI_RUNS_URL, ciJobs } from "./ciChecks.js";
import type { EvidenceWall, WallGroup, WallTile } from "./evidenceWall.js";

const ROOT = new URL("../../", import.meta.url);
const has = (p: string) => existsSync(new URL(p, ROOT));
type J = Record<string, unknown>;
const json = (p: string): J | null => { try { return JSON.parse(readFileSync(new URL(p, ROOT), "utf8")) as J; } catch { return null; } };
const blob = (p: string) => `${REPO_BLOB}${p}`;
const fmt = (n: number) => n.toLocaleString("en-GB");
const secs = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`);
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

/** The recorded /try walks, all series together (src/redesign/liveTry.ts), and the link each figure takes. */
function walks(records: LiveTryRecord[]) {
  const t = liveTryTotals(records);
  if (!t || !t.runs) return null;
  const last = records[records.length - 1]!;
  // One series: its run log; several: the folder of runs, where each series has its own.
  const href = records.length === 1 ? blob(last.log ?? last.summary) : `${REPO_BLOB.replace("/blob/", "/tree/")}docs/runs`;
  const rec = records.map((r) => r.summary).join(" ");
  const when = t.days.length === 1 ? day(`${t.days[0]}T12:00:00Z`) : `${day(`${t.days[0]}T12:00:00Z`)} to ${day(`${t.days.at(-1)}T12:00:00Z`)}`;
  return { t, href, rec, when };
}

/** A count as the site writes one (src/redesign/ui.ts countOf): "All 16", "Both", or "37 of 39"; never "16/16". */
const whole = (n: number, of: number) => (n !== of ? `${fmt(n)} of ${fmt(of)}` : of === 2 ? "Both" : `All ${fmt(of)}`);

function rails(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  if (w && w.t.transfers) out.push({ key: "try-transfers", fig: whole(w.t.paid, w.t.transfers), label: "Airwallex sandbox transfers PAID from the public /try", note: `${w.t.runs} walks as a visitor, ${w.when}; PAID by the sandbox's simulation.`, tag: "sandbox", tone: "awx", href: w.href, rec: w.rec });
  const BL = "docs/runs/2026-11-19-airwallex-bills.json";
  const bl = json(BL) as { bills?: { bill_id?: string | null; external_id_matches_signed?: boolean; created?: { read_back?: string } | null; paid?: { status?: string; read_back?: string } | null }[]; audit?: { ts: string }[] } | null;
  const bills = (bl?.bills ?? []).filter((b) => b.bill_id);
  if (bills.length && bills.every((b) => b.created?.read_back === "agrees" && b.paid?.read_back === "agrees")) {
    const paid = bills.filter((b) => b.paid?.status === "PAID" && b.external_id_matches_signed).length;
    out.push({ key: "spend-bills", fig: whole(paid, bills.length), label: "paid invoices made bills in Airwallex Spend", note: `The signed hash as external_id, read back exactly; transfers PAID by the sandbox's simulation, ${day(bl!.audit![0]!.ts)}.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-19-airwallex-bills.md"), rec: BL });
  }
  const facts = proofFacts(agentRun());
  const hash = facts.find((f) => f.key === "awx" && f.icon === "lock");
  if (hash) out.push({ key: "approval-hash", fig: hash.fig, label: "the signed hash, read back from Airwallex's transfer", note: "Its approval_sha256 is the hash of the terms the CFO signed.", tag: "sandbox", tone: "awx", href: hash.href, rec: hash.rec ?? "" });
  const alta = facts.find((f) => f.key === "metal");
  if (alta) out.push({ key: "alta-refusal", fig: alta.fig, label: "refused on chain by Alta: over the mandate", note: `On Alta's testnet explorer; the main run, ${day(agentRun().record.recorded_at)}.`, tag: "testnet", tone: "metal", href: alta.href, rec: alta.rec ?? "" });
  const v = vic3Run();
  if (v) {
    const s = vic3Summary(v), fid = s.paidFaceId[0]?.request;
    if (fid) out.push({ key: "visa-airi", fig: `${fid.currency} ${fid.amount}`, label: "paid with Visa via Airwallex's Airi, after Face ID", note: `A test card, ${s.date}; ${whole(s.paid, s.of).toLowerCase()} purchases paid.`, tag: "sandbox", tone: "awx", href: "visa", rec: VIC3_RUN_FILE });
  }
  const LF = "docs/runs/2026-11-17-airwallex-late-failure.json";
  const lf = json(LF) as { transfers?: unknown[]; audit?: { ts: string }[]; calls?: { by_endpoint?: { endpoint: string; calls: number }[] } } | null;
  const created = lf?.calls?.by_endpoint?.find((e) => e.endpoint === "POST /transfers/create")?.calls;
  if (lf?.transfers?.length && created === lf.transfers.length) out.push({ key: "late-failure", fig: whole(lf.transfers.length, lf.transfers.length), label: "payouts PAID then FAILED: back to a person, none resent", note: `PAID and FAILED by the sandbox's simulation${lf.audit?.[0] ? `, ${day(lf.audit[0].ts)}` : ""}.`, tag: "sandbox", tone: "awx", href: blob(LF), rec: LF });
  const COV = "docs/evidence/airwallex-api-coverage.json";
  const cov = json(COV) as { totals?: { endpoints: number; live: number } } | null;
  if (cov?.totals?.live) out.push({ key: "awx-endpoints", fig: String(cov.totals.live), label: `Airwallex endpoints called live, of ${cov.totals.endpoints} in the code`, note: "Each with the first record that holds a call to it.", tag: "sandbox", tone: "awx", href: blob("docs/evidence/airwallex-api-coverage.md"), rec: COV });
  return out;
}

function forged(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  const TM = "docs/evidence/tamper-matrix.json";
  const tm = json(TM) as { totals?: { artifacts: number; originalsValid: number; tried: number; refused: number; accepted: number } } | null;
  if (tm?.totals?.tried && tm.totals.accepted === 0 && tm.totals.originalsValid === tm.totals.artifacts) out.push({ key: "tamper-matrix", fig: whole(tm.totals.refused, tm.totals.tried), label: "tampered copies of signed proofs refused", note: `Every signed value of ${tm.totals.artifacts} proofs changed; the originals verify. Offline.`, tag: "test", tone: "ok", href: blob("docs/evidence/tamper-matrix.md"), rec: TM });
  if (w && w.t.runs) {
    out.push({ key: "try-cent", fig: whole(w.t.refused, w.t.runs), label: "one-cent changes after approval refused", note: `The public /try, ${w.when}; a virtual test passkey signed.`, tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
    out.push({ key: "try-hash", fig: whole(w.t.approvalsMatching, w.t.runs), label: "approvals whose hash the Airwallex transfer carries", note: `The public /try, ${w.when}.`, tag: "sandbox", tone: "awx", href: w.href, rec: w.rec });
    if (w.t.proofs) out.push({ key: "try-proofs", fig: whole(w.t.proofsValid, w.t.proofs), label: "proof files VALID on /verify and offline", note: "Downloaded from /try; npm run verify-bundle agrees.", tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
  }
  const cent = centRecord();
  if (cent && centHolds(cent.rec)) {
    const b = cent.rec.attempts[1]!;
    out.push({ key: "card-cent", fig: `EUR ${(b.amount_cents / 100).toFixed(2)}`, label: "declined by Airwallex: one cent over an agent card's limit", note: `Simulated card charges, ${day(cent.rec.ran_at)}.`, tag: "sandbox", tone: "awx", href: blob(cent.file), rec: cent.file });
  }
  const owners = ownersRun();
  if (owners) {
    const steps = ownersSteps(owners.rec), changes = steps.filter((x) => x.key === "bind" || x.key === "replace" || x.key === "revoke").length;
    const virtual = owners.rec.owners.some((x) => x.virtual);
    if (changes) out.push({ key: "passkeys-onchain", fig: String(changes), label: "limit changes on chain, each after the passkeys signed", note: `Alta testnet, ${day(owners.rec.ran_at)}: P-256 checked on chain${virtual ? "; one a test key" : ""}.`, tag: "testnet", tone: "metal", href: "alta#faceid-onchain", rec: owners.file });
  }
  return out;
}

function ai(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  const script = worstOf("purser_script"), naive = worstOf("no_rules");
  if (WORST_CASE && script && naive) out.push({ key: "worst-case", fig: `${script.wrong_payments} vs ${naive.wrong_payments}`, label: "wrong payments: an always-pay AI in Purser, vs no rules", note: `${WORST_CASE.cases_per_run} hostile and clean invoices; ${script.paid_past_cfo} paid past the CFO.`, tag: "test", tone: "claude", href: blob(WORST_CASE_DOC), rec: "docs/evals/worst-case-summary.json" });
  const RT = "docs/redteam/report.json";
  const rt = json(RT) as { attempts?: number; blocked?: number; caught_after?: number } | null;
  if (rt?.attempts) {
    const before = (rt.blocked ?? 0) - (rt.caught_after ?? 0);
    out.push({ key: "red-team", fig: whole(before, rt.attempts), label: "red-team attacks stopped before anything moved", note: `The other ${rt.caught_after ?? 0} found afterwards, not prevented.`, tag: "test", tone: "claude", href: blob(RT), rec: RT });
  }
  const AH = "docs/evals/ap-hostile.json";
  const ah = json(AH) as { calls?: number; refused?: number; stood?: number } | null;
  if (ah?.calls) out.push({ key: "hostile-model", fig: whole(ah.refused ?? 0, ah.calls), label: "hostile tool calls, in Claude's place, stopped by code", note: `The other ${ah.stood ?? 0} stood within the rules, by the ledger.`, tag: "test", tone: "claude", href: blob(AH), rec: AH });
  if (w && w.t.claude.entries) {
    out.push({ key: "try-claude", fig: String(w.t.claude.fallbacks), label: `fallbacks in ${w.t.claude.entries} Claude calls on /try`, note: `${w.t.claude.distinctIds} Anthropic request ids; ${w.t.claude.models.join(", ")}.`, tag: "sandbox", tone: "claude", href: w.href, rec: w.rec });
    if (w.t.held) out.push({ key: "try-held", fig: whole(w.t.held, w.t.runs), label: "invoices held by code's cash check", note: "Inside the agent's limit; no payout.", tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
  }
  return out;
}

function built(): WallTile[] {
  const out: WallTile[] = [];
  const VR = "docs/evidence/verification-2026-11-15.json";
  const vr = json(VR) as { counts?: { passed: number; could_not_run_here: number; failed: number }; transactions?: { read_from_chain: number; found: number }; started_at?: string } | null;
  if (vr?.counts) out.push({ key: "verify-all", fig: String(vr.counts.passed), label: `checks passed by npm run verify-all, ${vr.counts.failed} failed`, note: `${vr.transactions?.found ?? 0} Alta transactions read from the chain${vr.started_at ? `; ${day(vr.started_at)}` : ""}.`, tag: "check", tone: "ok", href: blob("docs/evidence/verification-2026-11-15.md"), rec: VR });
  const loads = ["docs/runs/clearing-load-1.json", "docs/runs/clearing-load-2.json"].filter(has).map((f) => ({ f, r: json(f) as { attempted: number; paid: number; failed: number; ran_at: string } }));
  if (loads.length) {
    const tried = loads.reduce((a, x) => a + x.r.attempted, 0), paid = loads.reduce((a, x) => a + x.r.paid, 0);
    const lastRun = loads[loads.length - 1]!.r;
    out.push({ key: "clearing-load", fig: whole(paid, tried), label: "payments through Alta's clearing, load test", note: `${loads.length} runs, ${day(lastRun.ran_at)}; the last: ${whole(lastRun.paid, lastRun.attempted).toLowerCase()} paid.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-10-30-clearing-load.md"), rec: loads.map((x) => x.f).join(" ") });
  }
  const jobs = ciJobs();
  const scans = jobs.filter((j) => /gitleaks|Semgrep|code scanning|npm audit/i.test(j.what)).length;
  out.push({ key: "ci", fig: String(jobs.length), label: "CI jobs on every change", note: `${scans} of them scan for security: gitleaks, Semgrep, CodeQL, npm audit.`, tag: "ci", tone: "", href: CI_RUNS_URL, rec: ".github/workflows/ci.yml" });
  return out;
}

function scale(w: ReturnType<typeof walks>): WallTile[] {
  if (!w) return [];
  const t = w.t, st = (k: string) => t.steps[k];
  const out: WallTile[] = [{ key: "try-journeys", fig: whole(t.ok, t.runs), label: "full /try journeys passed every step", note: `${w.when}, Chromium, desktop and phone; ${t.consoleErrors} console errors.`, tag: "sandbox", tone: "ok", href: w.href, rec: w.rec }];
  const tile = (key: string, step: string, label: string, extra = "") => {
    const p = st(step);
    if (p?.p50 != null) out.push({ key, fig: secs(p.p50), label, note: `Median of ${p.n}, p95 ${secs(p.p95)}${extra}.`, tag: "sandbox", tone: "", href: w.href, rec: w.rec });
  };
  tile("try-sign-paid", "sign_to_paid_on_screen_ms", "passkey to paid, on screen");
  tile("try-autopay", "autopay_awx_paid_ms", "agent pays alone, to Airwallex PAID", "; PAID by the sandbox's simulation");
  tile("try-refusal", "refusal_ms", "one-cent change to refusal");
  tile("try-verify", "verify_ms", "proof file to verdict on /verify");
  if (t.claude.costMicros && t.runs) out.push({ key: "try-cost", fig: `USD ${(t.claude.costMicros / 1e6 / t.runs).toFixed(4)}`, label: "Claude cost per journey", note: `List price; USD ${(t.claude.costMicros / 1e6).toFixed(4)} for ${t.runs}.`, tag: "sandbox", tone: "claude", href: w.href, rec: w.rec });
  return out;
}

/** The wall, computed from the records now. */
export function evidenceWall(records: LiveTryRecord[] = liveTryRecords()): EvidenceWall {
  const w = walks(records);
  const groups: WallGroup[] = [
    { id: "ev-rails", title: "Live on the rails", tiles: rails(w) },
    { id: "ev-forged", title: "Cannot be forged", tiles: forged(w) },
    { id: "ev-ai", title: "AI under control", tiles: ai(w) },
    { id: "ev-built", title: "Built to last", tiles: built() },
    { id: "ev-scale", title: "The public /try, timed", tiles: scale(w) },
  ].filter((g) => g.tiles.length);
  return {
    what: "/proof's evidence wall: every figure read from the committed record its tile links to. Test money only; what was simulated is said on each tile.",
    made_by: "npm run evidence:wall (scripts/evidence-wall.ts, src/redesign/evidenceWallData.ts)",
    groups,
  };
}

/** The file npm run evidence:wall writes. */
export const evidenceWallFile = (w: EvidenceWall = evidenceWall()): string => `${JSON.stringify(w, null, 2)}\n`;

