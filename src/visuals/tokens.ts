// The visuals' colours: read from the site's design tokens (src/redesign/ui.ts, TOKENS), light and dark, never typed
// here. A token renamed or removed there fails the visuals' test, so the diagrams keep the site's look.

import { TOKENS } from "../redesign/ui.js";

/** The tokens the visuals use. */
export const VISUAL_TOKENS = [
  "bg", "surface", "sunken", "border", "text", "muted", "faint", "accent", "accent-soft", "ok", "ok-soft",
  "bad", "bad-soft", "metal", "metal-soft", "awx", "awx-soft", "claude", "claude-soft",
] as const;
export type Theme = "light" | "dark";
export type Palette = Record<(typeof VISUAL_TOKENS)[number], string>;

function block(css: string): Record<string, string> {
  return Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** The palette of one theme, as TOKENS defines it (light: the first :root block; dark: :root[data-theme="dark"]). */
export function palette(theme: Theme): Palette {
  const light = /:root \{([\s\S]*?)\n\}/.exec(TOKENS)?.[1];
  const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(TOKENS)?.[1];
  if (!light || !dark) throw new Error("design tokens not found in src/redesign/ui.ts");
  const all = { ...block(light), ...(theme === "dark" ? block(dark) : {}) };
  return Object.fromEntries(VISUAL_TOKENS.map((k) => {
    const v = all[k];
    if (!v) throw new Error(`design token --${k} missing in src/redesign/ui.ts`);
    return [k, v];
  })) as Palette;
}

/** CSS custom properties for a standalone file: the light palette, or the dark one. */
export const paletteCss = (theme: Theme) => Object.entries(palette(theme)).map(([k, v]) => `--${k}:${v}`).join(";");
