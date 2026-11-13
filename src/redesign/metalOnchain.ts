// Two sections for /metal (master list 585), each rendered only from a run record, with real transaction links only:
//
// 1. "Face ID signs on chain": the passkey account on Metal testnet (docs/runs/<date>-faceid-onchain.json, written by
//    `npm run owners -- record`). The mandate changes ran only after both owner passkeys signed, and the account checked
//    the signatures itself. Shown as six steps: bind, paid, refused on chain, raised, paid, revoked; each links its
//    transaction. The second signer is a labelled virtual test passkey and says so; the CFO's device is as stated.
// 2. "Invoice → token → pre-financing → settlement": the invoice-token prototype (docs/runs/<date>-tokenize.json, the
//    record src/redesign/tokenizeRun.ts reads). Four steps, each from a transaction that landed.
//
// Without a record each section is one labelled line, "Built; the live run on Metal testnet has not happened yet", with
// a link to its runbook. Never a placeholder hash: a link shows only when the record has the transaction and its link
// is Metal's explorer for exactly that hash. test/metal-onchain.test.ts holds both states on fixture records.

import { readdirSync, readFileSync } from "node:fs";
import type { TokenizeRunRecord } from "../tokenize/runRecord.js";
import { faceIdTick } from "../ui/motion.js";
import { EXPLORER_TX } from "../metal/network.js";
import { REPO_BLOB } from "./metalStory.js";
import { showable } from "./tokenizeRun.js";
import { esc, icon } from "./ui.js";

const RUNS = new URL("../../docs/runs/", import.meta.url);
export const FACEID_RUNBOOK = "docs/runs/driver/faceid-onchain-runbook.md";
export const TOKENIZE_RUNBOOK = "docs/runs/driver/tokenize-runbook.md";
/** The one line a section shows without its record. */
export const NOT_RUN_YET = "Built; the live run on Metal testnet has not happened yet.";
// Review, 13 Nov: the chain verifies a passkey's P-256 signature; which device made it (the owner states an iPhone with
// Face ID) the chain does not prove, so the title names the passkey.
export const FACEID_TITLE = "Passkeys sign on chain (P-256)";
export const TOKEN_TITLE = "Invoice → token → pre-financing → settlement";

