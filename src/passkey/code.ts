// The one-time enrolment code, shared by the runner and the relay Worker, so both read a typed code the same way.
// Pure string handling: no imports, so the Worker bundle can use it as is.

/** Crockford base32 (no I, L, O or U), so a code typed on a phone is hard to get wrong. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

/** Upper case, separators dropped, O read as 0 and I or L as 1. Null unless 8 characters of the alphabet remain. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
