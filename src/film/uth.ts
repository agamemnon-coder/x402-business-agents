// "Purser, under the hood" (15 Nov): an advanced use-case film of about 3:30 beside the hand-in film. It shows the
// cryptography and the numbers that make Purser trustworthy, plainly, and every claim is on screen with its id or hash.
// Each figure here is read from its record at build time (never typed in): the live /try walk of 15 November
// (docs/film/under-the-hood/record.json, npm run record-uth), the main run of 3 November (docs/demo/main-run.json),
// Airwallex's read-back of its transfer (docs/runs/airwallex-transfer-approval-2026-11-06.json), awx-1 of 7 November
// (docs/demo/airwallex-run.json), the anchor record (docs/runs/*-anchor.json, checked live by npm run verify-anchor) and
// the README's test count. A figure without a record is not in the film. Test money only, and said on screen.

import { WORST_CASE, WORST_CASE_DOC, WORST_CASE_HEADLINE, worstOf } from "../evals/worstCase.js";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = <T>(p: string): T => JSON.parse(readFileSync(resolve(root, p), "utf8")) as T;

/** One segment of a scene: a card (HTML, rendered at 1920x1080) or a window of a recording. */
export type Segment = { card: string; seconds?: number } | { clip: string; from: number; to: number; hold?: number }; // hold: seconds the clip's last frame stays
export interface Scene { id: string; title: string; vo: string; segments: Segment[]; min: number; note?: string }

export interface UthRecord {
  recorded_at: string; origin: string; marks: Record<string, number>;
  terms: { terms_sha256: string; sha256_of_canonical: string; canonical: string; fx_quote: { source: string; quote_id: string; client_rate: string; market_rate?: string; valid_to: string; sell_amount: string; sell_currency: string; buy_amount: string; buy_currency: string } | null };
  assertion: { client_data: { type: string; challenge: string; origin: string }; challenge_hex: string; authenticator_data: { rp_id_hash: string; flags_byte: string; user_present: boolean; user_verified: boolean; sign_count: number }; rp_id_hash_of: string };
  pays: { status: number; answer: { outcome: string; signed_sha256: string; sent_sha256: string; changed: string[]; transfers_before: number; transfers_after: number } }[];
}

