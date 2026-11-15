// The opening of /alta (Metal Award, 15 Nov): three facts, each with its explorer link and the record it comes from,
// then the numbers. Every hash, amount and date is read here from the run records, never typed in:
//   refused on chain  docs/runs/2026-11-12-faceid-onchain.json (the refusal step)
//   two owners        the same record (P-0002 relayed after 2 of 2 approvals) and docs/runs/passkey-owners.json
//                     (1 Nov: the mandate bind with the CFO's passkey alone, reverted on chain)
//   the anchor        docs/runs/2026-11-13-anchor.json, and docs/runs/2026-11-15-anchor-verified.json (verify-anchor
//                     run live on 15 Nov: MATCH)
// A record that is missing or does not show its fact leaves that fact out; with no fact the block is empty.

import { existsSync, readFileSync } from "node:fs";
import { EXPLORER, REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const ALTA_FACTS_ID = "alta-facts";
export const FACEID_RECORD = "docs/runs/2026-11-12-faceid-onchain.json";
export const OWNERS_RECORD = "docs/runs/passkey-owners.json";
export const ANCHOR_RECORD = "docs/runs/2026-11-13-anchor.json";
export const ANCHOR_VERIFIED_RECORD = "docs/runs/2026-11-15-anchor-verified.json";
export const NO_ENDORSEMENT_ALTA = "No endorsement implied";

type Step = { kind?: string; step?: string; outcome?: string; tx?: string | null; at?: string };
const TX = /^0x[0-9a-f]{64}$/;

function read<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as T; } catch { return null; }
}
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

export interface AltaFact { id: "refused" | "owners" | "anchor"; title: string; text: string; links: { label: string; href: string }[]; record: string[] }

export interface AltaFactsInput {
  faceid?: { steps?: Step[] } | null;
  owners?: { ran_at?: string; steps?: Step[] } | null;
  anchor?: { tx?: string; anchored_at?: string } | null;
  verified?: { result?: string; ran_at?: string; tx?: string } | null;
}

