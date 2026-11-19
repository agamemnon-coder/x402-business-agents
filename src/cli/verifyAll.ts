// npm run verify-all [-- --no-write]
// One verification report, run live: every verifier this repository has, on the committed records it is built for, and
// every claim the site's proof pages make that a record backs, checked against that record. One line per check:
// pass, FAIL, or "could not run here" (with why). Nothing is estimated: a check that cannot run says so.
//  1. The verifiers: verify-bundle on the two /try samples, verify-approval, verify-receipt on each committed receipt,
//     verify-log on the recorded run's audit log with its anchor, verify-anchor against Alta testnet (read-only, needs
//     METAL_RPC_URL), judge --check. verify, reconcile and reconcile-books need the full ledger (KIT11_DB), which is
//     not committed: on an empty ledger they compare nothing, so they are listed as "could not run here".
//  2. Every Alta testnet transaction the site links to (/proof, /alta, /runs, read live; the README and the main run's
//     list of 86 it links): read from the chain (METAL_RPC_URL, read-only): it exists, it succeeded, and its block,
//     sender or recipient equal the ones a committed record names for it, where one does.
//  3. Every figure on /proof (and Home's) that a record backs, recomputed here from that record and compared with the
//     page as deployed now (https://kit11.max-31b.workers.dev, fetched read-only).
//  4. The timed /try runs (docs/evidence/try-timed-2026-11-15.json, made by scripts/try-timed.ts): their raw values,
//     median, p90 and worst, next to the 5 runs of docs/evidence/live-measurement-2026-11-15.json (read, not changed).
// Writes docs/evidence/verification-2026-11-15.json and .md (unless --no-write). Exit 1 when any check fails.
// No key is printed or kept: the RPC URL is never written; the chain is only read.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Hex } from "viem";
import { publicClient } from "../metal/chain.js";
import { USDZ } from "../metal/network.js";
import { liveRunCount } from "../redesign/runs.js";
import { AWX_CALLS_LABEL, NOT_IN_BAND } from "../redesign/scale.js";
import { PARTNER_STRIPS } from "../redesign/evidenceWall.js";
import { apiTrail } from "../airwallex/apiTrail.js";
import { mdCell as cell, pageText as text } from "./verifyAllFormat.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SITE = "https://kit11.max-31b.workers.dev";
const OUT = "docs/evidence/verification-2026-11-15";
const TIMED = "docs/evidence/try-timed-2026-11-15.json";
const EARLIER = "docs/evidence/live-measurement-2026-11-15.json";

export type Status = "pass" | "FAIL" | "could not run here";
export interface Check { group: string; status: Status; what: string; seen: string; source: string }
const checks: Check[] = [];
const add = (group: string, status: Status, what: string, seen: string, source: string) => {
  checks.push({ group, status, what, seen, source });
  console.log(`${status === "pass" ? "pass" : status === "FAIL" ? "FAIL" : "n/a "}  ${what}  ${seen}  (${source})`);
};
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = <T = unknown>(p: string): T => JSON.parse(read(p)) as T;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Every file under a folder whose name matches; the folders and files the band does not count (scale.ts NOT_IN_BAND) skipped. */
function filesIn(dir: string, re: RegExp): string[] {
  if (NOT_IN_BAND.includes(dir)) return [];
  let names: string[];
  try { names = readdirSync(join(ROOT, dir)); } catch { return []; }
  return names.flatMap((n) => { const p = `${dir}/${n}`; return NOT_IN_BAND.includes(p) ? [] : statSync(join(ROOT, p)).isDirectory() ? filesIn(p, re) : re.test(n) ? [p] : []; });
}
/** Never let a URL with a key in it reach the report. */
const scrub = (s: string) => (process.env.METAL_RPC_URL ? s.split(process.env.METAL_RPC_URL).join("<METAL_RPC_URL>") : s).replace(/https?:\/\/[^\s"']*(key|token|secret)[^\s"']*/gi, "<url>");

// 1. The verifiers ------------------------------------------------------------------------------------------------------
function runCli(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "src/cli", script), ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, timeout: 180_000 });
  const out = scrub(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  return { code: r.status, out, lines: out.split("\n").filter((l) => l.trim()) };
}
const lastLine = (lines: string[], re: RegExp) => [...lines].reverse().find((l) => re.test(l)) ?? lines.at(-1) ?? "";

