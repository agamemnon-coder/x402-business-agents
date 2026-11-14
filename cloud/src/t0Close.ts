// The Books screen's "Independent ledger check" (partner review, 14 Nov): books close only when T:0 agrees. Computed
// here, once, from the recorded read-back (docs/runs/2026-11-14-t0-readback.json) against Purser's books as recorded on
// 10 Nov, with the same check the ledger's close runs (src/accounting/closeGate.ts); the console shows the numbers it
// returns, never a fixed sentence. The read-back itself downloads from the site (/t0-readback.json).

import readBack from "../../docs/runs/2026-11-14-t0-readback.json" with { type: "json" };
import { entriesOfRecord, recordedCloseCheck, T0_READBACK_PATH, type ReadBackRecord } from "../../src/accounting/t0Readback.js";
import { SITE_ORIGIN } from "./siteHeader.js";

export interface T0CloseLine {
  agrees: boolean;
  /** Purser's entries the check expected; when T:0 agrees, all of them are in T:0. */
  entries: number;
  differences: number;
  /** The first difference in words, when there is one. */
  first: string | null;
  read_at: string;
  download: string;
  page: string;
}

export function t0CloseLine(rec: ReadBackRecord = readBack as unknown as ReadBackRecord): T0CloseLine {
  const c = recordedCloseCheck(entriesOfRecord(rec));
  return { agrees: c.agrees, entries: c.expected, differences: c.problems.length, first: c.problems[0]?.text ?? null, read_at: rec.read_at, download: `${SITE_ORIGIN}${T0_READBACK_PATH}`, page: `${SITE_ORIGIN}/t0` };
}
