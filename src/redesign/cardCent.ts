// One cent over the limit, at Airwallex itself (15 Nov). On an agent's live card with a per-purchase limit L, the CFO
// signs one action in Purser Cloud (passkey) and two sandbox authorizations run through Airwallex's simulated card
// transaction API: exactly L, then L + 0.01. Airwallex's own answers (approved, or declined with its reason code), with
// their ids and times, are kept in docs/runs/airwallex-card-cent-YYYY-MM-DD.json (written by scripts/cardCentRecord.ts from
// Purser Cloud's GET /v1/cards/edge/latest). This module reads that record and says what it holds: the line is computed
// from the record, never typed in, and with no record (or one that is not exactly L and L + 0.01) nothing is claimed.
//
// It also draws /airwallex's live block: each agent's live card and its older test cards, read from the sandbox when the
// page opens (worker/src/agentCardsLive.ts), sorted by the same function as Purser Cloud's Agents tab.
import { readFileSync } from "node:fs";
import { AGENT_CARDS_PATH } from "../../worker/src/agentCardsLive.js";
import { latestRecordFile } from "./airwallexProof.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const CENT_PREFIX = "airwallex-card-cent";

export interface CentAttempt { amount_cents: number; currency: string; id: string | null; at: string; status: string; approved: boolean; failure_reason: string | null }
export interface CentRecord {
  run: string; ran_at: string; label: string; method: string; agent: string; action_sha256: string;
  /** Who signed the action, as the company's records name them (15 Nov: a labelled software test passkey says so in its name). */
  signed_by?: { name: string; role: string; how: string };
  card: { last4: string | null; card_id_last4: string; per_tx_cents: number; monthly_cents: number | null };
  attempts: CentAttempt[];
}

export function centRecord(names?: string[]): { file: string; rec: CentRecord } | null {
  const file = latestRecordFile(CENT_PREFIX, names);
  if (!file) return null;
  return { file, rec: JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")) as CentRecord };
}

const eur = (c: number) => `EUR ${(c / 100).toFixed(2)}`;
const word = (a: CentAttempt) => (a.approved ? "approved" : `declined${a.failure_reason ? ` (${a.failure_reason})` : ""}`);

/** The line, from the record: only for exactly L then L + 0.01 on a card whose limit is L; else null. */
export function centLine(rec: CentRecord): string | null {
  const [a, b] = rec.attempts;
  if (!a || !b || rec.attempts.length !== 2) return null;
  if (a.amount_cents !== rec.card.per_tx_cents || b.amount_cents !== a.amount_cents + 1 || a.currency !== "EUR" || b.currency !== "EUR") return null;
  return `Airwallex itself: ${eur(a.amount_cents)} ${word(a)}, ${eur(b.amount_cents)} ${word(b)}`;
}
/** Whether the record shows the limit holding to the cent: L approved and L + 0.01 declined. */
export const centHolds = (rec: CentRecord) => centLine(rec) !== null && rec.attempts[0]!.approved && !rec.attempts[1]!.approved;

export const CENT_ID = "awx-cent";

/** The block for /airwallex and /proof: the computed line, each answer with its id and time, and the record. */
export function centHtml(r: { file: string; rec: CentRecord } | null): string {
  const line = r ? centLine(r.rec) : null;
  if (!r || !line) return "";
  const ok = centHolds(r.rec);
  const time = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  const items = r.rec.attempts.map((a) => `<li class="${a.approved ? "" : "no"}">${esc(`${eur(a.amount_cents)}: ${word(a)}`)}<br><small>${esc(`id ${a.id ?? "none given"} · ${time(a.at)}`)}</small></li>`).join("");
  return `<div class="card" id="${CENT_ID}"><h3>${icon("credit-card", 18)}${esc(`One cent over the limit, on the ${r.rec.agent} agent's card ····${r.rec.card.last4 ?? "?"}`)}</h3>
<p>${esc(`Its limit is ${eur(r.rec.card.per_tx_cents)} a purchase. Two test purchases at the Airwallex sandbox: exactly the limit, then one cent more.`)}</p>
<span class="awm ${ok ? "ok" : "bad"}">${icon(ok ? "circle-check" : "octagon-x", 16)}${esc(line)}</span>
<ul class="awc">${items}</ul>
${r.rec.signed_by ? `<p>${esc(`Signed by ${r.rec.signed_by.name}, the company's ${r.rec.signed_by.role}: ${r.rec.signed_by.how}.`)}</p>` : ""}
<p class="src">${esc(`${r.rec.method} · ${r.rec.label} · signed action ${r.rec.action_sha256.slice(0, 12)}…`)} · <a href="${esc(REPO_BLOB + r.file)}">${esc(r.file)}</a></p></div>`;
}

export const LIVE_CARDS_ID = "awx-live-cards";
/** /airwallex's live block: filled in by LIVE_CARDS_JS from the sandbox; says so when the read is unavailable. */
export function liveCardsHtml(): string {
  // Folded (word budget of /airwallex): the summary line names it; the reading is inside.
  return `<details class="card fold" id="${LIVE_CARDS_ID}"><summary>${esc("The agents' cards today, live")}</summary>
<p id="awx-live-sum">${esc("Reading the sandbox…")}</p><ul class="awc" id="awx-live-list"></ul>
<p class="src">${esc("GET /issuing/cards, read live when this page opens, at most once a minute for everyone · sandbox, test money · no card number beyond its last four digits · the same reading as Purser Cloud's Agents tab")}</p></details>`;
}

/** Fills the live block. Remote values only ever go in as text. */
export const LIVE_CARDS_JS = `(function () {
  var sum = document.getElementById("awx-live-sum"), list = document.getElementById("awx-live-list");
  if (!sum || !list || !window.fetch) return;
  var eur = function (c) { return typeof c === "number" ? "EUR " + (c / 100).toFixed(2) : "no limit read"; };
  var li = function (text, bad) { var x = document.createElement("li"); if (bad) x.className = "no"; x.textContent = text; list.appendChild(x); };
  fetch("${AGENT_CARDS_PATH.slice(1)}", { headers: { accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : false; }).then(function (a) {
    if (!a || a.source !== "airwallex-sandbox" || !a.summary || !a.agents) { sum.textContent = "The sandbox did not answer just now" + (a && a.reason ? " (" + a.reason + ")" : "") + "; nothing is shown in its place."; return; }
    sum.textContent = a.summary.text + ". Read " + String(a.read_at).slice(11, 16) + " UTC.";
    a.agents.forEach(function (s) {
      var name = s.agent.charAt(0).toUpperCase() + s.agent.slice(1) + " agent";
      if (s.live) li(name + ": live card ····" + (s.live.last4 || "?") + ", " + s.live.status.toLowerCase() + ", " + eur(s.live.per_tx_cents) + " a purchase, " + eur(s.live.monthly_cents) + " a month; " + (s.in_sync ? "matches the CFO policy" : "the CFO policy is " + eur(s.policy.per_tx_cents) + " and " + eur(s.policy.monthly_cents)), !s.in_sync);
      else li(name + ": no live card", true);
      s.older.forEach(function (o) { li(name + ": older test card ····" + (o.last4 || "?") + ", " + eur(o.per_tx_cents) + " a purchase, " + (o.frozen ? "frozen" : "still active, to be frozen"), !o.frozen); });
    });
  }).catch(function () { sum.textContent = "The sandbox did not answer just now; nothing is shown in its place."; });
})();`;
