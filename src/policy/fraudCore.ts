// The pure part of the invoice-fraud check (src/policy/fraud.ts): no database and no Node modules, so the Worker's
// /try/sign runs the very same code as the runner. The caller gives the allowlist and the SHA-256 of the invoice's
// IBAN (Node's crypto in fraud.ts, WebCrypto in the Worker).

import { BANK_CHANGE_ANY, BANK_DETAILS_CHANGED_ANY, BANK_UNCHANGED_ANY, bypassInAnyLanguage, CHANGE_NEGATED_ANY, fold, MESSENGER, PAY_ANY, PAY_OR_DETAILS_ANY, walletIn } from "./multilingual.js";
import { asciiSpelling, canonicalName, mixedScriptWord, plainAscii, romanFold, scriptsIn, toLatin, toLatinVariants, transliterable, withoutTypography } from "./scripts.js";

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

/**
 * A name reduced to what a reader sees: no case, accents, spacing or punctuation, lookalike letters folded to Latin.
 * 19 Nov (after eval v5): letters of other alphabets that look like no Latin one are kept (they were dropped, so a name
 * in Greek or Cyrillic was reduced to the few letters that look Latin, and two such names could not be told apart).
 * Latin letters outside a to z (ß, ø, ł) are dropped as before.
 */
export function skeleton(name: string): string {
  // 19 Nov (after eval v7): soft hyphens, zero-width characters, direction marks and tatweel set a name, they are no letters of it.
  return [...withoutTypography(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\u03C2/g, "\u03C3")]
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .filter((ch) => /[a-z0-9]/.test(ch) || (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)))
    .join("");
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
  // 20 Nov (after the held-out eval v10, v10-name-uewersauer-sarl and v10-name-iliria-form-first: "S.à r.l." on file against
  // a bank's "SARL", "sh.p.k." against "SHPK"): Luxembourg's and Switzerland's S.à r.l. as its dots and spaces leave it,
  // Albania's and Kosovo's sh.p.k. and sh.a., South Africa's (Edms) Bpk and (Pty) Ltd.
  ["sa", "rl"], ["s", "a", "r", "l"], ["shpk"], ["sha"], ["edms", "bpk"], ["bpk"], ["pty", "ltd"],
  // 20 Nov (after the held-out eval v11, v11-look-conamara-teo: "Olann Chonamara Teo." for "Olann Chonamara Teoranta"):
  // Ireland's Irish-language forms, written out and as companies abbreviate them.
  ["teoranta"], ["teo"], ["cuideachta", "teoranta"], ["cpt"],
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

/** The word for "company" that starts many names in the languages that put it first. */
const LEADING_COMPANY_WORDS: ReadonlySet<string> = new Set(["syarikat", "perusahaan", "shirkadda", "sharikat", "shirkat", "kampuni", "kamfanin", "kompania", "kompaniya", "empresa", "sociedad", "societe", "societa", "companhia", "compania", "cong", "pt", "cv", "ud"]);

/** A name's words as legalName reads them: lower case, no accents or dots, its legal form at the end dropped. */
export function legalTokens(name: string): string[] {
  const tokens = withoutTypography(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\./g, "").replace(/&/g, " & ").split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
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
  // 20 Nov (after the held-out eval v11, v11-name-garrotxa-form-first: a bank's holder "SL FILATURES DE LA GARROTXA" for
  // "Filatures de la Garrotxa S.L."): banks and registers write the legal form first too; one form at the start is
  // dropped as one at the end is, while something is left after it.
  const first = LEGAL_FORMS.find((form) => form[0] !== "&" && form[0] !== "and" && tokens.length > form.length && form.every((t, i) => tokens[i] === t));
  if (first) tokens.splice(0, first.length);
  // 20 Nov (after the held-out eval v13, v13-name-kelantan-short: a bank's holder "TENUN KELANTAN SDN BHD" for "Syarikat
  // Tenun Kelantan Sdn Bhd"): a name's first word that only says "company" in its language is left out as a form is.
  if (tokens.length > 2 && LEADING_COMPANY_WORDS.has(tokens[0]!)) tokens.splice(0, 1);
  return tokens;
}