/** The figures, each from its record. */
export function facts() {
  const rec = read<UthRecord>("docs/film/under-the-hood/record.json");
  const xfer = read<{ read_at: string; transfer: { id: string; status: string; transfer_amount: number; transfer_currency: string; reference: string; metadata: { approval_sha256: string } } }>("docs/runs/airwallex-transfer-approval-2026-11-06.json");
  const mainText = readFileSync(resolve(root, "docs/demo/main-run.json"), "utf8");
  const approved = new RegExp(`"event": "proposal\\.approved",\\s*"subject": "P-0005",\\s*"payload": \\{[^}]*"method": "passkey"[^}]*"terms_sha256": "${xfer.transfer.metadata.approval_sha256}"`).test(mainText);
  if (!approved) throw new Error("uth: P-0005's passkey approval with the transfer's approval_sha256 is not in the main run's record");
  // The run's own line (it predates Metal's rename to Alta; the film says "Alta (formerly Metal)").
  const recon = /"event": "reconcile\.done",[\s\S]{0,200}?"text": "Reconciled (\d+) money flows against Airwallex and Metal: no differences"/.exec(mainText);
  if (!recon) throw new Error("uth: no reconcile.done with no differences in the main run's record");
  const awx1 = readFileSync(resolve(root, "docs/demo/airwallex-run.json"), "utf8");
  const decline = /"LIMIT_EXCEEDED"/.test(awx1) && awx1.includes("01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38");
  if (!decline) throw new Error("uth: awx-1's LIMIT_EXCEEDED decline is not in its record");
  const anchorFile = readdirSync(resolve(root, "docs/runs")).filter((f) => /^\d{4}-\d{2}-\d{2}-anchor\.json$/.test(f)).sort().at(-1)!;
  const anchor = read<{ tx: string; block?: number; head: string; chain_id?: number }>(`docs/runs/${anchorFile}`);
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  const tests = /\*\*(\d+) tests passing\*\*/.exec(readme)?.[1];
  if (!tests) throw new Error("uth: no test count in the README");
  const claims = readFileSync(resolve(root, "docs/claims.md"), "utf8");
  const decisions = /\| Decisions by Claude \| (\d+) of \1, 0 fallbacks/.exec(claims)?.[1];
  const alta = /\| (\d+): (\d+) Alta payments \+ 1 card charge/.exec(claims)?.[2];
  const faceId = /\| Signed with Face ID \| (\d+) times, by the CFO/.exec(claims)?.[1];
  const stops = /\| Stops \| (\d+) stops, nothing paid over a limit/.exec(claims)?.[1];
  const alone = /\| Payments within the limits, no approval at the time \| (\d+): /.exec(claims)?.[1];
  if (!decisions || !alta || !faceId || !stops || !alone) throw new Error("uth: a main-run figure is not in docs/claims.md as expected");
  const refused = rec.pays.find((p) => p.answer.outcome === "refused")!.answer;
  const paid = rec.pays.find((p) => p.answer.outcome === "paid")!.answer;
  const replay = rec.pays.find((p) => p.answer.outcome === "paid_once")!.answer;
  // The worst-case AI test (src/evals/worstCase.ts, its record docs/evals/worst-case-summary.json): each payer's worse run.
  const script = worstOf("purser_script"), naive = worstOf("no_rules");
  if (!script || !naive) throw new Error("uth: the worst-case AI test's record has no runs");
  // What Claude adds (docs/worst-case-ai.md): with the script, code alone sent to the CFO the invoices only a reader catches;
  // with Claude reading in the same run (the scorecard's "purser" arm), none. Both from the records, the same in each run.
  const sc = read<{ by_run: Record<string, { purser: { to_cfo_not_held: number; wrong_payments: number; paid_past_cfo: number } }> }>(WORST_CASE.record);
  const withClaude = [...new Set(Object.values(sc.by_run).map((r) => `${r.purser.to_cfo_not_held}/${r.purser.wrong_payments}/${r.purser.paid_past_cfo}`))];
  if (withClaude.length !== 1) throw new Error("uth: the scorecard's Purser-with-Claude arm differs between runs");
  const [claudeNotHeld, claudeWrong, claudePastCfo] = withClaude[0]!.split("/").map(Number) as [number, number, number];
  if (WORST_CASE.sent_to_cfo_to_sign.length !== script.to_cfo_not_held) throw new Error("uth: the worst-case record's list of invoices sent to the CFO does not match its count");
  const score = { scriptNotHeld: script.to_cfo_not_held, claudeNotHeld, claudeWrong, claudePastCfo, ranOn: new Date(WORST_CASE.ran_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), runs: WORST_CASE.runs, cases: WORST_CASE.cases_per_run, scriptWrong: script.wrong_payments, scriptPastCfo: script.paid_past_cfo, naiveWrong: naive.wrong_payments, naivePastCfo: naive.paid_past_cfo };
  // The /verify beat (npm run record-uth -- --verify): the page's own result lines, the paid file and the one-cent copy.
  const verify = read<{ marks: Record<string, number>; lines: { paid: string[]; one_cent: string[] } }>("docs/film/under-the-hood/verify-record.json");
  const failed = verify.lines.one_cent.filter((l) => l.startsWith("FAIL")).map((l) => l.split(":")[0]!.slice(5));
  if (!verify.lines.paid.length || verify.lines.paid.some((l) => !l.startsWith("pass")) || failed.join(",") !== "terms hash,challenge,decision") throw new Error(`uth: /verify's record is not all pass, then terms hash, challenge and decision failing (${failed.join(", ")})`);
  return { verify: { ...verify.lines, marks: verify.marks }, score, rec, xfer: xfer.transfer, xferReadAt: xfer.read_at, reconFlows: Number(recon[1]), anchor, anchorFile, tests: Number(tests), decisions: Number(decisions), alta: Number(alta), alone: Number(alone), faceId: Number(faceId), stops: Number(stops), refused, paid, replay };
}

const fmt = (n: number) => n.toLocaleString("en-GB");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (h: string, n = 16) => `${h.slice(0, n)}…`;

/** The film's scenes in order. */
export const ORDER = ["u04", "a01", "a02", "u02", "u03", "u04v", "u05", "u07", "u08", "u08s", "u10"];

