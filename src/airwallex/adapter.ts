import type { AirwallexRail, SandboxSim } from "./port.js";

/** The REST adapter lands once the field reference is checked; until then there is none. */
export async function airwallexFromEnv(): Promise<{ rail: AirwallexRail; sim: SandboxSim } | null> {
  return null;
}
