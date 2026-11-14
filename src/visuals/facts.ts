// What the "held by the rail itself" visual says, read from the run records, never typed: each rail's own control
// holding one payment in a live sandbox or testnet run, with its record. A record that no longer names the figures
// drops its card (null), so the visual can only show what a record holds.
//
// - Airwallex: the two-locks run (10 and 12 Nov), its two run logs: after a labelled virtual test passkey signed the
//   terms in Purser, Airwallex's own transfer approval workflow held the transfer IN_APPROVAL until a person approved it
//   at Airwallex (12 Nov); then PAID, with simulated settlement.
// - Alta: the main run (3 Nov), its record (docs/demo/main-run.json): Purser's pre-check switched off for one purchase
//   as a test, and Alta refused it on chain (mandate_cap_exceeded). Nothing settled.
// - Airi (Visa Intelligent Commerce via Airwallex's Airi): the Airi run (7 Nov), its record (docs/demo/airi-run.json):
//   in a failed attempt, a purchase waited for the cardholder's passkey in Airi; none came, so Airi gave no card
//   credential and nothing was charged; Purser's own timeout then cancelled the mandate. Airi has not refused a
//   purchase outright in a live run, and the card says so.

import { readFileSync } from "node:fs";
import { agentRun } from "../redesign/run.js";
import { metalStory } from "../redesign/metalStory.js";
import { AIRI_RUN_FILE, AIRI_RUN_LOG } from "../redesign/airiRun.js";

export const TWO_LOCKS_LOG = "docs/runs/2026-11-10-airwallex-two-locks.md";
export const TWO_LOCKS_PAID_LOG = "docs/runs/2026-11-12-airwallex-two-locks-paid.md";
export const MAIN_RUN_LOG = "docs/runs/2026-11-03-main-run.md";
export const MAIN_RUN_RECORD = "docs/demo/main-run.json";

export type Rail = "airwallex" | "metal" | "airi";
export interface RailRefusal {
  rail: Rail;
  /** The rail's name, as the pages write it (text only, never a logo). */
  name: string;
  /** What the rail answered, in its own words (a status or an error code); null when the rail gave no answer to show. */
  code: string | null;
  /** The step that held, when there is no code of the rail's to show. */
  held?: string;
  /** The control that held, in a few words. */
  control: string;
  /** What happened, two short sentences, every figure from the record. */
  what: string;
  /** The same in one line, for the card (the owner, 12 Nov: one line each); the full sentences stay in what. */
  short: string;
  /** The date of the run (ISO date) and its label. */
  date: string;
  label: string;
  /** The run log (repo path) and, when there is one, the outside proof (an explorer link). */
  record: string;
  proof?: { label: string; href: string };
  /** A line of honesty, when the card shows less than a refusal. */
  note?: string;
}

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const isoDay = (iso: string) => iso.slice(0, 10);

