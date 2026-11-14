// The GitHub social preview (1280×640): docs/media/social-preview.html is the source, docs/media/social-preview.png the
// rendered image (`npm run social-preview`). Every figure on it is filled in here from the main run's record; the
// template types none. test/social-preview.test.ts checks the count and the template.

import { readFileSync } from "node:fs";

export const SOCIAL_HTML = "docs/media/social-preview.html";
export const SOCIAL_PNG = "docs/media/social-preview.png";
export const SOCIAL_SIZE = { width: 1280, height: 640 } as const;
/** Purser's own mark (the feather), the only image on the preview. */
export const SOCIAL_MARK = "src/ui/brand/favicon.svg";
const MAIN_RUN = "docs/demo/main-run.json";

interface Flow { rail?: string; refused?: boolean; count?: number; proof?: { href?: string } }
interface Record { snapshot: { flows: Flow[] } }

/**
 * The main run's payments on Alta, each its own transaction on Alta testnet: the record's flows on the Alta rail that
 * went through and carry a testnet tx link, counted (`count` per row). The same count as the film's 06-metal card.
 */
export function metalPaymentCount(r: Record): number {
  return r.snapshot.flows
    .filter((f) => f.rail === "metal" && !f.refused && /^https:\/\/testnet\.metal/.test(f.proof?.href ?? ""))
    .reduce((k, f) => k + (f.count ?? 1), 0);
}

/** The template with its {{placeholders}} filled from the record; throws when a figure is missing. */
export function socialPreviewHtml(template: string, record: Record, fontUrl: string, markUrl: string): string {
  const facts: { [k: string]: string } = { "metal.payments": String(metalPaymentCount(record) || ""), font: fontUrl, mark: markUrl };
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
    const v = facts[key];
    if (!v) throw new Error(`social preview: no value for {{${key}}}`);
    return v;
  });
}

export const loadRecord = (root: URL): Record => JSON.parse(readFileSync(new URL(MAIN_RUN, root), "utf8")) as Record;
