// Writing systems in supplier names (19 Nov, after the held-out adversarial eval v5, docs/evals/adversarial-v5.md: every
// clean invoice of the two suppliers on file whose legal names are in Greek and in Cyrillic letters was held as possible
// fraud). The root cause was src/policy/fraudCore.ts treating any letter outside the Latin alphabet as a spoof
// (hasOtherScript, "mixed_scripts" on the whole name) and refusing to match a non-Latin name by anything but its exact
// code points. What is a spoof is a word that MIXES alphabets (Unicode TR #39's mixed-script confusable: a Cyrillic "а"
// inside a Latin word), or a whole name in another alphabet that only looks like a Latin name on file (a whole-script
// confusable, which the lookalike check still catches). A name written wholly in Greek, Cyrillic, Hebrew, Thai or any
// other script is a name. Pure: no database, no Node modules (the Worker runs it too).

/** The scripts a letter can be in that this module tells apart; any other letter counts as "Other". */
const SCRIPTS = [
  "Latin", "Greek", "Cyrillic", "Armenian", "Georgian", "Hebrew", "Arabic", "Syriac", "Thaana", "Devanagari", "Bengali",
  "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala", "Thai", "Lao", "Tibetan",
  "Myanmar", "Khmer", "Hangul", "Han", "Hiragana", "Katakana", "Bopomofo", "Ethiopic", "Cherokee", "Mongolian",
] as const;
const SCRIPT_RE = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, "u")] as const);

/** The script of one letter, or null for what is not a letter of a script (digits, punctuation, marks, symbols). */
export function scriptOf(ch: string): string | null {
  if (!/\p{L}/u.test(ch) || /\p{Script=Common}|\p{Script=Inherited}/u.test(ch)) return null;
  for (const [name, re] of SCRIPT_RE) if (re.test(ch)) return name;
  return "Other";
}

/** The scripts of a text's letters, after NFKC (full-width and mathematical letters count as the letters they are). */
export function scriptsIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text.normalize("NFKC")) {
    const s = scriptOf(ch);
    if (s) out.add(s);
  }
  return out;
}

/**
 * The script sets one word may mix without being suspect: Unicode TR #39's "highly restrictive" level, the way Japanese,
 * Chinese and Korean are written (Han with kana or Hangul, with Latin letters beside them: "ABC株式会社").
 */
const ALLOWED_MIXES: readonly ReadonlySet<string>[] = [
  new Set(["Latin", "Han", "Hiragana", "Katakana"]),
  new Set(["Latin", "Han", "Bopomofo"]),
  new Set(["Latin", "Han", "Hangul"]),
];

/**
 * The first word of a name whose letters mix alphabets in a way no language writes a word ("Bеrgtex" with a Cyrillic е,
 * "Ωmega", "Пловдиv"), or undefined. Words are split at spaces and punctuation; digits, marks and symbols do not count.
 * A name wholly in one alphabet, or with whole words in different alphabets ("Текстил Пловдив EOOD"), has none.
 */
export function mixedScriptWord(name: string): string | undefined {
  for (const word of name.normalize("NFKC").split(/[^\p{L}\p{M}\p{N}]+/u)) {
    const s = scriptsIn(word);
    if (s.size <= 1) continue;
    if (!ALLOWED_MIXES.some((allowed) => [...s].every((x) => allowed.has(x)))) return word;
  }
  return undefined;
}

/**
 * A text without the characters that only shape how it is set, never which letters it has (19 Nov, after the held-out
 * eval v7, docs/evals/adversarial-v7.md: an Arabic name stretched with tatweel was held as another holder, and an order
 * with soft hyphens inside its words went past the screen of words): every invisible format character (Unicode Cf: soft
 * hyphen, zero-width space, joiners, direction marks, word joiner, tag characters) and the Arabic tatweel (kashida, U+0640),
 * which justifies a line by stretching a letter. For comparing and matching only: whether such characters are where a
 * script's spelling puts them is the injection screen's question (src/policy/injection.ts), not this one's.
 */
export function withoutTypography(text: string): string {
  return oneEncoding(text).replace(/[\p{Cf}\u0640]/gu, "");
}