function verifiers() {
  const G = "verifiers";
  for (const f of ["docs/proof/try-paid.json", "docs/proof/try-refused.json"]) {
    const r = runCli("verifyBundle.ts", [f]);
    const pass = r.lines.filter((l) => l.startsWith("pass")).length, fail = r.lines.filter((l) => l.startsWith("FAIL")).length;
    add(G, r.code === 0 && fail === 0 ? "pass" : "FAIL", `npm run verify-bundle -- ${f}`, `${pass} check lines pass, ${fail} fail; ${lastLine(r.lines, /VALID/)}`, f);
  }
  const receipts = ["docs/runs/2026-11-07-awx-1/receipt-P-0002.json", ...filesIn("docs/runs", /^receipt-.*\.json$/).filter((f) => !f.endsWith("2026-11-07-awx-1/receipt-P-0002.json"))];
  for (const f of receipts) {
    const r = runCli("verifyReceipt.ts", [f]);
    const pass = r.lines.filter((l) => l.startsWith("ok")).length, fail = r.lines.filter((l) => l.startsWith("FAIL")).length;
    const cmd = f.endsWith("2026-11-07-awx-1/receipt-P-0002.json") ? "npm run verify-approval" : `npm run verify-receipt -- ${f}`;
    add(G, r.code === 0 && fail === 0 ? "pass" : "FAIL", cmd, `${pass} check lines ok, ${fail} fail; ${lastLine(r.lines, /VALID/).split(":")[0]}`, f);
  }
  {
    const f = "docs/audit/friday-1-audit.jsonl";
    const anchor = "194:ee0732445a717f7386b4c6ccd94c0f5459b515e1d3e0869833c10d328fd83618";
    const r = runCli("verifyLog.ts", ["--jsonl", f, "--anchor", anchor]);
    add(G, r.code === 0 && r.lines.every((l) => !l.startsWith("FAIL")) ? "pass" : "FAIL", `npm run verify-log -- --jsonl ${f} --anchor 194:ee07…3618`, r.lines.map((l) => l.replace(/\s+/g, " ")).join("; "), f);
  }
  if (!process.env.METAL_RPC_URL) add(G, "could not run here", "npm run verify-anchor", "METAL_RPC_URL is not set: the anchor transaction cannot be read from Alta testnet", "docs/runs/2026-11-13-anchor.json");
  else {
    // The 13 Nov anchor by name: the newest record (19 Nov, not counted in the band) is checked in its own run log.
    const r = runCli("verifyAnchor.ts", ["docs/runs/2026-11-13-anchor.json"]);
    const ok = r.lines.filter((l) => l.startsWith("ok")).length;
    add(G, r.code === 0 ? "pass" : r.code === 2 ? "could not run here" : "FAIL", "npm run verify-anchor (Alta testnet, read-only)", `${ok} lines ok; ${lastLine(r.lines, /MATCH/).replace(ROOT + "/", "")}`, "docs/runs/2026-11-13-anchor.json");
  }
  {
    const r = runCli("judge.ts", ["--check"]);
    const ok = r.lines.filter((l) => /^ok\s/.test(l)).length, fail = r.lines.filter((l) => /^FAIL/.test(l)).length;
    add(G, r.code === 0 && fail === 0 && ok > 0 ? "pass" : "FAIL", "npm run judge -- --check", `${ok} pages served with 200, ${fail} failed, offline from the main run's record`, "docs/demo/main-run.json");
  }
  const noLedger = "needs the full ledger (KIT11_DB, a SQLite file), which is not committed; on an empty ledger it compares nothing, so running it here would prove nothing";
  add(G, "could not run here", "npm run verify", `${noLedger}; its committed audit log is checked by verify-log above`, "docs/audit/README.md");
  add(G, "could not run here", "npm run reconcile", `${noLedger}; it also reads Airwallex with sandbox keys`, "src/cli/reconcile.ts");
  add(G, "could not run here", "npm run reconcile-books", `${noLedger}; it also needs the outside books' settings`, "src/cli/reconcileBooks.ts");
}

// 2. Every Alta transaction the site links to ---------------------------------------------------------------------------
const TX = /testnet\.metalntwx\.com\/tx\/(0x[0-9a-fA-F]{64})/g;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
interface Recorded { block?: number; from?: string; to?: string; amount?: string; where: string }
/** What the committed JSON records say about each hash: a block, a sender, a recipient or an amount next to it. */
function recordedFacts(): Map<string, Recorded[]> {
  const m = new Map<string, Recorded[]>();
  const BLOCK = ["block", "block_number", "blockNumber"], FROM = ["from", "sender"], TO = ["to", "recipient"];
  const HASH_KEYS = ["tx", "hash", "tx_hash", "txHash", "transactionHash", "transaction"];
  const walk = (o: unknown, where: string): void => {
    if (Array.isArray(o)) { o.forEach((v) => walk(v, where)); return; }
    if (!isRec(o)) return;
    for (const k of HASH_KEYS) {
      const h = o[k];
      if (typeof h !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(h)) continue;
      const r: Recorded = { where };
      for (const b of BLOCK) { const v = o[b]; if (typeof v === "number" && Number.isSafeInteger(v)) r.block = v; else if (typeof v === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(v)) r.block = Number(v); }
      for (const f of FROM) { const v = o[f]; if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) r.from = v.toLowerCase(); }
      for (const t of TO) { const v = o[t]; if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) r.to = v.toLowerCase(); }
      if (r.to && typeof o.amount === "string" && /^\d+\.\d{2}$/.test(o.amount)) r.amount = o.amount;
      if (r.block !== undefined || r.from || r.to) m.set(h.toLowerCase(), [...(m.get(h.toLowerCase()) ?? []), r]);
    }
    Object.values(o).forEach((v) => walk(v, where));
  };
  for (const f of filesIn("docs", /\.json$/)) { try { walk(json(f), f); } catch { /* not JSON: skipped */ } }
  return m;
}
/** USDZ has 18 decimals: a value in wei as "0.05". */
const usdz = (wei: bigint) => { const c = wei / 10n ** 16n; return wei % 10n ** 16n ? null : `${c / 100n}.${String(c % 100n).padStart(2, "0")}`; };

