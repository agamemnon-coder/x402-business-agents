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

/** The page without its <tag …>…</tag> blocks (each of `tags`), found by position, case-insensitive: no regular expression. */
export function withoutBlocks(html: string, tags: readonly string[], sep = ""): string {
  let out = html;
  for (const tag of tags) {
    const low = () => out.toLowerCase();
    for (let a = low().indexOf(`<${tag}`); a >= 0; a = low().indexOf(`<${tag}`, a)) {
      const b = low().indexOf(`</${tag}`, a);
      const end = b < 0 ? out.length : low().indexOf(">", b) + 1 || out.length;
      out = out.slice(0, a) + sep + out.slice(end);
    }
  }
  return out;
}

/** The text between tags: everything outside < … >, each tag replaced by a space (a character walk, no regular expression). */
export function textOutsideTags(html: string): string {
  let out = "", inTag = false;
  for (const ch of html) {
    if (ch === "<") { inTag = true; out += " "; continue; }
    if (ch === ">" && inTag) { inTag = false; continue; }
    if (!inTag) out += ch;
  }
  return out;
}

/** A script block's body: after its opening tag's ">", before its closing "</". */
export function scriptBody(block: string): string {
  const open = block.indexOf(">");
  const close = block.toLowerCase().lastIndexOf("</script");
  return block.slice(open + 1, close < 0 ? block.length : close);
}
