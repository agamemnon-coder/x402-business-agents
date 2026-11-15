// Beneficiaries named after a person (15 Nov, privacy): every public view shows a person's name as initials only. A
// payee is a person when Airwallex says so (entity_type PERSONAL or INDIVIDUAL), or when its name reads like one: two to
// four capitalised words with no business word in them. A company keeps its name ("Stockline Data GmbH").
// Pure: the read gateway (worker/src/awxRead.ts) masks before anything leaves kit11.

const BUSINESS = /\b(gmbh|ag|bv|b\.v\.|nv|ltd|limited|llc|inc|corp|corporation|co|company|sa|sas|sarl|srl|spa|plc|oy|ab|aps|kg|ug|ev|stiftung|data|software|services|solutions|holding|holdings|group|trading|supplies|supply|bank|foods|outdoor|logistics|labs|systems|tech|technologies|studio|partners|consulting|agency|store|shop|market|media|energy|international|global|europe|eur|usd|gbp|swift|sepa|local|account)\b/i;
const PARTICLE = /^(van|von|de|der|den|del|della|di|da|du|la|le|el|al|bin|ibn|ten|ter|op|zu|y)$/i;
const WORD = /^[A-ZÀ-ÖØ-Þ][a-zß-öø-ÿ'’.-]*$/;

/** Whether a payee name reads like a person's. */
export function looksLikePerson(name: string | null | undefined, entityType?: string | null): boolean {
  if (entityType && /^(PERSONAL|INDIVIDUAL|PERSON)$/i.test(entityType)) return true;
  const n = (name ?? "").trim();
  if (!n || BUSINESS.test(n) || /\d/.test(n)) return false;
  const words = n.split(/\s+/);
  const named = words.filter((w) => !PARTICLE.test(w));
  return words.length >= 2 && words.length <= 5 && named.length >= 2 && named.length <= 4 && named.every((w) => WORD.test(w));
}

/** A person's name as initials only: "Jan de Vries" → "J. d. V.". Nothing else of it is kept. */
export function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => `${w.charAt(0)}.`).join(" ");
}

/** The name a public view may show: a person's as initials, a company's as it is. */
export function publicPayeeName(name: string | null, entityType?: string | null): string | null {
  if (!name) return null;
  return looksLikePerson(name, entityType) ? initialsOf(name) : name;
}

/**
 * A nickname a public view may show. For a person: none (nicknames often carry the name). Otherwise a nickname whose
 * leading words read like a person's name ("Jan de Vries EUR SWIFT") has those words as initials.
 */
export function publicNickname(nickname: string | null, person: boolean): string | null {
  if (!nickname) return null;
  if (person) return null;
  const words = nickname.trim().split(/\s+/);
  for (let k = Math.min(5, words.length); k >= 2; k--) {
    const head = words.slice(0, k).join(" ");
    if (looksLikePerson(head)) return [initialsOf(head), ...words.slice(k)].join(" ");
  }
  return nickname;
}