/** Legal forms of companies as they read in Latin letters beyond Europe's: romanised Japanese, Korean, Thai, Malay, Indonesian, Turkish, Indian and Chinese forms. */
const COMPANY_WORDS: ReadonlySet<string> = new Set([
  "co", "corp", "corporation", "company", "inc", "ltd", "limited", "llc", "plc", "pvt", "pte", "private", "sdn", "bhd", "tbk", "pt", "cv", "jsc", "ojsc", "pjsc", "kk", "kabushiki", "kaisha",
  "yugen", "godo", "jusik", "hoesa", "chusik", "borisat", "jamkat", "sti", "as", "tnhh", "cty", "gmbh", "ag", "sa", "bv", "nv", "srl", "spa", "sas", "sarl", "ab", "oy", "aps",
  // 19 Nov (after eval v7): the forms of more countries as banks print them in Latin letters (Baltic, Nordic, Balkan,
  // Caucasus, Central and South Asian, Latin American), and the words a bank's holder field uses for a business.
  "uab", "mb", "sia", "ou", "ehf", "hf", "sf", "kft", "zrt", "nyrt", "doo", "dd", "ad", "ood", "eood", "ead", "sro", "spol", "ltda", "sac", "saa", "eirl", "llp", "lp",
  "shpk", "tov", "prat", "ooo", "zao", "oao", "pao", "xxk", "hhk", "jv", "fze", "fzco", "fzc", "fzllc", "wll", "spc", "saog", "psc", "pjsc", "plc", "gk", "yk", "pty",
  "industries", "industry", "industrial", "trading", "traders", "enterprises", "enterprise", "group", "holdings", "holding", "manufacturing", "mills", "works", "exports", "imports",
  "international", "intl", "services", "solutions", "logistics", "textile", "textiles", "partners", "associates", "firm", "agency", "cooperative", "coop",
  // 20 Nov (after the held-out eval v10, v10-name-kashgar-latin-holder: "QESHQER REXTCHILIK SHIRKITI", the Uyghur company's
  // own name in the Uyghur Latin script, was held as a person's name): the word "company", "firm", "factory" or "industry"
  // as the languages suppliers write in romanise it, and the Southern African and Albanian forms.
  "shirkiti", "shirket", "shirkat", "sirket", "sharikat", "sherkat", "shirkadda", "shirkad", "kampuni", "kamfanin", "kamfani", "kompania", "kompaniya", "kompanija",
  "kompani", "kumpanya", "kampani", "perusahaan", "syarikat", "empresa", "impresa", "entreprise", "compagnie", "compania", "companhia", "gesellschaft", "firma", "bedrijf",
  // 20 Nov (after eval v11): Ireland's Irish-language forms.
  "teoranta", "teo", "cuideachta", "cpt",
  "fabrik", "fabriek", "fabrika", "fabryka", "factory", "udyog", "udyoga", "karkhana", "bpk", "edms", "sha",
]);
/** Legal forms written in other scripts, and as banks write them in katakana, as they read after NFKC and in lower case. */
const COMPANY_MARKS = [
  "有限公司", "股份公司", "公司", "株式会社", "有限会社", "合同会社", "(株)", "(有)", "주식회사", "유한회사", "(주)", "(유)", "บริษัท", "จำกัด", "ห้างหุ้นส่วน",
  "בע״מ", "בע\"מ", "בעמ", "חברה", "प्राइवेट लिमिटेड", "लिमिटेड", "प्रा. लि", "प्रा.लि", "شركة", "ش.م.م", "ذ.م.م", "مؤسسة", "شرکت", "ооо", "зао", "оао", "пао", "еоод", "оод", "еад", "тов",
  "α.ε.", "ε.π.ε.", "ι.κ.ε.", "công ty", "cổ phần", "a.ş.", "şti", "カ)", "(カ", "ユ)", "(ユ", "ド)", "(ド", "カブシキガイシャ", "カブシキカイシャ",
  // 19 Nov (after eval v7, v7-name-angkor-person-holder and v7-name-addis-person-holder: the Khmer and Ethiopic companies'
  // forms were not here, so a person's name as holder of their accounts on file was shown only). The legal forms and the
  // word "company" in more scripts: Khmer, Ethiopic, Tamil, Bengali, Georgian, Armenian, Urdu, Sinhala, Burmese, Lao,
  // Mongolian, Gujarati, Kannada, Malayalam, Telugu, Punjabi, Ukrainian, Kazakh. A name written with an abbreviation in
  // its words ("ኃ/የተ/የግ/ማ", "ឯ.ក", "s.r.o.") is a company's too (namesACompany), whatever its script.
  "ក្រុមហ៊ុន", "ឯ.ក", "សហគ្រាស", "ኃ/የተ/የግ/ማ", "ኃ.የተ.የግ.ማ", "አ.ማ", "ድርጅት", "ኩባንያ", "நிறுவனம்", "லிமிடெட்", "பிரைவேட்", "கம்பெனி",
  "লিমিটেড", "প্রাইভেট", "কোম্পানি", "শিল্প", "შპს", "სს ", "კომპანია", "ՍՊԸ", "ՓԲԸ", "ԲԲԸ", "ընկերություն", "լիմիտեդ",
  "کمپنی", "لمیٹڈ", "پرائیویٹ", "සමාගම", "(පුද්)", "පුද්ගලික", "ලිමිටඩ්", "ကုမ္ပဏီ", "လီမိတက်", "ບໍລິສັດ", "ຈຳກັດ", "ххк", "компани",
  "કંપની", "લિમિટેડ", "પ્રાઇવેટ", "ಕಂಪನಿ", "ಲಿಮಿಟೆಡ್", "ಪ್ರೈವೇಟ್", "കമ്പനി", "ലിമിറ്റഡ്", "പ്രൈവറ്റ്", "కంపెనీ", "లిమిటెడ్", "ప్రైవేట్", "ਕੰਪਨੀ", "ਲਿਮਿਟੇਡ",
  "тзов", "прат", "фоп", "товариство", "компанія", "компания", "фирма", "ჯგუფი",
  // 20 Nov (after the held-out eval v10): "company" in Uyghur, Sorani and Marathi letters.
  "شىركىتى", "شىركەت", "کۆمپانیا", "प्रायव्हेट", "कंपनी", "उद्योग",
];
/** An abbreviation inside a word: letters with dots or slashes between them ("ኃ/የተ/የግ/ማ", "ឯ.ក", "s.r.o.", "ذ.م.م"), as legal forms are written. */
const ABBREVIATED_FORM = /(?:^|\s)[\p{L}\p{M}]{1,4}[./](?:[\p{L}\p{M}]{1,4}[./]?)+(?=\s|$)/u;
/**
 * Whether a name is a company's (19 Nov, after eval v6): a legal form at its end as legalName drops it, a company word
 * of the romanisations banks print ("Co., Ltd.", "K.K.", "Pvt", "Sdn Bhd"), or a legal form in its own script.
 */
