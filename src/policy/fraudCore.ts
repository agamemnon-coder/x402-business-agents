// The pure part of the invoice-fraud check (src/policy/fraud.ts): no database and no Node modules, so the Worker's
// /try/sign runs the very same code as the runner. The caller gives the allowlist and the SHA-256 of the invoice's
// IBAN (Node's crypto in fraud.ts, WebCrypto in the Worker).

export type FraudCode =
  | "bank_details_changed" | "lookalike_vendor" | "mixed_scripts" | "account_name_mismatch" | "unknown_vendor"
  | "bank_change_language" | "pressure_language";

export interface FraudSignal {
  code: FraudCode;
  /** A blocking signal stops payment; the others are evidence for the person who verifies. */
  blocks: boolean;
  /**
   * Not a block, but a person reads it before anything is paid (19 Nov, adversarial eval v3): words that ask to pay
   * another account, or to get around the people who check payments. Absent or false: shown only.
   */
  holds?: boolean;
  detail: string;
  /** What the invoice says and what is on file, side by side (14 Nov: /try shows the evidence, not only the sentence). */
  asked?: string;
  on_file?: string;
}

export interface Beneficiary {
  beneficiary_id: string;
  name: string;
  iban_last4: string;
  iban_sha256: string;
  bic: string;
}

export interface FraudFinding {
  blocked: boolean;
  /** Blocked for a reason beyond "we do not know this vendor": what a person should treat as possible fraud. */
  suspicious: boolean;
  signals: FraudSignal[];
  /** The allowlisted beneficiary this invoice is (or pretends to be), if any. */
  allowlisted: Beneficiary | null;
}

// Letters from other alphabets that look like Latin ones (Cyrillic, Greek), and digits that pass for letters.
export const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w",
  α: "a", β: "b", ε: "e", ζ: "z", η: "n", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", γ: "y",
  "0": "o", "1": "l",
};

/** A name reduced to what a reader sees: no case, accents, spacing or punctuation, lookalike letters folded to Latin. */
export function skeleton(name: string): string {
  return [...name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Legal forms, as the tokens they read as once dots are dropped and the rest is split on what is not a letter or a
 * digit: GmbH and "G.m.b.H." are both "gmbh", "Sp. z o.o." is "sp z oo", "& Co. KG" is "& co kg". Only at the end of a
 * name, and only while something is left before them.
 */
const LEGAL_FORMS: readonly string[][] = [
  // German, Austrian, Swiss
  ["gmbh"], ["mbh"], ["gesmbh"], ["ag"], ["kg"], ["kgaa"], ["ohg"], ["gbr"], ["ug"], ["ek"], ["ev"], ["eg"], ["se"], ["haftungsbeschrankt"],
  // Dutch, Belgian
  ["bv"], ["nv"], ["vof"], ["cv"], ["bvba"], ["srl"],
  // English, Irish, American
  ["ltd"], ["limited"], ["plc"], ["llp"], ["lp"], ["llc"], ["inc"], ["incorporated"], ["corp"], ["corporation"], ["co"], ["company"], ["pty"], ["pte"],
  // French, Spanish, Italian, Portuguese
  ["sa"], ["sas"], ["sasu"], ["sarl"], ["eurl"], ["sl"], ["slu"], ["spa"], ["sapa"], ["snc"], ["lda"],
  // Nordic, Polish, Czech, Slovak, Hungarian, Baltic
  ["ab"], ["as"], ["a", "s"], ["asa"], ["aps"], ["oy"], ["oyj"], ["ou"], ["hf"], ["sp", "z", "oo"], ["spzoo"], ["sp", "j"], ["sp", "k"], ["sro"], ["s", "r", "o"], ["kft"], ["zrt"], ["nyrt"], ["uab"], ["sia"],
  // "& Co.", "and Co."
  ["&"], ["and"],
];

/**
 * A name as the payee checks compare it (19 Nov, adversarial eval v2: "Bergtex Textil" at the IBAN on file was held as
 * another account holder): its legal form at the end dropped, then reduced as skeleton reduces it (case, accents,
 * punctuation, spacing, lookalike letters). "Bergtex Textil GmbH & Co. KG", "BERGTEX TEXTIL G.m.b.H." and "Bergtex
 * Textil" are one name; "Bergtex Textiles" is another. A name is never matched on this alone where money moves: the
 * account must still be the one on file (assessAgainst compares it).
 */
export function legalName(name: string): string {
  return skeleton(legalTokens(name).join(" "));
}

/** A name's words as legalName reads them: lower case, no accents or dots, its legal form at the end dropped. */
export function legalTokens(name: string): string[] {
  const tokens = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\./g, "").replace(/&/g, " & ").split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
  for (let changed = true; changed;) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      if (tokens.length > form.length && form.every((t, i) => tokens[tokens.length - form.length + i] === t)) {
        tokens.splice(tokens.length - form.length);
        changed = true;
        break;
      }
    }
  }
  return tokens;
}