async function transactions(pages: Record<string, string>) {
  const G = "Alta transactions";
  const where = new Map<string, Set<string>>();
  const saysReverted = new Map<string, string>();
  const note = (h: string, w: string) => { const k = h.toLowerCase(); where.set(k, (where.get(k) ?? new Set()).add(w)); };
  for (const [p, html] of Object.entries(pages)) {
    if (!["/proof", "/alta", "/runs"].includes(p)) continue;
    for (const m of html.matchAll(TX)) note(m[1]!, p);
    // What the page says the transaction did: the label just before its short form ("CFO alone: reverted · 0xe097…69c3").
    const t = text(html);
    for (const h of where.keys()) {
      const short = `${h.slice(0, 10)}…${h.slice(-4)}`;
      for (let i = t.indexOf(short); i >= 0; i = t.indexOf(short, i + 1)) { const label = t.slice(Math.max(0, i - 50), i); if (/reverted\s*·?\s*$/i.test(label)) saysReverted.set(h, `${p} labels it "${label.replace(/^\S*\s/, "").trim()}"`); }
    }
  }
  for (const f of ["README.md", "docs/runs/2026-11-03-main-run-metal-transactions.md"]) for (const m of read(f).matchAll(TX)) note(m[1]!, f);
  const hashes = [...where.keys()].sort();
  if (!process.env.METAL_RPC_URL) {
    add(G, "could not run here", `${hashes.length} distinct transactions linked from /proof, /alta, /runs and the README`, "METAL_RPC_URL is not set: the chain cannot be read here", "the pages, read live");
    return { hashes: hashes.length, found: 0, notFound: [] as string[], withRecord: 0, reverted: 0, rows: [] as unknown[] };
  }
  const facts = recordedFacts();
  const pc = publicClient();
  type Row = { hash: string; linked_from: string[]; page_says: string; status: string; block: number | null; from: string; to: string | null; transfers: { to: string; amount: string | null }[]; recorded: Recorded[]; result: Status; why: string };
  const rows: Row[] = [];
  const notFound: string[] = [];
  const queue = [...hashes];
  const worker = async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      let tx = null, rc = null, err = "";
      for (let attempt = 0; attempt < 3 && !(tx && rc); attempt++) {
        try { tx = await pc.getTransaction({ hash: h as Hex }); rc = await pc.getTransactionReceipt({ hash: h as Hex }); } catch (e) { err = (e as Error).message.split("\n")[0]!; await new Promise((r) => setTimeout(r, 700)); }
      }
      const linked = [...where.get(h)!];
      const rec = facts.get(h) ?? [];
      const expect = saysReverted.has(h) ? "reverted" : "success";
      const pageSays = saysReverted.get(h) ?? "linked as a payment or step that went through";
      if (!tx || !rc) { notFound.push(h); rows.push({ hash: h, linked_from: linked, page_says: pageSays, status: "not found", block: null, from: "", to: null, transfers: [], recorded: rec, result: "FAIL", why: scrub(err).slice(0, 160) || "the chain returns no transaction" }); continue; }
      const transfers = rc.logs.filter((l) => l.address.toLowerCase() === USDZ.toLowerCase() && l.topics[0] === TRANSFER && l.topics[2]).map((l) => ({ to: `0x${l.topics[2]!.slice(26)}`.toLowerCase(), amount: usdz(BigInt(l.data)) }));
      const why: string[] = [];
      if (rc.status !== expect) why.push(`status ${rc.status}, the page says ${expect === "reverted" ? pageSays : "it went through"}`);
      for (const r of rec) {
        if (r.block !== undefined && r.block !== Number(rc.blockNumber)) why.push(`block ${rc.blockNumber}, ${r.where} says ${r.block}`);
        if (r.from && r.from !== tx.from.toLowerCase()) why.push(`sender ${tx.from}, ${r.where} says ${r.from}`);
        if (r.to && r.to !== (tx.to ?? "").toLowerCase()) {
          const t = transfers.find((x) => x.to === r.to);
          if (!t) why.push(`no USDZ transfer to ${r.to} (${r.where}); transfers to ${transfers.map((x) => x.to).join(", ") || "none"}`);
          else if (r.amount && t.amount !== r.amount) why.push(`USDZ ${t.amount} to ${r.to}, ${r.where} says ${r.amount}`);
        }
      }
      rows.push({ hash: h, linked_from: linked, page_says: pageSays, status: rc.status, block: Number(rc.blockNumber), from: tx.from.toLowerCase(), to: tx.to?.toLowerCase() ?? null, transfers, recorded: rec, result: why.length ? "FAIL" : "pass", why: why.join("; ") });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  rows.sort((a, b) => a.hash.localeCompare(b.hash));
  const withRecord = rows.filter((r) => r.recorded.length);
  const failed = rows.filter((r) => r.result === "FAIL");
  const recWords = (r: Row) => r.recorded.map((x) => [x.block !== undefined ? `block ${x.block}` : "", x.from ? "sender" : "", x.to ? `recipient${x.amount ? ` and USDZ ${x.amount}` : ""}` : ""].filter(Boolean).join(", ")).join("; ");
  for (const r of rows) {
    const what = `tx ${r.hash.slice(0, 10)}…${r.hash.slice(-4)} on chain, ${r.page_says !== "linked as a payment or step that went through" ? "reverted, as the page says" : "succeeded"}${r.recorded.length ? ", as its record says" : ""}`;
    add(G, r.result, what, r.result === "pass" ? `${r.status}, block ${r.block}${r.recorded.length ? `; matches the record's ${recWords(r)}` : ""}` : r.why, `linked from ${r.linked_from.join(", ")}${r.recorded.length ? `; ${[...new Set(r.recorded.map((x) => x.where))].join(", ")}` : ""}`);
  }
  console.log(`\n${rows.length} transactions read from Alta testnet: ${rows.length - notFound.length} found, ${notFound.length} not found, ${failed.length} failed; ${withRecord.length} compared with a recorded block, sender, recipient or amount`);
  return { hashes: rows.length, found: rows.length - notFound.length, notFound, withRecord: withRecord.length, reverted: rows.filter((r) => r.status === "reverted").length, rows };
}

// 3. The figures on the pages ---------------------------------------------------------------------------------------------

function figures(pages: Record<string, string>) {
  const G = "figures on the pages";
  const proofHtml = pages["/proof"] ?? "", homeHtml = pages["/"] ?? "";
  const proof = text(proofHtml);
  const band = (html: string) => new Map([...html.matchAll(/data-count="(\d+)"[^>]*>[^<]*<\/span><\/b><small>([^<]+)<\/small>/g)].map((m) => [m[2]!.replace(/\s*↗$/, "").trim(), Number(m[1])]));
  const proofBand = band(proofHtml), homeBand = band(homeHtml);
  // A band label can carry a scope after a comma ("233 Alta testnet transactions, all runs"): match the label itself.
  const pick = (b: Map<string, number>, label: string) => b.get(label) ?? [...b].find(([k]) => k.startsWith(`${label},`))?.[1];
  const cmp = (what: string, expected: number | string, seen: number | string | undefined, source: string) =>
    add(G, seen === undefined ? "FAIL" : String(seen) === String(expected) ? "pass" : "FAIL", what, seen === undefined ? `not found on the page; the record gives ${expected}` : `page ${seen}, record ${expected}`, source);
  const inText = (t: string, re: RegExp) => { const m = re.exec(t); return m ? m[1]!.replace(/,/g, "") : undefined; };

  // The band: each figure recomputed here from the files, not with the page's own code (except where said).
  const ts = json<{ passed: number; failed: number }>("docs/assets/test-summary.json");
  cmp("/proof: tests passing", ts.passed, pick(proofBand, "tests passing"), "docs/assets/test-summary.json (passed)");
  add(G, ts.failed === 0 ? "pass" : "FAIL", "the last full test run had no failure", `failed ${ts.failed}`, "docs/assets/test-summary.json");
  const records = [...filesIn("docs/runs", /\.json$/), ...filesIn("docs/demo", /\.json$/)];
  cmp("/proof: sandbox and testnet runs", liveRunCount(), pick(proofBand, "sandbox and testnet runs"), "/runs' rows (src/redesign/runs.ts liveRunCount)");
  // 15 Nov: one Airwallex count on /proof, the trail's (the page's own code: /airwallex/calls lists the same calls).
  cmp(`/proof: ${AWX_CALLS_LABEL}`, apiTrail().calls, pick(proofBand, AWX_CALLS_LABEL), "the Airwallex API trail of the run records (src/airwallex/apiTrail.ts, listed on /airwallex/calls)");
  const tx = new Set<string>();
  for (const f of [...records, ...filesIn("docs/runs", /\.md$/)]) for (const m of read(f).matchAll(/testnet\.metalntwx\.com\/tx\/(0x[0-9a-f]{64})/g)) tx.add(m[1]!);
  cmp("/proof: Alta testnet transactions", tx.size, pick(proofBand, "Alta testnet transactions"), "distinct explorer links in docs/runs and docs/demo, counted here");
  const req = new Set<string>();
  for (const f of filesIn("docs", /\.jsonl?$/)) for (const m of read(f).matchAll(/\breq_011[A-Za-z0-9]{10,}/g)) req.add(m[0]);
  cmp("/proof: Claude calls with request ids", req.size, pick(proofBand, "Claude calls with request ids"), "distinct req_011… ids in docs/**/*.json(l), counted here");
  const refusals = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!isRec(o)) return;
    if (typeof o.event === "string" && /refus|declin|reject|fraud/.test(o.event)) refusals.add(typeof o.row_hash === "string" ? o.row_hash : JSON.stringify([o.event, o.ts ?? null, o.subject ?? null]));
    Object.values(o).forEach(walk);
  };
  for (const f of records) { try { walk(json(f)); } catch { /* not JSON */ } }
  cmp("/proof: refusals on record", refusals.size, pick(proofBand, "refusals on record"), "audit rows of a refusal, decline, rejection or fraud stop in docs/runs and docs/demo, counted here");
  // 19 Nov: the evidence wall, each tile's figure as docs/evidence/evidence-wall.json holds it (the page's own code made
  // that file from the records: npm run evidence:wall; test/evidence-wall.test.ts holds it to them).
  const wallSeen = new Map([...proofHtml.matchAll(/data-wall="([^"]+)"[^>]*>\s*<a [^>]*><b class="ew-f">([^<]+)<\/b>/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
  const wallTiles = (json<{ groups: { tiles: { key: string; fig: string; rec: string; offProof?: boolean }[] }[] }>("docs/evidence/evidence-wall.json")).groups.flatMap((g) => g.tiles);
  for (const t of wallTiles.filter((x) => !x.offProof)) {
    cmp(`/proof evidence wall: ${t.key}`, t.fig, wallSeen.get(t.key), `docs/evidence/evidence-wall.json (from ${t.rec})`);
  }
  // The partner pages' strips (19 Nov): each tile the page shows, as the wall's file has it.
  for (const [path, strip] of [["/airwallex", "airwallex"], ["/alta", "alta"], ["/visa", "visa"], ["/visa", "tap"]] as const) {
    const html = pages[path] ?? "", seen = new Map([...html.matchAll(/data-wall="([^"]+)"[^>]*>\s*<a [^>]*><b class="ew-f">([^<]+)<\/b>/g)].map((m) => [m[1]!, m[2]!.replace(/&amp;/g, "&")]));
    for (const key of PARTNER_STRIPS[strip].keys) {
      const t = wallTiles.find((x) => x.key === key);
      if (t) cmp(`${path} strip: ${key}`, t.fig, seen.get(key), `docs/evidence/evidence-wall.json (from ${t.rec})`);
    }
  }
  for (const [label, n] of homeBand) {
    if (proofBand.has(label)) cmp(`Home: ${label}`, pick(proofBand, label)!, n, "the same figure on /proof");
  }

  // The partner tiles and the note above them: they must add up.
  const tiles = [...proofHtml.matchAll(/<span class="pt-n">([^<]+)<\/span><b class="pt-c">(\d+)<\/b>/g)].map((m) => [m[1]!, Number(m[2])] as const);
  // The note's wording since 15 Nov (src/redesign/proofRuns.ts): "25 live runs: 23 by partner in the tiles, the main run and 1 on /visa."
  const note = /(\d+) live runs: (\d+) by partner in the tiles,? (?:and )?the main run(?:,? and (\d+) on \/visa)?\./.exec(proof);
  const tileSum = tiles.reduce((k, [, n]) => k + n, 0);
  if (!note) add(G, "FAIL", "/proof: the live-runs note", "not found on the page", "/proof");
  else {
    cmp("/proof: the partner tiles add up to the note's count", tileSum, Number(note[2]), `the tiles: ${tiles.map(([n, c]) => `${n} ${c}`).join(", ")}`);
    cmp("/proof: live runs = tiles + the main run + on /visa", tileSum + 1 + Number(note[3] ?? 0), Number(note[1]), "/proof");
    cmp("/proof: the note's live runs = the band's", pick(proofBand, "sandbox and testnet runs") ?? -1, Number(note[1]), "/proof");
  }

  // The main run, from its record.
  const run = json<{ snapshot: Record<string, unknown> & { audit: { rows: number; intact: boolean }; agent_stats: { agent: string; decisions: number; by_claude: number; fallback: number; claude_calls: number; calls_without_request_id: number; cost_usd_micros: number }[]; refusals: { agent: string; what: string }[]; decisions: { proposal_id: string; status: string; by: string | null }[] }; proof: { chain_refusals: number; ai_tricks: number; face_id: number }; ledger: { disputes: { claims: { sale_refs: number[] } }[] } }>("docs/demo/main-run.json");
  const trace = json<{ payments: { rail: string; kind: string }[] }>("docs/demo/main-run-trace.json");
  const S = "docs/demo/main-run.json";
  const st = run.snapshot.agent_stats;
  const sum = (k: "decisions" | "by_claude" | "fallback" | "claude_calls" | "calls_without_request_id") => st.reduce((n, a) => n + a[k], 0);
  cmp("/proof: decisions by Claude (main run)", sum("by_claude"), inText(proof, /(\d+) decisions by Claude \(0 fallbacks\)/), `${S} agent_stats (by_claude)`);
  cmp("/proof: fallbacks (main run)", sum("fallback"), inText(proof, /decisions by Claude \((\d+) fallbacks\)/), `${S} agent_stats (fallback)`);
  cmp("/proof: calls to Claude, each logged", sum("claude_calls"), inText(proof, /(\d+) calls to Claude, each logged/), `${S} agent_stats (claude_calls)`);
  add(G, sum("calls_without_request_id") === 0 ? "pass" : "FAIL", "main run: every Claude call has a request id", `${sum("calls_without_request_id")} calls without one`, `${S} agent_stats`);
  for (const a of st) {
    const name = a.agent[0]!.toUpperCase() + a.agent.slice(1);
    const re = new RegExp(`${name} agent on \\w+: all (\\d+) decisions by Claude, (\\d+) fallbacks, (\\d+) calls, USD ([0-9.]+)`);
    const m = re.exec(proof);
    cmp(`/proof: ${a.agent} agent's decisions, fallbacks, calls, cost`, `${a.by_claude}/${a.decisions} ${a.fallback} ${a.claude_calls} ${(a.cost_usd_micros / 1e6).toFixed(4)}`, m ? `${m[1]}/${a.decisions} ${m[2]} ${m[3]} ${m[4]}` : undefined, `${S} agent_stats (${a.agent})`);
  }
  const alta = trace.payments.filter((p) => p.rail === "metal");
  const k = (kind: string) => alta.filter((p) => p.kind === kind).length;
  cmp("/proof: Alta payments (main run)", alta.length, inText(proof, /(\d+) Alta payments \+ 1 card charge/), "docs/demo/main-run-trace.json payments (rail metal)");
  cmp("/proof: card charges (main run)", trace.payments.filter((p) => p.rail === "airwallex_card").length, inText(proof, /Alta payments \+ (\d+) card charge/), "docs/demo/main-run-trace.json payments (rail airwallex_card)");
  cmp("/proof: sales + purchases + refunds + sweep", `${k("sale")} ${k("purchase")} ${k("refund")} ${k("sweep")}`, (() => { const m = /(\d+) sales \+ (\d+) supplier purchases \+ (\d+) refunds \+ (\d+) sweep on Alta/.exec(proof); return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : undefined; })(), "docs/demo/main-run-trace.json payments by kind");
  const refs = run.snapshot.refusals;
  const cfo = refs.filter((r) => r.what === "Proposal rejected").length;
  const planted = refs.filter((r) => r.what === "Planted instruction ignored").length;
  const chainRefused = run.proof.chain_refusals;
  const buyRule = refs.filter((r) => r.what === "Supplier purchase refused").length - chainRefused;
  const stops = /(\d+) stops, nothing paid over a limit: one buy rule Claude set stopped (\d+) overpriced checks, Alta refused (\d+) purchases, the CFO rejected (\d+) proposal, and (\d+) planted instruction/.exec(proof);
  cmp("/proof: stops (main run): total, buy rule, Alta, CFO, planted", `${refs.length} ${buyRule} ${chainRefused} ${cfo} ${planted}`, stops ? stops.slice(1, 6).join(" ") : undefined, `${S} snapshot.refusals and proof.chain_refusals`);
  const faceId = run.snapshot.decisions.filter((d) => d.by && /Face ID/.test(d.by)).length;
  cmp("/proof: decisions signed with Face ID", faceId, inText(proof, /(\d+) decisions signed with Face ID/), `${S} snapshot.decisions (by … Face ID)`);
  cmp("/proof: Face ID count = the record's proof.face_id", run.proof.face_id, faceId, S);
  const disputed = run.ledger.disputes[0]?.claims.sale_refs.length ?? 0;
  cmp("/proof: orders disputed", disputed, inText(proof, /(\d+) orders disputed/), `${S} ledger.disputes[0].claims.sale_refs`);
  cmp("/proof: disputed orders refunded (wrong data)", k("refund"), inText(proof, /(\d+) wrong data, refunded/), "docs/demo/main-run-trace.json refunds on Alta");
  cmp("/proof: disputed orders proven valid", disputed - k("refund"), inText(proof, /(\d+) proven valid/), "disputed minus refunded");
  cmp("/proof: audit rows (main run)", run.snapshot.audit.rows, inText(proof, /(\d+) audit rows/), `${S} snapshot.audit.rows`);
  add(G, run.snapshot.audit.intact ? "pass" : "FAIL", "main run: the audit chain is recorded intact", `intact ${run.snapshot.audit.intact}`, S);
}

// 4. The timed /try runs ----------------------------------------------------------------------------------------------------
/** p-th percentile by the nearest-rank method, on the values given. */
export const nearestRank = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!; };
export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };
const stats = (xs: number[]) => (xs.length ? { n: xs.length, median_ms: median(xs), p90_ms: nearestRank(xs, 90), worst_ms: Math.max(...xs), values_ms: xs } : { n: 0 });

