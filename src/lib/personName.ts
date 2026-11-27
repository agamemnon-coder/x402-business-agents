// A person's name as segregation of duties and four eyes compare it (red team round 2 on v1.5.3, finding B: the proposer's
// name was trimmed and the approver's was not, so "Carla CFO " proposed as "Carla CFO" and co-signed as "Carla CFO ").
// One normaliser for both sides. No imports: the Cloud's Worker bundles it.

/**
 * A name as people read it: Unicode-normalised (NFKC: a no-break space is a space, full-width letters are letters),
 * every run of spaces one space, the part before " (" (a passkey's "(passkey …)", a display name's "(Finance)"), trimmed.
 */
export function personName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/gu, " ").split(" (")[0]!.trim();
}

/** The same person's name, compared case-folded ("Carla CFO", " carla  cfo", "CARLA CFO (Finance)" are one name). */
export function samePerson(a: string, b: string): boolean {
  const fold = (x: string) => personName(x).toUpperCase().toLowerCase();
  return fold(a) === fold(b);
}
