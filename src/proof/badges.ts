// Shields.io endpoint badges (https://shields.io/badges/endpoint-badge), each computed from a committed record only:
// no network, no run, no figure typed by hand. `npm run badges` writes them to docs/badges/; test/badges.test.ts fails
// while a file there differs from what its record gives. A badge whose record does not exist is not written (the
// mutation score: no mutation record is committed, so there is no mutation badge).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BADGE_DIR = "docs/badges";

/** The shields.io endpoint schema, version 1. */
export interface EndpointBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: "brightgreen" | "green" | "yellow" | "orange" | "red" | "lightgrey";
  /** The committed record the figures come from (shields ignores unknown keys). */
  record: string;
}

/** Where each badge's figures come from. */
export const BADGE_RECORDS = {
  "tamper-matrix": "docs/evidence/tamper-matrix.json",
  "airwallex-endpoints": "docs/evidence/airwallex-api-coverage.json",
  "chaos": "docs/evidence/chaos-money.json",
  "fuzz": "docs/evidence/fuzzing.json",
  "coverage": "docs/evidence/coverage.json",
  "mutation": "docs/evidence/mutation.json",
} as const;

export type BadgeName = keyof typeof BADGE_RECORDS;

const n = (x: number) => x.toLocaleString("en-US");
const int = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`${what}: not a count in its record`);
  return v;
};

type Json = Record<string, unknown>;
const totals = (r: Json, file: string): Json => {
  const t = r.totals;
  if (!t || typeof t !== "object") throw new Error(`${file}: no totals`);
  return t as Json;
};

/** Each badge from its parsed record. Throws when the record lacks a figure, never guesses one. */
export const BUILD: Record<BadgeName, (r: Json) => Omit<EndpointBadge, "schemaVersion" | "record">> = {
  "tamper-matrix": (r) => {
    const t = totals(r, BADGE_RECORDS["tamper-matrix"]);
    const tried = int(t.tried, "tamper tried"), refused = int(t.refused, "tamper refused"), accepted = int(t.accepted, "tamper accepted");
    return { label: "tamper matrix", message: `${n(refused)}/${n(tried)} refused`, color: refused === tried && accepted === 0 && tried > 0 ? "brightgreen" : "red" };
  },
  "airwallex-endpoints": (r) => {
    const t = totals(r, BADGE_RECORDS["airwallex-endpoints"]);
    const all = int(t.endpoints, "endpoints"), live = int(t.live, "live endpoints");
    return { label: "Airwallex endpoints live (sandbox)", message: `${n(live)}/${n(all)}`, color: live === all ? "brightgreen" : live >= all * 0.9 ? "green" : "yellow" };
  },
  "chaos": (r) => {
    const t = totals(r, BADGE_RECORDS.chaos);
    const inv = r.invariants as Record<string, { broken?: unknown }> | undefined;
    if (!inv || !Object.keys(inv).length) throw new Error("chaos: no invariants");
    const broken = Object.entries(inv).reduce((s, [k, v]) => s + int(v.broken, `chaos ${k} broken`), 0);
    const scenarios = int(t.scenarios, "chaos scenarios");
    return { label: "chaos invariants broken", message: `${n(broken)} in ${n(scenarios)} scenarios`, color: broken === 0 ? "brightgreen" : "red" };
  },
  "fuzz": (r) => {
    const t = totals(r, BADGE_RECORDS.fuzz);
    const runs = int(t.runs, "fuzz runs"), props = int(t.properties, "fuzz properties"), failed = int(t.failed, "fuzz failed");
    return { label: "fuzz runs", message: `${n(runs)} · ${n(failed)}/${n(props)} properties failed`, color: failed === 0 ? "brightgreen" : "orange" };
  },
  // The product's measured scope (docs/evidence/coverage.md), from the counts, not the record's rounded pct. Bright green
  // only at OpenSSF gold's bar (90% of statements and 80% of branches), which the product does not reach today.
  "coverage": (r) => {
    const scopes = r.scopes as Record<string, { after?: Record<string, { covered?: unknown; total?: unknown }> }> | undefined;
    const after = scopes?.product?.after;
    if (!after) throw new Error("coverage: no product scope");
    const ratio = (k: string) => {
      const covered = int(after[k]?.covered, `coverage ${k} covered`), total = int(after[k]?.total, `coverage ${k} total`);
      if (!total || covered > total) throw new Error(`coverage ${k}: not a share`);
      return (covered / total) * 100;
    };
    const s = ratio("statements"), b = ratio("branches");
    return { label: "coverage", message: `${s.toFixed(1)}% statements · ${b.toFixed(1)}% branches`, color: s >= 90 && b >= 80 ? "brightgreen" : s >= 80 ? "green" : s >= 60 ? "yellow" : "red" };
  },
  "mutation": (r) => {
    const score = r.score;
    if (typeof score !== "number" || score < 0 || score > 100) throw new Error("mutation: no score between 0 and 100");
    return { label: "mutation score", message: `${score.toFixed(1)}%`, color: score >= 80 ? "brightgreen" : score >= 60 ? "yellow" : "red" };
  },
};

/** Every badge whose record exists in `root`, in a fixed order. */
export function badges(root = "."): { name: BadgeName; badge: EndpointBadge }[] {
  const out: { name: BadgeName; badge: EndpointBadge }[] = [];
  for (const name of Object.keys(BADGE_RECORDS) as BadgeName[]) {
    const record = BADGE_RECORDS[name];
    if (!existsSync(join(root, record))) continue;
    const r = JSON.parse(readFileSync(join(root, record), "utf8")) as Json;
    out.push({ name, badge: { schemaVersion: 1, ...BUILD[name](r), record } });
  }
  return out;
}

export const badgeFile = (name: BadgeName) => `${BADGE_DIR}/${name}.json`;
export const badgeJson = (b: EndpointBadge) => `${JSON.stringify(b, null, 2)}\n`;
