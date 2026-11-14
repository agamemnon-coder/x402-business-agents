// The live reconciliation badge (14 Nov): "Purser's books = Airwallex's transactions · checked <time>". It is computed
// from the reconciliation of Purser's ledger (the recorded awx-1 run) against Airwallex's financial transactions for
// that window, read live from the Airwallex sandbox (cloud/src/awxLive.ts reconcileView, worker/src/awxRead.ts). Three
// states, never an invented number:
//   matched      every movement matched, and nothing at Airwallex is missing from the ledger: "all 12 matched"
//   unmatched    k movements differ, or k rows at Airwallex are not in the ledger: "2 unmatched", with a link to the list
//   unavailable  the sandbox did not answer, or the comparison did not run: "Airwallex unavailable · last checked <time>"
// The answer is kept 5 minutes (AwxBadgeCache), so a busy page reads Airwallex at most once every 5 minutes.

/** How long one badge is kept before Airwallex is read again. */
export const AWX_BADGE_TTL_MS = 5 * 60_000;
/** The full list behind an amber badge: Purser Cloud's Airwallex tab (try it as a guest, read only). */
export const AWX_BADGE_LIST_URL = "https://purser-try.max-31b.workers.dev/#/airwallex";
export const AWX_BADGE_TITLE = "Purser's books = Airwallex's transactions";

export type AwxBadgeState = "matched" | "unmatched" | "unavailable";

export interface AwxBadge {
  state: AwxBadgeState;
  /** Movements that matched, of `checked`; null when the comparison did not run. */
  matched: number | null;
  checked: number | null;
  /** Movements that differ plus rows at Airwallex the ledger does not hold; null when the comparison did not run. */
  unmatched: number | null;
  /** When Purser last asked Airwallex (ISO, UTC). */
  checked_at: string;
  /** When Airwallex's rows were read (ISO), or null when it gave none. */
  read_at: string | null;
  /** The badge in words: "all 12 matched", "2 unmatched", "Airwallex unavailable". */
  text: string;
  title: string;
  /** Where the list of unmatched rows is; only on an amber badge. */
  list_url: string | null;
  sandbox: true;
}

/** The part of a reconcile answer the badge reads (cloud/src/awxLive.ts, view "reconcile"). */
export interface ReconcileLike {
  source: string;
  read_at?: string;
  data?: Record<string, unknown>;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null);

/** "18:20 UTC": the time on the badge, the same on every device. */
export function badgeTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toISOString().slice(11, 16)} UTC`;
}

/** The badge for one reconcile answer, asked at `now`. Grey unless the comparison actually ran. */
export function badgeOf(rec: ReconcileLike | null | undefined, now: Date): AwxBadge {
  const at = now.toISOString();
  const grey: AwxBadge = { state: "unavailable", matched: null, checked: null, unmatched: null, checked_at: at, read_at: null, text: "Airwallex unavailable", title: AWX_BADGE_TITLE, list_url: null, sandbox: true };
  if (!rec || rec.source !== "airwallex-sandbox" || !rec.data || rec.data.computed !== true) return grey;
  const checked = count(rec.data.checked), matched = count(rec.data.matched), differences = count(rec.data.differences);
  const unknown = Array.isArray(rec.data.unknown_at_airwallex) ? rec.data.unknown_at_airwallex.length : null;
  // Every figure must be there and add up; anything else is no badge at all.
  if (checked === null || matched === null || differences === null || unknown === null || checked === 0 || matched + differences !== checked) return grey;
  const readAt = typeof rec.read_at === "string" && !Number.isNaN(Date.parse(rec.read_at)) ? rec.read_at : null;
  const unmatched = differences + unknown;
  if (unmatched === 0) return { ...grey, state: "matched", matched, checked, unmatched, read_at: readAt, text: `all ${checked} matched` };
  return { ...grey, state: "unmatched", matched, checked, unmatched, read_at: readAt, text: `${unmatched} unmatched`, list_url: AWX_BADGE_LIST_URL };
}

/** The badge's line in words, as a page shows it: "… · all 12 matched · checked 18:20 UTC". */
export function badgeLine(b: AwxBadge): string {
  return b.state === "unavailable" ? `${b.title} · Airwallex unavailable · last checked ${badgeTime(b.checked_at)}` : `${b.title} · ${b.text} · checked ${badgeTime(b.checked_at)}`;
}

/**
 * One badge, kept AWX_BADGE_TTL_MS. Readers at the same moment share one read of Airwallex. A failed read is a grey
 * badge, kept the same 5 minutes, so a sandbox that is down is not asked again and again.
 */
export class AwxBadgeCache {
  private kept: { badge: AwxBadge; at: number } | null = null;
  private inFlight: Promise<AwxBadge> | null = null;

  constructor(private readonly load: (now: Date) => Promise<AwxBadge>, private readonly now: () => number = () => Date.now(), private readonly ttlMs = AWX_BADGE_TTL_MS) {}

  async get(): Promise<AwxBadge & { cached: boolean }> {
    const t = this.now();
    if (this.kept && t - this.kept.at < this.ttlMs) return { ...this.kept.badge, cached: true };
    this.inFlight ??= (async () => {
      const at = new Date(this.now());
      let badge: AwxBadge;
      try { badge = await this.load(at); } catch { badge = badgeOf(null, at); }
      this.kept = { badge, at: at.getTime() };
      return badge;
    })().finally(() => { this.inFlight = null; });
    return { ...(await this.inFlight), cached: false };
  }
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The badge as an image, for Home (whose script reaches no network): its own colours, its words, nothing else. */
export function badgeSvg(b: AwxBadge): string {
  const colours = { matched: ["#e7f6ee", "#14804a"], unmatched: ["#fdf3e1", "#a35f00"], unavailable: ["#eef0f3", "#5b6472"] }[b.state];
  const status = b.state === "unavailable" ? `Airwallex unavailable · last checked ${badgeTime(b.checked_at)}` : `${b.text} · checked ${badgeTime(b.checked_at)}`;
  const label = `${b.title} · ${status} · Airwallex sandbox, test money`;
  const w = 360, h = 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${xml(label)}"><title>${xml(label)}</title>`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${colours[0]}" stroke="${colours[1]}" stroke-opacity="0.35"/>`
    + `<circle cx="20" cy="28" r="6" fill="${colours[1]}"/>`
    + `<g font-family="Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" fill="${colours[1]}">`
    + `<text x="36" y="23" font-size="13" font-weight="700">${xml(b.title)}</text>`
    + `<text x="36" y="42" font-size="12.5">${xml(status)} · sandbox</text></g></svg>`;
}
