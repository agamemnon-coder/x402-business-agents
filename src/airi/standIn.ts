// STAND-IN for airi-cli and for a merchant checkout. It is not Airi, not Airwallex and not Visa: it makes no network
// call, runs no program, and issues no card credential. It runs the executor's decisions in tests and in
// `npm run airi:vic-1 -- --dry`. Every result it produces carries its label.

import { writeFileSync } from "node:fs";
import { AiriRefusal, AiriWaitTimeout, CheckoutOutcomeUnknown, mandateCreateArgs, type AiriCheckout, type AiriClient, type AiriCredentialReceipt, type AiriMandate, type AiriMandateRecord, type AiriMandateRequest, type AiriMandateResult, type AiriPaymentMethod, type AiriSession, type CheckoutAnswer, type CheckoutOrder } from "./client.js";
import { termsMetadata, type IntentMetadataReader } from "./termsMetadata.js";

export const STAND_IN_LABEL = "Stand-in for airi-cli: no call made, no card credential issued (not Airi, not Visa)";
export const STAND_IN_CHECKOUT_LABEL = "Stand-in checkout: no merchant, nothing charged";

export interface StandInScript {
  /** Refuse `mandate create` with this code. */
  refuseCreate?: string;
  /** Airi refuses the credential with this code (the owner denied the mandate). */
  refuseCredential?: string;
  /** The owner does not tap in time. */
  noTap?: boolean;
  /** What `auth whoami` says. */
  session?: AiriSession;
  /** What Airi keeps of a mandate's description (default: as sent); null: its list returns none. */
  stored?: (description: string) => string | null;
  /** The first this-many read-backs do not list the mandate yet. */
  unlistedReads?: number;
  /** The mandate list (read back or searched) fails with this code. */
  failRead?: string;
  /** Only the first this-many reads of the list fail (with failRead's code); default: every one. */
  failReads?: number;
}

/** Records every call, so a test sees exactly what was asked, in order. */
export class StandInAiriClient implements AiriClient {
  readonly kind = "stand-in" as const;
  readonly label = STAND_IN_LABEL;
  readonly calls: { op: string; args: string[] }[] = [];
  readonly mandates = new Map<string, { description: string; status: string }>();
  private n = 0;
  private reads = 0;
  private listed = 0;

  constructor(private readonly script: StandInScript = {}) {}

  async whoami(): Promise<AiriSession> {
    this.calls.push({ op: "auth whoami", args: [] });
    return this.script.session ?? { authenticated: true, sessionExpires: "2099-01-01T00:00:00Z" };
  }

  async listPaymentMethods(): Promise<AiriPaymentMethod[]> {
    this.calls.push({ op: "payment-methods list", args: [] });
    return [{ paymentMethodId: "standin-pm-1", type: "CARD", display: "stand-in card" }];
  }

  async createMandate(req: AiriMandateRequest): Promise<AiriMandate> {
    // The same argv the real client would run, so a request the CLI could misread fails here too.
    const args = mandateCreateArgs(req);
    this.calls.push({ op: "mandate create", args });
    if (this.script.refuseCreate) throw new AiriRefusal("airi", this.script.refuseCreate, `stand-in: mandate create refused (${this.script.refuseCreate})`);
    this.n += 1;
    const id = `standin-mdt-${this.n}`;
    this.mandates.set(id, { description: req.description, status: "CREATED" });
    return { mandateId: id, passkeyUrl: `https://stand-in.invalid/approve/${this.n}` };
  }

  async findMandate(description: string, createdFrom: string): Promise<{ mandateId: string; status: string } | null> {
    this.calls.push({ op: "mandate list", args: ["--created-from", createdFrom] });
    this.listed += 1;
    if (this.script.failRead && this.listed <= (this.script.failReads ?? Infinity)) throw new AiriRefusal("airi", this.script.failRead, `stand-in: mandate list failed (${this.script.failRead})`);
    for (const [id, m] of this.mandates) if (m.description === description) return { mandateId: id, status: m.status };
    return null;
  }

