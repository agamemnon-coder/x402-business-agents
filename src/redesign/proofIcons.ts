// Icons for /proof (src/redesign/proof.ts and the modules beside it): the site's set (src/redesign/ui.ts icon), and a
// few Lucide icons it does not have (ISC licence: src/ui/lucide-LICENSE.txt), drawn the same way.

import { esc, icon } from "./ui.js";

type Shape = [string, Record<string, string>][];
/** A few icons the site's set does not have (Lucide, ISC: src/ui/lucide-LICENSE.txt), for /proof only. */
const MORE: Record<string, Shape> = {
  layers: [["path", { d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" }], ["path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" }], ["path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" }]],
  "book-open": [["path", { d: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" }], ["path", { d: "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" }]],
  code: [["polyline", { points: "16 18 22 12 16 6" }], ["polyline", { points: "8 6 2 12 8 18" }]],
  shield: [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }]],
  "git-branch": [["line", { x1: "6", x2: "6", y1: "3", y2: "15" }], ["circle", { cx: "18", cy: "6", r: "3" }], ["circle", { cx: "6", cy: "18", r: "3" }], ["path", { d: "M18 9a9 9 0 0 1-9 9" }]],
  "flask-conical": [["path", { d: "M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" }], ["path", { d: "M8.5 2h7" }], ["path", { d: "M7 16h10" }]],
  hash: [["line", { x1: "4", x2: "20", y1: "9", y2: "9" }], ["line", { x1: "4", x2: "20", y1: "15", y2: "15" }], ["line", { x1: "10", x2: "8", y1: "3", y2: "21" }], ["line", { x1: "16", x2: "14", y1: "3", y2: "21" }]],
  "arrow-up-right": [["path", { d: "M7 7h10v10" }], ["path", { d: "M7 17 17 7" }]],
  "file-search": [["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }], ["path", { d: "M4.27 21.7A2 2 0 0 1 4 20.73V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2H7.33" }], ["circle", { cx: "5", cy: "14", r: "3" }], ["path", { d: "m9 18-1.5-1.5" }]],
  "badge-check": [["path", { d: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" }], ["path", { d: "m9 12 2 2 4-4" }]],
  "cent": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M15 9.35a4 4 0 1 0 0 5.3" }], ["path", { d: "M12 6v12" }]],
};
/** An icon of the site's set (src/redesign/ui.ts), or one of the few above. */
export function picon(name: string, size = 20): string {
  const s = MORE[name];
  if (!s) return icon(name, size);
  return `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.map(([t, a]) => `<${t} ${Object.entries(a).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`).join("")}</svg>`;
}

