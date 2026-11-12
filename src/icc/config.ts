// The ICC rail's environment: one reader for the names of docs/visa-icc.md, section 9. It validates what is set,
// returns a typed configuration, and lists what is missing or wrong BY NAME: never a value, since several of these
// are secrets or paths to them. Values are set by the owner; nothing here prints one.
//
// The configuration it returns holds names, ids, switches and file paths only. The secrets themselves (the shared
// secret, a key file's passphrase, the keys in the files) are read at the moment the client is built
// (iccClientFromEnv) and go nowhere else. Device and assurance data are read later still, at the moment of use
// (readAssuranceFile), and are never stored.

import { closeSync, fstatSync, openSync, readSync, constants as fsConstants } from "node:fs";
import { readPrivateKeyFile, readRequestCertificate, sharedSecretKey, type IccAuthScheme, type IccDateHeader, type IccDigestForm, type IccSigner } from "./auth.js";
import { ICC_PATH_PREFIXES, ICC_TEST_HOST, IccClient, type IccMle, type IccPathPrefix } from "./client.js";
import type { IccPassthrough } from "./instruction.js";
import { iccRailOn } from "./policy.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Every name of section 9, in its order. ICC_GO is the live commands' go variable: they read it, this reader does not. */
export const ICC_ENV_NAMES = [
  "KIT11_ICC_RAIL", "ICC_GO", "ICC_CALL_BUDGET", "ICC_CALL_LOG", "ICC_HOST", "ICC_PATH_PREFIX", "ICC_MERCHANT_ID", "ICC_AUTH_SCHEME",
  "ICC_JWT_KEY_ID", "ICC_JWT_PRIVATE_KEY_FILE", "ICC_JWT_PRIVATE_KEY_PASSPHRASE", "ICC_KEY_ID", "ICC_SHARED_SECRET",
  "ICC_MLE_REQUEST_CERT_FILE", "ICC_MLE_RESPONSE_KEY_ID", "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE", "ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE",
  "ICC_DIGEST_FORM", "ICC_HTTP_SIGNATURE_DATE", "ICC_INSTRUMENT_IDENTIFIER_ID", "ICC_TOKENIZED_CARD_ID", "ICC_ASSURANCE_FILE",
] as const;
export type IccEnvName = (typeof ICC_ENV_NAMES)[number];

export const ICC_AUTH_SCHEMES: readonly IccAuthScheme[] = ["jwt-p12", "jwt-shared-secret", "http-signature"];

export interface IccEnvConfig {
  budget: number;
  callLog: string;
  host: typeof ICC_TEST_HOST;
  pathPrefix: IccPathPrefix;
  merchantId: string;
  scheme: IccAuthScheme;
  /** The key ID of the scheme in use: the P12 signing certificate's, or the shared secret key pair's. */
  keyId: string;
  /** The PEM private key of the signing certificate (jwt-p12 only). */
  jwtPrivateKeyFile: string | null;
  digestForm: IccDigestForm;
  dateHeader: IccDateHeader;
  /** Message-Level Encryption, when its three variables are set. */
  mle: { requestCertFile: string; responseKeyId: string; responsePrivateKeyFile: string } | null;
  instrumentIdentifierId: string;
  tokenizedCardId: string | null;
  /** The private file with the device and assurance data; needed for a purchase, not for the preflight. */
  assuranceFile: string | null;
}

export interface IccEnvReading {
  /** Null unless nothing is missing and nothing is invalid. */
  config: IccEnvConfig | null;
  /** Names that are required and not set. */
  missing: IccEnvName[];
  /** `NAME: what is wrong`, never the value. */
  invalid: string[];
}

/**
 * Reads and validates the environment for the preflight (two reads) or for a purchase (which also needs the
 * assurance file and, with a JWT, Message-Level Encryption). Calls nothing and opens no file.
 */
