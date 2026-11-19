// The eIDAS option's feature flag: off unless PURSER_EIDAS is "on" (or "1", "true"). Off, nothing changes: the
// passkey approval, its proof bundle and every money rule stay as they are; only the export of an approval as JAdES
// evidence (src/eidas/jades.ts) and the QES adapter (src/eidas/csc.ts) need it. Verifying a file someone hands you
// needs no flag: it reads, and changes nothing.

export const EIDAS_FLAG = "PURSER_EIDAS";

export const eidasOn = (env: NodeJS.ProcessEnv = process.env): boolean => ["on", "1", "true"].includes(env[EIDAS_FLAG] ?? "");

export function requireEidas(env: NodeJS.ProcessEnv = process.env): void {
  if (!eidasOn(env)) throw new Error(`the eIDAS option is off; ${EIDAS_FLAG}=on turns it on (docs/legal/eidas-qes.md)`);
}
