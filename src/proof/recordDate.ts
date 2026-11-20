// The day a record speaks for (the owner, 21 Nov: "every figure shows its date"): read from the record itself, never
// typed. A run record or log under docs/ carries its day in its name (docs/runs/2026-11-19-alta-series.json); any other
// record says it in a field of its own (ran_at, recorded_at, started_at, measured_at, checked, as_of, date, …); a
// Markdown record without either says it as "Measured on 19 November 2026" or an ISO day near its top. A tile that names
// several records is as new as the newest of them: the others are the earlier runs its note names.
// Used by src/redesign/evidenceWallData.ts (each tile's asOf, written into docs/evidence/evidence-wall.json) and by
// /proof's charts and question sections (src/redesign/proofQuestions.ts). Build time only.

import { readFileSync, statSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
/** The fields a record's own day is read from, in order. */
export const DATE_FIELDS = ["ran_at", "recorded_at", "started_at", "measured_at", "measured_on", "measured", "anchored_at", "checked", "as_of", "read_at", "date", "generated_at", "finished_at"] as const;
const ISO_DAY = /(?<!\d)(20\d\d-[01]\d-[0-3]\d)(?!\d)/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LONG_DAY = new RegExp(`\\b([0-3]?\\d) (${MONTHS.join("|")}) (20\\d\\d)\\b`);

const cache = new Map<string, string | null>();

/** "2026-11-19": the day one record speaks for, or null when it says none. */
export function recordDate(path: string): string | null {
  const p = path.split("#")[0]!;
  if (cache.has(p)) return cache.get(p)!;
  const day = read(p);
  cache.set(p, day);
  return day;
}

function read(p: string): string | null {
  const named = ISO_DAY.exec(p.split("/").pop() ?? "")?.[1] ?? ISO_DAY.exec(p)?.[1];
  if (named) return named;
  let text: string;
  try {
    const u = new URL(p, ROOT);
    if (statSync(u).isDirectory()) return null;
    text = readFileSync(u, "utf8");
  } catch { return null; }
  if (p.endsWith(".json")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      for (const k of DATE_FIELDS) {
        const v = j[k];
        const d = typeof v === "string" ? ISO_DAY.exec(v)?.[1] : undefined;
        if (d) return d;
      }
    } catch { /* not JSON: no day */ }
    return null;
  }
  // Markdown (or text): the first day said in its first 30 lines.
  const head = text.split("\n").slice(0, 30).join("\n");
  const iso = ISO_DAY.exec(head)?.[1];
  const long = LONG_DAY.exec(head);
  const fromLong = long ? `${long[3]}-${String(MONTHS.indexOf(long[2]!) + 1).padStart(2, "0")}-${long[1]!.padStart(2, "0")}` : undefined;
  if (iso && fromLong) return head.indexOf(iso) < head.indexOf(long![0]) ? iso : fromLong;
  return iso ?? fromLong ?? null;
}

/** The newest day among a tile's records (its data-rec, space-separated), or null when none says one. */
export function newestDate(recs: string | readonly string[]): string | null {
  const list = typeof recs === "string" ? recs.split(/\s+/).filter(Boolean) : recs;
  const days = list.map(recordDate).filter((d): d is string => !!d).sort();
  return days.at(-1) ?? null;
}

/** "20 Nov": a day as the site writes one. */
export const shortDay = (iso: string): string => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
