// The two text helpers of npm run verify-all (src/cli/verifyAll.ts), kept apart so the tests can import them without
// running the report.

/** A page's visible words: no scripts or styles, no tags, the few entities the site writes decoded, `&amp;` last. */
export const pageText = (html: string) =>
  html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

/** A Markdown table cell: backslashes first, then pipes; a newline becomes a space. */
export const mdCell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
