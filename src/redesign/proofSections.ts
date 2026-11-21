// Which /proof section holds each evidence-wall group (21 Nov 2026: /proof is organised by question, q-*, so a link to
// the old group id, #ev-*, opened the page but jumped nowhere). No imports: Home, the partner strips and /proof all read it.
export const PROOF_SECTION_OF_GROUP: Readonly<Record<string, string>> = { "ev-rails": "q-live", "ev-forged": "q-approvals", "ev-ai": "q-ai", "ev-attacked": "q-security", "ev-built": "q-verify", "ev-quality": "q-built", "ev-scale": "q-live", "ev-load": "q-live" };

/** The /proof anchor for an evidence-wall group: its section, or the id itself when it has none. */
export const proofSection = (group: string): string => PROOF_SECTION_OF_GROUP[group] ?? group;
