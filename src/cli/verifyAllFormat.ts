// The text helpers of npm run verify-all (src/cli/verifyAll.ts), kept apart so the tests can import them without
// running the report.

/** A page's visible words: no scripts or styles, no tags, the few entities the site writes decoded, `&amp;` last. */
export const pageText = (html: string) =>
  html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** A Markdown table cell: backslashes first, then pipes; a newline becomes a space. */
export const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * The evidence-wall tiles a page shows, by key: each tile's figure (its `<b class="ew-f">`), read inside the tile's own
 * `<li … data-wall="key">…</li>`, whatever comes between its link and its figure (outside audit, 22 November: /proof's
 * tiles put a visual, `<span class="ew-v …">`, before the figure since 19bddc1d8, and a regex that wanted the figure
 * right after the link read none of them: 58 false FAILs). An element with data-wall but no figure is no tile; the
 * first tile of a key counts. `&amp;` is decoded.
 */
export function wallFigures(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<li\b[^>]*\bdata-wall="([^"]+)"[^>]*>/g)) {
    const from = m.index! + m[0].length;
    const end = html.indexOf("</li>", from);
    // 22 Nov: a figure may carry spans ("14 → 0", the blind run in amber, the rerun in green); its text is the figure.
    const fig = /<b class="ew-f">([\s\S]*?)<\/b>/.exec(html.slice(from, end < 0 ? undefined : end));
    const text = fig?.[1]!.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    if (text && !out.has(m[1]!)) out.set(m[1]!, text);
  }
  return out;
}
