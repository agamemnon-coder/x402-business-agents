// The close check's result as the cloud's Books screen shows it (cloud/src/t0Close.ts). Computed from the read-back
// record by recordedCloseCheck; npm run t0:readback writes it to cloud/src/t0Close.gen.ts, so the cloud's Worker
// carries a few numbers, not the 95-entry record. test/partner-controls.test.ts holds the file to the record.
import { entriesOfRecord, recordedCloseCheck, T0_READBACK_PATH, type ReadBackRecord } from "./t0Readback.js";

export const SITE = "https://kit11.max-31b.workers.dev";

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

export function t0CloseLineOf(rec: ReadBackRecord): T0CloseLine {
  const c = recordedCloseCheck(entriesOfRecord(rec));
  return { agrees: c.agrees, entries: c.expected, differences: c.problems.length, first: c.problems[0]?.text ?? null, read_at: rec.read_at, download: `${SITE}${T0_READBACK_PATH}`, page: `${SITE}/t0` };
}

export const t0CloseGen = (line: T0CloseLine): string => `// Written by npm run t0:readback (src/accounting/t0CloseLine.ts) from docs/runs/2026-11-14-t0-readback.json. Do not edit.
import type { T0CloseLine } from "../../src/accounting/t0CloseLine.js";
export const T0_CLOSE_LINE: T0CloseLine = ${JSON.stringify(line, null, 2)};
`;