/** The scenes. Clip windows are seconds into out/video/uth/try-walk.mp4 (its marks in record.json). */
export function scenes(): Scene[] {
  const f = facts();
  const m = f.rec.marks;
  const t = f.rec.terms;
  const a = f.rec.assertion;
  const q = t.fx_quote;
  const live = q?.source === "airwallex-sandbox";
  const host = new URL(f.rec.origin).hostname;
  const canon = JSON.parse(t.canonical) as Record<string, unknown>;
  const pick = ["amount", "currency", "beneficiary_name", "iban_last4", "bic", "invoice_no", "conversion", "fee_max", "expires_at"];
  // The excerpt: what a CFO reads (the conversion without its request id); the hash is of the whole canonical text.
  const shown = Object.fromEntries(pick.filter((k) => k in canon).map((k) => [k, k === "conversion" && canon[k] && typeof canon[k] === "object" ? Object.fromEntries(Object.entries(canon[k] as Record<string, unknown>).filter(([x]) => x !== "request_id")) : canon[k]]));
  const jsonLines = JSON.stringify(shown, null, 2).split("\n").map((l) => esc(l).replace(/("quote_id": )("[^"]+")/, '$1<b class="hl">$2</b>').replace(/("amount": )("[^"]+")/, '$1<b class="hl">$2</b>')).join("\n");
  const diff = (x: string, y: string) => [...x].map((c, i) => (c === y[i] ? c : `<mark>${c}</mark>`)).join("");
  const list: Scene[] = [
    // Part one (15 Nov, the main hand-in film): the product in plain words, shown live on /try, for a judge who has never
    // seen Purser. Part two is under the hood.
    { id: "a01", title: "What Purser is", min: 10,
      vo: "Purser lets AI agents pay a company's supplier invoices, but only within limits the CFO signs. It is built on Airwallex. Everything you see runs in its sandbox, with test money.",
      segments: [{ card: `<div class="hero"><p class="kicker">Purser · built on Airwallex</p><h1>AI agents pay supplier invoices.<br>Only within limits the CFO signs.</h1><p class="sub">Airwallex sandbox · test money only · every claim shown with its id or hash</p></div>` }] },
    { id: "a02", title: "Live on /try", min: 26.5,
      vo: `An agent reads the invoice and checks it: not paid before, bank details on file, a known supplier. Within the CFO's limits, the agents pay alone: ${f.alone} payments in the main run, with no approval needed. Above them, the CFO signs the exact terms with Face ID. Then it is paid, booked and filed.`,
      segments: [
        { clip: "try-walk", from: Math.max(0, m.inbox! - 0.3), to: m.inbox! + 2.2 },
        // Timed to the voice: the checks while it reads them, the card while it says "within the CFO's limits", the
        // approval sheet and the signature while it says "above them", Paid while it says "paid, booked and filed".
        { clip: "try-walk", from: m.checked! - 1.2, to: m.checked! + 2.4, hold: 2.3 },
        { card: `<div class="hero small-hero"><p class="kicker">Main run, 3 Nov · Airwallex sandbox and Alta (formerly Metal) testnet · test money</p><h2>${f.alone} payments within the CFO's limits, with no approval needed</h2><p class="sub">Above a limit, the CFO signs the exact terms with Face ID or a passkey. On /try every invoice is above the agents' limit (EUR 0 in that demo), so you sign each one.</p></div>`, seconds: 5 },
        { clip: "try-walk", from: m.sheet! - 0.2, to: m.sheet! + 2.6 },
        { clip: "try-walk", from: m.sign! - 0.2, to: m["paid-held"]! },
      ] },
    { id: "a03", title: "Under the hood", min: 6,
      vo: "So how can anyone check that the CFO signed exactly this, and nothing else? Here is what happens under the hood.",
      segments: [{ card: `<div class="hero"><p class="kicker">Under the hood</p><h1>Who signed what,<br>and how anyone can check it.</h1></div>` }] },
    { id: "u02", title: "The terms, hashed", min: 16,
      vo: "Every payment becomes one set of terms: the payee, the account, the amount, the exchange-rate quote and a deadline. Purser writes them as canonical JSON and takes its SHA-256. This is the real hash from the run you just saw.",
      segments: [
        { card: `<div class="two"><div class="pane"><p class="lab">The signed terms (canonical JSON, excerpt)</p><pre class="code">${jsonLines}</pre></div><div class="pane"><p class="lab">SHA-256 of the whole canonical JSON</p><p class="hash big">${t.terms_sha256}</p><p class="ok">✓ recomputed from the canonical text: equal</p><p class="src">/try on ${esc(host)}, ${f.rec.recorded_at.slice(0, 10)} · test company, test money</p></div></div>` }] },
    { id: "u03", title: "The passkey signs the hash", min: 21,
      vo: "That hash is the WebAuthn challenge. The CFO's passkey signs it after Face ID, and the flags say so: user present, user verified. The browser binds the signature to Purser's own domain, so a lookalike site gets nothing it can use. A PIN, a code or a click can be phished; this cannot.",
      note: "Recorded with a virtual test passkey (a browser authenticator with user verification), not a person's Face ID.",
      segments: [
        { card: `<div class="grid3"><div class="pane"><p class="lab">clientDataJSON</p><dl><dt>type</dt><dd>${esc(a.client_data.type)}</dd><dt>challenge</dt><dd class="mono">${a.challenge_hex}</dd><dt>origin</dt><dd class="mono">${esc(a.client_data.origin)}</dd></dl><p class="ok">✓ challenge = the terms' SHA-256</p></div><div class="pane"><p class="lab">authenticatorData</p><dl><dt>rpIdHash</dt><dd class="mono">${short(a.authenticator_data.rp_id_hash, 32)}</dd><dt>flags</dt><dd class="mono">${a.authenticator_data.flags_byte} · UP ${a.authenticator_data.user_present ? 1 : 0} · UV ${a.authenticator_data.user_verified ? 1 : 0}</dd><dt>counter</dt><dd class="mono">${a.authenticator_data.sign_count}</dd></dl><p class="ok">✓ rpIdHash = SHA-256("${esc(host)}")</p></div><div class="pane why"><p class="lab">Why it can't be phished</p><p>The signature is bound to Purser's domain by the browser. A lookalike site gets a signature that is useless anywhere else.</p></div></div><p class="foot">Recorded with a virtual test passkey (user verification on), not a person's Face ID.</p>` }] },
    { id: "u04", title: "One cent", min: 14,
      vo: "Change one cent and the terms hash to something else entirely. The signature no longer matches, so nothing moves: zero transfers. Send the paid terms again, and the executor refuses to pay twice.",
      segments: [
        { clip: "try-walk", from: m.cheat! + 0.5, to: m["refused-held"]! },
        { card: `<div class="stack"><div class="pane"><p class="lab">Signed (EUR 1,850.00)</p><p class="hash">${f.refused.signed_sha256}</p></div><div class="pane bad"><p class="lab">Sent (EUR 1,850.01)</p><p class="hash">${diff(f.refused.sent_sha256, f.refused.signed_sha256)}</p></div><div class="row"><p class="big-x">Refused · transfers made: ${f.refused.transfers_after - f.refused.transfers_before}</p><p class="small">${f.refused.transfers_before} before, ${f.refused.transfers_after} after</p></div><div class="row"><p class="big-ok">The paid terms sent again: paid once, never twice</p><p class="small">transfers ${f.replay.transfers_before} → ${f.replay.transfers_after}</p></div></div>` }] },
    // Verify it yourself (15 Nov): the proof file from this very payment, checked in the browser on /verify; then one cent.
    { id: "u04v", title: "Verify it yourself", min: 18,
      vo: `Don't take our word for it. The finish hands over a proof file. Drop it on the verify page: your browser checks the hash, the passkey's signature and the ledger, and all ${f.verify.paid.length} checks pass. Change one cent in the file, and the hash, the challenge and the decision fail.`,
      segments: [
        // The passing result holds until the voice has said "all checks pass"; then the one-cent edit and its failure.
        { clip: "verify", from: Math.max(0, f.verify.marks.start! - 0.3), to: f.verify.marks["passed-held"]!, hold: 4.5 },
        { clip: "verify", from: f.verify.marks.edit! - 0.6, to: f.verify.marks["failed-held"]! },
      ] },
    { id: "u05", title: "At Airwallex", min: 26,
      vo: `${live ? "The exchange-rate quote inside the signed terms is a live quote from Airwallex's sandbox, by its id." : "The exchange-rate quote is in the signed terms, by its id."} In the main run, the transfer Airwallex made carries the hash the CFO approved, in its own metadata, and Purser reads it back and compares. Then every money flow was reconciled to the cent against Airwallex and the chain: no differences.`,
      segments: [{ card: `<div class="stack"><div class="pane"><p class="lab">${live ? "Live Airwallex sandbox FX quote, inside the signed terms" : "FX quote inside the signed terms"} · ${f.rec.recorded_at.slice(0, 10)}</p><dl class="wide"><dt>quote_id</dt><dd class="mono">${q?.quote_id ?? "—"}</dd><dt>rate</dt><dd>1 ${q?.buy_currency} = ${q?.client_rate} ${q?.sell_currency}${q?.market_rate ? ` · Airwallex's own rate ${q.market_rate}` : ""}</dd><dt>buys</dt><dd>${q?.buy_currency} ${q?.buy_amount} for ${q?.sell_currency} ${q?.sell_amount}</dd></dl></div><div class="pane"><p class="lab">Main run, 3 Nov (recorded) · Airwallex transfer ${f.xfer.id} · ${f.xfer.transfer_currency} ${f.xfer.transfer_amount.toFixed(2)} · ${f.xfer.status}</p><dl class="wide"><dt>metadata.approval_sha256</dt><dd class="mono">${f.xfer.metadata.approval_sha256}</dd><dt>P-0005, approved by passkey</dt><dd class="mono">${f.xfer.metadata.approval_sha256}</dd></dl><p class="ok">✓ equal · read back from Airwallex with GET only, ${f.xferReadAt.slice(0, 10)}</p></div><div class="row"><p class="big-ok">Reconciled ${f.reconFlows} money flows against Airwallex and Alta (formerly Metal): no differences</p><p class="small">main run, 3 Nov · sandbox and testnet, test money</p></div></div>` }] },
    { id: "u06", title: "The card's own limit", min: 15,
      vo: "Agents also pay by card. When a charge goes over the card's limit, Airwallex itself declines it, whatever the agent asks.",
      segments: [{ card: `<div class="hero small-hero"><p class="kicker">Recorded · awx-1, 7 Nov · Airwallex sandbox, test money</p><h2>EUR 45.00 charge on a card with a EUR 30.00 limit</h2><p class="big-x">Declined by Airwallex: LIMIT_EXCEEDED</p><p class="mono src">card transaction 01a1b5e8-6dc2-7000-95bf-c8fc5e6e2f38</p></div>` }] },
    { id: "u07", title: "The audit log, anchored", min: 17.5,
      vo: "Every step lands in an audit log where each row hashes the one before. Its head is written into a transaction on Alta, formerly Metal, on testnet. Anyone can recompute it from the repository: verify-anchor prints match.",
      segments: [{ card: `<div class="term"><p class="prompt">$ npm run verify-anchor</p><pre>${esc(readFileSync(resolve(root, "docs/film/under-the-hood/verify-anchor.txt"), "utf8").trim())}</pre></div><p class="foot">Run on ${esc(readFileSync(resolve(root, "docs/film/under-the-hood/verify-anchor.txt"), "utf8").match(/^# (.*)$/m)?.[1] ?? "15 Nov 2026")} against the Alta (formerly Metal) testnet RPC.</p>` }] },
    { id: "u08", title: "The numbers", min: 17.5,
      vo: `Only measured numbers. In the main run: ${f.decisions} decisions by Claude, ${f.alta} payments on Alta within the limits, ${f.faceId} signatures with Face ID, and nothing paid over a limit. And ${fmt(f.tests)} tests pass.`,
      segments: [{ card: `<div class="band"><div><b>${f.decisions}</b><span>decisions by Claude, 0 fallbacks</span><i>main run, 3 Nov</i></div><div><b>${f.alta}</b><span>Alta payments within the limits</span><i>main run, 3 Nov</i></div><div><b>${f.faceId}</b><span>signatures with Face ID</span><i>main run, 3 Nov</i></div><div><b>0</b><span>paid over a limit (${f.stops} stops)</span><i>main run, 3 Nov</i></div><div><b>${fmt(f.tests)}</b><span>tests passing</span><i>README, last full run</i></div></div>` }] },
    // The worst-case AI test (Max, 15 Nov: this, not a "Claude alone" comparison): Purser's AI replaced by a script that
    // always says pay, on the scorecard's invoices; beside it a payer with no rules. From the scorecard's record.
    { id: "u08s", title: "The worst-case AI test, and what Claude adds", min: 20,
      vo: `The worst-case test: Purser's AI replaced by a script that always says pay, on ${f.score.cases} hostile and clean invoices. ${f.score.scriptWrong === 0 ? "No wrong payment" : `${f.score.scriptWrong} wrong payments`}; a payer with no rules made ${f.score.naiveWrong}. What Claude adds: with the script, ${f.score.scriptNotHeld === 7 ? "seven" : f.score.scriptNotHeld} invoices only a reader catches went to the CFO to sign; with Claude reading, Purser held ${f.score.claudeNotHeld === 0 ? "every one" : `all but ${f.score.claudeNotHeld}`}.`,
      segments: [{ card: `<div class="lift"><p class="kicker">The worst-case AI test · ${f.score.cases} hostile and clean invoices · run ${f.score.runs === 2 ? "twice" : `${f.score.runs} times`} · ${f.score.ranOn}</p><table class="sc"><thead><tr><th></th><th>Purser, its AI replaced by a script that always says pay</th><th>Purser, with Claude reading</th><th>A payer with no rules</th></tr></thead><tbody><tr><td>Wrong payments</td><td class="good">${f.score.scriptWrong}</td><td class="good">${f.score.claudeWrong}</td><td class="bad">${f.score.naiveWrong}</td></tr><tr><td>Paid past the CFO</td><td class="good">${f.score.scriptPastCfo}</td><td class="good">${f.score.claudePastCfo}</td><td class="bad">${f.score.naivePastCfo}</td></tr><tr><td>Bad invoices left for the CFO to catch</td><td class="warn">${f.score.scriptNotHeld}</td><td class="good">${f.score.claudeNotHeld}</td><td class="na">pays all</td></tr></tbody></table><p class="foot src-top">${WORST_CASE_DOC} · each payer's worse run · test invoices</p><h2 class="line">${esc(WORST_CASE_HEADLINE)}</h2></div>` }] },
    { id: "u09", title: "An agent's own card", min: 18,
      vo: "A second use: each agent has its own card for the software it buys, with limits the CFO sets. The CFO can freeze a card with Face ID from Purser Cloud.",
      segments: [{ clip: "cloud-agents", from: 0, to: 10 }, { card: `<div class="hero small-hero"><p class="kicker">Purser Cloud · Agents</p><h2>Each agent's card: per purchase, per month, the kind of shop</h2><p class="sub">The CFO changes a limit or freezes a card with Face ID. In the public demo company these actions are switched off; the cards shown are simulated.</p></div>` }] },
    { id: "u10", title: "Close", min: 12,
      vo: "Purser: AI agents pay the bills, the CFO signs the exceptions, and every step can be checked. Built on Airwallex, with test money only. Try it yourself.",
      segments: [{ card: `<div class="hero"><p class="kicker">Purser · built on Airwallex</p><h1>Agents pay the bills.<br>The CFO signs the exceptions.<br>Every step can be checked.</h1><p class="links">kit11.max-31b.workers.dev/try · /proof · github.com/agamemnon-coder/x402-business-agents</p><p class="sub">Test money only · Airwallex sandbox · Alta (formerly Metal) testnet</p><p class="credit">Music: AI-generated (ElevenLabs)</p></div>` }] },
  ];
  // The order (jury, 15 Nov, 06:30): the hook first (one cent changed, refused, both hashes in view), then what Purser is,
  // live on /try, and the strongest proofs; at most 3:30. The bridge, the card decline and the agent's card are cut.
  return ORDER.map((id) => list.find((s) => s.id === id)!);
}

/** A card's page: the film's own style (dark, Inter, the brand's accent), 1920x1080. */
export function cardPage(body: string, font: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${font}) format("woff2");font-weight:100 900}
*{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;overflow:hidden}
body{background:radial-gradient(1200px 600px at 15% 0%,#1d1b4b 0%,transparent 60%),#0b0d12;color:#e8eaf2;font:400 32px/1.4 Inter,system-ui,sans-serif;padding:90px 110px 160px;display:flex;flex-direction:column;justify-content:center}
.mono,.hash,pre,code{font-family:"DejaVu Sans Mono",ui-monospace,monospace}
.hero h1{font-size:96px;line-height:1.05;letter-spacing:-.03em;margin:0 0 28px;font-weight:750}
.hero h2{font-size:56px;line-height:1.1;letter-spacing:-.02em;margin:0 0 28px;font-weight:700}
.kicker{color:#8b85ff;font-weight:650;font-size:28px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 24px}
.sub{color:#a3a9bb;font-size:32px;margin:0}
.links{font-size:34px;color:#c9ccff;margin:0 0 20px}
.two{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:start}
.grid3{display:grid;grid-template-columns:1fr 1fr .8fr;gap:32px;align-items:stretch}
.stack{display:grid;gap:24px}
.pane{background:#141824;border:1px solid #262c3d;border-radius:20px;padding:32px 36px}
.pane.bad{border-color:#6b2a30}
.pane.why{background:#17163a;border-color:#3b3780}
.lab{margin:0 0 16px;color:#9aa1b5;font-size:24px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
pre.code{margin:0;font-size:23px;line-height:1.45;color:#cdd3e4;white-space:pre-wrap}
.hl{color:#a9a4ff}
.hash{font-size:36px;line-height:1.45;word-break:break-all;color:#fff;margin:0}
.hash.big{font-size:44px}
.hash mark{background:#ff6b70;color:#0b0d12;border-radius:3px}
.ok{color:#3ccf82;font-weight:650;margin:16px 0 0;font-size:26px}
.src{color:#8a91a6;font-size:24px;margin:14px 0 0}
dl{display:grid;grid-template-columns:auto 1fr;gap:12px 24px;margin:0;font-size:28px}
dl.wide{grid-template-columns:420px 1fr}
dt{color:#9aa1b5}dd{margin:0;word-break:break-all}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:24px}
.big-x{font-size:46px;font-weight:750;color:#ff6b70;margin:0}
.big-ok{font-size:40px;font-weight:700;color:#3ccf82;margin:0}
.small{color:#9aa1b5;font-size:24px;margin:0;white-space:nowrap}
.foot{color:#8a91a6;font-size:24px;margin:28px 0 0}
.term{background:#05070b;border:1px solid #262c3d;border-radius:18px;padding:36px 44px}
.term .prompt{color:#8b85ff;font-family:"DejaVu Sans Mono",monospace;font-size:26px;margin:0 0 18px}
.term pre{margin:0;font-size:23px;line-height:1.6;color:#d6dbe8;white-space:pre-wrap}
.band{display:grid;grid-template-columns:repeat(5,1fr);gap:24px}
.band div{background:#141824;border:1px solid #262c3d;border-radius:20px;padding:36px 28px;display:grid;gap:12px}
.band b{font-size:84px;letter-spacing:-.03em;color:#fff;font-variant-numeric:tabular-nums}
.band span{font-size:26px;color:#d6dbe8;line-height:1.25}
.band i{font-style:normal;color:#8a91a6;font-size:22px}
.small-hero h2{font-size:52px}
table.sc{width:100%;border-collapse:separate;border-spacing:0 14px;font-size:30px}
table.sc th{color:#9aa1b5;font-weight:600;font-size:24px;text-align:center;padding:0 16px 8px;vertical-align:bottom}
table.sc td{background:#141824;padding:28px 20px;text-align:center;font-size:64px;font-weight:750;font-variant-numeric:tabular-nums}
table.sc td:first-child{text-align:left;font-size:28px;font-weight:500;color:#d6dbe8;border-radius:16px 0 0 16px;width:30%}
table.sc td:last-child{border-radius:0 16px 16px 0}
div.lift{margin-bottom:150px}p.src-top{margin:14px 0 0}h2.line{font-size:44px;font-weight:700;margin:22px 0 0;letter-spacing:-.01em}table.sc .na{font-size:26px;color:#8a91a6;font-weight:500}table.sc .good{color:#3ccf82}table.sc .bad{color:#ff6b70}table.sc .warn{color:#ffc26b}
.credit{color:#7d8498;font-size:22px;margin:28px 0 0}
</style></head><body>${body}</body></html>`;
}