/** Airwallex's hold, from the two-locks run logs (10 Nov: created and held; 12 Nov: approved at Airwallex, then PAID). */
export function airwallexHold(log = read(TWO_LOCKS_LOG), paid = read(TWO_LOCKS_PAID_LOG)): RailRefusal | null {
  const transfer = /Transfer `([0-9a-f-]{36})`/.exec(log)?.[1];
  const amount = /(EUR [\d,]+\.\d\d) SWIFT/.exec(log)?.[1];
  const status = /Airwallex answered \*\*`([A-Z_]+)`\*\* on create/.exec(log)?.[1];
  const created = /created (\d{4}-\d\d-\d\dT[\d:]+Z)/.exec(log)?.[1];
  const virtual = /labelled virtual test passkey/.test(log) && /labelled virtual test passkey, not a person's device/.test(paid);
  const approvedAt = /\*\*The owner approved the transfer in the Airwallex sandbox web app\*\*/.test(paid);
  const ended = /\| `(PAID)`, simulated settlement \|/.exec(paid)?.[1];
  const day = /^# .*\((\d{1,2} \w+ \d{4})\)/m.exec(paid)?.[1];
  if (!transfer || !amount || !status || !created || !virtual || !approvedAt || !ended || !day || !paid.includes(transfer)) return null;
  const approvedDay = new Date(`${day} 12:00 UTC`).toISOString().slice(0, 10);
  return {
    rail: "airwallex", name: "Airwallex", code: status, control: "Its own transfer approval workflow",
    // Jury pass, 13 Nov: the card is dated the day it ended PAID (12 Nov), and links that day's record.
    short: `Held ${transfer.slice(0, 8)}… (${amount}) until a person approved it at Airwallex; then ${ended}.`,
    what: `A labelled virtual test passkey signed the terms in Purser; Purser created transfer ${transfer.slice(0, 8)}… for ${amount} on ${shortDay(isoDay(created))}. Airwallex held it ${status} until a person approved it at Airwallex, ${shortDay(approvedDay)}; then ${ended} (simulated settlement).`,
    date: approvedDay, label: "Airwallex sandbox, test money", record: TWO_LOCKS_PAID_LOG,
  };
}
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** Alta's refusal on chain, from the main run's record. */
export function metalRefusal(): RailRefusal | null {
  const run = agentRun();
  if (run.standIn) return null;
  const r = metalStory(run.record).refusal;
  const day = run.events.find((e) => e.k === "money")?.at ?? run.record.snapshot.flows[0]?.at;
  if (!r || !r.code || !r.amount || !r.cap || !day) return null;
  return {
    rail: "metal", name: "Alta", code: r.code, control: "The agent's mandate cap, on chain",
    short: `Refused #${r.seq} on chain: ${r.amount} over the ${r.cap} cap.`,
    what: `As a test, Purser's own check was switched off for one purchase. Alta refused #${r.seq} (${r.amount} test USD, over the ${r.cap} cap) and recorded the refusal on chain; nothing settled.`,
    date: isoDay(day), label: "Alta testnet, test money", record: MAIN_RUN_LOG, ...(r.proof.href ? { proof: { label: r.proof.label, href: r.proof.href } } : {}),
  };
}

interface AiriRecord { mode: string; test_money: boolean; test_card: boolean; attempts: { world: string; attempt?: number; at: string; cause: string | null }[] }

/** Airi's passkey step holding, from the Airi run's record. */
export function airiHold(record: AiriRecord = JSON.parse(read(AIRI_RUN_FILE)) as AiriRecord): RailRefusal | null {
  if (record.mode !== "live" || !record.test_money || !record.test_card) return null;
  const a = record.attempts.find((x) => /no tap within (\d+) minutes, PURSER_NO_TAP, mandate cancelled/.test(x.cause ?? ""));
  const minutes = /no tap within (\d+) minutes/.exec(a?.cause ?? "")?.[1];
  if (!a || !minutes) return null;
  return {
    rail: "airi", name: "Visa Intelligent Commerce via Airi", code: null, held: "Airi's passkey step", control: "The cardholder's passkey in Airi, each purchase",
    short: `Not confirmed in Airi within ${minutes} minutes: no card credential, nothing charged.`,
    what: `In a failed attempt, a purchase waited for the cardholder to confirm it with a passkey in Airi. The confirmation did not come within ${minutes} minutes: no card credential, nothing charged. Purser's own timeout (PURSER_NO_TAP) then cancelled the mandate.`,
    date: isoDay(a.at), label: "Airwallex sandbox, test card, test money", record: AIRI_RUN_LOG,
    note: "Airi has not refused a purchase outright in a live run.",
  };
}

/** The three, in the order the pages name the rails; a record without the figures drops its card. */
export const railRefusals = (): RailRefusal[] => [airwallexHold(), metalRefusal(), airiHold()].filter((x): x is RailRefusal => x !== null);
