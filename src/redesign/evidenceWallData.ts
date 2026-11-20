// The evidence wall's figures (src/redesign/evidenceWall.ts renders them on /proof), each read from a committed record
// now. npm run evidence:wall writes them to docs/evidence/evidence-wall.json; test/evidence-wall.test.ts holds that file
// to this. The /try walks' figures add up every recorded series (./liveTry.ts), so a later recording is picked up by
// running the script again.

import { existsSync, readFileSync } from "node:fs";
import { liveTryRecords, liveTryTotals, type LiveTryRecord } from "./liveTry.js";
import { REPO_BLOB } from "./metalStory.js";
import { agentRun, longRun, payments } from "./run.js";
import { METAL_TX_LIST } from "./partners.js";
import { proofFacts } from "./proof.js";
import { centHolds, centRecord } from "./cardCent.js";
import { ownersRun, ownersSteps } from "./metalOnchain.js";
import { VIC3_RUN_FILE, vic3Run, vic3Summary } from "./vic3Run.js";
import { WORST_CASE, WORST_CASE_DOC, worstOf } from "../evals/worstCase.js";
import { CI_RUNS_URL, ciJobs } from "./ciChecks.js";
import { NOT_IN_BAND } from "./scale.js";
import { soakTotals, soaks } from "../airwallex/soakRecords.js";
import type { EvidenceWall, WallGroup, WallTile } from "./evidenceWall.js";
import { verifyInclusion, type ProofStep } from "../anchor/merkle.js";

