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
  return {
    recorded: rows.some((r) => r.t !== null),
    movements: rows.length,
    missing: rows.filter((r) => r.t !== "object").map(({ seq, event, subject }) => ({ seq, event, subject })),
  };
}