/** Whether `short` is `full` with letters left out, in order, from its first letter on ("txtl" of "textil"). */
const shortened = (short: string, full: string) => {
  if (short.length < Math.min(3, full.length) || short.length >= full.length || short[0] !== full[0]) return false;
  let i = 0;
  for (const ch of full) if (ch === short[i]) i++;
  return i === short.length;
};

/**
 * Whether one name is a bank's abbreviation of another (19 Nov, adversarial eval v3, v3-name-bergtex-abbreviated:
 * "Bergtex Txtl. GmbH" at the IBAN on file was held as another account holder): the same number of words once legal
 * forms are dropped, at least one word the same, and each other word shortened from its first letter, letters in order
 * ("Txtl." of "Textil", "Outdr" of "Outdoor"). Another word ("Textiles", "Logistics", "Group") is another name. Used
 * only where the account is the one on file: a name is never matched on this alone where money moves.
 */
export function abbreviates(short: string, full: string): boolean {
  const a = legalTokens(short).map(skeleton), b = legalTokens(full).map(skeleton);
  if (!a.length || a.length !== b.length || !a.some((x, i) => x === b[i])) return false;
  return a.every((x, i) => x === b[i] || shortened(x, b[i]!));
}

/**
 * The account holder as the document prints it, under its label in the languages suppliers write in (19 Nov, eval v3:
 * only "Account name:" was read, so "Ten name van: Zeeland Logistics B.V." at the IBAN on file went unread): Account
 * name / holder, Beneficiary (name), Ten name van / T.n.v., Kontoinhaber(in), Begünstigter, Empfänger, Titulaire (du
 * compte), Titular (de la cuenta / da conta), Intestatario. At the start of a line; "Beneficiary bank:" is no holder.
 */
export function accountHolderIn(text: string): string | undefined {
  return HOLDER.exec(text)?.[1]?.trim() || undefined;
}
const HOLDER = /^[ \t]*(?:account (?:name|holder)|name of (?:the )?account holder|beneficiary(?: name)?|ten name van|t\.?n\.?v\.?|kontoinhaber(?:in)?|beg(?:ü|ue)nstigter|empf(?:ä|ae)nger|titulaire(?: du compte)?|titular(?: de la cuenta| da conta)?|intestatario(?: del conto)?)[ \t]*:[ \t]*(\S[^\n]*)$/im;

/**
 * An account in words, leaving out what is not known (screenshot pass S1: "and BIC ; on file: IBAN …3000 () and BIC ."):
 * "IBAN ...3000 (DE) and BIC COBADEFFXXX", "IBAN ...3000", "an account with no IBAN".
 */
export function accountWords(last4: string, country: string, bic: string): string {
  const l4 = (last4 ?? "").trim();
  const cc = (country ?? "").trim();
  const b = (bic ?? "").trim();
  const iban = l4 ? `IBAN ...${l4}${cc ? ` (${cc})` : ""}` : "an account with no IBAN";
  return b ? `${iban} and BIC ${b}` : iban;
}

