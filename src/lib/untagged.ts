// Text from outside (an invoice, a customer's e-mail) goes into a model's prompt inside <document> tags. A tag inside the
// text itself would end that block early, and what follows would read as Purser's own words. So the tags are taken out
// of the text first, until none is left: a tag split by another ("</docu</document>ment>") becomes whole once the
// inner one goes, and is taken out on the next pass. src/ap/checkerCore.ts and coderCore.ts do the same for their tags.

export function untagged(s: string, tags: readonly string[] = ["document"]): string {
  const re = new RegExp(`<\\s*\\/?\\s*(?:${tags.join("|")})\\s*>`, "gi");
  let out = s;
  for (let i = 0; i < 100; i++) {
    const next = out.replace(re, "");
    if (next === out) return out;
    out = next;
  }
  return out.replace(/[<>]/g, "");
}
