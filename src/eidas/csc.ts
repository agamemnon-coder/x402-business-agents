// The pluggable QES adapter, and one implementation: a client of the Cloud Signature Consortium API v2 (CSC API
// v2.0.0.2, cloudsignatureconsortium.org), the API most remote-signing QTSPs offer for a remote QSCD.
//
// STATUS, everywhere this is shown: built and tested against a mock CSC server (test/support/eidasMocks.ts); needs a
// QTSP account to run live. No live qualified signature has been made with it. Purser has no QTSP contract, no
// credential and no qualified certificate.
//
// The flow (CSC API v2 clauses 11.4, 11.6, 11.10): credentials/list (with credentialInfo, the certificate chain and
// the auth info) picks the CFO's credential; credentials/authorize binds a Signature Activation Data (SAD) to the one
// hash to be signed (SCAL 2: "the hash to-be-signed is linked to the signature activation data"); signatures/signHash
// returns the raw signature. What is signed is SHA-256 of the JAdES signing input (src/eidas/jades.ts), whose payload
// holds the approval's canonical terms and their SHA-256: the same terms hash the passkey signed.

import { ecdsaDerToRaw, OID } from "./der.js";
import { requireEidas } from "./flag.js";

/** Said wherever the QES tier is shown: in the CLI, the docs and the tests. */
export const QES_STATUS = "built and tested against a mock CSC server; needs a QTSP account to run live (no live QES has been made)";

/** JOSE algorithms the adapter can produce for a JAdES signature. */
export type JwsAlg = "ES256" | "RS256";

/** The credential a QES adapter signs with, as the RSSP describes it. */
export interface QesCredential {
  credentialId: string;
  /** Base64 DER X.509 certificates, the end-entity (the CFO's) first. */
  certificates: string[];
  alg: JwsAlg;
  /** CSC's signatureQualifier, e.g. "eu_eidas_qes", as the RSSP states it (not proven by it). */
  signatureQualifier: string | null;
}

/** Anything that can make a qualified signature over a SHA-256: a CSC client today, another QTSP API tomorrow. */
export interface QesAdapter {
  readonly status: string;
  credential(): Promise<QesCredential>;
  /** The JOSE signature value (ES256: raw r ‖ s) over a SHA-256 the RSSP signs as is. */
  signHash(sha256: Uint8Array, description: string): Promise<Uint8Array>;
}

/** One authentication object the RSSP asks for in explicit mode (CSC API v2 clause 8.3.1), e.g. a PIN or OTP. */
export interface CscAuthData { id: string; value: string }

export interface CscOptions {
  /** The RSSP's base URI, ending in /csc/v2 (CSC API v2 clause 7.2). */
  baseUrl: string;
  /** A service access token (CSC API v2 clause 8.1), passed as "Authorization: Bearer …". */
  accessToken: string;
  /** Which credential to use; the first enabled "eu_eidas_qes" credential when omitted. */
  credentialId?: string;
  /** Collects the CFO's authentication objects for credentials/authorize (explicit mode): asked at signing time, never stored. */
  authData: (credential: QesCredential) => Promise<CscAuthData[]>;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** An error the RSSP returned (CSC API v2 clause 10: { error, error_description }). */
export class CscError extends Error {
  constructor(readonly method: string, readonly status: number, readonly error: string, readonly description: string) {
    super(`CSC ${method}: ${status} ${error}${description ? ` (${description})` : ""}`);
  }
}

interface CredentialInfo {
  credentialID: string;
  signatureQualifier?: string;
  key: { status: string; algo: string[]; len?: number; curve?: string };
  cert?: { status?: string; certificates?: string[] };
  auth?: { mode?: string };
  SCAL?: string;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

export class CscQesAdapter implements QesAdapter {
  readonly status = QES_STATUS;
  private readonly f: typeof fetch;
  private chosen: (QesCredential & { signAlgo: string }) | null = null;

