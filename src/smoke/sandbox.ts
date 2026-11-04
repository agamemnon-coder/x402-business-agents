// npm run smoke:sandbox: the reproducible way to get fresh Airwallex sandbox ids. One small FX conversion (buy
// EUR 10.00 with USD) and one small SWIFT transfer (EUR 10.00) to a payee code already allowlists (the licensor), then
// the conversion id, the transfer id, the time (UTC) and the git commit, printed and written to out/ (gitignored).
//
// - Sandbox only: any other Airwallex base URL is refused; --allow-production does not change that in this build (the
//   Airwallex client itself refuses anything but the sandbox).
// - Keys from the environment only (AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY); never printed, never written.
// - Idempotent: both request ids are written to out/ before the first call. A run that stopped half-way is resumed
//   under the same ids, each step looked up by its request id before anything is created; a finished run is only shown
//   again. --new starts a new run with new ids.
// - It never creates a beneficiary: without the allowlisted payee at Airwallex it stops and says so.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AirwallexAmbiguous, SANDBOX_BASE } from "../airwallex/client.js";
import type { AirwallexRail, Conversion, Transfer } from "../airwallex/port.js";
import { LICENSOR } from "../agents/euroBill.js";

export const SMOKE_EUR_CENTS = 1000;
export const STATE_FILE = "smoke-sandbox.json";

export interface SmokeState {
  run_id: string;
  conversion_request_id: string;
  transfer_request_id: string;
  started_at: string;
  commit: string;
  conversion_id: string | null;
  conversion_status: string | null;
  transfer_id: string | null;
  transfer_status: string | null;
  finished_at: string | null;
}

export interface SmokeDeps {
  rail: AirwallexRail;
  outDir: string;
  commit: string;
  now?: () => Date;
  newRun?: boolean;
  log?: (line: string) => void;
}

/** The base URL the script may use, or why not. Only the sandbox; production is never the default and never allowed here. */
export function sandboxBase(env: NodeJS.ProcessEnv, allowProduction: boolean): { ok: true; base: string } | { ok: false; reason: string } {
  const base = (env.AIRWALLEX_BASE_URL ?? "").trim() || SANDBOX_BASE;
  if (base.startsWith("https://api.sandbox.airwallex.com/")) return { ok: true, base };
  return {
    ok: false,
    reason: allowProduction
      ? "refused: --allow-production was given, but this build only talks to the Airwallex sandbox; nothing was sent"
      : "refused: AIRWALLEX_BASE_URL is not the Airwallex sandbox; this script runs against the sandbox only, nothing was sent",
  };
}

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function load(path: string): SmokeState | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SmokeState;
}

function save(path: string, s: SmokeState): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** Runs (or resumes, or shows) one smoke run. Returns the state as written to out/. */
export async function smokeSandbox(deps: SmokeDeps): Promise<SmokeState> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  mkdirSync(deps.outDir, { recursive: true });
  const path = join(deps.outDir, STATE_FILE);
  let s = load(path);
  if (s && deps.newRun) {
    renameSync(path, join(deps.outDir, `smoke-sandbox-${s.run_id}.json`));
    s = null;
  }
  if (s?.finished_at) {
    log(`already done (run ${s.run_id}); nothing sent. npm run smoke:sandbox -- --new starts a new run.`);
    return s;
  }
  if (!s) {
    const run = randomUUID();
    s = {
      run_id: run, conversion_request_id: randomUUID(), transfer_request_id: randomUUID(), started_at: now().toISOString(), commit: deps.commit,
      conversion_id: null, conversion_status: null, transfer_id: null, transfer_status: null, finished_at: null,
    };
    // The request ids are on disk before the first call: a crash after it is resumed under the same ids.
    save(path, s);
  } else {
    log(`resuming run ${s.run_id} under its own request ids`);
  }
  const approval = sha(`purser smoke-sandbox ${s.run_id}`);

  // Step 1: the conversion, looked up by its request id first.
  if (!s.conversion_id) {
    let conv: Conversion | undefined = await deps.rail.findConversionByRequestId(s.conversion_request_id);
    if (!conv) {
      const quote = await deps.rail.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: SMOKE_EUR_CENTS, validity: "MIN_1" });
      try {
        conv = await deps.rail.createConversion({ requestId: s.conversion_request_id, quote, approvalSha256: approval });
      } catch (e) {
        if (!(e instanceof AirwallexAmbiguous)) throw e;
        conv = await deps.rail.findConversionByRequestId(s.conversion_request_id);
        if (!conv) throw new Error("the conversion's answer was lost and Airwallex does not list it yet; run again later (same request id, never a second conversion)", { cause: e });
      }
    }
    s = { ...s, conversion_id: conv.conversionId, conversion_status: conv.status };
    save(path, s);
    log(`conversion ${conv.conversionId} (${conv.status})`);
  }

  // Step 2: the transfer, to the payee code allowlists, already at Airwallex. Looked up by its request id first.
  if (!s.transfer_id) {
    let tr: Transfer | undefined = await deps.rail.findTransferByRequestIdStrict(s.transfer_request_id);
    if (!tr) {
      const ben = await deps.rail.findBeneficiaryByIban(LICENSOR.iban);
      if (!ben) throw new Error("the allowlisted test payee is not at Airwallex yet (npm run bootstrap creates it); no transfer was made");
      try {
        tr = await deps.rail.createTransfer({
          requestId: s.transfer_request_id, beneficiaryId: ben.id, amountCents: SMOKE_EUR_CENTS, currency: "EUR", sourceCurrency: "EUR",
          reference: "Purser sandbox smoke test", reason: "professional_business_services", approvalSha256: approval,
        });
      } catch (e) {
        if (!(e instanceof AirwallexAmbiguous)) throw e;
        tr = await deps.rail.findTransferByRequestIdStrict(s.transfer_request_id);
        if (!tr) throw new Error("the transfer's answer was lost and Airwallex does not list it yet; run again later (same request id, never a second transfer)", { cause: e });
      }
    }
    s = { ...s, transfer_id: tr.id, transfer_status: String(tr.status) };
    save(path, s);
    log(`transfer ${tr.id} (${tr.status})`);
  }

  s = { ...s, finished_at: now().toISOString() };
  save(path, s);
  return s;
}
