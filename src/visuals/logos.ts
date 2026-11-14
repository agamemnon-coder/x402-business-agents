// The partners' logos Purser may show (owner's decision, 12 Nov, relayed by the orchestrator: partner logos allowed),
// each an official file kept unmodified, with where and when it was downloaded (docs/assets/logos/SOURCES.md). Shown
// only as a neutral "Built with" row, never inside Purser's own diagrams and never with a word that suggests a partner
// made, certified or endorses Purser. A partner whose official file or published usage rules could not be found, or
// whose rules need a written permission not on record here, is left out (LEFT_OUT) and named in the PR.

export interface Logo { name: string; file: string; alt: string; height: number }
/** On white tiles in both themes: the Airwallex, Visa and Cloudflare files are dark marks with no light version on record. */
export const BUILT_WITH: Logo[] = [
  { name: "Airwallex", file: "src/ui/logos/airwallex.png", alt: "Airwallex", height: 30 },
  { name: "Claude", file: "docs/assets/logos/claude-logo-slate.svg", alt: "Claude", height: 30 },
  // Added 12 Nov on the owner's stated permission (docs/evidence/logo-permissions.md); sources in src/ui/logos/README.md.
  { name: "Visa", file: "src/ui/logos/visa.png", alt: "Visa", height: 26 },
  { name: "Cloudflare", file: "src/ui/logos/cloudflare.png", alt: "Cloudflare", height: 34 },
];
export const BUILT_WITH_PNG = "docs/assets/logos/built-with.png";
/** Named in text only, and why. */
export const LEFT_OUT: { name: string; why: string }[] = [
  { name: "Moneybird", why: "no brand or press page with logo files or usage rules was found on its site" },
  { name: "T:0", why: "no brand or press page with logo files or usage rules was found on its site" },
  // Metal renamed itself Alta on 14 Nov 2026; Metal's old wordmark (src/ui/logos/metal.svg) is no longer shown.
  { name: "Alta (formerly Metal)", why: "renamed from Metal on 14 Nov 2026; alta.finance has no brand kit, and its terms say the Alta logos may not be used without prior written consent" },
];
