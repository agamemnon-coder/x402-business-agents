// The files of the visual system under docs/assets/, by path: what `npm run visuals` writes and the test compares.

import { architectureSvg, lifecycleSvg, refusalsSvg, socialSvg, type Layout } from "./svg.js";
import { railRefusals } from "./facts.js";
import type { Theme } from "./tokens.js";
import { REPO_BLOB } from "../redesign/metalStory.js";

export const ASSETS = "docs/assets";
export const SOCIAL_PNG = `${ASSETS}/social-preview.png`;
export const LIVE_SITE = "kit11.max-31b.workers.dev";

export function visualFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const rails = railRefusals();
  for (const layout of ["wide", "tall"] as Layout[]) {
    for (const theme of ["light", "dark"] as Theme[]) {
      out[`${ASSETS}/architecture-${layout}-${theme}.svg`] = architectureSvg(layout, theme);
      out[`${ASSETS}/payment-life-${layout}-${theme}.svg`] = lifecycleSvg(layout, theme);
      out[`${ASSETS}/rail-refusals-${layout}-${theme}.svg`] = refusalsSvg(rails, (p) => `${REPO_BLOB}${p}`, layout, theme);
    }
  }
  out[`${ASSETS}/social-preview.svg`] = socialSvg(LIVE_SITE);
  return out;
}