const newest = (names: string[], suffix: string) => names.filter((n) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${suffix}\\.json$`).test(n)).sort().pop();
const load = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T; } catch { return null; } };
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const HASH = /^0x[0-9a-f]{64}$/;
/** A transaction link only when the hash is a real-shaped hash and the link is Metal's explorer for exactly it. */
const txLink = (hash: string | null | undefined, explorer?: string | null) =>
  hash && HASH.test(hash) && (explorer === undefined || explorer === `${EXPLORER_TX}${hash}`) ? `${EXPLORER_TX}${hash}` : null;

// ── 1. Face ID signs on chain ──

export interface OwnersStep { kind: string; step: string; outcome: string; at: string; tx: string | null; explorer?: string; proposal_id?: string }
export interface OwnersRecord {
  ran_at: string; network: string; chain_id: number; money: string; stand_in?: string; threshold: number;
  owners: { role: string; label: string; virtual: boolean; device?: string; device_basis?: string }[];
  steps: OwnersStep[];
  proposals: { proposal_id: string; what: string; status: string; cap?: string; budget?: string; tx?: string; explorer?: string }[];
}
export interface OwnersRun { file: string; rec: OwnersRecord }

export function ownersRunFile(names: string[] = readdirSync(RUNS)): string | null {
  const f = newest(names, "faceid-onchain");
  return f ? `docs/runs/${f}` : null;
}

/** The record when this section may show it: Metal testnet, test money, at least one change the account ran. */
export function ownersRun(file: string | null = ownersRunFile()): OwnersRun | null {
  if (!file) return null;
  const rec = load<OwnersRecord>(file);
  if (!rec || rec.network !== "Metal testnet" || !/test/i.test(rec.money) || !Array.isArray(rec.steps)) return null;
  return rec.steps.some((s) => s.kind === "relay" && s.outcome === "executed" && txLink(s.tx, s.explorer)) ? { file, rec } : null;
}

export interface ChainStep { key: "bind" | "replace" | "revoke" | "paid" | "refused"; label: string; at: string; href: string; hash: string; signed: boolean }

/** The steps in sight, in the record's order: each mandate change the account ran, each payment and each refusal. */
export function ownersSteps(rec: OwnersRecord): ChainStep[] {
  const out: ChainStep[] = [];
  for (const s of rec.steps) {
    const href = txLink(s.tx, s.explorer);
    if (!href || !s.tx) continue;
    if (s.kind === "relay" && s.outcome === "executed") {
      const p = rec.proposals.find((x) => x.proposal_id === s.proposal_id);
      const what = p?.what;
      if (what !== "bind" && what !== "replace" && what !== "revoke") continue;
      const label = what === "revoke" ? "Revoked" : what === "bind" ? `Bound: cap ${p!.cap ?? "?"}` : `Raised: cap ${p!.cap ?? "?"}`;
      out.push({ key: what, label, at: s.at, href, hash: s.tx, signed: true });
    } else if (s.kind === "payment" && s.outcome === "paid") {
      const amount = /pays ([\d.]+)/.exec(s.step)?.[1];
      if (amount) out.push({ key: "paid", label: `Paid ${amount}`, at: s.at, href, hash: s.tx, signed: false });
    } else if (s.kind === "refusal" && s.outcome === "refused on chain") {
      const amount = /^([\d.]+) to /.exec(s.step)?.[1];
      if (amount) out.push({ key: "refused", label: `Refused ${amount}`, at: s.at, href, hash: s.tx, signed: false });
    }
  }
  return out;
}

const stepIcon = (k: ChainStep["key"]) => k === "refused" ? icon("octagon-x", 16) : k === "paid" ? icon("circle-check", 16) : k === "revoke" ? icon("lock", 16) : faceIdTick(16, "Both passkeys signed");

/** The section, or the one labelled line when there is no record. */
export function faceIdOnChainSection(run: OwnersRun | null = ownersRun()): string {
  if (!run) return notYet(FACEID_TITLE, FACEID_RUNBOOK);
  const { rec, file } = run;
  const steps = ownersSteps(rec);
  const virtual = rec.owners.filter((o) => o.virtual).length;
  const cfo = rec.owners.find((o) => o.role === "CFO" && !o.virtual);
  const lead = `${dayOf(rec.ran_at)}: the agent's limit changed only with ${rec.threshold} passkeys, checked on chain.`;
  const labels = [`${rec.network}`, "test money", ...(virtual ? [`${virtual === 1 ? "second signer" : `${virtual} signers`}: labelled virtual test passkey`] : []), ...(cfo?.device_basis ? [`CFO's device ${cfo.device_basis}`] : [])];
  // data-rec: every figure here is the record's own (test/metal-onchain.test.ts); the hash of each step is its link's,
  // last, in its label for a screen reader, not in sight.
  return `<article class="moc" id="faceid-onchain" aria-labelledby="moc-faceid" data-rec="${esc(file)}"><h2 id="moc-faceid">${esc(FACEID_TITLE)}</h2>
<p class="moc-lead">${esc(lead)}</p>
<ol class="moc-steps">${steps.map((s) => `<li class="moc-${s.key}"><a href="${esc(s.href)}" target="_blank" rel="noopener" aria-label="${esc(`${s.label}: transaction ${s.hash} on Metal's explorer`)}"><span class="moc-ic">${stepIcon(s.key)}</span><span class="moc-l">${esc(s.label)}</span><span class="moc-x" aria-hidden="true">↗</span></a></li>`).join("")}</ol>
<p class="moc-src">${esc(labels.join(" · "))} · <a class="pf" href="${esc(`${REPO_BLOB}${file.replace(/\.json$/, ".md")}`)}" target="_blank" rel="noopener">run record ↗</a></p></article>`;
}

// ── 2. Invoice → token → pre-financing → settlement ──

export interface TokenRun { file: string; rec: TokenizeRunRecord }
export function tokenRunFile(names: string[] = readdirSync(RUNS)): string | null {
  const f = newest(names, "tokenize");
  return f ? `docs/runs/${f}` : null;
}
export function tokenRun(file: string | null = tokenRunFile()): TokenRun | null {
  if (!file) return null;
  const rec = load<TokenizeRunRecord>(file);
  return rec && showable(rec) ? { file, rec } : null;
}

export interface FlowNode { key: "invoice" | "token" | "financed" | "settled"; label: string; note: string; href: string | null; hash: string | null }

