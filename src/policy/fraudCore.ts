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
  detail: string;
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
const CONFUSABLES: Record<string, string> = {
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

const BANK_CHANGE = /bank (details|account)[^.\n]{0,40}(changed|new)|\bnew (bank|account)\b|update your records|changed (our )?bank/i;
const PRESSURE = /\burgent(ly)?\b|\bimmediately\b|\btoday\b|avoid (an? )?(interruption|suspension|penalt)|final notice|\bconfidential\b/i;

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
  // The same vendor written differently (case, spacing, punctuation) in Latin letters is that vendor.
  const matched = all.find((b) => b.name === inv.vendor) ?? (hasOtherScript(inv.vendor) ? undefined : all.find((b) => skeleton(b.name) === skeleton(inv.vendor)));

  if (hasOtherScript(inv.vendor)) {
    signals.push({ code: "mixed_scripts", blocks: true, detail: `the vendor name "${inv.vendor}" contains letters from a non-Latin alphabet` });
  }
  const look = matched ? null : lookalikeOf(inv.vendor, all);
  if (look) {
    signals.push({ code: "lookalike_vendor", blocks: true, detail: `"${inv.vendor}" is not the allowlisted "${look.b.name}" but looks like it (${look.how})` });
  } else if (!matched) {
    signals.push({ code: "unknown_vendor", blocks: true, detail: `${inv.vendor} is not an allowlisted beneficiary` });
  }

  // Compared with the supplier it is, or pretends to be.
  const onFile = matched ?? look?.b;
  if (onFile && (onFile.iban_sha256 !== invIbanSha || onFile.bic !== inv.bic)) {
    const iban = inv.iban.replace(/\s+/g, "").toUpperCase();
    signals.push({
      code: "bank_details_changed", blocks: true,
      detail: `the invoice asks for IBAN ...${iban.slice(-4)} (${iban.slice(0, 2)}) and BIC ${inv.bic}; on file: IBAN ...${onFile.iban_last4} (${onFile.bic.slice(4, 6)}) and BIC ${onFile.bic}`,
    });
  }
  const holder = /^Account name:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const expectedHolder = matched?.name ?? inv.vendor;
  if (holder && skeleton(holder) !== skeleton(expectedHolder)) {
    signals.push({ code: "account_name_mismatch", blocks: true, detail: `the account holder on the invoice is "${holder}", not ${expectedHolder}` });
  }
  const line = (re: RegExp) => text.split("\n").find((l) => re.test(l))?.trim();
  const change = line(BANK_CHANGE);
  if (change) signals.push({ code: "bank_change_language", blocks: false, detail: `the invoice announces a change of bank: "${change}"` });
  const pressure = line(PRESSURE);
  if (pressure) signals.push({ code: "pressure_language", blocks: false, detail: `the invoice pushes for speed: "${pressure}"` });

  const blocked = signals.some((s) => s.blocks);
  return { blocked, suspicious: signals.some((s) => s.blocks && s.code !== "unknown_vendor"), signals, allowlisted: matched ?? look?.b ?? null };
}