export function namesACompany(name: string): boolean {
  const n = canonicalName(name).toLowerCase();
  if (COMPANY_MARKS.some((m) => n.includes(m.toLowerCase()))) return true;
  if (n.split(/\s+/).length >= 2 && ABBREVIATED_FORM.test(n)) return true;
  const raw = rawTokens(name);
  if (raw.some((t) => COMPANY_WORDS.has(t))) return true;
  return legalTokens(name).length < raw.length || ROMANISED_FORMS.has(raw.at(-1) ?? "");
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

/** German letters as they are written without them (Müller as Mueller, Söhne as Soehne, Straße as Strasse). */
const transliterate = (name: string) => name.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");
/** The word for "and" in the languages suppliers write in: between two words it reads as "&" does. */
const AND_WORDS: ReadonlySet<string> = new Set(["&", "and", "und", "en", "et", "y", "e"]);
/** A name as sameName compares it: legalName's words without a word for "and" between them, reduced as skeleton reduces them. */
const nameKey = (name: string) => {
  const t = legalTokens(name);
  return skeleton(t.filter((x, i) => !(i > 0 && i < t.length - 1 && AND_WORDS.has(x))).join(" "));
};

/**
 * Whether two names are one name as people write it (19 Nov, third round; adversarial eval v4, v4-clean-muller-transliterated
 * and v4-name-muller-und-soehne: "Mueller und Soehne Gurtband GmbH" at the IBAN on file was held as another holder):
 * legalName's sameness, and also with umlauts and ß written out (ue, oe, ae, ss) and "und", "and", "et", "en", "y" or "e"
 * for "&". Other letters or other words are another name. A name is never matched on this alone where money moves: the
 * account must still be the one on file (assessAgainst compares it).
 */
export function sameName(a: string, b: string): boolean {
  return legalName(a) === legalName(b) || nameKey(a) === nameKey(b) || nameKey(transliterate(a)) === nameKey(transliterate(b)) || sameRomanised(a, b)
    || (leadingForm(a) || leadingForm(b) ? sameName(withoutLeadingForm(a), withoutLeadingForm(b)) : false);
}

/**
 * Legal forms written before the name, as Lithuanian (UAB), Latvian (SIA), Estonian (OÜ, AS), Swedish (AB), Indonesian
 * (PT, CV), Ukrainian and Russian (ТОВ, ТзОВ, ПрАТ, ООО) companies write them (19 Nov, after eval v7: "TOV LVIVSKA
 * TKANYNA" for "ТОВ «Львівська Тканина»"; legalName dropped legal forms only at the end).
 */
const LEADING_FORMS: ReadonlySet<string> = new Set(["uab", "ab", "mb", "sia", "as", "ou", "pt", "cv", "tov", "tzov", "prat", "ooo", "oao", "zao", "pao", "fop", "тов", "тзов", "прат", "ооо", "оао", "зао", "пао", "фоп",
  "shpk", "sha"]);
const leadingForm = (name: string) => { const t = rawTokens(name); return t.length > 1 && LEADING_FORMS.has(t[0]!); };
/** A name without a legal form at its start (the words after it, as written). */
const withoutLeadingForm = (name: string) => {
  if (!leadingForm(name)) return name;
  const plain = withoutTypography(name).normalize("NFKC");
  return plain.replace(/^[\s\p{P}]*[\p{L}]+[.\s\p{P}]*/u, "").trim() || name;
};

/** Legal forms of Greek, Bulgarian, Russian, Ukrainian and Serbian companies, as they read in Latin letters (Α.Ε., ЕООД, ООО, ТОВ, Д.О.О.). */
// 20 Nov (after eval v8): and Mongolian ХХК (a limited company) as toLatin writes it ("hhk"). Not "XXK" in Latin letters
// that copy the Cyrillic ones' shapes: that is a lookalike, not a romanisation (v8-look-khukh-latin-x is held).
// 20 Nov (after the held-out eval v9, v9-name-alatau-romanised: "Алатау Тоқыма ЖШС" was held against its bank's
// "ALATAU TOKYMA LLP"): the forms of Kazakhstan (ЖШС, ТОО, ЖАҚ), Kyrgyzstan (ОсОО), Uzbekistan (МЧЖ), Tajikistan (ҶДММ)
// and Belarus (ТАА, ААТ) as their letters romanise.
const ROMANISED_FORMS: ReadonlySet<string> = new Set(["ae", "epe", "ike", "oe", "ee", "eood", "ood", "ead", "ad", "et", "kd", "sd", "ooo", "oao", "zao", "pao", "ao", "tov", "pp", "doo", "hhk",
  "zhshs", "too", "zhak", "osoo", "mchzh", "jdmm", "chdmm", "taa", "aat", "prat", "tdv"]);
/** A name in Latin letters as romanFold reduces it, its legal form at the end dropped, with no spaces. */
export function romanKey(name: string): string {
  return romanKeyOf(toLatin(name));
}
function romanKeyOf(latin: string): string {
  const t = legalTokens(latin);
  while (t.length > 1 && ROMANISED_FORMS.has(t[t.length - 1]!)) t.pop();
  // 19 Nov (after eval v7): and a form before the name ("TOV …", "ТОВ «…»").
  while (t.length > 1 && (ROMANISED_FORMS.has(t[0]!) || LEADING_FORMS.has(t[0]!))) t.shift();
  return romanFold(t.filter((x, i) => !(i > 0 && i < t.length - 1 && AND_WORDS.has(x))).join("")).replace(/[^a-z0-9]/g, "");
}
/** Every key of a name's usual romanisations (toLatinVariants). */
const romanKeys = (name: string) => new Set(toLatinVariants(name).map(romanKeyOf));
/**
 * Whether two names, one of them in Greek or Cyrillic letters, are one name romanised (19 Nov, after eval v5: "TEKSTIL
 * PLOVDIV EOOD" at the IBAN on file was held as another holder than "Текстил Пловдив ЕООД"): only between Latin, Greek
 * and Cyrillic, which have standard romanisations; the spellings banks use for one letter are one (romanFold), and the
 * legal forms of those countries are dropped as legalName drops the Latin ones ("Родопи" is "Родопи ООД"). A name is
 * never matched on this alone where money moves: the account must still be the one on file.
 */
function sameRomanised(a: string, b: string): boolean {
  if (!transliterable(a) || !transliterable(b) || !(greekOrCyrillic(a) || greekOrCyrillic(b))) return false;
  const kb = romanKeys(b);
  return [...romanKeys(a)].some((k) => k.length >= 3 && kb.has(k));
}
const greekOrCyrillic = (s: string) => { const x = scriptsIn(s); return x.has("Greek") || x.has("Cyrillic"); };
/** Whether two names are written in the same alphabets. */
const sameScripts = (a: string, b: string) => {
  const x = scriptsIn(a), y = scriptsIn(b);
  return x.size === y.size && [...x].every((s) => y.has(s));
};

/** A name's words as legalTokens reads them, its legal form kept. */
const rawTokens = (name: string) => withoutTypography(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\./g, "").replace(/&/g, " & ").split(/[^\p{L}\p{N}&]+/u).filter(Boolean);

/**
 * Whether a holder is the full name cut short by a bank's field (19 Nov, third round; eval v4, v4-name-lagerhaus-truncated:
 * "Lagerhaus Nord Gm" for "Lagerhaus Nord GmbH"): the name's every word before its legal form, whole, then its legal form
 * cut short. A cut inside the name itself ("Lagerhaus Nor") or another word is not this. Used only at the account on file.
 */
export function truncates(short: string, full: string): boolean {
  const s = rawTokens(short), f = rawTokens(full), core = legalTokens(full).length;
  if (s.length <= core || s.length > f.length) return false;
  const last = s.length - 1;
  if (!s.slice(0, last).every((x, i) => x === f[i])) return false;
  return (s[last] !== f[last] && f[last]!.startsWith(s[last]!)) || (s[last] === f[last] && s.length < f.length);
}

/**
 * Whether a name written in plain ASCII is the name on file as an ASCII system writes it (20 Nov, after the held-out eval
 * v8, v8-look-thors-ascii: "Thorsdottir Ullarvorur ehf." for "Þórsdóttir Ullarvörur ehf." was held as a lookalike): the
 * name on file with its accents dropped and the letters no mark makes spelled out (þ as th, ð as d, ø as o, ß as ss, ł as
 * l, ı as i: asciiSpelling), then compared as sameName compares. One way only: the name on file has those letters and the
 * name written is plain ASCII. A name that uses such a letter to look like a plain name on file ("Bılgın" for "Bilgin")
 * is the other way round, and stays a lookalike. A name is never matched on this alone where money moves: the account
 * must still be the one on file (assessAgainst compares it).
 */
export function asciiSpellingOf(written: string, onFile: string): boolean {
  return plainAscii(written) && !plainAscii(onFile) && nameKey(written) === nameKey(asciiSpelling(onFile));
}

/** A trade name after the holder ("Cascade Webbing Inc. dba Cascade Straps", "t/a", "trading as"): the holder before it. */
const TRADE_NAME = /\s+(?:d\/b\/a|d\.b\.a\.?|dba|doing business as|t\/a|trading as)\s+/i;
/**
 * Whether a holder is the supplier under a trade name (19 Nov, third round; eval v4, v4-name-cascade-dba): the name before
 * "dba" is the supplier's own. Another holder before it ("Petra Vogel dba Cascade Webbing") is not. Used only at the account on file.
 */
export function tradeNameOf(holder: string, name: string): boolean {
  const [legal, trade] = holder.split(TRADE_NAME);
  return !!trade && !!legal && sameName(legal, name);
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
  "\\b(our|this|the old|unser(e|em|es)?|dieses|ons|onze|notre|nuestra|il nostro|a nossa)\\b(?:[^.\\n]|(?<=\\d)\\.){0,20}(\\bbank ?account|account|konto|rekening|\\bcompte|\\bcuenta|\\bconto|\\bconta)\\b(?:[^.\\n]|(?<=\\d)\\.){0,30}\\b(clos(e|es|ed|ing)|frozen|blocked|terminated|discontinued|no longer (valid|in use|active|available)|geschlossen|aufgel(ö|oe)st|gek(ü|ue)ndigt|gesperrt|eingefroren|blockiert|opgeheven|gesloten|bevroren|geblokkeerd|ferm(é|e)|bloqu(é|e)|gel(é|e)|cerrad[ao]|congelad[ao]|bloquead[ao]|chius[oa]|bloccat[oa]|congelat[oa]|encerrad[ao]|bloqueada|congelada)",
  // Third round (eval v4, v4-pressure-muller-eingefroren): "die neue Verbindung teilen wir Ihnen telefonisch mit".
  "\\bneue[mnrs]? (bank)?verbindung",
  "\\bbank\\b[^.\\n]{0,20}\\bclos(es|ing|ed)\\b[^.\\n]{0,25}\\baccount\\b",
  // 19 Nov, third round (adversarial eval v4, v4-bec-valsesia-conto-aggiornato): an updated account, and bank details
  // given somewhere else than on the invoice (an attached e-mail or letter), in each language: "Si prega di effettuare il
  // bonifico sul conto aggiornato indicato nella mail allegata", "the updated account", "das Konto aus der beigefügten E-Mail".
  "\\bupdated (bank |banking |payment )?(account|iban|details)\\b", "\\b(conto|iban)( corrente)? aggiornat[oa]\\b", "coordinate (bancarie )?aggiornate",
  "\\bcuenta (bancaria )?actualizada", "\\bcompte (bancaire )?mis (à|a) jour", "coordonn(é|e)es (bancaires )?mises (à|a) jour", "\\bconta (banc(á|a)ria )?atualizada",
  "\\baktualisierte[mnrs]? (bank|konto|iban)", "\\bbijgewerkte? (bank)?(rekening|gegevens|iban)",
  "\\b((bank|banking|payment) (details|account)|account (details|number)|iban|konto|kontodaten|bankverbindung|rekening(nummer)?|bankgegevens|compte|coordonn(é|e)es bancaires|cuenta|datos bancarios|conto|coordinate bancarie|conta|dados banc(á|a)rios)\\b[^.\\n]{0,60}\\b(attached|enclosed|allegat[oa]|adjunt[oa]|ci-joint|(en )?pi(è|e)ce jointe|beigef(ü|ue)gt\\w*|angeh(ä|ae)ngt\\w*|bijgevoegde?|anexad?[oa])\\b",
  "\\b(attached|enclosed|allegat[oa]|adjunt[oa]|ci-joint|beigef(ü|ue)gt\\w*|angeh(ä|ae)ngt\\w*|bijgevoegde?|anexad?[oa])\\b[^.\\n]{0,40}\\b((bank|banking|payment) (details|account)|account (details|number)|iban|bankverbindung|bankgegevens|coordonn(é|e)es bancaires|datos bancarios|coordinate bancarie|dados banc(á|a)rios)\\b",
].join("|"), "i");
/**
 * A link to pay through instead of the account on file (19 Nov, third round; eval v4, v4-bec-zeeland-payment-link:
 * "Betaal eenvoudig en veilig via onze nieuwe betaalpagina: https://…"): a web address on a line that asks to pay, in
 * the words outside the address. A website, an e-mail address, a link to the terms or to view the invoice is no such request.
 */