export function readIccEnv(env: Env = process.env, purpose: "preflight" | "purchase" = "purchase"): IccEnvReading {
  const missing: IccEnvName[] = [];
  const invalid: string[] = [];
  const get = (name: IccEnvName): string | undefined => (env[name] === undefined || env[name] === "" ? undefined : env[name]);
  const need = (name: IccEnvName): string => { const v = get(name); if (v === undefined) missing.push(name); return v ?? ""; };
  const oneOf = <T extends string>(name: IccEnvName, allowed: readonly T[], fallback: T): T => {
    const v = get(name);
    if (v === undefined) return fallback;
    if (!(allowed as readonly string[]).includes(v)) { invalid.push(`${name}: must be one of ${allowed.join(", ")}`); return fallback; }
    return v as T;
  };
  const id = (name: IccEnvName, value: string, pattern: RegExp, what: string): string => { if (value && !pattern.test(value)) invalid.push(`${name}: ${what}`); return value; };

  if (!iccRailOn(env)) missing.push("KIT11_ICC_RAIL");
  const budgetText = need("ICC_CALL_BUDGET");
  if (budgetText && !/^\d{1,6}$/.test(budgetText)) invalid.push("ICC_CALL_BUDGET: must be a whole number");
  const callLog = need("ICC_CALL_LOG");
  const host = get("ICC_HOST");
  if (host !== undefined && host !== ICC_TEST_HOST) invalid.push(`ICC_HOST: only the documented test host ${ICC_TEST_HOST} is accepted`);
  const pathPrefix = oneOf("ICC_PATH_PREFIX", ICC_PATH_PREFIXES, "/icc/v1");
  const merchantId = id("ICC_MERCHANT_ID", need("ICC_MERCHANT_ID"), /^[A-Za-z0-9_-]{1,64}$/, "must be a plain organisation ID");
  const scheme = oneOf("ICC_AUTH_SCHEME", ICC_AUTH_SCHEMES, "jwt-p12");
  const keyPattern = /^[A-Za-z0-9._-]{1,128}$/;
  let keyId: string, jwtPrivateKeyFile: string | null = null;
  if (scheme === "jwt-p12") {
    keyId = id("ICC_JWT_KEY_ID", need("ICC_JWT_KEY_ID"), keyPattern, "must be a plain key ID");
    jwtPrivateKeyFile = need("ICC_JWT_PRIVATE_KEY_FILE");
  } else {
    keyId = id("ICC_KEY_ID", need("ICC_KEY_ID"), keyPattern, "must be a plain key ID");
    const secret = need("ICC_SHARED_SECRET");
    if (secret) { try { sharedSecretKey(secret); } catch { invalid.push("ICC_SHARED_SECRET: must be Base64"); } }
  }
  const digestForm = oneOf("ICC_DIGEST_FORM", ["raw", "hex"] as const, "raw");
  const dateHeader = oneOf("ICC_HTTP_SIGNATURE_DATE", ["v-c-date", "date"] as const, "v-c-date");

  // Message-Level Encryption: its three variables go together. With a JWT a purchase needs them (the API reference
  // marks encryption mandatory on the ICC paths); the preflight's two reads may go without.
  const mleNames = ["ICC_MLE_REQUEST_CERT_FILE", "ICC_MLE_RESPONSE_KEY_ID", "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE"] as const;
  const mleSet = mleNames.filter((n) => get(n) !== undefined);
  const mleNeeded = mleSet.length > 0 || (purpose === "purchase" && scheme !== "http-signature");
  let mle: IccEnvConfig["mle"] = null;
  if (mleNeeded) mle = { requestCertFile: need(mleNames[0]), responseKeyId: id(mleNames[1], need(mleNames[1]), keyPattern, "must be a plain key ID"), responsePrivateKeyFile: need(mleNames[2]) };

  const instrumentIdentifierId = id("ICC_INSTRUMENT_IDENTIFIER_ID", need("ICC_INSTRUMENT_IDENTIFIER_ID"), /^[A-Za-z0-9]{12,32}$/, "must be an instrument identifier of 12 to 32 letters and digits");
  const tokenizedCardId = get("ICC_TOKENIZED_CARD_ID") ?? null;
  if (tokenizedCardId !== null) id("ICC_TOKENIZED_CARD_ID", tokenizedCardId, /^[A-Za-z0-9_-]{8,64}$/, "must be a plain ID of 8 to 64 characters");
  const assuranceFile = purpose === "purchase" ? need("ICC_ASSURANCE_FILE") : get("ICC_ASSURANCE_FILE") ?? null;

  if (missing.length > 0 || invalid.length > 0) return { config: null, missing, invalid };
  return {
    config: { budget: Number(budgetText), callLog, host: ICC_TEST_HOST, pathPrefix, merchantId, scheme, keyId, jwtPrivateKeyFile, digestForm, dateHeader, mle, instrumentIdentifierId, tokenizedCardId, assuranceFile: assuranceFile || null },
    missing, invalid,
  };
}

