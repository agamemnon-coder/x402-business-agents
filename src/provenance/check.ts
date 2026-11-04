// D24: every money movement records who decided it (src/provenance/origin.ts). This lists the ones that do not: in a
// run with the agents, Thursday's included, the count must be 0, or the run is blocked. A ledger recorded before D24
// carries no origins at all (recorded: false), and is an old recording, not a broken run.

import type { DB } from "../db/open.js";
import { MONEY_EVENTS } from "./origin.js";

export interface OriginsCheck {
  /** False for a ledger recorded before origins existed: no money event carries the field at all. */
  recorded: boolean;
  movements: number;
  missing: { seq: number; event: string; subject: string | null }[];
}

export function originsCheck(db: DB): OriginsCheck {
  const events = [...MONEY_EVENTS];
  const rows = db.prepare(`SELECT seq, event, subject, json_type(payload_json, '$.origin') AS t FROM audit_log WHERE event IN (${events.map(() => "?").join(",")}) ORDER BY seq`)
    .all(...events) as { seq: number; event: string; subject: string | null; t: string | null }[];
  // A ledger that began before D24 is checked from its first movement with an origin on (the code that records them).
  const first = rows.findIndex((r) => r.t !== null);
  const checked = first < 0 ? rows : rows.slice(first);
  return {
    recorded: first >= 0,
    movements: checked.length,
    missing: checked.filter((r) => r.t !== "object").map(({ seq, event, subject }) => ({ seq, event, subject })),
  };
}