const WEB_ADDRESS = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const PAY_WORD = /\b(pay|paying|payment|betaal|betalen|betaling|zahlen|bezahlen|zahlung|payez|payer|paiement|r(é|e)glez|r(é|e)gler|pague|pagar|pago|paga|pagare|pagamento)\b(?!\s*(terms|conditions|voorwaarden|bedingungen|termini|condiciones))/i;
const payLink = (line: string) => /\bhttps?:\/\/|\bwww\./i.test(line) && (PAY_WORD.test(line.replace(WEB_ADDRESS, " ")) || PAY_ANY.test(fold(line.replace(WEB_ADDRESS, " "))));
/** "Our bank details are unchanged": no announcement of a change (19 Nov: "unchanged" read as "changed"). */
const BANK_UNCHANGED = /\b(unchanged|not (been )?changed|remain(s)? (the same|unchanged|valid)|unver(ä|ae)ndert|nicht ge(ä|ae)ndert|ongewijzigd|niet gewijzigd|inchang(é|e)e?s?|sin cambios|invariat[ie]|inalterad[oa]s?)\b/i;
/** "Unchanged" in every language the lists know, over a folded line. */
const UNCHANGED_ANY = new RegExp(`${BANK_UNCHANGED_ANY.source}|${BANK_UNCHANGED.source}`, "iu");
/** The same, or a word of change negated: what is not an announcement of other bank details (for the concept rule). */
const UNCHANGED_OR_NEGATED = new RegExp(`${UNCHANGED_ANY.source}|${CHANGE_NEGATED_ANY.source}`, "iu");
/**
 * Words that push for speed (19 Nov, adversarial eval v3: on their own they held a courtesy "placed today", a line item
 * "Urgent courier delivery", a confidentiality footer and a supplier's own final notice). Shown to the person who
 * verifies; on their own they hold nothing.
 */