/** Malayalam's chillu letters, by the consonant they were written with before Unicode 5.1 (consonant, virama, zero-width joiner). */
const CHILLU: Readonly<Record<string, string>> = { "\u0d23": "\u0d7a", "\u0d28": "\u0d7b", "\u0d30": "\u0d7c", "\u0d32": "\u0d7d", "\u0d33": "\u0d7e", "\u0d15": "\u0d7f", "\u0d2e": "\u0d54", "\u0d2f": "\u0d55", "\u0d34": "\u0d56" };
/** Yiddish's ligatures, which Unicode gives no decomposition: the two letters they are written with too. */
const YIDDISH_PAIRS: Readonly<Record<string, string>> = { "\u05f0": "\u05d5\u05d5", "\u05f1": "\u05d5\u05d9", "\u05f2": "\u05d9\u05d9" };
/**
 * A text with each letter that Unicode encodes two ways, and no normalisation unifies, in one of them (20 Nov, after the
 * held-out eval v8, docs/evals/adversarial-v8.md: a Malayalam name written with its chillu letter as consonant, virama
 * and zero-width joiner, as text was encoded before Unicode 5.1, was held as a lookalike of the same name written with
 * the chillu letter of today; the joiner was dropped as typography and the virama left a letter that differs). Malayalam's
 * chillu letters as the one character of Unicode 5.1, and Yiddish's ligatures ("\u05f0", "\u05f1", "\u05f2") as the letter pairs
 * Yiddish is also written with. For comparing and matching only.
 */
export function oneEncoding(text: string): string {
  return text.replace(/([\u0d15\u0d23\u0d28\u0d2e\u0d2f\u0d30\u0d32\u0d33\u0d34])\u0d4d\u200d/gu, (_, c: string) => CHILLU[c]!)
    .replace(/[\u05f0-\u05f2]/gu, (ch) => YIDDISH_PAIRS[ch]!);
}

/** The name as written, for an exact comparison: NFKC, without invisible format characters or tatweel, spacing collapsed. */
export function canonicalName(name: string): string {
  return withoutTypography(name.normalize("NFKC")).replace(/\s+/g, " ").trim();
}

/** Whether every letter of a text is Latin, Greek or Cyrillic: the alphabets toLatin writes in Latin letters. */
export function transliterable(text: string): boolean {
  return [...scriptsIn(text)].every((s) => s === "Latin" || s === "Greek" || s === "Cyrillic");
}

// Greek in Latin letters as ELOT 743 / ISO 843 write it (what Greek banks print), the pairs first.
const GREEK_PAIRS: Readonly<Record<string, string>> = {
  ου: "ou", γγ: "ng", γκ: "gk", γξ: "nx", γχ: "nch", μπ: "mp", ντ: "nt", αι: "ai", ει: "ei", οι: "oi",
};
/** αυ, ευ, ηυ: v before a vowel or a voiced consonant, f before a voiceless one or at the end (ELOT 743). */
const GREEK_U: Readonly<Record<string, string>> = { αυ: "a", ευ: "e", ηυ: "i" };
const VOICELESS = new Set(["θ", "κ", "ξ", "π", "σ", "ς", "τ", "φ", "χ", "ψ"]);
const GREEK: Readonly<Record<string, string>> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
// Cyrillic in Latin letters: Bulgaria's official system (2009) for the letters it has, Russian, Ukrainian, Serbian and
// Macedonian letters as their national systems write them.
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya",
  ё: "yo", ы: "y", э: "e", є: "ye", і: "i", ї: "yi", ґ: "g", ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz", ѓ: "gj", ќ: "kj", ѕ: "dz", ў: "u",
  // 20 Nov (after the held-out eval v8, v8-name-khukh-romanised-holder: "KHUKH TENGER NOOLUUR LLC", a bank's romanisation of
  // "Хөх Тэнгэр Ноолуур ХХК", was held as another holder, because the Mongolian letters ө and ү were in no table and stayed
  // Cyrillic). The letters of the other Cyrillic alphabets, as their national romanisations write them without marks:
  // Mongolian (ө, ү), Kazakh and Kyrgyz (ә, ғ, қ, ң, ұ, һ), Tajik (ӣ, ӯ, ҳ, ҷ), Tatar and Bashkir (җ, ҙ, ҫ, ҡ, ҕ).
  ө: "o", ү: "u", ә: "a", ғ: "g", қ: "k", ң: "n", ұ: "u", һ: "h", ӣ: "i", ӯ: "u", ҳ: "h", ҷ: "j", җ: "zh", ҙ: "z", ҫ: "s", ҡ: "k", ҕ: "g",
};