const ROOT = new URL("../../", import.meta.url);
const has = (p: string) => existsSync(new URL(p, ROOT));
type J = Record<string, unknown>;
const json = (p: string): J | null => { try { return JSON.parse(readFileSync(new URL(p, ROOT), "utf8")) as J; } catch { return null; } };
const blob = (p: string) => `${REPO_BLOB}${p}`;
const fmt = (n: number) => n.toLocaleString("en-GB");
const secs = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)} s`);
/** "19 and 20 Nov", "19 Nov": the days of several records, in order. */
const joinDays = (days: readonly string[]) => {
  const and = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
  const mon = days.map((d) => d.split(" ")[1]);
  return days.length > 1 && mon.every((m) => m === mon[0]) ? `${and(days.map((d) => d.split(" ")[0]!))} ${mon[0]}` : and(days);
};
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
  return { t, href, rec, when, records };
}

/** A count as the site writes one (src/redesign/ui.ts countOf): "All 16", "Both", or "37 of 39"; never "16/16". */
const whole = (n: number, of: number) => (n !== of ? `${fmt(n)} of ${fmt(of)}` : of === 2 ? "Both" : `All ${fmt(of)}`);

function rails(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  if (w && w.t.transfers) out.push({ key: "try-transfers", fig: whole(w.t.paid, w.t.transfers), label: "Airwallex transfers PAID from the public /try", note: `${w.t.runs} walks as a visitor, ${w.when}; PAID by the sandbox's simulation.`, tag: "sandbox", tone: "awx", href: w.href, rec: w.rec });
  const BL = "docs/runs/2026-11-19-airwallex-bills.json";
  const bl = json(BL) as { bills?: { bill_id?: string | null; external_id_matches_signed?: boolean; created?: { read_back?: string } | null; paid?: { status?: string; read_back?: string } | null }[]; audit?: { ts: string }[] } | null;
  const bills = (bl?.bills ?? []).filter((b) => b.bill_id);
  if (bills.length && bills.every((b) => b.created?.read_back === "agrees" && b.paid?.read_back === "agrees")) {
    const paid = bills.filter((b) => b.paid?.status === "PAID" && b.external_id_matches_signed).length;
    out.push({ key: "spend-bills", fig: whole(paid, bills.length), label: "paid invoices made bills in Airwallex Spend", note: `The signed hash as external_id, read back exactly; transfers PAID by the sandbox's simulation, ${day(bl!.audit![0]!.ts)}.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-19-airwallex-bills.md"), rec: BL });
  }
  // The soaks (19 and 20 Nov so far): each figure the sum of the same field in every soak record, all of them in data-rec.
  const sk = soakTotals(), skAll = soaks();
  if (sk.created) {
    const days = skAll.map((x) => day(x.rec.started_at)), on = joinDays(days), last = skAll.at(-1)!;
    out.push({ key: "soak-paid", fig: whole(sk.readbackMatches, sk.created), label: "soak payments PAID, signed hash read back", note: `Each read back from Airwallex as signed: hash, amount, payee, reference; PAID by the sandbox's simulation; ${skAll.length === 1 ? "the soak of" : `${skAll.length} soaks,`} ${on}.`, tag: "sandbox", tone: "awx", href: blob(last.log), rec: sk.files.join(" ") });
    if (sk.fx.planned) out.push({ key: "soak-fx", fig: whole(sk.fx.readbackMatches, sk.fx.planned), label: "FX conversions booked and read back", note: `In the ${skAll.length === 1 ? "soak" : "soaks"} of ${on}, each before the payment it funded.`, tag: "sandbox", tone: "awx", href: blob(last.log), rec: sk.files.join(" ") });
  }
  const facts = proofFacts(agentRun());
  const hash = facts.find((f) => f.key === "awx" && f.icon === "lock");
  if (hash) out.push({ key: "approval-hash", fig: hash.fig, label: "signed hash in Airwallex's transfer record", note: "Its approval_sha256 is the hash of the terms the CFO signed.", tag: "sandbox", tone: "awx", href: hash.href, rec: hash.rec ?? "" });
  const held = facts.find((f) => f.key === "awx" && f.icon === "landmark");
  if (held) out.push({ key: "two-locks", fig: held.fig, label: "held by Airwallex until a person approved", note: `${held.text.replace(/\.$/, "")}; a test passkey signed in Purser, settlement simulated.`, tag: "sandbox", tone: "awx", href: held.href, rec: held.rec ?? "" });
  const alta = facts.find((f) => f.key === "metal");
  if (alta) out.push({ key: "alta-refusal", fig: alta.fig, label: "refused on chain by Alta, over the mandate", note: `On Alta's testnet explorer; the main run, ${day(agentRun().record.recorded_at)}.`, tag: "testnet", tone: "metal", href: alta.href, rec: alta.rec ?? "" });
  const pay = payments(agentRun().record);
  if (pay.sums && pay.onChain) out.push({ key: "alta-payments", fig: String(pay.onChain), label: "payments on Alta, each its own transaction", note: `The main run, ${day(agentRun().record.recorded_at)}: every one inside the agents' mandates; each linked to Alta's testnet explorer.`, tag: "testnet", tone: "metal", href: blob(METAL_TX_LIST), rec: agentRun().file });
  const v = vic3Run();
  if (v) {
    const s = vic3Summary(v), fid = s.paidFaceId[0]?.request;
    if (fid) out.push({ key: "visa-airi", fig: `${fid.currency} ${fid.amount}`, label: `paid via Airi after Face ID: ${whole(s.paid, s.of).toLowerCase()} purchases`, note: `Visa Intelligent Commerce via Airwallex's Airi, a test card, ${s.date}.`, tag: "sandbox", tone: "awx", href: "visa", rec: VIC3_RUN_FILE });
  }
  const AS = ["docs/runs/2026-11-19-alta-series.json", "docs/runs/2026-11-19-alta-series-finish.json"].filter(has);
  if (AS.length) {
    const steps = AS.flatMap((f) => ((json(f) as { steps?: { kind: string; outcome: string; event?: string; reason?: string; amount?: string }[] } | null)?.steps ?? []));
    // An "over-mandate" step the chain paid was planned wrong (the budget was not yet spent: the record marks it
    // UNEXPECTED, the run log explains); it was inside the mandate, so it is not counted as an attempt outside it.
    const paid = steps.filter((x) => x.event === "MandatePayment"), refused = steps.filter((x) => x.outcome === "refused on chain");
    const misplanned = steps.filter((x) => x.kind === "over-mandate" && x.event === "MandatePayment");
    const tried = steps.filter((x) => x.kind === "over-mandate" && x.event !== "MandatePayment");
    const total = (paid.reduce((n, x) => n + Math.round(Number(x.amount) * 100), 0) / 100).toFixed(2);
    const ran = (json(AS[0]!) as { ran_at?: string } | null)?.ran_at;
    if (refused.length) out.push({ key: "alta-series-refused", fig: whole(refused.length, tried.length), label: "over-mandate attempts refused on chain", note: `${refused.map((x) => x.reason).join(", ")}: each a transaction of its own, 0.00 moved; ${ran ? day(ran) : ""}.${misplanned.length ? ` One more step planned as over the budget was within it (the plan's error, said in the run log) and was paid.` : ""}`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-19-alta-series.md"), rec: AS.join(" ") });
    if (paid.length) out.push({ key: "alta-series-paid", fig: String(paid.length), label: "payments inside an agent's mandate on Alta", note: `${total} test USD in all, each its own transaction; ${ran ? day(ran) : ""}.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-19-alta-series.md"), rec: AS.join(" ") });
  }
  // 20 Nov: the refusals the 19 Nov series did not send (src/cli/altaRefusals.ts). Off /proof (its words are at their
  // budget); in the wall file, the Alta page's strip and llms.txt.
  const AR = "docs/runs/2026-11-20-alta-refusals.json";
  const ar = json(AR) as { ran_at?: string; summary?: { refusals_sent: number; refused_on_chain: number; refused_before_sending: number; reasons: string[]; unexpected: number } } | null;
  if (ar?.summary?.refusals_sent && !ar.summary.unexpected) {
    const m = ar.summary;
    out.push({ offProof: true, key: "alta-refusals", fig: whole(m.refused_on_chain, m.refusals_sent), label: "mandate refusals on chain: over the count, revoked, not started, expired", note: `${m.reasons.join(", ")}: each a transaction of its own, 0.00 moved${ar.ran_at ? `; ${day(ar.ran_at)}` : ""}.${m.refused_before_sending ? " A payment signed by another key was stopped by the CLI before sending, not by the chain." : ""}`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-20-alta-refusals.md"), rec: AR });
  }
  // 19 Nov: the day's signed Airwallex payments as one Merkle tree, its root in one Alta transaction (src/anchor/merkle.ts).
  const AM = "docs/runs/2026-11-19-alta-merkle.json";
  const am = json(AM) as { leaves?: number; root?: string; anchored_at?: string; read_back?: { matches: boolean }; payments?: { approval_sha256: string; proof: ProofStep[]; airwallex_sha256_matches: boolean }[] } | null;
  if (am?.leaves && am.root && am.read_back?.matches && am.payments) {
    const proven = am.payments.filter((p) => p.airwallex_sha256_matches && verifyInclusion(p.approval_sha256, p.proof, am.root!)).length;
    out.push({ key: "alta-merkle", fig: whole(proven, am.leaves), label: "signed Airwallex payments in one Alta transaction, each with a proof", note: `One Merkle root on chain; each proof checks offline${am.anchored_at ? `; ${day(am.anchored_at)}` : ""}.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-19-alta-merkle.md"), rec: AM });
  }
  const LF = "docs/runs/2026-11-17-airwallex-late-failure.json";
  const lf = json(LF) as { transfers?: unknown[]; audit?: { ts: string }[]; calls?: { by_endpoint?: { endpoint: string; calls: number }[] } } | null;
  const created = lf?.calls?.by_endpoint?.find((e) => e.endpoint === "POST /transfers/create")?.calls;
  if (lf?.transfers?.length && created === lf.transfers.length) out.push({ key: "late-failure", fig: whole(lf.transfers.length, lf.transfers.length), label: "PAID, then FAILED: back to a person", note: `PAID and FAILED by the sandbox's simulation${lf.audit?.[0] ? `, ${day(lf.audit[0].ts)}` : ""}.`, tag: "sandbox", tone: "awx", href: blob(LF), rec: LF });
  const COV = "docs/evidence/airwallex-api-coverage.json";
  const cov = json(COV) as { totals?: { endpoints: number; live: number } } | null;
  if (cov?.totals?.live) out.push({ key: "awx-endpoints", fig: String(cov.totals.live), label: `Airwallex endpoints live, of ${cov.totals.endpoints}`, note: "Each with the first record that holds a call to it.", tag: "sandbox", tone: "awx", href: blob("docs/evidence/airwallex-api-coverage.md"), rec: COV });
  // Airwallex, deeper (19 Nov; src/proof/awxDeepLive.ts): the wallet statement, the seller side, a payment withdrawn.
  // The last two are off /proof (its words in sight are at their budget, test/proof-first.test.ts): for the Airwallex
  // partner page's strip, and in the wall file, the README and llms.txt.
  type Deep = { ran_at?: string; facts?: { statement?: { window?: { from: string; to: string }; checked: number; agree: number; lines: number; continuity: { links: number; breaks: unknown[] } } | null; receivable?: { invoice: { invoice_no: string; amount_cents: number; currency: string }; matched: { outcome: string } | null; link: { active_after: boolean | null } | null } | null; revoke?: { before: string | null; after: string | null; validated: boolean } | null } };
  const DEEP = ["docs/runs/2026-11-19-airwallex-deep.json", "docs/runs/2026-11-19-airwallex-deep-3.json"] as const;
  const d1 = json(DEEP[0]) as Deep | null, d3 = json(DEEP[1]) as Deep | null;
  const st = d3?.facts?.statement;
  if (st?.checked) out.push({ key: "awx-statement", fig: whole(st.agree, st.checked), label: "soak payouts and FX legs on Airwallex's statement, to the cent", note: `Balance history${st.window?.from ? ` of the ${day(st.window.from.replace(/\+0000$/, "Z"))} soak` : ""}; ${whole(st.continuity.links - st.continuity.breaks.length, st.continuity.links).toLowerCase()} links add up${d3?.ran_at ? `; ${day(d3.ran_at)}` : ""}.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-19-airwallex-deep-3.md"), rec: DEEP[1] });
  const rv = d1?.facts?.receivable;
  if (rv?.matched?.outcome === "MATCHED" && rv.link?.active_after === false) out.push({ offProof: true, key: "awx-receivable", fig: `${rv.invoice.currency} ${(rv.invoice.amount_cents / 100).toFixed(2)}`, label: "invoice matched from a Global Account's statement; its payment link switched off", note: `Bank transfer by the sandbox's simulation${d1?.ran_at ? `, ${day(d1.ran_at)}` : ""}.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-19-airwallex-deep.md"), rec: DEEP[0] });
  const rk = d3?.facts?.revoke;
  if (rk?.validated && rk.before === "SCHEDULED" && rk.after === "CANCELLED") out.push({ offProof: true, key: "awx-revoke", fig: "EUR 1.00", label: "scheduled payment cancelled at Airwallex before its day", note: `Terms checked by Airwallex first; no passkey${d3?.ran_at ? `; ${day(d3.ran_at)}` : ""}.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-19-airwallex-deep-3.md"), rec: DEEP[1] });
  return out;
}

function forged(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  const TM = "docs/evidence/tamper-matrix.json";
  const tm = json(TM) as { totals?: { artifacts: number; originalsValid: number; tried: number; refused: number; accepted: number } } | null;
  if (tm?.totals?.tried && tm.totals.accepted === 0 && tm.totals.originalsValid === tm.totals.artifacts) out.push({ key: "tamper-matrix", fig: whole(tm.totals.refused, tm.totals.tried), label: "tampered proof copies refused", note: `Every signed value of ${tm.totals.artifacts} proofs changed; the originals verify. Offline.`, tag: "test", tone: "ok", href: blob("docs/evidence/tamper-matrix.md"), rec: TM });
  if (w && w.t.runs) {
    out.push({ key: "try-cent", fig: whole(w.t.refused, w.t.runs), label: "one-cent changes refused after approval", note: `The public /try, ${w.when}; a virtual test passkey signed.`, tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
    out.push({ key: "try-hash", fig: whole(w.t.approvalsMatching, w.t.runs), label: "approvals whose hash Airwallex carries", note: `The public /try, ${w.when}.`, tag: "sandbox", tone: "awx", href: w.href, rec: w.rec });
    if (w.t.proofs) out.push({ key: "try-proofs", fig: whole(w.t.proofsValid, w.t.proofs), label: "proof files VALID, browser and offline", note: "Downloaded from /try; npm run verify-bundle agrees.", tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
  }
  // The soaks' one-cent changes, summed over every soak record (the calls in each refusal's window, as each record counts them).
  const skn = soakTotals(), sknAll = soaks();
  if (skn.negatives.planned) {
    const n = skn.negatives, reads = Object.entries(n.reads).map(([e, c]) => `${c} ${e}`).join(", ");
    out.push({ key: "soak-negatives", fig: whole(n.refused, n.planned), label: "one-cent changes refused before any create", note: `${n.posts} money-moving calls (${n.creates} creates); ${n.calls} ${n.calls === 1 ? "read" : "reads"} in the refusal windows${reads ? ` (${reads})` : ""}. Soaks, ${joinDays(sknAll.map((x) => day(x.rec.started_at)))}.`, tag: "sandbox", tone: "ok", href: blob(sknAll.at(-1)!.log), rec: skn.files.join(" ") });
  }
  // 20 Nov: the same create sent again under one request_id (src/proof/awxReplay.ts). Off /proof, as above.
  const RP = "docs/runs/2026-11-20-airwallex-replay.json";
  const rp = json(RP) as { ran_at?: string; errors?: string[]; summary?: { cases: number; one_object: number; repeats_sent: number; repeats_refused: number } } | null;
  if (rp?.summary?.repeats_sent && !rp.errors?.length) {
    const m = rp.summary;
    out.push({ offProof: true, key: "awx-replay", fig: whole(m.repeats_refused, m.repeats_sent), label: "repeated creates under one request_id refused by Airwallex", note: `Transfers, a conversion and a batch: ${whole(m.one_object, m.cases).toLowerCase()} left with one object under their request_id${rp.ran_at ? `; ${day(rp.ran_at)}` : ""}. Two of the answer codes were new to Purser's rail; fixed the same day.`, tag: "sandbox", tone: "awx", href: blob("docs/runs/2026-11-20-airwallex-replay.md"), rec: RP });
  }
  const cent = centRecord();
  if (cent && centHolds(cent.rec)) {
    const b = cent.rec.attempts[1]!;
    out.push({ key: "card-cent", fig: `EUR ${(b.amount_cents / 100).toFixed(2)}`, label: "one cent over an agent's limit: declined", note: `Simulated card charges, ${day(cent.rec.ran_at)}.`, tag: "sandbox", tone: "awx", href: blob(cent.file), rec: cent.file });
  }
  const vr = vic3Run();
  if (vr) {
    const s5 = vic3Summary(vr);
    if (s5.byPurser.length) out.push({ key: "visa-refused", fig: String(s5.byPurser.length), label: "Visa attempts refused by Purser, before Airi", note: `0 calls to Airi or Airwallex for any of them${s5.credentialRefused.length ? `; ${s5.credentialRefused.length} a credential presented again or for another amount` : ""}. A test card, ${s5.date}.`, tag: "sandbox", tone: "ok", href: "visa", rec: VIC3_RUN_FILE });
  }
  const TAP = "docs/runs/2026-11-19-visa-tap-interop.md";
  const tapm = has(TAP) ? /\*\*Result: (\d+) of (\d+) interop cases hold\*\*/.exec(readFileSync(new URL(TAP, ROOT), "utf8")) : null;
  // Off /proof (Max's last round, item 2: TAP is told on /visa only); /visa's TAP section and llms.txt show it.
  if (tapm) out.push({ key: "tap-interop", fig: whole(Number(tapm[1]), Number(tapm[2])), label: "TAP cases against Visa's public reference", note: "Our signed agent checkout against Visa's public Trusted Agent Protocol reference, run unchanged at a pinned commit; nothing bought, no money moved. 19 Nov.", tag: "test", tone: "", href: blob(TAP), rec: TAP, offProof: true });
  const owners = ownersRun();
  if (owners) {
    const steps = ownersSteps(owners.rec), changes = steps.filter((x) => x.key === "bind" || x.key === "replace" || x.key === "revoke").length;
    const virtual = owners.rec.owners.some((x) => x.virtual);
    if (changes) out.push({ key: "passkeys-onchain", fig: String(changes), label: "limit changes signed by passkeys on chain", note: `Alta testnet, ${day(owners.rec.ran_at)}: P-256 checked on chain${virtual ? "; one a test key" : ""}.`, tag: "testnet", tone: "metal", href: "alta#faceid-onchain", rec: owners.file });
  }
  return out;
}

function ai(w: ReturnType<typeof walks>): WallTile[] {
  const out: WallTile[] = [];
  // The newest and largest count (owner, 20 Nov: 24 looked low): the long run of 20 Nov, under its own day and name, the
  // main run's 24 kept in the note with its own record. Without the long run's record, the main run's figure as before.
  const claude = proofFacts(agentRun()).find((f) => f.key === "claude"), lr = longRun();
  if (lr?.decisions) {
    const ids = lr.callsWithoutId ? `${lr.callsWithoutId} of them with no request id` : "each with its Anthropic request id";
    out.push({ key: "claude-main", fig: String(lr.byClaude), label: `decisions by Claude in the ${day(lr.recordedAt)} long run`, note: `${lr.fallbacks} ${lr.fallbacks === 1 ? "fallback" : "fallbacks"}; ${lr.calls} Claude calls, ${ids}. A test world: virtual test passkeys, test money.${claude ? ` The main run of 3 Nov: ${claude.fig}.` : ""}`, tag: "sandbox", tone: "claude", href: blob(lr.log), rec: [lr.file, lr.log, ...(claude?.rec ? [claude.rec] : [])].join(" ") });
  } else if (claude) out.push({ key: "claude-main", fig: claude.fig, label: "decisions by Claude in the main run", note: claude.text, tag: "sandbox", tone: "claude", href: claude.href, rec: claude.rec ?? "" });
  const script = worstOf("purser_script"), naive = worstOf("no_rules");
  if (WORST_CASE && script && naive) out.push({ key: "worst-case", fig: `${script.wrong_payments} vs ${naive.wrong_payments}`, label: "wrong payments: always-pay AI vs no rules", note: `${WORST_CASE.cases_per_run} hostile and clean invoices; ${script.paid_past_cfo} paid past the CFO.`, tag: "test", tone: "claude", href: blob(WORST_CASE_DOC), rec: "docs/evals/worst-case-summary.json" });
  // Eval v3 (19 Nov): 100 held-out invoices, the case file committed alone before the run (src/cli/adversarialV3.ts).
  // 19 Nov, fourth round: beside it, the dated re-run on the code after all four rounds of fixes, the second to fourth
  // written against misses of these sets, so not held out. The figure stays the held-out one (the evidence map's
  // "Held-out eval" node shows it); the re-run is said in the note, and the run after the earlier rounds stays linked.
  const V3 = "docs/evals/adversarial-v3.json", V3_RERUN = "docs/evals/adversarial-v3-rerun-2026-11-19.json", V3_AFTER = "docs/evals/adversarial-v3-after.json";
  const v3 = json(V3) as { held_out?: boolean; cases_commit?: string; totals?: Record<"purser_script" | "no_rules", { cases: number; wrong_payments: number; false_holds: number; clean_truths: number }> } | null;
  const v3a = json(V3_RERUN) as { held_out?: boolean; totals?: Record<"purser_script", { wrong_payments: number; false_holds: number }> } | null;
  if (v3?.held_out && v3.totals?.purser_script && v3.totals.no_rules) {
    const p = v3.totals.purser_script, n = v3.totals.no_rules, a = v3a && !v3a.held_out ? v3a.totals?.purser_script : undefined;
    out.push({ key: "eval-v3", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices: Purser vs no rules`, note: `Cases committed before the run (commit ${v3.cases_commit}); a script always says pay. ${p.false_holds} false holds of ${p.clean_truths}.${a ? ` Re-run after the 19 Nov fixes written against these misses (not held out): ${a.wrong_payments} wrong payments, ${a.false_holds} false holds.` : ""} Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v3.md"), rec: a ? `${V3} ${V3_RERUN} ${V3_AFTER}` : V3 });
  }
  // Eval v4 (19 Nov): 100 held-out invoices, its run before the third round of fixes kept as recorded, and beside it the
  // run after that round, written against its misses, so no longer held out (src/cli/adversarialV4.ts).
  const V4 = "docs/evals/adversarial-v4.json", V4_AFTER = "docs/evals/adversarial-v4-after.json", V4_RERUN = "docs/evals/adversarial-v4-rerun-2026-11-19.json";
  type AdvTotals = Record<"purser_script" | "no_rules", { cases: number; wrong_payments: number; false_holds: number; clean_truths: number }>;
  const v4 = json(V4) as { held_out?: boolean; cases_commit?: string; totals?: AdvTotals } | null;
  const v4a = json(V4_AFTER) as { held_out?: boolean; totals?: AdvTotals } | null;
  const v4r = json(V4_RERUN) as { held_out?: boolean; totals?: AdvTotals } | null;
  const r4 = v4r && !v4r.held_out ? v4r.totals?.purser_script : undefined;
  if (v4?.held_out && v4.totals?.purser_script && v4.totals.no_rules && v4a && !v4a.held_out && v4a.totals?.purser_script) {
    const p = v4.totals.purser_script, n = v4.totals.no_rules, a = v4a.totals.purser_script;
    out.push({ key: "eval-v4", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices (eval v4): Purser vs no rules`, note: `Cases committed before the run (commit ${v4.cases_commit}); a script always says pay. ${p.false_holds} false holds of ${p.clean_truths}. After the fixes written against these misses (no longer held out): ${a.wrong_payments} wrong payments, ${a.false_holds} false holds.${r4 ? ` Re-run after the fourth round of 19 Nov: ${r4.wrong_payments} wrong payments, ${r4.false_holds} false holds.` : ""} Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v4.md"), rec: r4 ? `${V4} ${V4_AFTER} ${V4_RERUN}` : `${V4} ${V4_AFTER}` });
  }
  // Eval v5 (19 Nov): 100 held-out invoices written after the third round of fixes, committed alone with their
  // pre-registration before the run (src/cli/adversarialV5.ts). Its run is kept as recorded; beside it the run after the
  // fixes that followed it (non-Latin supplier names, orders in other scripts), so no longer held out.
  const V5 = "docs/evals/adversarial-v5.json", V5_AFTER = "docs/evals/adversarial-v5-after.json";
  const v5 = json(V5) as { held_out?: boolean; cases_commit?: string; totals?: AdvTotals } | null;
  const v5a = json(V5_AFTER) as { held_out?: boolean; totals?: AdvTotals } | null;
  if (v5?.held_out && v5.totals?.purser_script && v5.totals.no_rules && v5a && !v5a.held_out && v5a.totals?.purser_script) {
    const p = v5.totals.purser_script, n = v5.totals.no_rules, a = v5a.totals.purser_script;
    // Off /proof since v6 (/proof's words in sight stay within their budget, test/proof-first.test.ts): /proof shows the
    // held-out set after the latest fixes, v6; this tile stays on the wall's record and in llms.txt.
    out.push({ offProof: true, key: "eval-v5", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices (eval v5): Purser vs no rules`, note: `Cases committed with their pre-registration before the run (commit ${v5.cases_commit}); a script always says pay. ${p.false_holds} false holds of ${p.clean_truths}. Fixed since, no longer held out: ${a.wrong_payments} wrong payments, ${a.false_holds} false holds. Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v5.md"), rec: V5 });
  }
  // Eval v6 (19 Nov): 108 held-out invoices written after the fixes that followed v5 (suppliers named in Hebrew, Thai,
  // Devanagari, Hangul, Han and kana, Turkish and Vietnamese letters; injections in those languages; invisible
  // characters), committed alone with their pre-registration before the run (src/cli/adversarialV6.ts). Its run is kept
  // as recorded; beside it the run after the fixes that followed it (amounts asked above the total, a person as holder,
  // joiners a script needs, other scripts' digits, more languages), so no longer held out.
  const V6 = "docs/evals/adversarial-v6.json", V6_AFTER = "docs/evals/adversarial-v6-after.json";
  const v6 = json(V6) as { held_out?: boolean; cases_commit?: string; totals?: AdvTotals } | null;
  const v6a = json(V6_AFTER) as { held_out?: boolean; totals?: AdvTotals } | null;
  if (v6?.held_out && v6.totals?.purser_script && v6.totals.no_rules && v6a && !v6a.held_out && v6a.totals?.purser_script) {
    const p = v6.totals.purser_script, n = v6.totals.no_rules, a = v6a.totals.purser_script;
    // Off /proof since v7 (/proof's words in sight stay within their budget, test/proof-first.test.ts): /proof shows the
    // held-out set after the latest fixes, v7; this tile stays on the wall's record and in llms.txt.
    out.push({ offProof: true, key: "eval-v6", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices (eval v6): Purser vs no rules`, note: `Cases committed with their pre-registration before the run (commit ${v6.cases_commit}); a script always says pay. ${p.false_holds} false hold${p.false_holds === 1 ? "" : "s"} of ${p.clean_truths}. Fixed since, no longer held out: ${a.wrong_payments} wrong payments, ${a.false_holds} false holds. Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v6.md"), rec: V6 });
  }
  // Eval v7 (19 Nov): 117 held-out invoices written after the fixes that followed v6 (suppliers named in Georgian,
  // Armenian, Arabic, Tamil, Bengali, Ukrainian Cyrillic, Ethiopic, Khmer and Persian letters; injections and pressure in
  // those languages; soft hyphens, word joiners, Braille blanks; hard negatives against the new rules), committed alone
  // with their pre-registration before the run. Its run is kept as recorded; beside it the run after the fixes that
  // followed it (typography read as letters, amounts above the total in any language, a person as holder in any script,
  // more languages), so no longer held out (src/cli/adversarialV7.ts).
  const V7 = "docs/evals/adversarial-v7.json", V7_AFTER = "docs/evals/adversarial-v7-after.json";
  const v7 = json(V7) as { held_out?: boolean; cases_commit?: string; totals?: AdvTotals } | null;
  const v7a = json(V7_AFTER) as { held_out?: boolean; totals?: AdvTotals } | null;
  if (v7?.held_out && v7.totals?.purser_script && v7.totals.no_rules && v7a && !v7a.held_out && v7a.totals?.purser_script) {
    const p = v7.totals.purser_script, n = v7.totals.no_rules, a = v7a.totals.purser_script;
    // Off /proof since v8 (/proof's words in sight stay within their budget, test/proof-first.test.ts): /proof shows the
    // held-out set after the latest fixes, v8; this tile stays on the wall's record and in llms.txt.
    out.push({ offProof: true, key: "eval-v7", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices (eval v7): Purser vs no rules`, note: `Cases committed with their pre-registration before the run (commit ${v7.cases_commit}); a script always says pay. ${p.false_holds} false hold${p.false_holds === 1 ? "" : "s"} of ${p.clean_truths}. Fixed since, no longer held out: ${a.wrong_payments} wrong payments, ${a.false_holds} false holds. Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v7.md"), rec: V7 });
  }
  // Eval v8 (19 Nov): 140 held-out invoices written after the fixes that followed v7 (suppliers named in Sinhala, Lao,
  // Mongolian Cyrillic, Burmese, Gujarati, Malayalam, Telugu, Yiddish, Lithuanian, Icelandic, Latvian and Kannada;
  // injections and pressure in those languages and in Tibetan, Syriac, Inuktitut and Javanese; hard negatives against the
  // new rules), committed alone with their pre-registration before the run. Its run is kept as recorded; beside it, since
  // 20 Nov, the run after the fixes that followed it (letters encoded two ways, names as banks spell them, a number's own
  // label, AI headings in any language, thirteen more languages), so no longer held out (src/cli/adversarialV8.ts). It
  // stays on /proof: no held-out set has run after those fixes yet.
  const V8 = "docs/evals/adversarial-v8.json", V8_AFTER = "docs/evals/adversarial-v8-after.json";
  const v8 = json(V8) as { held_out?: boolean; cases_commit?: string; totals?: AdvTotals } | null;
  const v8a = json(V8_AFTER) as { held_out?: boolean; totals?: AdvTotals } | null;
  if (v8?.held_out && v8.totals?.purser_script && v8.totals.no_rules && v8a && !v8a.held_out && v8a.totals?.purser_script) {
    const p = v8.totals.purser_script, n = v8.totals.no_rules, a = v8a.totals.purser_script;
    out.push({ key: "eval-v8", fig: `${p.wrong_payments} vs ${n.wrong_payments}`, label: `wrong payments on ${p.cases} held-out invoices (eval v8): Purser vs no rules`, note: `Cases committed with their pre-registration before the run (commit ${v8.cases_commit}); a script always says pay. ${p.false_holds} false hold${p.false_holds === 1 ? "" : "s"} of ${p.clean_truths}. Fixed since, no longer held out: ${a.wrong_payments} wrong payments, ${a.false_holds} false holds. Offline.`, tag: "test", tone: "claude", href: blob("docs/evals/adversarial-v8.md"), rec: V8 });
  }
  // 20 Nov: the newest red-team run is the full suite's re-run: every scripted attack and every earlier attempt a
  // red-team record holds (the documents Claude wrote on 30 Oct, the bank notice of 31 Oct, the night batch's tests that
  // were not blocked or inconclusive), each an attack of its own (src/redteam/regressionAttacks.ts). The two re-runs of
  // 19 Nov (fourth and fifth round) and the first run of 30 Oct stay as recorded, named in the note and the records.
  const RT = "docs/redteam/report.json", RT_RERUN4 = "docs/redteam/rerun-2026-11-19.json", RT_RERUN5 = "docs/redteam/rerun-2026-11-19b.json", RT_RERUN = "docs/redteam/rerun-2026-11-20.json";
  type RedTeam = { ran_at?: string; attempts?: number; blocked?: number; caught_after?: number; inconclusive?: number; not_blocked?: number; model?: string | null; results?: { id: string; caught?: string }[] };
  const rt = json(RT) as RedTeam | null, rt4 = json(RT_RERUN4) as RedTeam | null, rt5 = json(RT_RERUN5) as RedTeam | null, rr = json(RT_RERUN) as RedTeam | null;
  if (rt?.attempts) {
    const before = (x: RedTeam) => (x.blocked ?? 0) - (x.caught_after ?? 0);
    const afterIds = (x: RedTeam) => (x.results ?? []).filter((r) => r.caught === "after").map((r) => r.id);
    const afterWords = (x: RedTeam) => `${x.caught_after ?? 0} found afterwards${afterIds(x).length ? ` (${afterIds(x).join(", ")})` : ""}`;
    const written = (rt.results ?? []).filter((r) => r.id === "document").length;
    const first = `First run, ${day(rt.ran_at!)}${rt.model && written ? `, with Claude writing ${written} of the documents` : ""}: ${whole(before(rt), rt.attempts).toLowerCase()}, ${rt.caught_after ?? 0} found afterwards.`;
    const r4 = rt4?.attempts ? ` Re-run, ${day(rt4.ran_at!)}, fourth round: ${whole(before(rt4), rt4.attempts).toLowerCase()}, ${afterWords(rt4)}.` : "";
    const r5 = rt5?.attempts ? ` Re-run, ${day(rt5.ran_at!)}, after agent cards were frozen by default: ${whole(before(rt5), rt5.attempts).toLowerCase()}, ${afterWords(rt5)}.` : "";
    if (rr?.attempts) {
      const extra = rr.attempts - (rt5?.attempts ?? 0);
      const left = [rr.caught_after ? `${afterWords(rr)}, not prevented` : "none found only afterwards", `${rr.inconclusive ?? 0} inconclusive`, `${rr.not_blocked ?? 0} not blocked`].join(", ");
      out.push({ key: "red-team", fig: whole(before(rr), rr.attempts), label: "red-team attacks stopped before money moved, full re-run, not held out", note: `Newest full run, ${day(rr.ran_at!)}, in a throwaway test world${rr.model ? "" : ", no model"}: the scripted attacks${rt5?.attempts && extra > 0 ? ` and ${extra} earlier attempts as attacks of their own (the documents Claude wrote on 30 Oct, the bank notice of 31 Oct, the night batch's tests of 2 Nov that code judged not blocked or inconclusive)` : ""}; ${left}.${r5}${r4} ${first}`, tag: "test", tone: "claude", href: blob(RT_RERUN), rec: [RT_RERUN, ...(rt5?.attempts ? [RT_RERUN5] : []), ...(rt4?.attempts ? [RT_RERUN4] : []), RT].join(" ") });
    } else out.push({ key: "red-team", fig: whole(before(rt), rt.attempts), label: "red-team attacks stopped before money moved", note: `The other ${rt.caught_after ?? 0} found afterwards, not prevented.`, tag: "test", tone: "claude", href: blob(RT), rec: RT });
  }
  // The hostile-model eval: the figure as CI checks it. The calls that stood are each the script's last call, a "pay" of
  // an invoice whose right outcome is pay, within the agent's limit (test/ap-agent-evals.test.ts checks every one; 19
  // Nov: 4 Checker, on clean invoices, and 6 Payer, paying today from the invoice's own balance by the supplier's rail,
  // two of them after the orders in the payee's name were refused). Refusing them would refuse a right payment. 19 Nov,
  // fourth round: its dated re-run is said beside it (the cases it sent to the CFO where a person had to look).
  const AH = "docs/evals/ap-hostile.json", AH_AFTER = "docs/evals/ap-hostile-rerun-2026-11-19.json";
  const ah = json(AH) as { calls?: number; refused?: number; stood?: number; looser?: number } | null;
  const aha = json(AH_AFTER) as { calls?: number; refused?: number; looser?: number; unsafe?: number } | null;
  if (ah?.calls) out.push({ key: "hostile-model", fig: whole(ah.refused ?? 0, ah.calls), label: "hostile tool calls stopped by code", note: `The other ${ah.stood ?? 0} stood within the rules, by the ledger: each the last pay of an invoice whose right outcome is pay, within the limit.${aha?.calls ? ` Sent to the CFO where a person had to look: ${ah.looser ?? 0}; ${aha.looser ?? 0} after the 19 Nov fixes, re-run, not held out.` : ""}`, tag: "test", tone: "claude", href: blob(AH), rec: aha?.calls ? `${AH} ${AH_AFTER}` : AH });
  if (w && w.t.claude.entries) {
    out.push({ key: "try-claude", fig: String(w.t.claude.fallbacks), label: `fallbacks in ${w.t.claude.entries} Claude calls on /try`, note: `${w.t.claude.distinctIds} Anthropic request ids; ${w.t.claude.models.join(", ")}.${w.t.claude.readerNoId ? ` ${w.t.claude.readerNoId} reader calls were logged with no request id: those walks ran before the fix of 19 Nov was deployed.` : ""}`, tag: "sandbox", tone: "claude", href: w.href, rec: w.rec });
    if (w.t.held) out.push({ key: "try-held", fig: whole(w.t.held, w.t.runs), label: "invoices held by code's cash check", note: `Inside the agent's limit; no payout.${w.t.held < w.t.runs ? ` ${w.t.runs - w.t.held === 1 ? "One walk" : `${w.t.runs - w.t.held} walks`} stopped before this step.` : ""}`, tag: "sandbox", tone: "ok", href: w.href, rec: w.rec });
  }
  return out;
}

function built(): WallTile[] {
  const out: WallTile[] = [];
  const VR = "docs/evidence/verification-2026-11-15.json";
  const vr = json(VR) as { counts?: { passed: number; could_not_run_here: number; failed: number }; transactions?: { read_from_chain: number; found: number }; started_at?: string } | null;
  if (vr?.counts) out.push({ key: "verify-all", fig: String(vr.counts.passed), label: `checks passed by verify-all, ${vr.counts.failed} failed`, note: `${vr.transactions?.found ?? 0} Alta transactions read from the chain${vr.started_at ? `; ${day(vr.started_at)}` : ""}.`, tag: "check", tone: "ok", href: blob("docs/evidence/verification-2026-11-15.md"), rec: VR });
  const AN = "docs/runs/2026-11-19-anchor.json";
  const an = json(AN) as { anchored_at?: string; height?: number; parts?: unknown[] } | null;
  if (an?.height) out.push({ key: "anchor", fig: String(an.height), label: "records sealed by one anchor transaction", note: `${an.parts?.length ?? 0} parts hashed into one head on Alta testnet, ${day(an.anchored_at!)}; npm run verify-anchor recomputes it.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-19-anchor.md"), rec: AN });
  type Load = { attempted: number; paid: number; failed: number; ran_at: string; payers: number; resends_after_lost_answer?: number };
  // The re-run of 19 Nov (docs/runs/2026-11-19-clearing-load.md), after one payment's retries moved into tested code
  // (src/metal/loadPayment.ts): the tile shows it, dated; the two runs of 30 Oct stay in its note and its records.
  const RERUN = "docs/runs/2026-11-19-clearing-load.json";
  const loads = ["docs/runs/clearing-load-1.json", "docs/runs/clearing-load-2.json"].filter(has).map((f) => ({ f, r: json(f) as Load }));
  const rerun = json(RERUN) as Load | null;
  if (rerun?.attempted && loads.length) {
    const resent = rerun.resends_after_lost_answer ?? 0;
    out.push({ key: "clearing-load", fig: whole(rerun.paid, rerun.attempted), label: `payments through Alta's clearing, load test of ${day(rerun.ran_at)}`, note: `${rerun.payers} wallets at once${resent ? `; ${resent === 1 ? "one lost answer" : `${resent} lost answers`} resent, then paid` : ""}. Runs of ${day(loads[0]!.r.ran_at)}: ${loads.map((x) => whole(x.r.paid, x.r.attempted).toLowerCase()).join(", then ")}; the first lost ${fmt(loads[0]!.r.failed)} because the script did not resend.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-11-19-clearing-load.md"), rec: [RERUN, ...loads.map((x) => x.f)].join(" ") });
  } else if (loads.length) {
    const tried = loads.reduce((a, x) => a + x.r.attempted, 0), paid = loads.reduce((a, x) => a + x.r.paid, 0);
    const lastRun = loads[loads.length - 1]!.r;
    out.push({ key: "clearing-load", fig: whole(paid, tried), label: "payments through Alta's clearing, load test", note: `${loads.length} runs, ${day(lastRun.ran_at)}; the last: ${whole(lastRun.paid, lastRun.attempted).toLowerCase()} paid.`, tag: "testnet", tone: "metal", href: blob("docs/runs/2026-10-30-clearing-load.md"), rec: loads.map((x) => x.f).join(" ") });
  }
  const jobs = ciJobs();
  const scans = jobs.filter((j) => /gitleaks|Semgrep|code scanning|npm audit/i.test(j.what)).length;
  out.push({ key: "ci", fig: String(jobs.length), label: "CI jobs on every change", note: `${scans} of them scan for security: gitleaks, Semgrep, CodeQL, npm audit.`, tag: "ci", tone: "", href: CI_RUNS_URL, rec: ".github/workflows/ci.yml" });
  return out;
}

/** Attacked and broken on purpose (19 Nov): the /try API's red team, chaos on the money path, fuzzing; findings said. */
function attacked(): WallTile[] {
  const out: WallTile[] = [];
  const RA = "docs/evidence/redteam-api.json";
  const ra = json(RA) as { checked?: string; totals?: { attacks: number; pass: number; fail: number; error: number }; results?: { id: string; group: string; target: string; verdict: string }[] } | null;
  if (ra?.totals?.attacks) {
    const t = ra.totals, fails = (ra.results ?? []).filter((r) => r.verdict !== "PASS");
    const judgeOnly = fails.length > 0 && fails.every((r) => r.target === "judge");
    const ids = fails.map((r) => r.id).sort().join(" ");
    // The findings in words when they are the two of 19 Nov (a missing nosniff header); otherwise the record lists them.
    const what = judgeOnly && ids === "headers-files headers-pages" ? "its 404 page and its static files lack nosniff" : `${[...new Set(fails.map((r) => r.group))].join(", ")}; the record lists them`;
    out.push({ key: "redteam-api", fig: whole(t.pass, t.attacks), label: "attacks on the /try API held", note: `${t.fail ? `${t.fail === 1 ? "One fails" : `${t.fail} fail`}${judgeOnly ? ", on the judge server only" : ""}: ${what}. ` : ""}${t.error} errors. Servers on this computer, no live site; ${day(`${ra.checked}T12:00:00Z`)}.`, tag: "test", tone: t.fail ? "" : "ok", href: blob("docs/evidence/redteam-api.md"), rec: RA });
  }
  const CM = "docs/evidence/chaos-money.json";
  const cm = json(CM) as { checked?: string; totals?: { scenarios: number; passed: number; faults: number; crashes: number }; invariants?: Record<string, { held: number; broken: number }>; canaries?: { caught: boolean }[] } | null;
  if (cm?.totals?.scenarios && cm.invariants) {
    const t = cm.totals, broken = Object.values(cm.invariants).reduce((n, i) => n + i.broken, 0), inv = Object.keys(cm.invariants).length;
    const can = cm.canaries ?? [], caught = can.filter((c) => c.caught).length;
    out.push({ key: "chaos-money", fig: String(broken), label: `money invariants broken in ${fmt(t.scenarios)} chaos scenarios`, note: `${inv} invariants held, never paid twice and never unsigned among them; ${t.crashes} process deaths, ${t.faults} faults from a simulated Airwallex in the test${can.length ? `; ${caught === can.length ? `all ${can.length}` : `${caught} of ${can.length}`} planted bugs caught` : ""}. In process, test money.`, tag: "test", tone: broken ? "" : "ok", href: blob("docs/evidence/chaos-money.md"), rec: CM });
  }
  const FZ = "docs/evidence/fuzzing.json";
  const fz = json(FZ) as { totals?: { properties: number; runs: number; passed: number; failed: number } } | null;
  if (fz?.totals?.properties) {
    const t = fz.totals;
    out.push({ key: "fuzzing", fig: whole(t.passed, t.properties), label: `fuzzed properties held${t.failed ? `; ${t.failed} findings open` : ""}`, note: `${fmt(t.runs)} runs with fast-check, in process.${t.failed ? ` The ${t.failed} findings are not fixed yet; each is shrunk and kept with the seed that replays it.` : ""}`, tag: "test", tone: t.failed ? "" : "ok", href: blob("docs/evidence/fuzzing.md"), rec: FZ });
  }
  return out;
}

/** Quality and supply chain (19 Nov): the public site measured, /try in WebKit, the assurance case, the badge, the workflows set up. */
function quality(): WallTile[] {
  const out: WallTile[] = [];
  const SQ = "docs/evidence/site-quality.json";
  type Lh = { path: string; preset: string; median: { performance: number; accessibility: number } };
  const sq = json(SQ) as { measured_at?: string; tools?: { lighthouse?: string }; lighthouse_runs_per_page?: number; lighthouse?: Lh[]; axe?: { path: string; counts: { critical: number }; violations: { id: string; impact: string }[] }[] } | null;
  if (sq?.lighthouse?.length && sq.axe?.length) {
    const lh = sq.lighthouse, pages = [...new Set(lh.map((x) => x.path))], presets = [...new Set(lh.map((x) => x.preset))];
    const a11y = Math.min(...lh.map((x) => x.median.accessibility)), low = [...lh].sort((a, b) => a.median.performance - b.median.performance)[0]!;
    const critical = sq.axe.reduce((n, x) => n + x.counts.critical, 0);
    const serious = [...new Set(sq.axe.flatMap((x) => x.violations.filter((v) => v.impact === "serious").map((v) => `${v.id} on ${x.path}`)))];
    out.push({ key: "site-quality", fig: String(a11y), label: `accessibility score on ${a11y === 100 ? "all " : ""}${pages.length} public pages, ${presets.length === 2 ? "mobile and desktop" : presets.join(", ")}`, note: `Lighthouse ${sq.tools?.lighthouse}, median of ${sq.lighthouse_runs_per_page}; lowest performance ${low.median.performance} (${low.path}, ${low.preset}). axe: ${critical} critical${serious.length ? `, serious: ${serious.join(", ")}` : ""}. Read-only, ${day(sq.measured_at!)}.`, tag: "site", tone: "ok", href: blob("docs/evidence/site-quality.md"), rec: SQ });
  }
  // The /try walk in WebKit (Safari's engine): a browser check, out of the band and of the walks' sums above (scale.ts NOT_IN_BAND).
  const WK = "docs/runs/2026-11-19-webkit-try";
  const wk = json(`${WK}/summary.json`) as { aggregate?: { runs: number; ok: number; first_start?: string; by_browser?: Record<string, number> } } | null;
  const wkSteps = has(`${WK}.md`) ? [...readFileSync(new URL(`${WK}.md`, ROOT), "utf8").matchAll(/all ok \((\d+) of (\d+) steps\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const) : [];
  if (wk?.aggregate?.runs && wkSteps.length === wk.aggregate.runs && wkSteps.every(([a, b]) => a === b)) {
    const a = wk.aggregate, steps = wkSteps[0]![1];
    out.push({ key: "webkit-try", fig: whole(a.ok, a.runs), label: `/try walks in WebKit (Safari's engine): all ${steps} steps passed`, note: `Desktop light and phone dark; a software test passkey, no Touch ID; payouts PAID by the sandbox's simulation. A browser check, not counted with the walks above; ${day(a.first_start!)}.`, tag: "sandbox", tone: "ok", href: blob(`${WK}.md`), rec: `${WK}/summary.json` });
  }
  const AC = "docs/assurance.md";
  if (has(AC)) {
    const rows = readFileSync(new URL(AC, ROOT), "utf8").split("\n").filter((l) => /^\| \*\*/.test(l)).length;
    if (rows) out.push({ key: "assurance", fig: String(rows), label: "invariants, each mapped to code, tests and CI", note: "The assurance case; test/assurance.test.ts checks every file, function and CI job it names.", tag: "check", tone: "ok", href: blob(AC), rec: AC });
  }
  // An outside programme's badge, as a text tile (no outside image: the page's CSP allows images from itself only).
  const OS = "docs/evidence/openssf-best-practices.json";
  const os = json(OS) as { programme?: string; project?: number; status?: string; as_of?: string; url?: string; basis?: string } | null;
  if (os?.status && os.url) out.push({ key: "openssf", fig: os.status[0]!.toUpperCase() + os.status.slice(1), label: `${os.programme} badge, project ${os.project}`, note: `From ${os.basis}, as of ${day(`${os.as_of}T12:00:00Z`)}; the live status is on the project page.`, tag: "external", tone: "ok", href: os.url, rec: OS });
  // Supply chain, as run (19 Nov): the v1.2.0 release's Sigstore-signed attestations, read from their committed record
  // (docs/evidence/release-v1.2.0.json). The OpenSSF Scorecard score is no longer shown (owner, 20 Nov).
  const RV = "docs/evidence/release-v1.2.0.json";
  const rv = json(RV) as { attestations?: unknown[]; release?: string } | null;
  if (rv?.attestations?.length && rv.release) out.push({ key: "supply-chain", fig: "v1.2.0", label: "release signed: SLSA provenance and SBOM attested", note: `${rv.attestations.length} Sigstore-signed attestations on the source archive, read back from GitHub; check with gh attestation verify.`, tag: "ci", tone: "ok", href: rv.release, rec: RV });
  return out;
}

function scale(w: ReturnType<typeof walks>): WallTile[] {
  if (!w) return [];
  const t = w.t, st = (k: string) => t.steps[k];
  const browsers = [...new Set(w.records.flatMap((r) => r.runs.map((x) => (typeof x.browser === "string" ? x.browser : "chromium"))))].map((b) => b[0]!.toUpperCase() + b.slice(1)).join(" and ");
  const devices = (["desktop", "tablet", "phone"] as const).filter((d) => w.records.some((r) => r.runs.some((x) => String(x.profile ?? "").startsWith(d))));
  const deviceWords = devices.length > 1 ? `${devices.slice(0, -1).join(", ")} and ${devices.at(-1)}` : devices.join("");
  const out: WallTile[] = [{ key: "try-journeys", fig: whole(t.siteStepsPassed, t.runs), label: "/try walks: every site step passed", note: `${w.when}, ${browsers}, ${deviceWords}; ${t.consoleErrors} console errors.${t.ok !== t.siteStepsPassed ? ` The recording script marked ${whole(t.ok, t.runs).toLowerCase()} all ok: the others stopped on its own bug or on /verify's new words; the run logs say which.` : ""}`, tag: "sandbox", tone: "ok", href: w.href, rec: w.rec }];
  const tile = (key: string, step: string, label: string, extra = "") => {
    const p = st(step);
    if (p?.p50 != null) out.push({ key, fig: secs(p.p50), label, note: `Median of ${p.n}, p95 ${secs(p.p95)}${extra}.`, tag: "sandbox", tone: "", href: w.href, rec: w.rec });
  };
  tile("try-sign-paid", "sign_to_paid_on_screen_ms", "passkey to paid, on screen");
  tile("try-autopay", "autopay_awx_paid_ms", "agent pays alone, to Airwallex PAID", "; PAID by the sandbox's simulation");
  tile("try-refusal", "refusal_ms", "one-cent change to refusal");
  tile("try-verify", "verify_ms", "proof file to verdict on /verify");
  if (t.claude.costMicros && t.runs) out.push({ key: "try-cost", fig: `USD ${(t.claude.costMicros / 1e6 / t.runs).toFixed(4)}`, label: "Claude cost per /try journey", note: `List price; USD ${(t.claude.costMicros / 1e6).toFixed(4)} for ${t.runs}.`, tag: "sandbox", tone: "claude", href: w.href, rec: w.rec });
  return out;
}

/** The recorded /try walks the wall adds up: every series but those out of the band (the WebKit check has a tile of its own). */
export const wallWalks = (): LiveTryRecord[] => liveTryRecords().filter((r) => !NOT_IN_BAND.includes(r.dir));

/** The wall, computed from the records now. */
export function evidenceWall(records: LiveTryRecord[] = wallWalks()): EvidenceWall {
  const w = walks(records);
  const groups: WallGroup[] = [
    { id: "ev-rails", title: "Live on the rails", tiles: rails(w) },
    { id: "ev-forged", title: "Cannot be forged", tiles: forged(w) },
    { id: "ev-ai", title: "AI under control", tiles: ai(w) },
    { id: "ev-attacked", title: "Attacked and broken on purpose", tiles: attacked() },
    { id: "ev-built", title: "Built to last", tiles: built() },
    { id: "ev-quality", title: "Quality and supply chain", tiles: quality() },
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