  constructor(private readonly o: CscOptions) {
    requireEidas(o.env);
    if (!/\/csc\/v2$/.test(o.baseUrl)) throw new Error("a CSC v2 base URI ends in /csc/v2 (CSC API v2 clause 7.2)");
    this.f = o.fetch ?? fetch;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.f(`${this.o.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.accessToken}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new CscError(method, res.status, String(json.error ?? "error"), String(json.error_description ?? ""));
    return json as T;
  }

  async credential(): Promise<QesCredential> {
    if (this.chosen) return this.chosen;
    const list = await this.call<{ credentialIDs: string[]; credentialInfos?: CredentialInfo[] }>("credentials/list", {
      credentialInfo: true, certificates: "chain", certInfo: true, authInfo: true,
    });
    const infos = list.credentialInfos ?? [];
    const info = this.o.credentialId
      ? infos.find((c) => c.credentialID === this.o.credentialId)
      : infos.find((c) => c.signatureQualifier === "eu_eidas_qes" && c.key.status === "enabled");
    if (!info) throw new Error(this.o.credentialId ? `the RSSP lists no credential ${this.o.credentialId}` : "the RSSP lists no enabled eu_eidas_qes credential");
    if (info.key.status !== "enabled") throw new Error(`credential ${info.credentialID} is ${info.key.status}`);
    if (info.auth?.mode && info.auth.mode !== "explicit") throw new Error(`credential ${info.credentialID} uses ${info.auth.mode} authorization; this client does explicit (credentials/authorize) only`);
    const certificates = info.cert?.certificates ?? [];
    if (certificates.length === 0) throw new Error(`the RSSP returned no certificate for ${info.credentialID}`);
    // ES256 when the key is ECDSA P-256, RS256 when it is RSA; nothing else is offered.
    const ec = info.key.algo.includes(OID.ecdsaWithSha256) && (info.key.curve === undefined || info.key.curve === "1.2.840.10045.3.1.7");
    const rsa = info.key.algo.includes(OID.rsaEncryption) || info.key.algo.includes(OID.sha256WithRsa);
    if (!ec && !rsa) throw new Error(`credential ${info.credentialID} offers no ES256 or RS256 algorithm (${info.key.algo.join(", ")})`);
    this.chosen = {
      credentialId: info.credentialID, certificates, alg: ec ? "ES256" : "RS256",
      signAlgo: ec ? OID.ecdsaWithSha256 : info.key.algo.includes(OID.rsaEncryption) ? OID.rsaEncryption : OID.sha256WithRsa,
      signatureQualifier: info.signatureQualifier ?? null,
    };
    return this.chosen;
  }

  async signHash(sha256: Uint8Array, description: string): Promise<Uint8Array> {
    if (sha256.length !== 32) throw new Error("the hash to sign is a SHA-256: 32 bytes");
    const c = await this.credential();
    const hashes = [b64(sha256)];
    // SCAL 2: the SAD is bound to this one hash, so it cannot sign anything else.
    const { SAD } = await this.call<{ SAD: string; expiresIn?: number }>("credentials/authorize", {
      credentialID: c.credentialId, numSignatures: 1, hashes, hashAlgorithmOID: OID.sha256,
      authData: await this.o.authData(c), description: description.slice(0, 500),
    });
    const { signatures } = await this.call<{ signatures: string[] }>("signatures/signHash", {
      credentialID: c.credentialId, SAD, hashes, hashAlgorithmOID: OID.sha256, signAlgo: (this.chosen as { signAlgo: string }).signAlgo,
    });
    const sig = signatures?.[0];
    if (typeof sig !== "string") throw new Error("signatures/signHash returned no signature");
    const raw = Buffer.from(sig, "base64");
    // An ECDSA signature comes back DER-encoded (or already r ‖ s); JOSE wants r ‖ s.
    return c.alg === "ES256" ? (raw.length === 64 ? raw : ecdsaDerToRaw(raw)) : raw;
  }
}
