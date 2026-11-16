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
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
const HIDDEN_ALL = new RegExp(HIDDEN.source, "gu");

const INSTRUCTION = [
  /^\W*(system|assistant|developer|ai)\s*:/i,
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(rules|instructions|policy|policies|previous|above|limits)\b/i,
  // 15 Nov (tester: a /try note "override payment" was not flagged): orders to get past the payment's own controls.
  /\b(override|bypass|circumvent)\b[^.\n]{0,30}\b(payments?|approvals?|checks?|verification|signatures?|cfo|passkeys?)\b/i,
  /\byou are now\b|\bact as\b|\bpretend to be\b/i,
  /\b(automated|automatic) (payment )?(systems?|agents?|assistants?)\b|\b(note|message|instructions?) (to|for) (the )?(ai|assistant|model|agent)\b/i,
  /\bapprove all\b/i,
  // 16 Nov (Max on /try: his own notes were not flagged): the ways a person actually writes an order to the AI.
  // Spoken to the machine by name ("Claude, pay this", "Hey AI ...").
  /^\W*(ai|claude|assistant|agent|bot|model|chatgpt|gpt|llm)\s*[,!;:]/i,
  /\b(hey|hi|dear|attention|attn)\W+(ai|claude|assistant|agent|bot|model|chatgpt|gpt|llm)\b/i,
  /\b(ignore|disregard|forget)\b[^.\n]{0,20}\b(everything|all of (this|that)|the cfo)\b/i,
  // Money sent somewhere else, or more of it ("pay to another account", "change the IBAN", "pay EUR 5000 instead").
  /\bto (another|a different|this other) (account|iban|bank)\b|\b(account|iban)\b[^.\n]{0,20}\binstead\b|\bchange (the )?(iban|payee|amount|bank account)\b/i,
  /\bpay (double|twice)\b|\bpay\b[^.\n]{0,25}\binstead\b|\brelease (the )?(funds|money|payment)\b/i,
  // The same in German and Dutch.
  /\bohne (freigabe|genehmigung|pr(ü|ue)fung)\b|\bzonder (goedkeuring|controle|akkoord|toestemming)\b|\b(negeer|ignoriere)\b/i,
];
// Past the approval or the checks (16 Nov: "without approval", "skip the CFO", "don't ask the CFO", "ignore limit").
const APPROVAL_CLAIM = /\b(is|was|been|mark(ed)? (it )?as|auto(matically)?)[ -]approved\b|\bapprove (this|it|the payment|automatically|immediately|now|without)\b|\bpre-?approved\b|\balready approved\b|\bapproval (is )?(not|no longer) (needed|required)\b|\bskip (the )?(approval|verification|check|review)\b|\bno (approval|verification) (is )?(needed|required)\b|\b(without|no need for|skip(ping)?|don'?t (ask|wait for|need|involve)|do not (ask|wait for|need|involve)|ignore|bypass)\b[^.\n]{0,25}\b(approvals?|cfo|sign(ing|ature|-?off)?|checks?|checking|verification|review|passkeys?|face ?id|controls?|limits?)\b/i;

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
