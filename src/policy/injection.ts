// Prompt injection, tier 3 item 8. Every incoming document is screened by code for lines aimed at a machine
// (orders to the AI, claims that approval is not needed) and for hidden characters. What is found is logged and
// shown; it changes nothing, because documents are data: the models only read them, code checks every reading,
// and only a person's passkey or typed hash approves.

export type InjectionKind = "hidden_characters" | "instruction" | "approval_claim";

export interface InjectionFinding {
  kind: InjectionKind;
  /** The line, trimmed, with hidden characters shown as [U+XXXX]. Hostile text: display it as text only. */
  excerpt: string;
}

// Zero-width characters and bidirectional controls: invisible on screen, read by a model.
const HIDDEN = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/u;
const HIDDEN_ALL = new RegExp(HIDDEN.source, "gu");

const INSTRUCTION = [
  /^\W*(system|assistant|developer|ai)\s*:/i,
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(rules|instructions|policy|policies|previous|above|limits)\b/i,
  /\byou are now\b|\bact as\b|\bpretend to be\b/i,
  /\b(automated|automatic) (payment )?(systems?|agents?|assistants?)\b|\b(note|message|instructions?) (to|for) (the )?(ai|assistant|model|agent)\b/i,
  /\bapprove all\b/i,
];
const APPROVAL_CLAIM = /\bpre-?approved\b|\balready approved\b|\bapproval (is )?(not|no longer) (needed|required)\b|\bskip (the )?(approval|verification|check|review)\b|\bno (approval|verification) (is )?(needed|required)\b/i;

const show = (line: string) => line.replace(HIDDEN_ALL, (ch) => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`).trim().slice(0, 200);

/** One finding per suspicious line, the strongest kind first: hidden characters, an instruction, an approval claim. */
export function findInjections(text: string): InjectionFinding[] {
  const out: InjectionFinding[] = [];
  for (const line of text.split("\n")) {
    const kind: InjectionKind | null = HIDDEN.test(line) ? "hidden_characters"
      : INSTRUCTION.some((re) => re.test(line)) ? "instruction"
      : APPROVAL_CLAIM.test(line) ? "approval_claim"
      : null;
    if (kind) out.push({ kind, excerpt: show(line) });
  }
  return out;
}
