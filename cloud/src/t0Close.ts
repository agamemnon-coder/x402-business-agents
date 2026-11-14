// The Books screen's "Independent ledger check" (partner review, 14 Nov): books close only when T:0 agrees. The numbers
// are the close check's (src/accounting/closeGate.ts) on the recorded read-back (docs/runs/2026-11-14-t0-readback.json),
// written to t0Close.gen.ts by npm run t0:readback, so the Worker does not carry the whole record; the console shows the
// numbers, never a fixed sentence. The read-back itself downloads from the site (/t0-readback.json).
import type { T0CloseLine } from "../../src/accounting/t0CloseLine.js";
import { T0_CLOSE_LINE } from "./t0Close.gen.js";

export type { T0CloseLine };
export const t0CloseLine = (): T0CloseLine => T0_CLOSE_LINE;
