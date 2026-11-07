// The Airi rail's live dependencies: the pinned airi-cli and the Airwallex sandbox checkout. And where the one-time
// approval link goes: never into a log or a record.
//
// - In the vic-1 conductor (a person watches its console), the link is printed on one console line.
// - In the runner (its output is a log), the link is written to a 0600 file in this world's keys folder, outside the
//   repo, and the log line says only that it is there; the file is removed as soon as the tap is over. The vic-1
//   conductor, waiting for that purchase, prints it from there on its own console at once and removes it
//   (awaitWithTap).
//
// The checkout: AIRI_CHECKOUT=hosted (the default; Airwallex's Hosted Payment Page, hostedCheckout.ts) or api (the
// REST confirm, checkout.ts, which our sandbox refuses: "not enabled for native API access", 7 November).

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { keyPath } from "../metal/agentCli.js";
import { AirwallexSandboxCheckout } from "./checkout.js";
import { AiriCliClient } from "./cli.js";
import type { AiriCheckout } from "./client.js";
import { AirwallexHostedCheckout } from "./hostedCheckout.js";
import type { AiriDeps } from "./purchase.js";

export const TAP_LINK_FILE = "airi-tap-link.json";
/** How long Max has to tap in Airi (get-credential waits 300 s; src/airi/cli.ts). */
export const TAP_WINDOW_MS = 5 * 60_000;

const dur = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
const stamp = (d: Date) => d.toISOString().slice(11, 19);

/** The one console line (two lines on screen) that carries a one-time link. `which` names the purchase (A, B). */
export function tapLine(which: string, actionId: string, i: { amount: string; currency: string; merchant: string }, url: string, at: Date = new Date()): string {
  return `AIRI TAP ${which}  ${stamp(at)} UTC  ${actionId}: ${i.amount} ${i.currency} at ${i.merchant}. Open this one-time link on your phone and confirm with your passkey within 5 minutes:\n           ${url}`;
}

/** The console of a person: the link on its own line. */
export function consoleLinkSink(print: (line: string) => void, which = ""): Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl"> {
  return {
    showPasskeyUrl: (url, i) => print(tapLine(which, i.actionId, i, url)),
  };
}

/** The runner: the link to a 0600 file in the keys folder; the log line names the file, not the link. */
export function fileLinkSink(log: (line: string) => void, file: () => string = () => keyPath(TAP_LINK_FILE)): Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl"> {
  return {
    showPasskeyUrl: (url, i) => {
      // Written whole, then renamed into place: a reader never sees half a file.
      const f = file();
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ action_id: i.actionId, url, amount: i.amount, currency: i.currency, merchant: i.merchant, at: new Date().toISOString() }), { mode: 0o600 });
      renameSync(tmp, f);
      log(`airi     ${i.actionId}: waiting for the wallet owner's tap in Airi; the one-time link is in the keys folder (${TAP_LINK_FILE}), not in this log`);
    },
    clearPasskeyUrl: (actionId) => {
      const f = file();
      try {
        if (existsSync(f) && (JSON.parse(readFileSync(f, "utf8")) as { action_id?: string }).action_id === actionId) rmSync(f, { force: true });
      } catch {
        rmSync(f, { force: true });
      }
    },
  };
}

export interface TapLink { url: string; amount: string; currency: string; merchant: string }

/** Takes the link the runner left for this action, once (the file is removed). */
export function takeTapLink(actionId: string, file: string = keyPath(TAP_LINK_FILE)): TapLink | null {
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { action_id?: string; url?: string; amount?: string; currency?: string; merchant?: string };
    if (j.action_id !== actionId || typeof j.url !== "string") return null;
    rmSync(file, { force: true });
    return { url: j.url, amount: j.amount ?? "", currency: j.currency ?? "", merchant: j.merchant ?? "" };
  } catch {
    return null;
  }
}

/** Proposal states after which nothing more happens to it. */
export const PROPOSAL_DONE = ["EXECUTED", "FAILED", "REJECTED", "EXPIRED", "NEEDS_REAPPROVAL", "SUPERSEDED"];

export interface AwaitWithTap {
  id: string;
  /** The proposal's status now. */
  status: () => string;
  /** The runner's link for this proposal, taken once (takeTapLink). */
  takeLink: () => TapLink | null;
  /** The person's console: the link goes here and nowhere else. */
  tap: (line: string) => void;
  /** The run log: notices without the link. */
  log: (line: string) => void;
  /** The purchase's name on the console (B). */
  which: string;
  /** How long to wait for the CFO and the runner before the tap (default 70 minutes). */
  approvalWaitMs?: number;
  tapWindowMs?: number;
  /** After the tap window, how long to wait for the runner to record the outcome (default 60 s). */
  graceMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The conductor's wait for a purchase the runner executes after the CFO's Face ID. It watches for the runner's tap
 * link and prints it on the console the moment it appears (then the file is gone), with a notice in the run log that
 * names no link. It returns the proposal's final status, and never before the purchase has an outcome or the tap
 * window (plus a short grace for the runner to record it) has run out.
 */
export async function awaitWithTap(o: AwaitWithTap): Promise<string> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tapWindow = o.tapWindowMs ?? TAP_WINDOW_MS;
  const until = now() + (o.approvalWaitMs ?? 70 * 60_000);
  let tapEnds: number | null = null;
  let lastNotice = 0;
  for (;;) {
    const link = o.takeLink();
    if (link) {
      o.tap(tapLine(o.which, o.id, link, link.url, new Date(now())));
      tapEnds = now() + tapWindow;
      lastNotice = now();
      o.log(`AIRI TAP ${o.which}  ${o.id}: the one-time Airi link is on the console now (not in this log); Max has ${dur(tapWindow)} to tap`);
    }
    const s = o.status();
    if (PROPOSAL_DONE.includes(s)) return s;
    const t = now();
    if (tapEnds !== null) {
      if (t > tapEnds + (o.graceMs ?? 60_000)) return `still ${s} after the ${dur(tapWindow)} tap window`;
      if (t - lastNotice >= 60_000 && t < tapEnds) {
        lastNotice = t;
        o.log(`AIRI TAP ${o.which}  ${o.id}: still waiting for Max's tap in Airi, about ${Math.ceil((tapEnds - t) / 60_000)} min left (the link is on the console above)`);
      }
    } else if (t > until) return `still ${s} after ${dur(o.approvalWaitMs ?? 70 * 60_000)}`;
    await sleep(o.pollMs ?? 500);
  }
}

/** The checkout AIRI_CHECKOUT names: hosted (default) or api. */
export function checkoutFromEnv(api: Airwallex, env: NodeJS.ProcessEnv = process.env): AiriCheckout {
  const which = env.AIRI_CHECKOUT ?? "hosted";
  if (which === "hosted") return new AirwallexHostedCheckout(api);
  if (which === "api") return new AirwallexSandboxCheckout(api);
  throw new Error(`AIRI_CHECKOUT must be hosted or api, not ${JSON.stringify(which.slice(0, 20))}`);
}

/** The live rail: airi-cli and the Airwallex sandbox. Null when the Airwallex keys are not set. */
export function liveAiriDeps(sink: Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl">, say: (line: string) => void): AiriDeps | null {
  const cfg = fromEnv();
  if (!cfg) return null;
  return { airi: new AiriCliClient(), checkout: checkoutFromEnv(new Airwallex(cfg)), say, ...sink };
}
