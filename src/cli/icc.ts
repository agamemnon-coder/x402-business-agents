// npm run icc -- <command>: the ICC rail's first sandbox hour (docs/runs/driver/icc-runbook.md). Built from the public
// documentation only (docs/visa-icc.md); until the owner's sandbox access arrives nothing here has been sent.
//   preflight   no purchase: local checks (key files, keys, the certificate's serial number, the clock, the assurance
//               file), then at most two reads, both GET
//   run         purchase A within the limit through the whole flow (the CFO's Face ID on the relay, then the runner,
//               npm run relay, with this same environment, runs it), then attempt B above the limit, which Purser
//               refuses before any call. Stops before checkout: nothing is paid
//   record      docs/runs/<the run's date>-icc.md and .json from this ledger's audit rows and the call log; 0 calls
// preflight and run need KIT11_ICC_RAIL=on, ICC_GO=yes, ICC_CALL_BUDGET, ICC_CALL_LOG, KIT11_DB=…/icc*.sqlite, (run)
// KIT11_KEYS_DIR=…/icc*, and the names of section 9 for the chosen scheme. Nothing here prints a credential, device or
// assurance data, a key, or the value of a variable.

import { resolve } from "node:path";
import { readCallLog } from "../airwallex/callBudget.js";
import { openDb, type DB } from "../db/open.js";
import { iccGuard, iccPreflight, iccRun, iccRunRefusals, waitForOutcome, type IccAwaitCfo, type IccCommand, type IccRunIo } from "../icc/conductor.js";
import { IccNoRun, iccRunRecord, writeIccRunRecord } from "../icc/record.js";
import { approvalHint } from "./hint.js";

const USAGE = "usage: npm run icc -- preflight | run | record   (docs/runs/driver/icc-runbook.md)";
const repo = resolve(import.meta.dirname, "../..");

export interface IccCliIo {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  out: (line: string) => void;
  err: (line: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Where record writes its two files (default docs/runs). */
  recordDir?: string;
  /** How the run waits for the CFO and the runner (default: the relay's Face ID, then the runner; polled). */
  awaitCfo?: (o: IccAwaitCfo) => Promise<string>;
  plan?: IccRunIo["plan"];
}

/** Runs one command. Returns the exit code: 0 done, 1 a check failed, 2 refused before anything was called. */
export async function iccCli(args: string[], io: IccCliIo): Promise<number> {
  const cmd = args[0];
  if (cmd === undefined) { io.out(USAGE); return 0; }
  if (cmd !== "preflight" && cmd !== "run" && cmd !== "record") { io.err(USAGE); return 2; }
  const why = iccGuard(cmd as IccCommand, io.env);
  if (why.length) {
    for (const w of why) io.err(`REFUSED  ${w}`);
    io.err(`icc ${cmd}: nothing was called`);
    return 2;
  }
  const db = openDb(io.env.KIT11_DB);
  try {
    if (cmd === "record") return record(db, io);
    if (cmd === "preflight") return (await iccPreflight({ db, env: io.env, say: io.out, fetchImpl: io.fetchImpl, now: io.now })).ok ? 0 : 1;
    const refused = iccRunRefusals(db);
    if (refused.length) {
      for (const w of refused) io.err(`REFUSED  ${w}`);
      io.err("icc run: nothing was called");
      return 2;
    }
    const awaitCfo = io.awaitCfo ?? (async ({ db: d, proposalId }: IccAwaitCfo) => {
      io.out(`FACE ID  ${approvalHint(d, proposalId)}; the runner (npm run relay, with this environment) then runs it`);
      return waitForOutcome(d, proposalId, { log: io.out });
    });
    return (await iccRun({ db, env: io.env, say: io.out, awaitCfo, fetchImpl: io.fetchImpl, now: io.now, plan: io.plan })).ok ? 0 : 1;
  } catch (e) {
    // The rail's errors name a variable or a code, never a value.
    io.err(`STOP     ${e instanceof Error ? e.message : "error"}`);
    return 1;
  } finally {
    db.close();
  }
}

function record(db: DB, io: IccCliIo): number {
  try {
    const rec = iccRunRecord(db, readCallLog(io.env.ICC_CALL_LOG ?? ""));
    const files = writeIccRunRecord(io.recordDir ?? resolve(repo, "docs/runs"), rec);
    io.out(`record   ${files.md}`);
    io.out(`record   ${files.json}`);
    return 0;
  } catch (e) {
    if (e instanceof IccNoRun) { io.err(`REFUSED  ${e.message}`); return 2; }
    throw e;
  }
}

if (process.argv[1] && /cli[\\/]icc\.ts$/.test(process.argv[1])) {
  process.exitCode = await iccCli(process.argv.slice(2), { env: process.env, out: (l) => console.log(l), err: (l) => console.error(l) });
}