function timing() {
  const G = "timed /try runs";
  let timed: { runs: { run: number; start_to_paid_ms: number | null; refusal_round_trip_ms: number | null; paid_bundle_valid: boolean | null; refused_bundle_valid: boolean | null; stopped: string | null }[]; stopped: string | null } | null = null;
  try { timed = json(TIMED); } catch { /* not made */ }
  const earlier = json<{ try_runs: { run: number; t: Record<string, number>; total: number; failedAt: string | null }[] }>(EARLIER).try_runs;
  const before = {
    source: EARLIER,
    note: "the 5 runs measured earlier on 15 Nov, read as they are (not changed); their steps are timed differently from today's two times, so they are shown next to them, not pooled",
    passkey_to_paid: stats(earlier.map((r) => r.t.passkey_to_paid!).filter((v) => typeof v === "number")),
    one_cent_refusal: stats(earlier.map((r) => r.t.one_cent_refusal!).filter((v) => typeof v === "number")),
    total_start_to_finish: stats(earlier.map((r) => r.total)),
  };
  if (!timed) { add(G, "could not run here", "timed /try runs", `${TIMED} is not there: run npx tsx scripts/try-timed.ts`, TIMED); return { today: null, before }; }
  const paid = timed.runs.flatMap((r) => (r.start_to_paid_ms === null ? [] : [r.start_to_paid_ms]));
  const refused = timed.runs.flatMap((r) => (r.refusal_round_trip_ms === null ? [] : [r.refusal_round_trip_ms]));
  for (const r of timed.runs) {
    if (r.start_to_paid_ms !== null) add(G, r.paid_bundle_valid ? "pass" : "FAIL", `/try run ${r.run}: paid, and its proof bundle verifies`, `start to paid ${r.start_to_paid_ms} ms; bundle ${r.paid_bundle_valid ? "VALID" : "NOT VALID"}`, TIMED);
    if (r.refusal_round_trip_ms !== null) add(G, r.refused_bundle_valid ? "pass" : "FAIL", `/try run ${r.run}: one cent more refused, and its proof bundle verifies`, `refusal round trip ${r.refusal_round_trip_ms} ms; bundle ${r.refused_bundle_valid ? "VALID" : "NOT VALID"}`, TIMED);
    if (r.stopped && r.start_to_paid_ms === null) add(G, "could not run here", `/try run ${r.run}`, r.stopped, TIMED);
    else if (r.stopped) add(G, "FAIL", `/try run ${r.run}: the walk finished`, r.stopped, TIMED);
  }
  return { today: { source: TIMED, stopped: timed.stopped, start_to_paid: stats(paid), refusal_round_trip: stats(refused) }, before };
}

