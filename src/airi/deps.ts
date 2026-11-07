// The Airi rail's live dependencies: the pinned airi-cli and the Airwallex sandbox checkout. And where the one-time
// approval link goes: never into a log or a record.
//
// - In the vic-1 conductor (a person watches its console), the link is printed on one console line.
// - In the runner (its output is a log), the link is written to a 0600 file in this world's keys folder, outside the
//   repo, and the log line says only that it is there; the file is removed as soon as the tap is over. The vic-1
//   conductor, waiting for that purchase, prints it from there on its own console and removes it.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { keyPath } from "../metal/agentCli.js";
import { AirwallexSandboxCheckout } from "./checkout.js";
import { AiriCliClient } from "./cli.js";
import type { AiriDeps } from "./purchase.js";

export const TAP_LINK_FILE = "airi-tap-link.json";

/** The console of a person: the link on its own line. */
export function consoleLinkSink(print: (line: string) => void): Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl"> {
  return {
    showPasskeyUrl: (url, i) => print(`AIRI TAP   ${i.actionId}: ${i.amount} ${i.currency} at ${i.merchant}. Open this one-time link on your phone and confirm with your passkey:\n           ${url}`),
  };
}

/** The runner: the link to a 0600 file in the keys folder; the log line names the file, not the link. */
export function fileLinkSink(log: (line: string) => void, file: () => string = () => keyPath(TAP_LINK_FILE)): Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl"> {
  return {
    showPasskeyUrl: (url, i) => {
      writeFileSync(file(), JSON.stringify({ action_id: i.actionId, url, amount: i.amount, currency: i.currency, merchant: i.merchant }), { mode: 0o600 });
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

/** Takes the link the runner left for this action, once (the file is removed). */
export function takeTapLink(actionId: string, file: string = keyPath(TAP_LINK_FILE)): { url: string; amount: string; currency: string; merchant: string } | null {
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

/** The live rail: airi-cli and the Airwallex sandbox. Null when the Airwallex keys are not set. */
export function liveAiriDeps(sink: Pick<AiriDeps, "showPasskeyUrl" | "clearPasskeyUrl">, say: (line: string) => void): AiriDeps | null {
  const cfg = fromEnv();
  if (!cfg) return null;
  return { airi: new AiriCliClient(), checkout: new AirwallexSandboxCheckout(new Airwallex(cfg)), say, ...sink };
}