/** Edits (insert, delete, change, or swap two neighbours) between two strings. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

const hasOtherScript = (s: string) => [...s].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A change of bank announced in the text, in the languages Purser's suppliers write in (English, German, Dutch). A
// signal for the person who verifies, never a block on its own: the bank details themselves are what is checked.
const BANK_CHANGE = new RegExp([
  // English
  "bank (details|account)[^.\\n]{0,40}(changed|new)", "\\bnew (bank|account|iban)\\b", "update your records", "changed (our )?banks?",
  // English, red team round 4: "Our payment details have changed", "banking details have been updated", "we have moved
  // our account", "our IBAN has changed"
  "(bank|banking|payment|account) (details|information)[^.\\n]{0,40}(changed|updated)", "\\b(iban|account number)[^.\\n]{0,20}(has|have) (been )?(changed|updated)",
  "\\bmoved our (bank )?account", "(updated|changed|new) (bank|banking|payment) details",
  // German: "Unsere Bankverbindung hat sich geändert", "neue Bankverbindung", "geänderte Kontodaten", "unserem neuen Konto"
  "(bank|konto)(verbindung|daten|angaben|nummer)[^.\\n]{0,40}(ge(ä|ae)ndert|neu\\b)", "\\bneue[mnrs]? (bank|konto|iban)", "\\bge(ä|ae)nderte[mnrs]? (bank|konto|iban)",
  "\\b(iban|bankverbindung)[^.\\n]{0,30}(ge(ä|ae)ndert|gewechselt)", "\\bbankwechsel",
  // Dutch: "ons rekeningnummer is gewijzigd", "een nieuw rekeningnummer", "bankgegevens zijn gewijzigd"
  "(rekening(nummer)?|bankrekening(nummer)?|bankgegevens)[^.\\n]{0,40}(gewijzigd|veranderd)", "\\bnieuwe? (bank)?(rekening|gegevens)", "\\bnieuwe? iban", "\\biban[^.\\n]{0,30}(gewijzigd|veranderd)",
  // 19 Nov (adversarial eval v3): French, Spanish, Italian and Portuguese ("nos nouvelles coordonnées bancaires", "nuestra
  // nueva cuenta", "il nostro nuovo conto", "a nossa nova conta").
  "\\bnouv(eau|el|elle)s? (compte|iban|rib|coordonn(é|e)es)", "\\bchangement de (banque|compte|rib|coordonn(é|e)es)", "coordonn(é|e)es bancaires[^.\\n]{0,30}(chang|modifi)",
  "\\bnuev[oa]s? (cuenta|iban|n(ú|u)mero de cuenta|datos bancarios)", "\\bcuenta (bancaria )?nueva\\b", "datos bancarios[^.\\n]{0,30}(cambi|actualiz|modific)",
  "\\bnuov[oa]? (conto|iban|coordinate)", "coordinate bancarie[^.\\n]{0,30}(cambiat|variat|aggiornat)",
  "\\bnov[oa] (conta|iban)", "dados banc(á|a)rios[^.\\n]{0,30}(alterad|atualizad|mudad)",
  // An account about to close or closed: the prelude to new bank details ("our bank closes this account then", "unser
  // Konto wird zum 30.11. aufgelöst"). The customer's own account being suspended is dunning, not this.
  "\\b(our|this|the old|unser(e|em|es)?|dieses|ons|onze|notre|nuestra|il nostro|a nossa)\\b(?:[^.\\n]|(?<=\\d)\\.){0,20}\\b(bank ?account|account|bankkonto|konto|bankrekening|rekening|compte|cuenta|conto|conta)\\b(?:[^.\\n]|(?<=\\d)\\.){0,30}\\b(clos(e|es|ed|ing)|frozen|terminated|discontinued|no longer (valid|in use|active|available)|geschlossen|aufgel(ö|oe)st|gek(ü|ue)ndigt|gesperrt|opgeheven|gesloten|ferm(é|e)|cerrad[ao]|chius[oa]|encerrad[ao])",
  "\\bbank\\b[^.\\n]{0,20}\\bclos(es|ing|ed)\\b[^.\\n]{0,25}\\baccount\\b",
].join("|"), "i");
/** "Our bank details are unchanged": no announcement of a change (19 Nov: "unchanged" read as "changed"). */
const BANK_UNCHANGED = /\b(unchanged|not (been )?changed|remain(s)? (the same|unchanged|valid)|unver(ä|ae)ndert|nicht ge(ä|ae)ndert|ongewijzigd|niet gewijzigd|inchang(é|e)e?s?|sin cambios|invariat[ie]|inalterad[oa]s?)\b/i;
/**
 * Words that push for speed (19 Nov, adversarial eval v3: on their own they held a courtesy "placed today", a line item
 * "Urgent courier delivery", a confidentiality footer and a supplier's own final notice). Shown to the person who
 * verifies; on their own they hold nothing.
 */
const PRESSURE = /\burgent(ly)?\b|\bimmediately\b|\b(pay|paid|payment|wire|wired|transfer|settle|send|remit)\b[^.\n]{0,30}\btoday\b|\btoday\b[^.\n]{0,15}\b(at the latest|without fail)\b|avoid (an? )?(interruption|suspension|penalt)|final notice|letzte mahnung|laatste aanmaning|\bsofort\b|\bonmiddellijk\b/i;
/**
 * A request to get around the people and the numbers that check a payment (19 Nov, adversarial eval v3): secrecy from
 * them, a channel other than the numbers on file, approval claimed from outside the process, the process skipped.
 * These hold the invoice for a person, with or without words of speed.
 */