// Run it all ---------------------------------------------------------------------------------------------------------------
const startedAt = new Date().toISOString();
const pages: Record<string, string> = {};
for (const p of ["/proof", "/", "/alta", "/runs", "/airwallex", "/visa"]) {
  try { const r = await fetch(`${SITE}${p}`); pages[p] = await r.text(); add("the site", r.ok ? "pass" : "FAIL", `GET ${SITE}${p}`, `${r.status}, ${pages[p]!.length} bytes`, "the deployed site"); }
  catch (e) { add("the site", "could not run here", `GET ${SITE}${p}`, `no answer: ${(e as Error).message}`, "the deployed site"); }
}
verifiers();
const txs = await transactions(pages);
figures(pages);
const times = timing();
const finishedAt = new Date().toISOString();

const n = (s: Status) => checks.filter((c) => c.status === s).length;
const summary = `${n("pass")} checks passed, ${n("could not run here")} could not run here, ${n("FAIL")} failed`;
console.log(`\n${summary}`);
let commit = "";
try { commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(); } catch { /* no git */ }

if (!process.argv.includes("--no-write")) {
  const report = {
    what: "Verification report: every verifier of this repository on the committed records it is built for, every Alta testnet transaction the site links to read from the chain, every figure on /proof that a record backs recomputed and compared with the deployed page, and timed runs of the deployed /try. Test money only. Made by npm run verify-all (src/cli/verifyAll.ts); run it again to check.",
    rerun: "npm ci && npm run verify-all   (METAL_RPC_URL, an Alta testnet RPC endpoint, for the chain checks; without it they say could not run here)",
    started_at: startedAt,
    finished_at: finishedAt,
    commit,
    site: SITE,
    summary,
    counts: { passed: n("pass"), could_not_run_here: n("could not run here"), failed: n("FAIL") },
    failures: checks.filter((c) => c.status === "FAIL"),
    transactions: { read_from_chain: txs.hashes, found: txs.found, not_found: txs.notFound, reverted_as_the_pages_say: txs.reverted, compared_with_a_record: txs.withRecord },
    try_timing: { ...times, method: "median: the middle value (the mean of the two middle ones for an even count); p90: nearest rank; worst: the largest. From the raw values listed only." },
    checks,
    transaction_rows: txs.rows,
  };
  writeFileSync(join(ROOT, `${OUT}.json`), `${JSON.stringify(report, null, 1)}\n`);
  const groups = [...new Set(checks.map((c) => c.group))];
  const t = times.today as null | { start_to_paid: ReturnType<typeof stats>; refusal_round_trip: ReturnType<typeof stats>; stopped: string | null };
  const fmtS = (s: ReturnType<typeof stats>) => ("median_ms" in s ? `${s.n} runs: median ${s.median_ms} ms, p90 ${s.p90_ms} ms, worst ${s.worst_ms} ms (raw: ${s.values_ms!.join(", ")})` : "no runs");
  const md = [
    "# Verification report, 15 November 2026",
    "",
    `**${summary}.**`,
    "",
    `Run live from ${startedAt} to ${finishedAt}, on commit \`${commit}\`, by \`npm run verify-all\` (src/cli/verifyAll.ts). Re-run it: \`npm ci && npm run verify-all\`; the chain checks need \`METAL_RPC_URL\` (an Alta testnet RPC endpoint; only read). The full result, every transaction with its block: [verification-2026-11-15.json](verification-2026-11-15.json). Test money only.`,
    "",
    `Alta testnet: ${txs.hashes} distinct transactions linked from /proof, /alta, /runs and the README read from the chain; ${txs.found} found, ${txs.notFound.length} not found${txs.notFound.length ? ` (${txs.notFound.join(", ")})` : ""}; ${txs.reverted} of them reverted, each one the pages label "reverted" (a refusal on chain); ${txs.withRecord} compared with the block, sender, recipient or amount a committed record names.`,
    "",
    "## Timed /try runs (deployed, test money)",
    "",
    t ? `Today, by scripts/try-timed.ts (${TIMED}): start to paid, ${fmtS(t.start_to_paid)}; one-cent refusal round trip, ${fmtS(t.refusal_round_trip)}.${t.stopped ? ` Stopped early: ${t.stopped}` : ""}` : "Today's timed runs: could not run here.",
    "",
    `Next to them, the 5 earlier runs of ${EARLIER} (not changed; timed per step, so not pooled with today's): passkey to paid, ${fmtS(times.before.passkey_to_paid)}; one-cent refusal, ${fmtS(times.before.one_cent_refusal)}; start to finish, ${fmtS(times.before.total_start_to_finish)}.`,
    "",
    "Median: the middle value (the mean of the two middle ones for an even count). p90: nearest rank. Worst: the largest. From the raw values only. Measured from a cloud sandbox in US-East, headless Chromium with a virtual passkey, at bot speed.",
    "",
    ...groups.flatMap((g) => {
      const rows = checks.filter((c) => c.group === g);
      const head = [`## ${g[0]!.toUpperCase()}${g.slice(1)} (${rows.filter((c) => c.status === "pass").length} passed${rows.some((c) => c.status === "could not run here") ? `, ${rows.filter((c) => c.status === "could not run here").length} could not run here` : ""}${rows.some((c) => c.status === "FAIL") ? `, ${rows.filter((c) => c.status === "FAIL").length} failed` : ""})`, ""];
      const table = ["| Result | What was checked | Value seen | Source |", "|---|---|---|---|", ...rows.map((c) => `| ${c.status === "FAIL" ? "**FAIL**" : c.status} | ${cell(c.what)} | ${cell(c.seen)} | ${cell(c.source)} |`)];
      return g === "Alta transactions" && rows.length > 12 ? [...head, `<details><summary>Every transaction, one line each</summary>`, "", ...table, "", "</details>", ""] : [...head, ...table, ""];
    }),
  ].join("\n");
  writeFileSync(join(ROOT, `${OUT}.md`), `${md}\n`);
  console.log(`wrote ${relative(ROOT, join(ROOT, OUT))}.json and .md`);
}
process.exit(n("FAIL") ? 1 : 0);
