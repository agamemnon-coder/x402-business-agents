// The real Airi client: runs the pinned airi-cli binary (github.com/airwallex/airi-cli, 0.1.0-beta.4).
//
// - execFile, never a shell; the absolute path of the Go binary itself (the npm launcher bin/airi-cli.js only spawns
//   vendor/airi-cli, so that binary is run directly), checked against a pinned SHA-256 and `version` before first use;
// - every call with `-o json --no-telemetry`, and a child environment of its own: PATH, HOME, TZ=UTC and
//   AIRI_TELEMETRY_DISABLED=1 only, so none of Purser's keys reaches the CLI;
// - a time limit per command; get-credential waits up to 300 s for the wallet owner's tap;
// - every answer parsed with zod; an answer that does not parse is refused, and its text is never repeated;
// - the passkey URL is returned to the executor only, which shows it on the operator console and nowhere else.
//   CLI error text is scrubbed (no link, no long digit run, no e-mail) before it is kept anywhere.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { AIRI_CLI_DOCUMENTED_VERSION, AiriRefusal, AiriWaitTimeout, mandateCreateArgs, scrubText, type AiriClient, type AiriCredentialReceipt, type AiriMandate, type AiriMandateRequest, type AiriMandateResult, type AiriPaymentMethod, type AiriSession } from "./client.js";

/** Where the container's install put it (npm -g, 7 November). */
export const DEFAULT_AIRI_CLI = "/opt/node22/bin/airi-cli";

/**
 * SHA-256 of the Go binary 0.1.0-beta.4 put in vendor/airi-cli, per platform, as installed here on 7 November (npm
 * itself checked the release tarball against the package's pinned checksums.json). Another platform needs
 * KIT11_AIRI_CLI_SHA256, set by a person who checked that binary.
 */
export const PINNED_BINARY_SHA256: Readonly<Record<string, string>> = {
  "linux-x64": "c1bc11e4a09c79ffa6efcb603d84568e71822485b141058ca93c03ee2a201fcb",
};

/** Seconds get-credential waits for the tap (the CLI's own default and maximum we use). */
export const TAP_WAIT_S = 300;
const TIMEOUT_MS: { short: number; version: number; credential: number } = { short: 30_000, version: 10_000, credential: (TAP_WAIT_S + 30) * 1000 };

export interface ExecResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export type Exec = (file: string, args: string[], o: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>;

/** node's execFile: no shell, bounded output, SIGTERM at the time limit. */
export const nodeExec: Exec = (file, args, o) => new Promise((ok) => {
  execFile(file, args, { timeout: o.timeoutMs, env: o.env, maxBuffer: 1 << 20, windowsHide: true, shell: false, killSignal: "SIGTERM" }, (err, stdout, stderr) => {
    const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
    ok({ code: e ? (typeof e.code === "number" ? e.code : null) : 0, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed });
  });
});

/** The Go binary behind a path: the npm launcher is followed to <package>/vendor/airi-cli. */
export function resolveAiriBinary(path: string): string {
  if (!isAbsolute(path)) throw new Error(`the airi-cli path must be absolute: ${path}`);
  const real = realpathSync(path);
  return real.endsWith("/bin/airi-cli.js") ? join(dirname(dirname(real)), "vendor", "airi-cli") : real;
}

export function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Only what the CLI needs: no key of Purser's, telemetry off, times in UTC. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin", HOME: env.HOME ?? "/root", TZ: "UTC", LANG: "C.UTF-8",
    ...(env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: env.XDG_CONFIG_HOME } : {}),
    AIRI_TELEMETRY_DISABLED: "1", DISABLE_TELEMETRY: "1",
  };
}

// ---- the answers, as airi-cli 0.1.0-beta.4 gives them (README, skill, and the shapes seen on 7 November) ----------

const Version = z.object({ version: z.string() });
const Session = z.object({ authenticated: z.boolean(), session_expires: z.string().optional() });
/** `payment-methods list`: an array of { asDefault, card, createdAt, nickName, paymentMethodId, type }. `card` is
 *  sensitive: only a brand and last four are ever read from it, and only when they are plain. */
