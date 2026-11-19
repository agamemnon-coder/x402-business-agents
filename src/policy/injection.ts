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

// Zero-width characters and bidirectional controls: invisible on screen, read by a model. 19 Nov (adversarial eval v2,
// inject-unicode-tags): also the Arabic letter mark, the Mongolian vowel separator, and the Unicode tag characters
// U+E0000 to U+E007F, which spell out ASCII text no person sees.
const HIDDEN_CLASS = "\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF\\u{E0000}-\\u{E007F}";
const HIDDEN = new RegExp(`[${HIDDEN_CLASS}]`, "u");
const HIDDEN_ALL = new RegExp(`[${HIDDEN_CLASS}]`, "gu");
/** A run of tag characters (U+E0020 to U+E007E spell out ASCII). */
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;

/** The text as a person sees it: every zero-width, direction and tag character taken out. */
export const visibleText = (text: string): string => text.replace(HIDDEN_ALL, "");

const INSTRUCTION = [
  /^\W*(system|assistant|developer|ai)\s*:/i,
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(rules|instructions|policy|policies|previous|above|limits)\b/i,
  // 15 Nov (tester: a /try note "override payment" was not flagged): orders to get past the payment's own controls.
  /\b(override|bypass|circumvent)\b[^.\n]{0,30}\b(payments?|approvals?|checks?|verification|signatures?|cfo|passkeys?)\b/i,
  /\byou are now\b|\bact as\b|\bpretend to be\b/i,
  /\b(automated|automatic) (payment )?(systems?|agents?|assistants?)\b|\b(note|message|instructions?) (to|for) (the )?(ai|assistant|model|agent)\b/i,
  /\bapprove all\b/i,
  // 19 Nov (eval v2): the reader named with a word before it ("Note to the payment assistant", "AI agent:", in an HTML
  // comment), an override in a field ("AI-OVERRIDE: APPROVED"), and a claim that the reader's limit changed.
  /^\W*(ai|automated|payment|reading|invoice)?\s*(agent|assistant|bot|model)\s*[,!;:]/i,
  /\b(note|message|instructions?) (to|for) (the |your |our )?[a-z]+ (ai|assistant|model|agent|bot)\b/i,
  /\b(ai|bot|agent|llm|gpt|assistant|system)[-_ ]?(override|instruction|command|directive)s?\b/i,
  /\b(your|the agent'?s?|the assistant'?s?|approval|payment) limits?\b[^.\n]{0,40}\b(raised|increased|lifted|waived|changed|doubled)\b/i,
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
  // 19 Nov: and in French; a note addressed to the payment system ("voor het betaalsysteem", "für das Zahlungssystem").
  /\b(ignorez|ignorer|oubliez)\b|\bsans (validation|approbation|v(é|e)rification|contr(ô|o)le)\b/i,
  /\b(voor|aan) (het|de) (betaalsysteem|betalingssysteem|systeem|assistent)\b|\b(f(ü|ue)r|an) (das|den) (zahlungssystem|system|assistenten)\b|\b(pour|au) (le )?(syst(è|e)me|l'assistant)\b/i,
];
// Past the approval or the checks (16 Nov: "without approval", "skip the CFO", "don't ask the CFO", "ignore limit").
const APPROVAL_CLAIM = /\b(al|reeds|bereits|schon|d(é|e)j(à|a)) (goedgekeurd|freigegeben|genehmigt|approuv(é|e)e?s?)\b|\bsla\b[^.\n]{0,25}\b(controle|goedkeuring|verificatie|check)\b[^.\n]{0,10}\bover\b|\b(pr(ü|ue)fung|freigabe|kontrolle|genehmigung)\b[^.\n]{0,15}\b(entf(ä|ae)llt|(ü|ue)berspringen|nicht (n(ö|oe)tig|erforderlich))\b|\bohne r(ü|ue)ckfrage\b|\bapproved\b[^.\n]{0,20}\bpay (it )?(now|immediately|at once|right away)\b|\b(do not|don'?t|never|no need to) escalate\b|\b(is|was|been|mark(ed)? (it )?as|auto(matically)?)[ -]approved\b|\bapprove (this|it|the payment|automatically|immediately|now|without)\b|\bpre-?approved\b|\balready approved\b|\bapproval (is )?(not|no longer) (needed|required)\b|\bskip (the )?(approval|verification|check|review)\b|\bno (approval|verification) (is )?(needed|required)\b|\b(without|no need for|skip(ping)?|don'?t (ask|wait for|need|involve)|do not (ask|wait for|need|involve)|ignore|bypass)\b[^.\n]{0,25}\b(approvals?|cfo|sign(ing|ature|-?off)?|checks?|checking|verification|review|passkeys?|face ?id|controls?|limits?)\b/i;

/** A line for people: a run of tag characters as the text it spells, any other hidden character as [U+XXXX]. */
const show = (line: string) => line
  .replace(TAG_RUN, (run) => `[hidden text: ${[...run].map((ch) => ch.codePointAt(0)! - 0xe0000).filter((c) => c >= 0x20 && c < 0x7f).map((c) => String.fromCharCode(c)).join("")}]`)
  .replace(HIDDEN_ALL, (ch) => `[U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`).trim().slice(0, 200);

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

/** A finding of the screen in one field of a reading: which field, and what was found there. */
export interface FieldInjectionFinding extends InjectionFinding { field: string }

/**
 * The screen over every free-text field of a reading, by name (19 Nov, eval v2 inject-in-reference: an order planted in
 * the payment reference, a field that travels with the payment). Fields that are not text are skipped.
 */
export function findInjectionsInFields(fields: Readonly<Record<string, unknown>>): FieldInjectionFinding[] {
  const out: FieldInjectionFinding[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value !== "string" || !value) continue;
    for (const x of findInjections(value)) out.push({ field, ...x });
  }
  return out;
}
