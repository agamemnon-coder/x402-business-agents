// An amount as people write it, read once, in one place: the hands-on page's script carries this function's own source
// (AMOUNT_JS, embedded in SIGN_JS: screens 1 and 4 share it) and the compose route reads the incoming amount with it
// before the engine's strict check, so a page cached before this change is read the same way.
// Plain script only inside the function: no inner functions (a bundler's keepNames would wrap them in a helper the page
// does not have), no TypeScript beyond the signature, no newer syntax than the page's.

/**
 * normaliseAmount(raw, like?): 10k, 1.5k, 10.000, 10,000, 10000, € 10.000,00, €10000, EUR 10,000.00, 1.850,01,
 * 1850,01, 1850.5, as a plain decimal in the format of like (another amount: as many decimals as it has; two when none
 * is given), or null.
 * - A currency sign or code (€, EUR) and spaces go; a trailing k or K multiplies by 1,000.
 * - With both separators the last is the decimal mark and the other separates thousands (in groups of three).
 * - With one kind of separator before groups of exactly three digits (1,850 · 10.000 · 1.234.567) it separates
 *   thousands; otherwise, once, it is the decimal mark (1850,5 · 1850.001).
 * - Negative, zero, letters or more decimals than like has: null.
 * - A value equal to like stays like (screen 4: the signed amount, untouched, is sent as signed).
 */
export function normaliseAmount(raw: unknown, like?: string | null): string | null {
  const L = like === undefined || like === null ? "0.00" : String(like);
  let s = String(raw).replace(/\s/g, "");
  if (like !== undefined && like !== null && s === L && /^\d+(\.\d+)?$/.test(L)) return L;
  s = s.replace(/^(€|eur)/i, "").replace(/(€|eur)$/i, "");
  const k = /^[^kK]*\d[kK]$/.test(s);
  if (k) s = s.slice(0, -1);
  if (!/^\d[\d.,]*\d$|^\d$/.test(s)) return null;
  const seps = s.replace(/\d/g, "");
  let int = s, frac = "";
  if (seps.indexOf(".") >= 0 && seps.indexOf(",") >= 0) {
    const dec = seps[seps.length - 1]!, at = s.lastIndexOf(dec), head = s.slice(0, at);
    if (s.indexOf(dec) !== at || !(dec === "." ? /^\d{1,3}(,\d{3})+$/ : /^\d{1,3}(\.\d{3})+$/).test(head)) return null;
    int = head.replace(/[.,]/g, "");
    frac = s.slice(at + 1);
  } else if (seps) {
    const c = seps[0]!;
    if ((c === "." ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/).test(s)) int = s.replace(/[.,]/g, "");
    else if (seps.length === 1) { int = s.slice(0, s.indexOf(c)); frac = s.slice(s.indexOf(c) + 1); }
    else return null;
  }
  if (k) { frac = frac.padEnd(3, "0"); int = int + frac.slice(0, 3); frac = frac.slice(3); }
  const d = (/\.(\d+)$/.exec(L) || ["", ""])[1]!.length;
  if (frac.length > d) return null;
  int = int.replace(/^0+(?=\d)/, "");
  if (int.length > 12 || !/[1-9]/.test(int + frac)) return null;
  return d ? int + "." + frac.padEnd(d, "0") : int;
}

/** The same function as page script: its own source, under its own name (the page embeds it, Node tests run it). */
export const AMOUNT_JS = `const normaliseAmount=${normaliseAmount.toString()};`;
