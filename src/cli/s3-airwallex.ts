import type { AirwallexConfig } from "../airwallex/client.js";
import type { DB } from "../db/open.js";

/** Filled in once the adapter lands; until then it refuses rather than pretending. */
export async function runAirwallexSide(_db: DB, _cfg: AirwallexConfig, _eventKey: string): Promise<void> {
  throw new Error("the Airwallex side is not wired yet");
}
