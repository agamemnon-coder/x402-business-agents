// The partners' logos Purser may show (owner's decision, 12 Nov, relayed by the orchestrator: partner logos allowed),
// each an official file kept unmodified, with where and when it was downloaded (docs/assets/logos/SOURCES.md). Shown
// only as a neutral "Built with" row, never inside Purser's own diagrams and never with a word that suggests a partner
// made, certified or endorses Purser. A partner whose official file or published usage rules could not be found, or
// whose rules need a written permission not on record here, is left out (LEFT_OUT) and named in the PR.

export interface Logo { name: string; file: string; alt: string; height: number }
/** On white tiles in both themes: the Airwallex, Visa and Cloudflare files are dark marks with no light version on record. */
export const BUILT_WITH: Logo[] = [
  { name: "Airwallex", file: "src/ui/logos/airwallex.png", alt: "Airwallex", height: 30 },
  // Alta (formerly Metal), 14 Nov: shown with the Alta team's OK in the hackathon Slack (docs/evidence/logo-permissions.md).
  { name: "Alta", file: "src/ui/logos/alta.svg", alt: "Alta", height: 30 },
  { name: "Claude", file: "docs/assets/logos/claude-logo-slate.svg", alt: "Claude", height: 30 },
];
export const BUILT_WITH_PNG = "docs/assets/logos/built-with.png";
/** Named in text only, and why. */
export const LEFT_OUT: { name: string; why: string }[] = [
  { name: "Moneybird", why: "no brand or press page with logo files or usage rules was found on its site" },
  { name: "T:0", why: "no brand or press page with logo files or usage rules was found on its site" },
  // 14 Nov (owner's decision): Visa and Cloudflare are named in text, no logo image (docs/evidence/logo-permissions.md).
  { name: "Visa", why: "the owner's decision of 14 Nov 2026: named in text, no logo image" },
  { name: "Cloudflare", why: "the owner's decision of 14 Nov 2026: named in text, no logo image" },
];