// 20 Nov (after the held-out eval v9, v9-pressure-english-close-of-play: "Your MD has asked that this goes out before close of
// play — no need to loop anyone else in." was paid): the deadlines of office English, and the managing director as "MD".
const PRESSURE = /\burgent(ly)?\b|\bimmediately\b|\b(close of (play|business)|end of (the )?(day|business)|cob|eod|asap|as soon as possible|right away|straight away|without delay)\b|\b(pay|paid|payment|wire|wired|transfer|settle|send|remit)\b[^.\n]{0,30}\btoday\b|\btoday\b[^.\n]{0,15}\b(at the latest|without fail)\b|avoid (an? )?(interruption|suspension|penalt)|final notice|letzte mahnung|laatste aanmaning|\bsofort\b|\bonmiddellijk\b/i;
/**
 * A request to get around the people and the numbers that check a payment (19 Nov, adversarial eval v3): secrecy from
 * them, a channel other than the numbers on file, approval claimed from outside the process, the process skipped.
 * These hold the invoice for a person, with or without words of speed.
 */
const BYPASS = new RegExp([
  // Secrecy: "keep this between us", "no need to loop in your controller", "do not phone Bergtex about it".
  "\\bkeep (this|it|the (payment|transfer|matter|invoice))\\b[^.\\n]{0,25}\\b(between us|confidential|secret|quiet|private|to yourself|discreet)",
  "\\b(no need to|don'?t|do not|please do not|without|never)\\s+(loop(ing)? in|involv\\w*|inform\\w*|tell\\w*|copy\\w*|cc|check\\w* with|call\\w*|phon\\w*|ring\\w*|contact\\w*|verify\\w*|discuss\\w*|mention\\w*)\\b",
  // 20 Nov (after eval v9): someone looped in, told or copied with words between ("loop anyone else in", "let anyone else know").
  "\\b(no need to|don'?t|do not|please do not|without|never)\\s+(loop(ing)?|let(ting)?|keep(ing)?)\\s+(\\w+\\s+){0,3}(in|know|posted|informed)\\b",
  "\\b(no need to|don'?t|do not|please do not|without|never)\\s+(\\w+\\s+)?(involv|inform|tell|copy|cc|loop|alert|notify|bother)\\w*\\s+(anyone|anybody|others|other people|the rest|your (team|colleagues|finance|controller|cfo|boss|manager))\\b",
  "\\bno (phone )?calls\\b|\\b(nicht|niemals) (an)?rufen\\b|\\brufen sie (uns )?nicht an\\b|\\bniet (bellen|contacteren)\\b|\\bbel (ons )?niet\\b|\\bne (pas )?(appeler|contacter|t(é|e)l(é|e)phoner)\\b|\\bno (llame|contacte)\\b",
  // Only another channel: "reply only to this e-mail", "kontaktieren Sie ausschließlich …@gmail.com".
  "\\b(only|exclusively|solely|ausschlie(ß|ss)lich|nur noch|nur per|uitsluitend|alleen( nog)?|(ú|u)nicamente|seulement|uniquement|soltanto|apenas|somente)\\b[^.\\n]{0,40}\\b(e-?mail|mail|address|adresse|adres|contact|kontakt|whatsapp|telegram|phone|telefon|number|nummer)\\b",
  "\\b(reply|respond|confirm|contact|write|kontaktier\\w*|antwort\\w*|schreib\\w*|mail(en)?|reageer|reageren|r(é|e)pond\\w*|contact\\w*)\\b[^.\\n]{0,30}\\b(only|exclusively|ausschlie(ß|ss)lich|nur|uitsluitend|alleen|uniquement|(ú|u)nicamente)\\b",
  // Third round (eval v4, v4-pressure-iberico-whatsapp: "confirme el pago solo por WhatsApp"): "only" in Spanish, Italian
  // and Portuguese before a channel, and the payment or its details through a messaging app.
  "\\b(solo|s(ó|o)lo|s(ó|o)|soltanto|unicamente)\\s+(por|per|via|su|tramite|a|al|pelo|pela|en|in|con)\\s+(whatsapp|telegram|signal|sms|viber|wechat|imessage|e-?mail|correo|mail|tel(é|e)fono|telefone)\\b",
  "\\b(pay\\w*|confirm\\w*|(bank |banking |payment )?details|zahlung|best(ä|ae)tig\\w*|bankverbindung|betaling|bevestig\\w*|bankgegevens|paiement|coordonn(é|e)es|pago|confirme\\w*|datos bancarios|pagamento|conferm\\w*|coordinate|dados)\\b[^\\n]{0,60}\\b(via|per|por|par|on|over|auf|op|sur|su|tramite|pelo|pela|by|through|with|mit|met|con)\\s+(whatsapp|telegram|signal|viber|wechat|imessage)\\b",
  "\\b(new|neue[nrs]?|nieuwe?|nouvel(le)?|nuev[oa])\\b[^\\n]{0,80}@(gmail|googlemail|yahoo|hotmail|outlook|live|gmx|web|icloud|aol|proton(mail)?|yandex|mail)\\.",
  // The process skipped, or approval claimed from outside it: "skip your normal process", "your board approved this".
  "\\b(skip|bypass|circumvent|outside|avoid)\\b[^.\\n]{0,20}\\b(process|procedure|workflow|controls?|channels?)\\b",
  "\\b(board|ceo|chief executive|managing director|director|owner|chairman|gesch(ä|ae)ftsf(ü|ue)hr\\w*|vorstand|directeur|directie|bestuur|your cfo|the cfo|(your|the|our) md|general manager|managing partner|head of finance)\\b[^.\\n]{0,25}\\b(approved|has approved|agreed|signed off|is aware|knows|needs|wants|requires|asks|asked|requests|authori[sz]ed|genehmigt|freigegeben|goedgekeurd|vraagt|wil|eist|bittet|verlangt|w(ü|ue)nscht|demande|exige|pide|chiede)\\b",
].join("|"), "i");
/** Someone above the payer: speed on their word in one line is the shape of CEO fraud ("URGENT: the CEO asks ... today"). */
const AUTHORITY = /\b(ceo|chief executive|managing director|director|directeur|directie|gesch(ä|ae)ftsf(ü|ue)hr\w*|vorstand|board|chairman|owner|pr(é|e)sident|your cfo|the cfo|(your|the|our) md|general manager|managing partner|head of finance)\b/i;

