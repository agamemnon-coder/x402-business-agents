// Metal renamed itself Alta on 14 November 2026 (its team, in the hackathon's Slack: "We are no longer called Metal, we
// are now Alta (alta.finance)"). Every page says Alta; the first time a page names it, it says "Alta (formerly Metal)",
// so a juror who knows the kit as Metal connects the two. Done once here, on the page as served, rather than in each
// page's copy: the first mention moves whenever a page changes. Run records keep the name they were written with.

/** The words of the first mention. */
export const ALTA_FIRST = "Alta (formerly Metal)";

// Text the first mention never goes into: code, styles, drawings, and a logo tile (a fixed-size mark).
const SKIP = /^(script|style|svg|title|code|pre|option|textarea|button|kbd|nav|select)$/i;
const SKIP_CLASS = /\b(logo|mark|wm|lg|tile|chip|navl|vh-n)\b/;

/** The page with its first visible "Alta" inside <main> written as "Alta (formerly Metal)"; unchanged when it has none, or already says so. */
export function formerlyMetal(html: string): string {
  const open = html.search(/<main\b/i);
  const close = html.search(/<\/main>/i);
  if (open < 0 || close < 0 || close < open) return html;
  if (html.slice(open, close).includes(ALTA_FIRST)) return html;
  const stack: { tag: string; cls: string }[] = [];
  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  re.lastIndex = open;
  for (let m = re.exec(html); m && m.index < close; m = re.exec(html)) {
    if (m[3] !== undefined) {
      const hidden = stack.some((s) => SKIP.test(s.tag) || SKIP_CLASS.test(s.cls) || /aria-hidden="true"/.test(s.cls));
      const at = hidden ? -1 : m[3].search(/\bAlta\b(?! \(formerly)/);
      if (at >= 0) {
        const i = m.index + at;
        return `${html.slice(0, i)}${ALTA_FIRST}${html.slice(i + 4)}`;
      }
      continue;
    }
    const tag = m[1]!.toLowerCase();
    if (m[0].startsWith("</")) { const k = stack.map((s) => s.tag).lastIndexOf(tag); if (k >= 0) stack.length = k; continue; }
    if (/\/>$/.test(m[0]) || /^(br|img|input|meta|link|hr|source|wbr|col|area|base|embed|param|track)$/.test(tag)) continue;
    stack.push({ tag, cls: m[2] ?? "" });
    if (/^(script|style|svg|textarea)$/.test(tag)) {
      // Jump past the element's body: its text is not markup.
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      if (end > 0) re.lastIndex = end;
    }
  }
  return html;
}