export function altaFacts(i: AltaFactsInput = {
  faceid: read(FACEID_RECORD), owners: read(OWNERS_RECORD), anchor: read(ANCHOR_RECORD), verified: read(ANCHOR_VERIFIED_RECORD),
}): AltaFact[] {
  const out: AltaFact[] = [];
  const steps = i.faceid?.steps ?? [];
  const txOf = (s: Step | undefined) => (s && typeof s.tx === "string" && TX.test(s.tx) ? s.tx : null);

  const refusal = steps.find((s) => s.kind === "refusal" && s.outcome === "refused on chain");
  const over = refusal?.step ? /^([\d.]+) to (\w+), over the mandate's ([\d.]+) cap/.exec(refusal.step) : null;
  if (refusal && over && txOf(refusal) && refusal.at) {
    out.push({ id: "refused", title: "Refused on chain",
      text: `${day(refusal.at)}: ${over[1]} to ${over[2]}, over the mandate's ${over[3]} cap. Alta refused it on chain; nothing moved.`,
      links: [{ label: "tx", href: `${EXPLORER}/tx/${txOf(refusal)}` }], record: [FACEID_RECORD] });
  }

  // The mandate change: the relay of P-0002 after both owners signed; and, separately, one passkey alone refused.
  const signed = steps.find((s) => s.kind === "approvals" && /P-0002/.test(s.step ?? "") && s.outcome === "2 of 2 approvals");
  const change = steps.find((s) => s.kind === "relay" && /P-0002/.test(s.step ?? "") && s.outcome === "executed");
  const alone = (i.owners?.steps ?? []).find((s) => /mandate with the CFO's passkey alone/.test(s.step ?? "") && s.outcome === "reverted");
  if (signed && change && txOf(change) && change.at) {
    const links = [{ label: "both: tx", href: `${EXPLORER}/tx/${txOf(change)}` }];
    const record = [FACEID_RECORD];
    let text = `${day(change.at)}: the cap changed only after both owners signed: the CFO's iPhone passkey and a labelled test passkey.`;
    if (alone && txOf(alone) && i.owners?.ran_at) {
      text += ` One passkey alone: refused on chain (${day(i.owners.ran_at)}, software passkeys).`;
      links.push({ label: "one: tx", href: `${EXPLORER}/tx/${txOf(alone)}` });
      record.push(OWNERS_RECORD);
    }
    out.push({ id: "owners", title: "Two passkey owners", text, links, record });
  }

  const at = i.anchor?.anchored_at;
  if (i.anchor?.tx && TX.test(i.anchor.tx) && at) {
    const v = i.verified && i.verified.result === "MATCH" && i.verified.tx === i.anchor.tx && i.verified.ran_at ? i.verified : null;
    out.push({ id: "anchor", title: "Anchored",
      text: `${day(at)}: the head of Purser's records, in one transaction.${v ? ` verify-anchor run live on ${day(v.ran_at!)}: MATCH.` : ""}`,
      links: [{ label: "tx", href: `${EXPLORER}/tx/${i.anchor.tx}` }], record: v ? [ANCHOR_RECORD, ANCHOR_VERIFIED_RECORD] : [ANCHOR_RECORD] });
  }
  return out;
}

export const ALTA_FACTS_CSS = `.afacts { display: grid; gap: 10px; margin: 0 0 18px; }
.afacts ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.afacts li { padding: 14px 16px; display: grid; gap: 6px; align-content: start; }
.afacts h2 { margin: 0; font-size: 17px; line-height: 1.3; display: flex; align-items: center; gap: 8px; }
.afacts p { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.afacts .alinks { display: flex; flex-wrap: wrap; gap: 0 14px; font-size: 14px; }
.afacts .alinks a { display: inline-flex; align-items: center; min-height: 44px; }
.afacts .anum { font-size: 15px; margin: 0; }
.afacts .anum a { display: inline-flex; align-items: center; min-height: 44px; }
.phd .noend { font-size: 13px; color: var(--muted); }`;

const ICON: Record<AltaFact["id"], string> = { refused: "ban", owners: "users", anchor: "shield-check" };
/** The record's readable page when it has one (the .md beside the .json), else the .json itself. */
const shown = (file: string) => { const md = file.replace(/\.json$/, ".md"); return md !== file && existsSync(new URL(`../../${md}`, import.meta.url)) ? md : file; };
/** A record named by its run's date ("12 Nov record"), its file in the link (and in the link's title). */
const RECORD_DAY: Record<string, string> = { [FACEID_RECORD]: "12 Nov", [OWNERS_RECORD]: "1 Nov", [ANCHOR_RECORD]: "13 Nov", [ANCHOR_VERIFIED_RECORD]: "15 Nov" };
const recordLink = (file: string) => `<a href="${esc(`${REPO_BLOB}${shown(file)}`)}" title="${esc(shown(file))}" target="_blank" rel="noopener">${esc(`${RECORD_DAY[file] ?? file.split("/").pop()} record`)} ↗</a>`;

/** The block: the three facts, then the numbers (the main run's Alta payments, with their list). */
export function altaFactsHtml(facts: AltaFact[], payments: { count: number; list: string } | null): string {
  if (!facts.length) return "";
  // data-rec: the fact's own record (its first), as the site's other dated blocks name theirs.
  const li = (f: AltaFact) => `<li class="card" id="fact-${f.id}" data-rec="${esc(f.record[0]!)}"><h2>${icon(ICON[f.id], 18)}${esc(f.title)}</h2><p>${esc(f.text)}</p>
<p class="alinks">${f.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}${f.record.map(recordLink).join("")}</p></li>`;
  const num = payments ? `<p class="anum">${esc(`${payments.count} Alta payments in the main run, each its own transaction.`)} <a href="${esc(`${REPO_BLOB}${payments.list}`)}" title="${esc(payments.list)}" target="_blank" rel="noopener">${esc("3 Nov record")} ↗</a></p>` : "";
  return `<section class="afacts" id="${ALTA_FACTS_ID}" aria-label="${esc("Three facts on Alta testnet")}"><ol>${facts.map(li).join("")}</ol>${num}</section>`;
}