/** A text with its Greek and Cyrillic letters written in Latin ones (lower case); other letters are left as they are. */
export function toLatin(text: string): string {
  // Cyrillic letters with a mark of their own (й, ё, ї, ў, ѓ, ќ) are looked up whole; Greek accents are dropped first.
  const bare = (ch: string) => (CYRILLIC[ch] ? ch : ch.normalize("NFKD").replace(/\p{M}/gu, ""));
  const s = [...text.normalize("NFKC").toLowerCase()].map(bare).join("");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const u = GREEK_U[s.slice(i, i + 2)];
    if (u) { const next = s[i + 2]; out += u + (next === undefined || !/\p{L}/u.test(next) || VOICELESS.has(next) ? "f" : "v"); i++; continue; }
    const pair = GREEK_PAIRS[s.slice(i, i + 2)];
    if (pair) { out += pair; i++; continue; }
    const ch = s[i]!;
    out += GREEK[ch] ?? CYRILLIC[ch] ?? ch;
  }
  return out;
}

/**
 * A text in Latin letters as the other usual romanisations of Russian and Ukrainian write it (19 Nov, after the held-out
 * eval v7, v7-name-lviv-translit-holder: the Ukrainian national romanisation "LVIVSKA TKANYNA" of "Львівська Тканина" was
 * held as another holder, because toLatin follows Bulgaria's system, which writes the soft sign "ь" as "y", where Russian
 * and Ukrainian banks drop it): the soft and hard signs dropped, "щ" as "shch", "ё" as "e", and "г" also as Ukrainian and Belarusian
 * write it, "h". Every spelling is compared; none is ever shown.
 */
export function toLatinVariants(text: string): string[] {
  const low = text.normalize("NFKC").toLowerCase();
  const east = low.replace(/[ьъ]/gu, "").replace(/щ/gu, "shch").replace(/ё/gu, "е");
  const out = [toLatin(text), toLatin(east), toLatin(east.replace(/г/gu, "h"))];
  // 20 Nov (after eval v8): Mongolian, Kazakh and Kyrgyz banks write ө and ү, and ұ, all as "u" ("Хөх" as "KHUKH").
  if (/[өүұ]/u.test(low)) out.push(toLatin(low.replace(/[өүұ]/gu, "у")));
  return [...new Set(out)];
}

/** Latin letters that no mark makes, as an ASCII system spells them (Icelandic þ and ð, Danish ø, German ß, Polish ł, Turkish ı …). */
const ASCII_SPELLING: Readonly<Record<string, string>> = {
  þ: "th", ð: "d", æ: "ae", ø: "o", œ: "oe", ß: "ss", ł: "l", đ: "d", ħ: "h", ı: "i", ŀ: "l", ŋ: "ng", ĸ: "k", ŧ: "t", ſ: "s", ƒ: "f",
};
/**
 * A Latin name as an ASCII system writes it (20 Nov, after the held-out eval v8, v8-look-thors-ascii: "Thorsdottir
 * Ullarvorur ehf." for "Þórsdóttir Ullarvörur ehf." on file was held as a lookalike, because þ, a letter no mark makes,
 * was dropped from the name, not written "th"): accents dropped, and the letters no mark makes as their usual spelling.
 * Lower case. Used only to compare a name written in plain ASCII with the name on file, never to show one.
 */
export function asciiSpelling(text: string): string {
  return [...text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()].map((ch) => ASCII_SPELLING[ch] ?? ch).join("");
}
/** Whether a text is plain ASCII. */
export const plainAscii = (text: string) => /^[\x20-\x7E]*$/.test(text.trim());

/**
 * A Latin spelling reduced to what the usual romanisations of one Greek or Cyrillic name share (ELOT, ISO 9, BGN, the
 * banks' own): kh, ch and h as h; y and j as i; ph as f; w as v; x as ks; ou as u; tz as ts. Used only to compare two
 * spellings of one name, never to show one.
 */
export function romanFold(latin: string): string {
  return latin.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/kh|ch/g, "h").replace(/ph/g, "f").replace(/[yj]/g, "i").replace(/w/g, "v").replace(/x/g, "ks").replace(/ou/g, "u").replace(/tz/g, "ts");
}