/** How close a name must be to count as a lookalike: two edits for names of eight letters or more, one below. */
function lookalikeOf(vendor: string, all: Beneficiary[]): { b: Beneficiary; how: string } | null {
  const sv = skeleton(vendor);
  for (const b of all) {
    const sb = skeleton(b.name);
    // Called only for a name that matched no supplier: the same skeleton is then letters from another alphabet.
    if (sv === sb) return { b, how: "same letters, some from another alphabet" };
    // 19 Nov (after eval v5): a name on file in Greek or Cyrillic is also compared as it reads in Latin letters, so a
    // Latin "Tekstil Plovdlv" is a lookalike of "Текстил Пловдив" as "Bergtex Texitl" is of "Bergtex Textil".
    const pairs: [string, string][] = [[sv, sb]];
    if (!sameScripts(vendor, b.name) && transliterable(vendor) && transliterable(b.name)) pairs.push([skeleton(toLatin(vendor)), skeleton(toLatin(b.name))]);
    for (const [x, y] of pairs) {
      const d = editDistance(x, y);
      const limit = Math.min(x.length, y.length) >= 8 ? 2 : 1;
      if (y.length >= 4 && d <= limit) return { b, how: d === 0 ? "the same name in another alphabet, with another account or holder" : `${plural(d, "letter")} ${d === 1 ? "differs" : "differ"}` };
    }
  }
  return null;
}