  async readMandate(mandateId: string, createdFrom: string): Promise<AiriMandateRecord | null> {
    this.calls.push({ op: "mandate list", args: ["--mandate-id", mandateId, "--created-from", createdFrom] });
    this.listed += 1;
    if (this.script.failRead && this.listed <= (this.script.failReads ?? Infinity)) throw new AiriRefusal("airi", this.script.failRead, `stand-in: mandate list failed (${this.script.failRead})`);
    this.reads += 1;
    const m = this.mandates.get(mandateId);
    if (!m || this.reads <= (this.script.unlistedReads ?? 0)) return null;
    return { mandateId, status: m.status, description: this.script.stored ? this.script.stored(m.description) : m.description };
  }

  async getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt> {
    this.calls.push({ op: "mandate get-credential", args: ["--mandate-id", mandateId, "--file", file] });
    if (this.script.noTap) throw new AiriWaitTimeout(300);
    if (this.script.refuseCredential) throw new AiriRefusal("airi", this.script.refuseCredential, `stand-in: no credential (${this.script.refuseCredential})`);
    // No card data at all: a marker saying what it is. "wx" refuses to overwrite, as the CLI does without --force.
    writeFileSync(file, JSON.stringify({ stand_in: true, note: STAND_IN_LABEL }), { mode: 0o600, flag: "wx" });
    return { status: "STAND_IN", tokenType: "STAND_IN", tokenExpiration: "1970-01-01T00:00:00Z" };
  }

  async reportResult(mandateId: string, result: AiriMandateResult, reason?: string): Promise<void> {
    this.calls.push({ op: "mandate result", args: ["--mandate-id", mandateId, "--result", result, ...(reason ? ["--reason", reason] : [])] });
    const m = this.mandates.get(mandateId);
    if (m) m.status = result === "SUCCEEDED" ? "COMPLETED" : "FAILED";
  }

  async cancelMandate(mandateId: string): Promise<void> {
    this.calls.push({ op: "mandate cancel", args: ["--mandate-id", mandateId] });
    const m = this.mandates.get(mandateId);
    if (m) m.status = "DENIED";
  }
}

export interface StandInCheckoutScript {
  /** pay declines with this code. */
  decline?: string;
  /** prepare answers NOT_SUBMITTED with this code. */
  unavailable?: string;
  /** pay has no answer (outcome unknown). */
  noAnswer?: boolean;
  /** What lookup answers after a crash. */
  lookup?: CheckoutAnswer | null;
}

/** A stand-in merchant checkout: never reads the credential's contents, only that the file is there. It keeps each
 *  order's metadata (the signed terms hash and proposal id, as checkout.ts sends them) so a dry run can read it back. */
export class StandInCheckout implements AiriCheckout, IntentMetadataReader {
  readonly kind = "stand-in" as const;
  readonly label = STAND_IN_CHECKOUT_LABEL;
  readonly seen: { op: string; reference: string; credentialFile?: string }[] = [];
  private n = 0;
  private readonly metadata = new Map<string, Record<string, string>>();

  constructor(private readonly script: StandInCheckoutScript = {}) {}

  async prepare(order: CheckoutOrder): ReturnType<AiriCheckout["prepare"]> {
    if (this.script.unavailable) return { outcome: "NOT_SUBMITTED", reference: null, code: this.script.unavailable, reason: "stand-in: the checkout cannot take orders" };
    this.n += 1;
    const reference = `standin-order-${this.n}`;
    if (order.signed) this.metadata.set(reference, termsMetadata(order.signed));
    this.seen.push({ op: "prepare", reference });
    return { reference };
  }

  async pay(reference: string, _ref: string, credentialFile: string): Promise<CheckoutAnswer> {
    this.seen.push({ op: "pay", reference, credentialFile });
    if (this.script.noAnswer) throw new CheckoutOutcomeUnknown(reference, "stand-in: no answer");
    return this.script.decline ? { outcome: "DECLINED", reference, code: this.script.decline } : { outcome: "SUCCEEDED", reference, code: "STAND_IN" };
  }

  /** The order's metadata as it was stored on prepare; null when it had none (no signed terms). */
  async readMetadata(reference: string): Promise<Record<string, string> | null> {
    this.seen.push({ op: "read metadata", reference });
    const m = this.metadata.get(reference);
    return m ? { ...m } : null;
  }

  async lookup(reference: string): Promise<CheckoutAnswer | null> {
    this.seen.push({ op: "lookup", reference });
    return this.script.lookup === undefined ? null : this.script.lookup;
  }
}
