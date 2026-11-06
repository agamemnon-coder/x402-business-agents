// Every <script …>…</script> block of a page, whole, found by position (case-insensitive, as differentiation.test.ts's
// dropBlocks does), not by an HTML-filtering regular expression: "<SCRIPT>" or "</script >" are found too.
export function scriptBlocks(html: string): string[] {
  const low = html.toLowerCase(), out: string[] = [];
  for (let i = 0; ;) {
    const a = low.indexOf("<script", i);
    if (a < 0) return out;
    const b = low.indexOf("</script", a);
    const end = b < 0 ? html.length : low.indexOf(">", b) + 1 || html.length;
    out.push(html.slice(a, end));
    i = end;
  }
}
