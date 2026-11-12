// Tap targets on a phone (jury review, 12 Nov: menu links 37 px, /judge's checkboxes 26 px): every visible link, button,
// input, checkbox label and fold header inside the given parts of the page is at least 44 px high. Used by
// pages.check.ts for the shared header and footer of /home, /try, /proof and /watch and for the whole of /judge, at
// 360 and 390 px; Home's own content has its check in homeStory.ts.
import type { Page } from "playwright";

export const TAP_MIN = 44;
/** The shared header and footer of a page. */
export const CHROME = ["header", "footer"];

export interface SmallTap { what: string; height: number }

/** The controls under `scopes` that are lower than 44 px, each with its tag, its words and its height. */
export async function smallTaps(page: Page, scopes: string[]): Promise<SmallTap[]> {
  // As a string: tsx would wrap named functions in a helper the page does not have.
  return await page.evaluate(`((scopes, min) => {
    const seen = new Set(), out = [];
    for (const scope of scopes) for (const root of document.querySelectorAll(scope)) for (const e of root.querySelectorAll("a, button, input, summary, label[for]")) {
      if (seen.has(e)) continue;
      seen.add(e);
      if (e.tagName === "INPUT" && e.type === "hidden") continue;
      if (e.tagName === "LABEL") { const c = document.getElementById(e.htmlFor); if (!c || c.type !== "checkbox") continue; }
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (!r.width || !r.height || s.visibility === "hidden" || !(e.offsetParent || s.position === "fixed")) continue;
      if (r.height < min - 0.01) out.push({ what: e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + " “" + (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40) + "”", height: Math.round(r.height * 10) / 10 });
    }
    return out;
  })(${JSON.stringify(scopes)}, ${TAP_MIN})`) as SmallTap[];
}

/** Fails once for each control under `scopes` that is lower than 44 px; returns how many it measured as too low. */
export async function checkTaps(page: Page, o: { name: string; scopes: string[]; fail: (what: string) => void }): Promise<number> {
  const small = await smallTaps(page, o.scopes);
  for (const s of small) o.fail(`${o.name}: ${s.what} is ${s.height} px high, under ${TAP_MIN}`);
  return small.length;
}