const PaymentMethods = z.array(z.object({ paymentMethodId: z.string().min(1).max(200), type: z.string().max(40), card: z.unknown().optional() }));
// airi-cli 0.1.0-beta.4 answers in camelCase, as seen live on 7 Nov (vic-1): { expiresAt, mandateId, passkeyUrl, status }.
// The docs show snake_case; both are read, and only the id and the https link are kept.
const MandateCreated = z.union([
  z.object({ mandateId: z.string().min(1).max(200), passkeyUrl: z.string().url() }),
  z.object({ mandate_id: z.string().min(1).max(200), passkey_url: z.string().url() }),
  z.object({ mandateId: z.string().min(1).max(200), passkey_url: z.string().url() }),
]);
const Receipt = z.object({ status: z.string().max(100), tokenType: z.string().max(100), tokenExpiration: z.string().max(100) });
const Cancelled = z.object({ status: z.literal("ok") });
const MandateRow = z.object({ mandateId: z.string().min(1).max(200), status: z.string().max(40), description: z.string().max(500).optional() });
const MandateList = z.union([
  z.array(MandateRow),
  z.object({ mandates: z.array(MandateRow) }),
  z.object({ items: z.array(MandateRow) }),
  z.object({ data: z.array(MandateRow) }),
  z.object({ content: z.array(MandateRow) }),
]);
const CliError = z.object({
  error: z.union([z.string(), z.object({ code: z.string().optional(), message: z.string().optional() })]).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

function display(card: unknown): string {
  const c = (card && typeof card === "object" ? card : {}) as Record<string, unknown>;
  const brand = typeof c.brand === "string" && /^[A-Za-z ]{2,20}$/.test(c.brand) ? c.brand : null;
  const last4 = typeof c.last4 === "string" && /^\d{4}$/.test(c.last4) ? c.last4 : null;
  return [brand, last4 && `•••• ${last4}`].filter(Boolean).join(" ") || "card";
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

export interface AiriCliOptions {
  binary?: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
  /** The binary's expected SHA-256; default PINNED_BINARY_SHA256 for this platform, or KIT11_AIRI_CLI_SHA256. */
  expectedSha256?: string | null;
  sha256Of?: (file: string) => string;
  resolve?: (path: string) => string;
}

export class AiriCliClient implements AiriClient {
  readonly kind = "airi-cli" as const;
  readonly label = `airi-cli ${AIRI_CLI_DOCUMENTED_VERSION} (Airwallex's Airi wallet)`;
  private readonly exec: Exec;
  private readonly env: NodeJS.ProcessEnv;
  private readonly path: string;
  private checked: Promise<string> | null = null;

  constructor(private readonly o: AiriCliOptions = {}) {
    this.exec = o.exec ?? nodeExec;
    this.env = childEnv(o.env ?? process.env);
    this.path = o.binary ?? (o.env ?? process.env).KIT11_AIRI_CLI ?? DEFAULT_AIRI_CLI;
  }

  /** The binary, once checked: its SHA-256 against the pin, then `version` = 0.1.0-beta.4. Cached. */
  binary(): Promise<string> {
    this.checked ??= (async () => {
      const bin = (this.o.resolve ?? resolveAiriBinary)(this.path);
      const env = this.o.env ?? process.env;
      const expected = this.o.expectedSha256 !== undefined ? this.o.expectedSha256 : env.KIT11_AIRI_CLI_SHA256 ?? PINNED_BINARY_SHA256[`${process.platform}-${process.arch}`] ?? null;
      if (!expected) throw new Error(`no pinned SHA-256 for airi-cli on ${process.platform}-${process.arch}; a person who checked the binary sets KIT11_AIRI_CLI_SHA256`);
      const actual = (this.o.sha256Of ?? sha256File)(bin);
      if (actual !== expected) throw new Error(`airi-cli at ${bin} is not the pinned binary (sha256 ${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…); nothing was run`);
      const r = await this.exec(bin, ["version", "-o", "json", "--no-telemetry"], { timeoutMs: TIMEOUT_MS.version, env: this.env });
      const v = Version.safeParse(parseJson(r.stdout));
      if (r.code !== 0 || !v.success) throw new Error(`airi-cli version did not answer as expected (exit ${r.code})`);
      if (v.data.version !== AIRI_CLI_DOCUMENTED_VERSION) throw new Error(`airi-cli is ${scrubText(v.data.version)}, not ${AIRI_CLI_DOCUMENTED_VERSION}: its flags were read for that version only`);
      return bin;
    })();
    // A failed check is not cached: the next call checks again.
    this.checked.catch(() => { this.checked = null; });
    return this.checked;
  }

  /** One command. A non-zero exit becomes AiriRefusal with the CLI's own code (scrubbed); a timeout an Error. */
  private async run(name: string, args: string[], timeoutMs = TIMEOUT_MS.short): Promise<unknown> {
    const bin = await this.binary();
    const r = await this.exec(bin, [...args, "-o", "json", "--no-telemetry"], { timeoutMs, env: this.env });
    if (r.timedOut) throw new Error(`airi-cli ${name} did not answer within ${Math.round(timeoutMs / 1000)} s`);
    const out = parseJson(r.stdout.trim());
    if (r.code === 0) return out;
    const err = CliError.safeParse(out ?? parseJson(r.stderr.trim()));
    const e = err.success ? err.data : {};
    const code = (typeof e.error === "object" ? e.error.code : undefined) ?? e.code ?? (typeof e.error === "string" && /^[a-z0-9_.-]{1,60}$/i.test(e.error) ? e.error : undefined) ?? `AIRI_CLI_EXIT_${r.code ?? "SIGNAL"}`;
    const message = (typeof e.error === "object" ? e.error.message : undefined) ?? e.message ?? (typeof e.error === "string" ? e.error : undefined) ?? (r.stderr.split("\n").find((l) => l.trim()) ?? "");
    if (/timed out after/i.test(message) && name === "mandate get-credential") throw new AiriWaitTimeout(TAP_WAIT_S);
    throw new AiriRefusal("airi", scrubText(code).slice(0, 80), `airi-cli ${name}: ${scrubText(message)}`);
  }

  private parse<T>(name: string, schema: z.ZodType<T>, value: unknown): T {
    const p = schema.safeParse(value);
    // The answer itself is never repeated (it may hold card or account data): only where it differed.
    if (!p.success) throw new AiriRefusal("airi", "AIRI_OUTPUT_UNRECOGNISED", `airi-cli ${name}: answer not in the expected shape (${p.error.issues.slice(0, 3).map((i) => i.path.join(".") || "(root)").join(", ")})`);
    return p.data;
  }

  async version(): Promise<string> {
    await this.binary();
    return AIRI_CLI_DOCUMENTED_VERSION;
  }

  async whoami(): Promise<AiriSession> {
    const s = this.parse("auth whoami", Session, await this.run("auth whoami", ["auth", "whoami"]));
    return { authenticated: s.authenticated, sessionExpires: s.session_expires ?? null };
  }

  async listPaymentMethods(): Promise<AiriPaymentMethod[]> {
    return this.parse("payment-methods list", PaymentMethods, await this.run("payment-methods list", ["payment-methods", "list"]))
      .map((m) => ({ paymentMethodId: m.paymentMethodId, type: m.type, display: display(m.card) }));
  }

  async createMandate(req: AiriMandateRequest): Promise<AiriMandate> {
    const m = this.parse("mandate create", MandateCreated, await this.run("mandate create", mandateCreateArgs(req)));
    const link = "passkeyUrl" in m ? m.passkeyUrl : m.passkey_url;
    if (new URL(link).protocol !== "https:") throw new AiriRefusal("airi", "AIRI_OUTPUT_UNRECOGNISED", "airi-cli mandate create: the approval link is not https");
    return { mandateId: "mandate_id" in m ? m.mandate_id : m.mandateId, passkeyUrl: link };
  }

  async findMandate(description: string, createdFrom: string): Promise<{ mandateId: string; status: string } | null> {
    const raw = this.parse("mandate list", MandateList, await this.run("mandate list", ["mandate", "list", "--created-from", createdFrom, "--size", "100"]));
    const rows = Array.isArray(raw) ? raw : "mandates" in raw ? raw.mandates : "items" in raw ? raw.items : "data" in raw ? raw.data : raw.content;
    const hit = rows.find((r) => r.description === description);
    return hit ? { mandateId: hit.mandateId, status: hit.status } : null;
  }

  async getCredential(mandateId: string, file: string): Promise<AiriCredentialReceipt> {
    const r = await this.run("mandate get-credential", ["mandate", "get-credential", "--mandate-id", mandateId, "--file", file, "--timeout", String(TAP_WAIT_S), "--interval", "2"], TIMEOUT_MS.credential)
      .catch((e: unknown) => { throw e instanceof Error && /did not answer within/.test(e.message) ? new AiriWaitTimeout(TAP_WAIT_S) : e; });
    return this.parse("mandate get-credential", Receipt, r);
  }

  async reportResult(mandateId: string, result: AiriMandateResult, reason?: string): Promise<void> {
    await this.run("mandate result", ["mandate", "result", "--mandate-id", mandateId, "--result", result, ...(reason ? ["--reason", scrubText(reason).slice(0, 120)] : [])]);
  }

  async cancelMandate(mandateId: string): Promise<void> {
    this.parse("mandate cancel", Cancelled, await this.run("mandate cancel", ["mandate", "cancel", "--mandate-id", mandateId]));
  }
}