const BYPASS = new RegExp([
  // Secrecy: "keep this between us", "no need to loop in your controller", "do not phone Bergtex about it".
  "\\bkeep (this|it|the (payment|transfer|matter|invoice))\\b[^.\\n]{0,25}\\b(between us|confidential|secret|quiet|private|to yourself|discreet)",
  "\\b(no need to|don'?t|do not|please do not|without|never)\\s+(loop(ing)? in|involv\\w*|inform\\w*|tell\\w*|copy\\w*|cc|check\\w* with|call\\w*|phon\\w*|ring\\w*|contact\\w*|verify\\w*|discuss\\w*|mention\\w*)\\b",
  "\\bno (phone )?calls\\b|\\b(nicht|niemals) (an)?rufen\\b|\\brufen sie (uns )?nicht an\\b|\\bniet (bellen|contacteren)\\b|\\bbel (ons )?niet\\b|\\bne (pas )?(appeler|contacter|t(é|e)l(é|e)phoner)\\b|\\bno (llame|contacte)\\b",
  // Only another channel: "reply only to this e-mail", "kontaktieren Sie ausschließlich …@gmail.com".
  "\\b(only|exclusively|solely|ausschlie(ß|ss)lich|nur noch|nur per|uitsluitend|alleen( nog)?|(ú|u)nicamente|seulement|uniquement|soltanto|apenas|somente)\\b[^.\\n]{0,40}\\b(e-?mail|mail|address|adresse|adres|contact|kontakt|whatsapp|telegram|phone|telefon|number|nummer)\\b",
  "\\b(reply|respond|confirm|contact|write|kontaktier\\w*|antwort\\w*|schreib\\w*|mail(en)?|reageer|reageren|r(é|e)pond\\w*|contact\\w*)\\b[^.\\n]{0,30}\\b(only|exclusively|ausschlie(ß|ss)lich|nur|uitsluitend|alleen|uniquement|(ú|u)nicamente)\\b",
  "\\b(new|neue[nrs]?|nieuwe?|nouvel(le)?|nuev[oa])\\b[^\\n]{0,80}@(gmail|googlemail|yahoo|hotmail|outlook|live|gmx|web|icloud|aol|proton(mail)?|yandex|mail)\\.",
  // The process skipped, or approval claimed from outside it: "skip your normal process", "your board approved this".
  "\\b(skip|bypass|circumvent|outside|avoid)\\b[^.\\n]{0,20}\\b(process|procedure|workflow|controls?|channels?)\\b",
  "\\b(board|ceo|chief executive|managing director|director|owner|chairman|gesch(ä|ae)ftsf(ü|ue)hr\\w*|vorstand|directeur|directie|bestuur|your cfo|the cfo)\\b[^.\\n]{0,25}\\b(approved|has approved|agreed|signed off|is aware|knows|needs|wants|requires|asks|asked|requests|authori[sz]ed|genehmigt|freigegeben|goedgekeurd|vraagt|wil|eist|bittet|verlangt|w(ü|ue)nscht|demande|exige|pide|chiede)\\b",
].join("|"), "i");
/** Someone above the payer: speed on their word in one line is the shape of CEO fraud ("URGENT: the CEO asks ... today"). */
const AUTHORITY = /\b(ceo|chief executive|managing director|director|directeur|directie|gesch(ä|ae)ftsf(ü|ue)hr\w*|vorstand|board|chairman|owner|pr(é|e)sident|your cfo|the cfo)\b/i;

/** How close a name must be to count as a lookalike: two edits for names of eight letters or more, one below. */
function lookalikeOf(vendor: string, all: Beneficiary[]): { b: Beneficiary; how: string } | null {
  const sv = skeleton(vendor);
  for (const b of all) {
    const sb = skeleton(b.name);
    if (sv === sb) return hasOtherScript(vendor) ? { b, how: "same letters, some from another alphabet" } : null;
    const d = editDistance(sv, sb);
    const limit = Math.min(sv.length, sb.length) >= 8 ? 2 : 1;
    if (sb.length >= 4 && d <= limit) return { b, how: `${plural(d, "letter")} ${d === 1 ? "differs" : "differ"}` };
  }
  return null;
}

