// "What you just saw ran for real": the strip under the film on /watch. Each entry links the run's own record in the
// public repository, and is shown only when that record is in this repository; an entry whose run is recorded later
// (Face ID on chain, the invoice token) appears by itself once its record is merged, its words its record's own
// heading. The rest rests on the claims list (src/film/claims.ts); test/watch-film.test.ts checks each one holds.
// Beside it, the honest labels: what is test money and what is simulated.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./cuts.js";

export const REPO_BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";

export interface RunSeen {
  rail: string;
  /** Its words; null: the record's own first heading (a run recorded after this page was written). */
  text: string | null;
  /** The record: a path, or a pattern for a file in docs/runs/ (the newest match). */
  record: string | RegExp;
  claims: string[];
}

export const RUNS_SEEN: readonly RunSeen[] = [
  { rail: "Airwallex", text: "A card charge declined over its limit; a payout signed with Face ID, paid by SWIFT (settlement simulated).", record: "docs/runs/2026-11-07-awx-1.md", claims: ["C09", "C10", "C12"] },
  { rail: "Metal", text: "86 payments inside the limits; #24 refused on chain, our own check off on purpose.", record: "docs/runs/2026-11-03-main-run.md", claims: ["C13", "C14"] },
  { rail: "Metal", text: null, record: /^\d{4}-\d{2}-\d{2}-(faceid|face-id)[-a-z0-9]*\.md$/, claims: [] },
  { rail: "Metal", text: null, record: /^\d{4}-\d{2}-\d{2}-tokeni[sz]e[-a-z0-9]*\.md$/, claims: [] },
  { rail: "Visa via Airi", text: "Over the limit, the purchase waited for Face ID. A test card.", record: "docs/runs/2026-11-07-vic-1.md", claims: ["C15"] },
  { rail: "Claude", text: "24 decisions in the main run, by three models.", record: "docs/runs/2026-11-03-main-run.md", claims: ["C22"] },
  { rail: "Moneybird", text: "A test company's purchase invoices read back: 0 differences.", record: "docs/runs/2026-11-12-moneybird-sandbox.md", claims: ["C17"] },
];

/** The honest labels, short: what the money is and what the sandboxes simulate. */
export const LABELS: readonly { text: string; claims: string[] }[] = [
  { text: "Test money only", claims: ["C09", "C13", "C15"] },
  { text: "Settlement simulated by the sandbox", claims: ["C10"] },
  { text: "Card merchants simulated", claims: ["C12"] },
  { text: "Test passkeys named as such", claims: ["C26", "C32"] },
];

const DAY = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export interface RunShown { rail: string; day: string; text: string; href: string; file: string }

/** The entries whose record is here, each with its record's day and link. `files`: docs/runs/'s names (a test's own). */
export function runsSeen(files: string[] = readdirSync(resolve(ROOT, "docs/runs")), read: (p: string) => string = (p) => readFileSync(resolve(ROOT, p), "utf8"), list: readonly RunSeen[] = RUNS_SEEN): RunShown[] {
  return list.flatMap((r) => {
    const file = typeof r.record === "string"
      ? (files.includes(r.record.replace(/^docs\/runs\//, "")) ? r.record : null)
      : ((n?: string) => (n ? `docs/runs/${n}` : null))(files.filter((f) => (r.record as RegExp).test(f)).sort().at(-1));
    if (!file) return [];
    const day = /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1];
    const text = r.text ?? /^#\s+(.+)$/m.exec(read(file))?.[1]?.trim().replace(/[*`_]/g, "");
    if (!day || !text) return [];
    return [{ rail: r.rail, day: DAY(day), text, href: REPO_BLOB + file, file }];
  });
}

/** Does a record file exist in this repository (for the tests). */
export const recordHere = (p: string) => existsSync(resolve(ROOT, p));
