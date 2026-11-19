// One payment of the clearing load test (src/cli/clearingLoad.ts): the request paid through clearing, retried on the
// two refusals that are not failures. An epoch boundary (between_epochs: nothing was paid) is waited out; a payment
// whose outcome is unknown (its answer lost: the wallet then holds it) is sent again, the same request, as Alta's docs
// say, so the clearing client can resolve it. Run 1 of 30 Oct did not resend, and one lost receipt held a wallet for
// its other 120 payments (docs/runs/2026-10-30-clearing-load.md, finding 1). Resends and epoch waits are counted apart.
import { redactSecrets } from "../lib/redact.js";
import { betweenEpochs, outcomeUnknown } from "./clearing.js";

export interface LoadPayment { ok: boolean; ms: number; epochRetries: number; resends: number; reason: string | null }
export interface LoadPaymentOptions {
  /** Waits out an epoch boundary or a lost answer; 3 s each by default, Purser's wait elsewhere. */
  wait?: (ms: number) => Promise<void>;
  waitMs?: number;
  maxEpochRetries?: number;
  maxResends?: number;
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pays one request with `pay` (the same request each time it is called) and says how it went. */
export async function payLoadRequest(pay: () => Promise<Response>, o: LoadPaymentOptions = {}): Promise<LoadPayment> {
  const wait = o.wait ?? sleep, waitMs = o.waitMs ?? 3000, now = o.now ?? Date.now;
  const maxEpoch = o.maxEpochRetries ?? 10, maxResends = o.maxResends ?? 5;
  const start = now();
  let epochRetries = 0, resends = 0;
  for (;;) {
    try {
      const res = await pay();
      await res.text();
      return { ok: res.ok, ms: now() - start, epochRetries, resends, reason: res.ok ? null : `HTTP ${res.status}` };
    } catch (e) {
      if (betweenEpochs(e) && epochRetries < maxEpoch) { epochRetries++; await wait(waitMs); continue; }
      if (outcomeUnknown(e) && resends < maxResends) { resends++; await wait(waitMs); continue; }
      const said = (e as { reason?: string }).reason ?? (e as Error).message ?? String(e);
      return { ok: false, ms: now() - start, epochRetries, resends, reason: redactSecrets(said.split("\n")[0]!.slice(0, 100)) };
    }
  }
}