/** The four steps, each from the record: a step whose transaction did not land shows as not run. */
export function tokenFlow(rec: TokenizeRunRecord): FlowNode[] {
  const tx = (key: string) => rec.transactions.find((t) => t.key === key && t.status === "success" && txLink(t.hash, t.explorer));
  const node = (key: FlowNode["key"], label: string, note: string, t: ReturnType<typeof tx> | null): FlowNode => ({ key, label, note, href: t ? `${EXPLORER_TX}${t.hash}` : null, hash: t?.hash ?? null });
  const a = rec.invoice.approval;
  const who = a.test_passkey ? "approved with a labelled test passkey" : "approved with a passkey";
  const mint = tx("mint"), accept = tx("accept"), settle = tx("settle");
  return [
    node("invoice", "Invoice", `${rec.invoice.invoice_no}, ${who}`, null),
    node("token", "Token", mint ? `face value ${rec.face_value.amount} test USD` : "not run", mint ?? null),
    node("financed", "Pre-financing", accept && rec.received.creditor ? `a simulated financier paid ${rec.received.creditor}` : "not run", accept ?? null),
    node("settled", "Settlement", settle && rec.received.holder ? `the debtor paid ${rec.received.holder} to the holder` : "not run", settle ?? null),
  ];
}

/** The section, or the one labelled line when there is no record. */
export function tokenFlowSection(run: TokenRun | null = tokenRun()): string {
  if (!run) return notYet(TOKEN_TITLE, TOKENIZE_RUNBOOK);
  const { rec, file } = run;
  const nodes = tokenFlow(rec);
  return `<section class="moc" id="invoice-token-flow" aria-labelledby="moc-token"><h2 id="moc-token">${esc(TOKEN_TITLE)}</h2>
<ol class="moc-flow">${nodes.map((n) => `<li class="${n.href || n.key === "invoice" ? "on" : "off"}"><b>${esc(n.label)}</b><span>${esc(n.note)}</span>${n.href && n.hash ? `<a class="pf" href="${esc(n.href)}" target="_blank" rel="noopener" aria-label="${esc(`${n.label}: transaction ${n.hash} on Metal's explorer`)}">${esc(shortHash(n.hash))} ↗</a>` : ""}</li>`).join("")}</ol>
<p class="moc-src">${esc(`Prototype · ${rec.labels.network} · test money · financier simulated · amounts scaled down ${rec.labels.face_value_scaled_by}× for testnet · ${dayOf(rec.date)}`)} · <a class="pf" href="${esc(`${REPO_BLOB}${file.replace(/\.json$/, ".md")}`)}" target="_blank" rel="noopener">run record ↗</a></p></section>`;
}

function notYet(title: string, runbook: string): string {
  return `<p class="moc-none"><b>${esc(title)}.</b> ${esc(NOT_RUN_YET)} <a class="pf" href="${esc(`${REPO_BLOB}${runbook}`)}" target="_blank" rel="noopener">runbook ↗</a></p>`;
}

/** The style: the site's tokens only. */
export const METAL_ONCHAIN_CSS = `
.moc { margin: 28px 0; }
.moc h2 { margin: 0 0 6px; }
.moc-lead { margin: 0 0 12px; max-width: 62ch; }
.moc-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.moc-steps li { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.moc-steps li a { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: var(--text); text-decoration: none; border-radius: 12px; min-height: 44px; }
.moc-steps li a:hover .moc-l { text-decoration: underline; } .moc-steps li a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.moc-steps .moc-x { margin-left: auto; color: var(--muted); }
.moc-steps .moc-ic { display: inline-flex; color: var(--ok); }
.moc-steps .moc-refused { border-color: var(--bad); } .moc-steps .moc-refused .moc-ic { color: var(--bad); }
.moc-steps .moc-revoke .moc-ic { color: var(--muted); }
.moc-steps .moc-l { font-weight: 650; }
.moc-flow a { font-size: 13px; overflow-wrap: anywhere; }
.moc-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; counter-reset: moc; }
.moc-flow li { display: grid; gap: 4px; align-content: start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.moc-flow li.off { color: var(--muted); border-style: dashed; }
.moc-flow span { font-size: 14px; color: var(--muted); }
@media (max-width: 640px) { .moc-flow { grid-template-columns: 1fr; } }
.moc-src, .moc-none { color: var(--muted); font-size: 13.5px; margin: 8px 0 0; }
.moc-none b { color: var(--text); }`;