/** The invoice's payee against an allowlist: the same signals, in the same order, as assessInvoice. */
export function assessAgainst(all: Beneficiary[], inv: { vendor: string; iban: string; bic: string }, text: string, invIbanSha: string): FraudFinding {
  const signals: FraudSignal[] = [];
  // 19 Nov (after the held-out eval v5, docs/evals/adversarial-v5.md: every clean invoice of the suppliers on file named
  // in Greek and in Cyrillic letters was held as possible fraud): what is suspect is a word that mixes alphabets (a
  // Cyrillic "а" inside a Latin word), not a name written wholly in another alphabet. The name as written is the
  // supplier's when it is the name on file after NFKC (full-width letters, composed or decomposed accents, invisible
  // format characters aside: the injection screen holds an invoice for those). A name with no mixed word is that
  // supplier also written differently in the same alphabets (case, spacing, punctuation, legal form, umlauts written out:
  // skeleton and sameName), or romanised from Greek or Cyrillic (sameName). A whole name in another alphabet that only
  // looks like one on file is not matched here, and the lookalike check below holds it.
  const mixed = mixedScriptWord(inv.vendor);
  const canon = canonicalName(inv.vendor);
  const matched = all.find((b) => b.name === inv.vendor) ?? all.find((b) => canonicalName(b.name) === canon)
    ?? (mixed ? undefined : all.find((b) => sameScripts(b.name, inv.vendor) && skeleton(b.name) === skeleton(inv.vendor))
      ?? all.find((b) => sameScripts(b.name, inv.vendor) && sameName(b.name, inv.vendor))
      ?? all.find((b) => sameRomanised(b.name, inv.vendor))
      // 20 Nov (after eval v8): the name on file as an ASCII system writes it.
      ?? all.find((b) => asciiSpellingOf(inv.vendor, b.name)));

  if (mixed) {
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
  // Third round (eval v4): the holder transliterated or with "und" for "&" (sameName), and, at the account on file only,
  // cut short by the bank's field (truncates) or followed by the supplier's trade name (tradeNameOf).
  // 19 Nov (after eval v5): a holder with a word that mixes alphabets is held as the vendor's name is.
  const holderMixed = holder ? mixedScriptWord(holder) : undefined;
  if (holder && holderMixed && !mixed) {
    signals.push({ code: "mixed_scripts", blocks: true, detail: `the account holder "${holder}" contains letters from a non-Latin alphabet` });
  }
  if (holder && !holderMixed && !sameName(holder, expectedHolder) && !asciiSpellingOf(holder, expectedHolder)
    && !(atAccountOnFile && (abbreviates(holder, expectedHolder) || truncates(holder, expectedHolder) || tradeNameOf(holder, expectedHolder)))) {
    // 19 Nov (after eval v5): at the account on file, a holder in another alphabet than the name on file that has no
    // standard romanisation to compare it by (a Thai, Hebrew or Korean name on file, the holder in Latin letters as banks
    // and SWIFT write it) cannot be told to differ: shown to the person who verifies, not held. Anywhere else, and
    // between alphabets that can be compared, another name is another holder.
    const incomparable = atAccountOnFile && !sameScripts(holder, expectedHolder) && !(transliterable(holder) && transliterable(expectedHolder));
    // 19 Nov (after the held-out eval v6, v6-name-haining-person-holder: "LI WEI" as holder of the account on file of
    // 浙江海宁绳业有限公司 was paid on a warning). Code cannot read a Chinese name in Latin letters, but it can read what kind of
    // name it is: a company on file (its legal form in its own script: 有限公司, 株式会社, 주식회사, บริษัท … จำกัด, בע״מ,
    // प्राइवेट लिमिटेड) whose account is held, the invoice says, in a name with no company form in any script is a person's
    // account. That holds the invoice, as another holder in the same alphabet does. A romanised company name ("ZHEJIANG
    // HAINING ROPE INDUSTRY CO., LTD.", a bank's "ﾔﾏﾄｾﾝｲ(ｶ") at the account on file is still shown only: the account is the
    // one on file and code cannot compare the letters. At a new or changed account there is no "shown only": another
    // holder holds the invoice (and the changed account blocks it) in any script.
    // 19 Nov (after the held-out eval v7, v7-name-angkor-person-holder and v7-name-addis-person-holder: "SOK DARA" and
    // "ABEBE KEBEDE" at the accounts on file of a Khmer and an Ethiopic company were paid on a warning, as no company form
    // in those scripts was known). Whatever the script: a supplier on file whose name code cannot read in Latin letters is
    // taken to be a company (as suppliers on file are) unless its name is in Latin, Greek or Cyrillic letters and has no
    // company form; a holder written with no company form in any script is then a person's name.
    const person = incomparable && !namesACompany(holder) && (namesACompany(expectedHolder) || !transliterable(expectedHolder));
    signals.push(person
      ? { code: "account_name_mismatch", blocks: true, detail: `the account holder on the invoice is "${holder}", a name with no company form, at the account on file of the company ${expectedHolder}: a person's name as holder of a company's account`, asked: holder, on_file: expectedHolder }
      : incomparable
      ? { code: "account_name_mismatch", blocks: false, detail: `the account holder on the invoice is "${holder}", in another alphabet than ${expectedHolder} on file, which code cannot compare letter by letter; the account is the one on file`, asked: holder, on_file: expectedHolder }
      : { code: "account_name_mismatch", blocks: true, detail: `the account holder on the invoice is "${holder}", not ${expectedHolder}`, asked: holder, on_file: expectedHolder });
  }
  const line = (re: RegExp, not?: RegExp) => text.split("\n").find((l) => re.test(l) && !(not && not.test(l)))?.trim();
  // 19 Nov (after eval v5): the same, in the other languages and scripts suppliers write in (src/policy/multilingual.ts),
  // over the line folded as those lists are (case, accents).
  const anyLine = (re: RegExp, not?: RegExp) => text.split("\n").find((l) => { const f = fold(l); return re.test(f) && !(not && not.test(f)); })?.trim();
  // 19 Nov (eval v3, v3-bec-zeeland-footer-new-account): words asking to pay another account hold the invoice for a
  // person, even when the IBAN line is the one on file; a person confirms with the supplier on a number on file.
  // 19 Nov (after eval v6, v6-bec-galil-details-updated: "פרטי חשבון הבנק שלנו עודכנו"): and bank details near a word of
  // change, in any language the lists know.
  const change = line(BANK_CHANGE, BANK_UNCHANGED) ?? anyLine(BANK_CHANGE_ANY, UNCHANGED_ANY) ?? anyLine(BANK_DETAILS_CHANGED_ANY, UNCHANGED_OR_NEGATED);
  if (change) signals.push({ code: "bank_change_language", blocks: false, holds: true, detail: `the invoice announces a change of bank: "${change}"` });
  else {
    const link = text.split("\n").find(payLink)?.trim();
    // 19 Nov (after eval v5): a crypto wallet's address is never a supplier's bank account on file, in any language.
    const wallet = link ? undefined : walletIn(text);
    if (link) signals.push({ code: "bank_change_language", blocks: false, holds: true, detail: `the invoice asks to be paid through a link, not to the account on file: "${link}"` });
    else if (wallet) signals.push({ code: "bank_change_language", blocks: false, holds: true, detail: `the invoice names a crypto-currency wallet (${wallet.slice(0, 6)}…${wallet.slice(-4)}), not a bank account on file` });
  }
  // Pressure: words of speed alone are shown; a request to get around the checks holds it (eval v3). After eval v5: also
  // in the other languages, and paying or bank details through a messaging app in any language.
  const bypass = line(BYPASS) ?? text.split("\n").find((l) => AUTHORITY.test(l) && PRESSURE.test(l))?.trim()
    // 19 Nov (after eval v6, v6-pressure-galil-ceo and v6-pressure-bharat-confidential): someone above the payer with speed
    // or a request, or secrecy with a payment, speed or "keep", in any language the lists know (bypassInAnyLanguage).
    ?? text.split("\n").find(bypassInAnyLanguage)?.trim() ?? text.split("\n").find((l) => MESSENGER.test(l) && PAY_OR_DETAILS_ANY.test(fold(l)))?.trim();
  const pressure = line(PRESSURE);
  if (bypass) signals.push({ code: "pressure_language", blocks: false, holds: true, detail: `the invoice asks to get around the people or the numbers that check a payment: "${bypass}"` });
  else if (pressure) signals.push({ code: "pressure_language", blocks: false, detail: `the invoice pushes for speed: "${pressure}"` });

  const blocked = signals.some((s) => s.blocks);
  return { blocked, suspicious: signals.some((s) => s.blocks && s.code !== "unknown_vendor"), signals, allowlisted: matched ?? look?.b ?? null };
}
