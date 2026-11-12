// Reading the single-use credential that `airi-cli mandate get-credential --file` wrote. Only a checkout adapter calls
// this, at the moment it builds its request; the values live in memory for that one request and are never returned
// to the executor, logged, audited, recorded, put in an error, or shown to a model.
//
// What the file holds is documented only in words: "a tokenized PAN, expiry, and CVV" (airi-cli README and
// airi-get-credential skill, 0.1.0-beta.4). Its field names are not documented. The binary's own strings name
// expiryMonth, expiryYear, tokenType and tokenExpiration; the number and CVV fields are matched by the names below. A
// file that matches none is refused with its key NAMES only (never a value), so the first live run shows what to add.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { constants } from "node:fs";
import { z } from "zod";
import { CREDENTIAL_MAX_BYTES, CREDENTIAL_OTHERS_MASK } from "./cardData.js";

/** The card for one checkout request. Never stored; never in an error. */
export interface CardForCheckout {
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  name?: string;
}

export class CredentialFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialFileError";
  }
}

const NUMBER = ["tokenNumber", "tokenizedPan", "token_number", "pan", "number", "cardNumber", "card_number", "token"];
const MONTH = ["expiryMonth", "expiry_month", "expMonth", "exp_month"];
const YEAR = ["expiryYear", "expiry_year", "expYear", "exp_year"];
const EXPIRY = ["expiry", "expiryDate", "expiry_date", "expirationDate"];
const CVC = ["cvv", "cvc", "cvv2", "securityCode", "security_code", "dynamicCvv"];
const NAME = ["cardholderName", "cardHolderName", "holderName", "name"];
const NESTS = ["credential", "card", "data", "paymentCredential"];

const Shape = z.object({
  number: z.string().regex(/^\d{12,19}$/),
  expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
  expiryYear: z.string().regex(/^20\d{2}$/),
  cvc: z.string().regex(/^\d{3,4}$/),
  name: z.string().min(1).max(128).optional(),
});

function pick(o: Record<string, unknown>, names: string[]): unknown {
  for (const n of names) if (n in o) return o[n];
  return undefined;
}

const asText = (v: unknown): string | undefined => (typeof v === "string" ? v.replace(/[\s-]/g, "") : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : undefined);

/** The card fields from the parsed file, or a refusal naming keys only. */
export function cardFromCredential(json: unknown): CardForCheckout {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new CredentialFileError("the credential file is not a JSON object");
  const top = json as Record<string, unknown>;
  const nested = NESTS.map((k) => top[k]).find((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
  const scopes = [top, ...(nested ? [nested] : [])];
  const find = (names: string[]) => scopes.map((s) => pick(s, names)).find((v) => v !== undefined);
  let month = asText(find(MONTH));
  let year = asText(find(YEAR));
  const expiry = asText(find(EXPIRY));
  if ((!month || !year) && expiry) {
    // MM/YY, MM/YYYY or YYYY-MM.
    const m = /^(\d{2})\/(\d{2}|\d{4})$/.exec(expiry) ?? null;
    const iso = /^(\d{4})(\d{2})$/.exec(expiry.replace("/", "")) ?? null;
    if (m) { month = m[1]; year = m[2]; } else if (iso && Number(iso[2]) <= 12) { year = iso[1]; month = iso[2]; }
  }
  if (month && /^\d$/.test(month)) month = `0${month}`;
  if (year && /^\d{2}$/.test(year)) year = `20${year}`;
  const nameRaw = find(NAME);
  const r = Shape.safeParse({ number: asText(find(NUMBER)), expiryMonth: month, expiryYear: year, cvc: asText(find(CVC)), ...(typeof nameRaw === "string" && nameRaw.trim() ? { name: nameRaw.trim() } : {}) });
  if (!r.success) {
    const missing = [...new Set(r.error.issues.map((i) => String(i.path[0])))].join(", ");
    const keys = scopes.flatMap((s, i) => Object.keys(s).map((k) => (i === 0 ? k : `nested.${k}`))).filter((k) => /^[\w.]{1,40}$/.test(k)).slice(0, 30);
    throw new CredentialFileError(`the credential file's fields are not recognised (${missing}); it has the keys: ${keys.join(", ") || "none"}`);
  }
  return r.data;
}

/**
 * Reads the file the CLI wrote: a regular file (not a symlink), owned by this user, readable by no one else, at most
 * 64 KiB. Then cardFromCredential. Nothing of its contents leaves this function except the returned card.
 */
export function readCredentialFile(file: string): CardForCheckout {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    throw new CredentialFileError(`the credential file could not be opened (${(e as NodeJS.ErrnoException).code ?? "error"})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new CredentialFileError("the credential file is not a regular file");
    if ((st.mode & CREDENTIAL_OTHERS_MASK) !== 0) throw new CredentialFileError("the credential file is readable by others; refused");
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new CredentialFileError("the credential file belongs to another user; refused");
    if (st.size > CREDENTIAL_MAX_BYTES) throw new CredentialFileError("the credential file is too large");
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    let json: unknown;
    try { json = JSON.parse(buf.toString("utf8")); } catch { throw new CredentialFileError("the credential file is not JSON"); } finally { buf.fill(0); }
    return cardFromCredential(json);
  } finally {
    closeSync(fd);
  }
}