/** The invoice's payee against an allowlist: the same signals, in the same order, as assessInvoice. */
export function assessAgainst(all: Beneficiary[], inv: { vendor: string; iban: string; bic: string }, text: string, invIbanSha: string): FraudFinding {
  const signals: FraudSignal[] = [];
  // The same vendor written differently (case, spacing, punctuation) in Latin letters is that vendor; 19 Nov, also with
  // or without its legal form (legalName). Its account is compared below all the same.
  const latin = !hasOtherScript(inv.vendor);
  const matched = all.find((b) => b.name === inv.vendor) ?? (latin ? all.find((b) => skeleton(b.name) === skeleton(inv.vendor)) ?? all.find((b) => legalName(b.name) === legalName(inv.vendor)) : undefined);

  if (hasOtherScript(inv.vendor)) {
    signals.push({ code: "mixed_scripts", blocks: true, detail: `the vendor name "${inv.vendor}" contains letters from a non-Latin alphabet` });
  }
  const look = matched ? null : lookalikeOf(inv.vendor, all);
  if (look) {
    signals.push({ code: "lookalike_vendor", blocks: true, detail: `"${inv.vendor}" is not the allowlisted "${look.b.name}" but looks like it (${look.how})`, asked: inv.vendor, on_file: look.b.name });
  } else if (!matched) {
    signals.push({ code: "unknown_vendor", blocks: true, detail: `${inv.vendor} is not an allowlisted beneficiary` });
  }

  // Compared with the supplier it is, or pretends to be.
  const onFile = matched ?? look?.b;
  if (onFile && (onFile.iban_sha256 !== invIbanSha || onFile.bic !== inv.bic)) {
    const iban = inv.iban.replace(/\s+/g, "").toUpperCase();
    const asked = accountWords(iban.slice(-4), iban.slice(0, 2), inv.bic), had = accountWords(onFile.iban_last4, onFile.bic.slice(4, 6), onFile.bic);
    // 19 Nov (eval v3): the same account number at another bank or routing number reads the same in four digits.
    const same = asked === had ? " (the same last digits, at another bank or routing number)" : "";
    signals.push({ code: "bank_details_changed", blocks: true, detail: `the invoice asks for ${asked}${same}; on file: ${had}`, asked: `${asked}${same}`, on_file: had });
  }
  const holder = accountHolderIn(text);
  const expectedHolder = matched?.name ?? inv.vendor;
  // 19 Nov (eval v3): a bank's abbreviation of the supplier's own name is that name, but only at the account on file.
  const atAccountOnFile = !!matched && !signals.some((s) => s.code === "bank_details_changed");
  if (holder && legalName(holder) !== legalName(expectedHolder) && !(atAccountOnFile && abbreviates(holder, expectedHolder))) {
    signals.push({ code: "account_name_mismatch", blocks: true, detail: `the account holder on the invoice is "${holder}", not ${expectedHolder}`, asked: holder, on_file: expectedHolder });
  }
  const line = (re: RegExp, not?: RegExp) => text.split("\n").find((l) => re.test(l) && !(not && not.test(l)))?.trim();
  // 19 Nov (eval v3, v3-bec-zeeland-footer-new-account): words asking to pay another account hold the invoice for a
  // person, even when the IBAN line is the one on file; a person confirms with the supplier on a number on file.
  const change = line(BANK_CHANGE, BANK_UNCHANGED);
  if (change) signals.push({ code: "bank_change_language", blocks: false, holds: true, detail: `the invoice announces a change of bank: "${change}"` });
  // Pressure: words of speed alone are shown; a request to get around the checks holds it (eval v3).
  const bypass = line(BYPASS) ?? text.split("\n").find((l) => AUTHORITY.test(l) && PRESSURE.test(l))?.trim();
  const pressure = line(PRESSURE);
  if (bypass) signals.push({ code: "pressure_language", blocks: false, holds: true, detail: `the invoice asks to get around the people or the numbers that check a payment: "${bypass}"` });
  else if (pressure) signals.push({ code: "pressure_language", blocks: false, detail: `the invoice pushes for speed: "${pressure}"` });

  const blocked = signals.some((s) => s.blocks);
  return { blocked, suspicious: signals.some((s) => s.blocks && s.code !== "unknown_vendor"), signals, allowlisted: matched ?? look?.b ?? null };
}