/** One line for a person: what to set or fix, by name. Empty when the reading is complete. */
export function iccEnvProblem(r: IccEnvReading): string {
  return [r.missing.length ? `not set: ${r.missing.join(", ")}` : "", r.invalid.length ? `not valid: ${r.invalid.join("; ")}` : ""].filter(Boolean).join("; ");
}

/**
 * The client this environment describes. The key files are opened here (a private key file must be this user's and
 * unreadable to others); an error names the variable, never a value. Refuses unless the reading is complete.
 */
export function iccClientFromEnv(env: Env = process.env, purpose: "preflight" | "purchase" = "purchase", o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): { client: IccClient; config: IccEnvConfig } {
  const reading = readIccEnv(env, purpose);
  if (!reading.config) throw new Error(`the ICC rail cannot start (${iccEnvProblem(reading)}); nothing was called`);
  const c = reading.config;
  const signer: IccSigner = c.scheme === "jwt-p12"
    ? { scheme: c.scheme, keyId: c.keyId, privateKey: readPrivateKeyFile(c.jwtPrivateKeyFile!, env.ICC_JWT_PRIVATE_KEY_PASSPHRASE || undefined, "ICC_JWT_PRIVATE_KEY_FILE") }
    : { scheme: c.scheme, keyId: c.keyId, secret: sharedSecretKey(env.ICC_SHARED_SECRET ?? "") };
  const mle: IccMle | null = c.mle && {
    request: readRequestCertificate(c.mle.requestCertFile, "ICC_MLE_REQUEST_CERT_FILE"),
    responseKeyId: c.mle.responseKeyId,
    responsePrivateKey: readPrivateKeyFile(c.mle.responsePrivateKeyFile, env.ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE || undefined, "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE"),
  };
  const client = new IccClient({ merchantId: c.merchantId, signer, mle, budget: c.budget, callLog: c.callLog, host: c.host, pathPrefix: c.pathPrefix, digestForm: c.digestForm, dateHeader: c.dateHeader, ...o });
  return { client, config: c };
}

export class IccAssuranceFileError extends Error {
  constructor(message: string) {
    super(`ICC_ASSURANCE_FILE: ${message}`);
    this.name = "IccAssuranceFileError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The device and assurance data of the cardholder's passkey step, from the owner's private file: a JSON object with
 * `deviceInformation` (an object) and `assuranceData` (a list), passed through unchanged. Read at the moment of use
 * and never stored. The file must be a regular file of this user that nobody else can read, at most 64 KiB. An error
 * names what is wrong and, at most, the names of the file's top-level keys; never a value.
 */
export function readAssuranceFile(file: string): IccPassthrough {
  let fd: number;
  try {
    fd = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (e) {
    throw new IccAssuranceFileError(`the file could not be opened (${(e as NodeJS.ErrnoException).code ?? "error"})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new IccAssuranceFileError("not a regular file");
    if ((st.mode & 0o077) !== 0) throw new IccAssuranceFileError("the file is readable by others; refused (chmod 600)");
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new IccAssuranceFileError("the file belongs to another user; refused");
    if (st.size === 0 || st.size > 64 * 1024) throw new IccAssuranceFileError("the file is empty or too large");
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    let json: unknown;
    try { json = JSON.parse(buf.toString("utf8")) as unknown; } catch { throw new IccAssuranceFileError("the file is not JSON"); } finally { buf.fill(0); }
    if (!isObject(json) || !isObject(json.deviceInformation) || !Array.isArray(json.assuranceData) || json.assuranceData.length === 0 || !json.assuranceData.every(isObject)) {
      const keys = isObject(json) ? Object.keys(json).filter((k) => /^\w{1,40}$/.test(k)).slice(0, 12).join(", ") : "";
      throw new IccAssuranceFileError(`needs an object with deviceInformation (an object) and assuranceData (a list of objects); it has the keys: ${keys || "none"}`);
    }
    return { deviceInformation: json.deviceInformation, assuranceData: json.assuranceData };
  } finally {
    closeSync(fd);
  }
}
