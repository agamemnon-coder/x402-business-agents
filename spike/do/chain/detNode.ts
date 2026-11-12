// Node only: the same clock and counted stream as in workerd, put in place of node:crypto's three random functions
// for every importer (syncBuiltinESMExports updates the live bindings of `import { randomUUID } from "node:crypto"`).
import { createRequire, syncBuiltinESMExports } from "node:module";
import { detBytes, detInt, detUuid, installClock } from "./det.js";

export function installDeterminism(): void {
  installClock();
  const c = createRequire(import.meta.url)("node:crypto") as Record<string, unknown>;
  c.randomUUID = detUuid;
  c.randomBytes = detBytes;
  c.randomInt = detInt;
  syncBuiltinESMExports();
}
