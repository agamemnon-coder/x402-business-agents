// STAND-IN for airi-cli and for a merchant checkout. It is not Airi, not Airwallex and not Visa: it makes no network
// call, runs no program, and issues no card credential. It exists so the executor's decisions (src/airi/purchase.ts)
// can be tested before Airi access exists. Every result it produces carries STAND_IN_LABEL.

import { writeFileSync } from "node:fs";
import { AiriRefusal, mandateCreateArgs, type AiriCheckout, type AiriClient, type AiriCredentialReceipt, type AiriMandate, type AiriMandateRequest, type AiriMandateResult, type AiriPaymentMethod } from "./client.js";

export const STAND_IN_LABEL = "Stand-in for airi-cli: no call made, no card credential issued (not Airi, not Visa)";

export interface StandInScript {
  /** Refuse `mandate create` with this code. */
  refuseCreate?: string;
  /** The wallet owner does not approve: get-credential fails with this code. */
  refuseCredential?: string;
}

/** Records every call, so a test can see exactly what the executor asked for and in which order. */
export class StandInAiriClient implements AiriClient {
  readonly kind = "stand-in" as const;
  readonly label = STAND_IN_LABEL;
  readonly calls: { op: string; args: string[] }[] = [];
  private n = 0;

  constructor(private readonly script: StandInScript = {}) {}

  async listPaymentMethods(): Promise<AiriPaymentMethod[]> {
    this.calls.push({ op: "payment-methods list", args: [] });
    return [{ paymentMethodId: "standin-pm-1", display: "stand-in card" }];
  }

  async createMandate(req: AiriMandateRequest): Promise<AiriMandate> {
    // The same argv a real adapter would run, so a request the CLI could misread fails here too.
    const args = mandateCreateArgs(req);
    this.calls.push({ op: "mandate create", args });
    if (this.script.refuseCreate) throw new AiriRefusal("airi", this.script.refuseCreate, `stand-in: mandate create refused (${this.script.refuseCreate})`);
    this.n += 1;
    return { mandateId: `standin-mdt-${this.n}`, passkeyUrl: `https://stand-in.invalid/approve/${this.n}` };
  }

  async getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt> {
    this.calls.push({ op: "mandate get-credential", args: ["--mandate-id", mandateId, "--file", file] });
    if (this.script.refuseCredential) throw new AiriRefusal("airi", this.script.refuseCredential, `stand-in: no credential (${this.script.refuseCredential})`);
    // No card data at all: a marker that says what it is. flag "wx" refuses to overwrite, as the CLI does without --force.
    writeFileSync(file, JSON.stringify({ stand_in: true, note: STAND_IN_LABEL }), { mode: 0o600, flag: "wx" });
    return { status: "STAND_IN", tokenType: "STAND_IN", tokenExpiration: "1970-01-01T00:00:00Z" };
  }

  async reportResult(mandateId: string, result: AiriMandateResult, reason?: string): Promise<void> {
    this.calls.push({ op: "mandate result", args: ["--mandate-id", mandateId, "--result", result, ...(reason ? ["--reason", reason] : [])] });
  }

  async cancelMandate(mandateId: string): Promise<void> {
    this.calls.push({ op: "mandate cancel", args: ["--mandate-id", mandateId] });
  }
}

/** A stand-in merchant checkout: approves, or declines with the code a test gives it. */
export class StandInCheckout implements AiriCheckout {
  readonly kind = "stand-in" as const;
  readonly label = "Stand-in checkout: no merchant, nothing charged";
  readonly seen: { merchantUrl: string; amount: string; currency: string; credentialFile: string }[] = [];
  private n = 0;

  constructor(private readonly decline?: string) {}

  async submit(order: { merchantUrl: string; amount: string; currency: string }, credentialFile: string): Promise<{ outcome: AiriMandateResult; reference: string; code?: string }> {
    this.seen.push({ ...order, credentialFile });
    this.n += 1;
    return this.decline ? { outcome: "DECLINED", reference: `standin-order-${this.n}`, code: this.decline } : { outcome: "SUCCEEDED", reference: `standin-order-${this.n}` };
  }
}
