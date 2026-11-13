// The shot list of the video plan (section D), as data for npm run capture (src/cli/capture.ts). A shot is one page,
// one viewport, dark, and a few actions in order (hold, eased scroll to a line, a click, a file pick, a highlight
// box). Before the first frame the capture reads the page and refuses the shot when a line in `must` is missing or the
// gate fails, so nothing is filmed that the page does not say. GETs only: no shot presses a button that calls a server
// (T8's buttons run in the browser: /try/verify has connect-src 'none').
//
// T = can be captured from the live site today; D = waits for a stream, and is taken from the first site whose page
// passes its gate (the preview, kit11-next, until the stream is live); stills are files of this repository.

export const LIVE = "https://kit11.max-31b.workers.dev";
/** "local:/path": the page as this branch builds it (npm run capture serves the Worker's pages on this computer). */
export const LOCAL = "local:";
export const NEXT = "https://kit11-next.max-31b.workers.dev";
const GH = "https://github.com/agamemnon-coder/x402-business-agents/blob/main";

export type Action =
  | { hold: number }
  /** Scroll, eased, until the first element whose text contains `to` sits at `at` of the viewport's height (0.3). */
  | { scroll: string; s: number; at?: number }
  /** Click the first button or link whose text contains this (instant; the next hold shows the result). */
  | { click: string }
  /** Give the page's file input a repository file (instant). */
  | { pick: string }
  /** Outline the smallest elements that contain these strings (a highlight box; the page's words are not changed). */
  | { highlight: string[] };

export type Viewport = "desktop" | "phone";
export const VIEWPORTS: Record<Viewport, { width: number; height: number; dpr: number; out: [number, number] }> = {
  desktop: { width: 1440, height: 900, dpr: 2, out: [1920, 1080] },
  phone: { width: 390, height: 844, dpr: 3, out: [1080, 1920] },
};

export interface Shot {
  id: string;
  what: string;
  /** Page shots: the addresses to try, in order; the first whose page passes `must` and `gate` is filmed. */
  urls?: string[];
  /** Still shots: a repository image, shown whole in the cut. */
  still?: string;
  viewport: Viewport;
  actions: Action[];
  /** Lines that must be on the page (its text, as a visitor reads it) before a frame is taken. */
  must: string[];
  /** Lines the page must not show once its actions are done (a defect on screen): the shot is refused there. */
  mustNot?: string[];
  /** A stream's gate: the page must not contain (in its main menu) / must contain these. */
  gate?: { stream: string; menuWithout?: string; pageWith?: string };
  /** The page as it renders (GitHub, the explorer): its own theme, not forced. */
  ownTheme?: boolean;
}

export const seconds = (s: Pick<Shot, "actions">) => Math.round(s.actions.reduce((t, a) => t + ("hold" in a ? a.hold : "scroll" in a ? a.s : 0), 0) * 1000) / 1000;

const desktop = (s: Omit<Shot, "viewport">): Shot => ({ viewport: "desktop", ...s });

export const SHOTS: readonly Shot[] = [
  desktop({ id: "T14", what: "Today's Home: the H1 and the four steps", urls: [`${LIVE}/`], actions: [{ hold: 3 }, { scroll: "Tamper refused", s: 2.5, at: 0.45 }, { hold: 6 }], must: ["AI agents spend. You sign off.", "Tamper refused"] }),
  desktop({ id: "D1a", what: "Home (home-story): the H1, then the four steps", urls: [`${LIVE}/`, `${NEXT}/`], actions: [{ hold: 3 }, { scroll: "An approval is usually a button", s: 2.5, at: 0.55 }, { hold: 6 }], must: ["AI agents spend. You sign off.", "+1 cent"], gate: { stream: "home-story", menuWithout: "Watch" } }),
  desktop({ id: "T2a", what: "/metal: the H1, three mandates, 86 payments", urls: [`${LIVE}/metal`], actions: [{ hold: 2.5 }, { scroll: "3 mandates on chain", s: 2, at: 0.3 }, { hold: 5.5 }], must: ["A limit the agent cannot talk past", "3 mandates on chain, one per agent", "86 Metal payments"] }),
  desktop({ id: "T2b", what: "/metal: #24 refused on chain", urls: [`${LIVE}/metal`], actions: [{ hold: 0.5 }, { scroll: "#24 refused on chain", s: 2, at: 0.3 }, { highlight: ["#24 refused on chain"] }, { hold: 9.5 }], must: ["#24 refused on chain", "mandate_cap_exceeded", "0x2e92"] }),
  desktop({ id: "T3", what: "/claude: the H1, the three agents, 24/24", urls: [`${LIVE}/claude`], actions: [{ hold: 3 }, { scroll: "24/24", s: 2.5, at: 0.3 }, { hold: 18.5 }], must: ["Claude decides the exceptions", "24/24", "Haiku", "routine payments by code"] }),
  desktop({ id: "T4", what: "The explorer page of tx 0x2e92…1871 (log #0, undecoded)", urls: ["https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871"], actions: [{ hold: 5 }], must: ["0x2e92…1871", "2026-11-03"], ownTheme: true }),
  desktop({ id: "T5a", what: "The awx-1 record on GitHub: Face ID at 12:12:20.250, PAID 6.3 s after", urls: [`${GH}/docs/runs/2026-11-07-awx-1.md`], actions: [{ hold: 0.5 }, { scroll: "12:12:20.250", s: 2, at: 0.35 }, { highlight: ["12:12:20.250", "6.3 s after Face ID"] }, { hold: 11.5 }], must: ["12:12:20.250", "6.3 s after Face ID"], ownTheme: true }),
  desktop({ id: "T5d", what: "The platform run's record on GitHub: its Result", urls: [`${GH}/docs/runs/2026-11-10-platform-e2e.md`], actions: [{ hold: 0.5 }, { scroll: "3 companies onboarded", s: 1.5, at: 0.3 }, { highlight: ["1 payout PAID"] }, { hold: 11 }], must: ["3 companies onboarded", "1 payout PAID", "registration number"], ownTheme: true }),
  // The live page showed "Payee undefined" for this receipt until the fix on this branch is deployed: a page that shows
  // a line in `mustNot` after its actions is refused, and the page as this branch builds it (local:) is filmed instead.
  desktop({ id: "T8", what: "/try/verify with the real receipt P-0002: valid, then + 0.01 fails", urls: [`${LIVE}/try/verify`, "local:/try/verify"], actions: [{ hold: 1.5 }, { pick: "docs/runs/2026-11-07-awx-1/receipt-P-0002.json" }, { hold: 3 }, { scroll: "Change one field", s: 1.2, at: 0.6 }, { hold: 1.5 }, { click: "Change one field" }, { hold: 5.8 }], must: ["Check the signature yourself", "Pick receipt.json"], mustNot: ["undefined"] }),
  desktop({ id: "T9a", what: "/airwallex, awx-1: the EUR 45.00 decline, the raise, the same charge approved", urls: [`${LIVE}/airwallex`], actions: [{ hold: 0.5 }, { scroll: "LIMIT_EXCEEDED", s: 2, at: 0.35 }, { highlight: ["LIMIT_EXCEEDED"] }, { hold: 17.5 }], must: ["7 November, awx-1", "LIMIT_EXCEEDED", "P-0001"] }),
  desktop({ id: "T9b", what: "/airwallex, awx-1: SLL-2026-11, EUR 240.00 by SWIFT, PAID", urls: [`${LIVE}/airwallex`], actions: [{ hold: 0.5 }, { scroll: "SLL-2026-11", s: 2, at: 0.35 }, { highlight: ["SLL-2026-11"] }, { hold: 9.5 }], must: ["SLL-2026-11", "738a4263"] }),
  desktop({ id: "T9c", what: "/airwallex, awx-1: only EUR 623.50 bought", urls: [`${LIVE}/airwallex`], actions: [{ hold: 0.5 }, { scroll: "623.50", s: 2, at: 0.35 }, { highlight: ["623.50"] }, { hold: 6.5 }], must: ["623.50", "1605354b"] }),
  desktop({ id: "T10", what: "/visa: VIC via Airi, A paid, B after Face ID, C refused", urls: [`${LIVE}/visa`], actions: [{ hold: 1 }, { scroll: "Visa Intelligent Commerce via Airwallex", s: 2.5, at: 0.15 }, { hold: 16.5 }], must: ["Visa Intelligent Commerce via Airwallex", "EUR 12.00", "0 Airi calls"] }),
  desktop({ id: "D4", what: "/visa (visa-vic-first): as T10, with the fourth attempt", urls: [`${LIVE}/visa`, `${NEXT}/visa`], actions: [{ hold: 1 }, { scroll: "Visa Intelligent Commerce via Airwallex", s: 2.5, at: 0.15 }, { hold: 16.5 }], must: ["Visa Intelligent Commerce via Airwallex", "EUR 12.00", "0 Airi calls"], gate: { stream: "visa-vic-first", pageWith: "fourth attempt" } }),
  desktop({ id: "T11", what: "/runs: the main run's books posted to T:0, 95 of 95", urls: [`${LIVE}/runs`], actions: [{ hold: 0.5 }, { scroll: "The main run's books posted to T:0", s: 2, at: 0.25 }, { highlight: ["The main run's books posted to T:0"] }, { hold: 15.5 }], must: ["The main run's books posted to T:0", "95 journal entries"] }),
  desktop({ id: "T12", what: "/runs: three test companies, 3 invoices refused by Airwallex", urls: [`${LIVE}/runs`], actions: [{ hold: 0.5 }, { scroll: "Three test companies on their own Airwallex accounts", s: 2, at: 0.25 }, { highlight: ["3 invoices refused by Airwallex"] }, { hold: 13.5 }], must: ["Three test companies on their own Airwallex accounts", "3 invoices refused by Airwallex"] }),
  desktop({ id: "T13", what: "/runs: two locks on one payout, IN_APPROVAL (10 Nov)", urls: [`${LIVE}/runs`], actions: [{ hold: 0.5 }, { scroll: "Two locks on one payout", s: 2, at: 0.25 }, { highlight: ["IN_APPROVAL"] }, { hold: 11.5 }], must: ["Two locks on one payout", "IN_APPROVAL"] }),
  desktop({ id: "D3", what: "/runs (runs-timeline): one payout, two locks, PAID", urls: [`${LIVE}/runs`, `${NEXT}/runs`], actions: [{ hold: 0.5 }, { scroll: "One payout, two locks", s: 2, at: 0.25 }, { highlight: ["One payout, two locks"] }, { hold: 11.5 }], must: ["One payout, two locks", "then PAID"], gate: { stream: "runs-timeline", pageWith: "One payout, two locks" } }),
  desktop({ id: "T5e", what: "The Moneybird record on GitHub: its Result (moneybird-live)", urls: [`${GH}/docs/runs/2026-11-12-moneybird-sandbox.md`], actions: [{ hold: 0.5 }, { scroll: "0 differences", s: 1.5, at: 0.35 }, { highlight: ["0 differences"] }, { hold: 9 }], must: ["0 differences", "stand-in rail"], gate: { stream: "moneybird-live", pageWith: "0 differences" }, ownTheme: true }),
  // Not capturable yet: no demo deployment (cloud-demo), and the zero-trust tests are on their branch (a terminal shot).
  desktop({ id: "D5-B", what: "Purser Cloud's demo world (cloud-demo, DEMO_PUBLIC=on): inbox, held, waiting, FX, ledger, vault", urls: [], actions: [{ hold: 33 }], must: ["test company", "stand-in"], gate: { stream: "cloud-demo" } }),
  desktop({ id: "D6", what: "Terminal: npx vitest run test/zero-trust.test.ts, the green summary", urls: [], actions: [{ hold: 10 }], must: ["passed"], gate: { stream: "zero-trust" } }),
  // The hand-in film (13 Nov): the runs of 12 November, the books, Purser Cloud and the proof page.
  desktop({ id: "F0", what: "/runs: Face ID signs on chain, two passkeys, the second a virtual test passkey (12 Nov)", urls: [`${LIVE}/runs`], actions: [{ hold: 0.5 }, { scroll: "Face ID signs on chain", s: 2, at: 0.2 }, { highlight: ["Face ID signs on chain"] }, { hold: 12.5 }], must: ["Face ID signs on chain", "virtual test passkey"] }),
  desktop({ id: "F1", what: "The Face ID on-chain record on GitHub: the owners, and both passkeys signing", urls: [`${GH}/docs/runs/2026-11-12-faceid-onchain.md`], actions: [{ hold: 0.5 }, { scroll: "The owners", s: 1.5, at: 0.2 }, { highlight: ["iPhone (Face ID) (as stated by the owner)"] }, { hold: 7 }, { scroll: "the owners sign P-0001", s: 1.5, at: 0.4 }, { highlight: ["2 of 2 approvals"] }, { hold: 9.5 }], must: ["threshold 2", "virtual test passkey"], ownTheme: true }),
  desktop({ id: "F1b", what: "The same record: refused, then paid", urls: [`${GH}/docs/runs/2026-11-12-faceid-onchain.md`], actions: [{ hold: 0.5 }, { scroll: "Refused, then paid", s: 1.5, at: 0.2 }, { highlight: ["refused on chain under the 0.05 cap"] }, { hold: 10 }], must: ["Refused, then paid", "refused on chain"], ownTheme: true }),
  desktop({ id: "F2", what: "The explorer page of the refused payment, tx 0xe6d9c7ea…585df4", urls: ["https://testnet.metalntwx.com/tx/0xe6d9c7eab36bb2c3af40269aa2e605982f3aa3d78a93a94d13b62ef96b585df4"], actions: [{ hold: 8 }], must: ["0xe6d9…5df4"], ownTheme: true }),
  desktop({ id: "V3", what: "The vic-3 record on GitHub: purchase B, 45.00 EUR after Face ID, both read-backs equal", urls: [`${GH}/docs/runs/2026-11-12-vic-3.md`], actions: [{ hold: 0.5 }, { scroll: "above the CFO's limit: Face ID", s: 1.5, at: 0.35 }, { highlight: ["above the CFO's limit: Face ID"] }, { hold: 16 }], must: ["above the CFO's limit: Face ID", "succeeded"], ownTheme: true }),
  desktop({ id: "V3n", what: "The vic-3 record: the negative tests, only Purser enforces the binding", urls: [`${GH}/docs/runs/2026-11-12-vic-3.md`], actions: [{ hold: 0.5 }, { scroll: "Negative test (F1, F2)", s: 1.5, at: 0.2 }, { highlight: ["only Purser enforces the binding here"] }, { hold: 12 }], must: ["only Purser enforces the binding here"], ownTheme: true }),
  desktop({ id: "T5f", what: "The two-locks record on GitHub: approved at Airwallex, then PAID (12 Nov)", urls: [`${GH}/docs/runs/2026-11-12-airwallex-two-locks-paid.md`], actions: [{ hold: 0.5 }, { scroll: "What happened on 12 November", s: 1.5, at: 0.2 }, { highlight: ["The owner approved the transfer in the Airwallex sandbox web app"] }, { hold: 10 }], must: ["IN_APPROVAL", "PAID"], ownTheme: true }),
  desktop({ id: "B1", what: "/books: the test company's books, then the Coder agent's choices with its reasons", urls: [`${LIVE}/books`], actions: [{ hold: 3 }, { scroll: "chose account, VAT code and cost centre", s: 2.5, at: 0.2 }, { highlight: ["chose account, VAT code and cost centre"] }, { hold: 16.5 }], must: ["Test company · test money", "chose account, VAT code and cost centre"] }),
  desktop({ id: "C1", what: "Purser Cloud (purser-try): the console's landing, test money", urls: ["https://purser-try.max-31b.workers.dev/"], actions: [{ hold: 10 }], must: ["Purser Cloud", "The console never pays"] }),
  desktop({ id: "PR1", what: "/proof: what Purser guarantees, who enforces it, the evidence", urls: [`${LIVE}/proof`], actions: [{ hold: 3 }, { scroll: "What Purser guarantees", s: 2, at: 0.15 }, { hold: 13 }], must: ["What Purser guarantees"] }),
  { id: "T7a", what: "Screenshot: the payables inbox of a test company", still: "docs/screenshots/after-kit/1-payables-inbox.png", viewport: "desktop", actions: [{ hold: 7 }], must: [] },
  { id: "T7b", what: "Screenshot: several invoices approved at once with Face ID", still: "docs/screenshots/after-kit/3-batch-face-id-phone.png", viewport: "desktop", actions: [{ hold: 7 }], must: [] },
  { id: "T7c", what: "Screenshot: an Airwallex account opened through Purser", still: "docs/screenshots/after-kit/4-airwallex-account.png", viewport: "desktop", actions: [{ hold: 7 }], must: [] },
];

/**
 * The same pages at phone size (390x844, DPR 3), for the 9:16 cut and the phone frame: the pages a viewer can open on a
 * phone (the four records the film leans on, and the check).
 */
export const PHONE_SHOTS: readonly Shot[] = ["D1a", "T2b", "T8", "T9a", "T9b", "T10", "T11"].map((id) => {
  const s = SHOTS.find((x) => x.id === id)!;
  return { ...s, id: `${id}-phone`, viewport: "phone" as const, actions: s.actions.map((a) => ("scroll" in a ? { ...a, at: Math.min(a.at ?? 0.3, 0.25) } : a)) };
});

export const ALL_SHOTS: readonly Shot[] = [...SHOTS, ...PHONE_SHOTS];

/**
 * What only the owner can record (the plan's E): the placeholders in the first cut. They are never captured; the cut
 * draws a card in their place until a file is given (npm run cut -- --cam, --phone).
 */
export const OWN_FOOTAGE = {
  M1: "Max on camera: the opening (20 s, landscape)",
  M2: "Max on camera: the close (15 s, landscape)",
  P1a: "Phone recording: /try/sign, the reading and the advice (Face ID take)",
  P1b: "Phone recording: the terms, then Face ID, then \"Signed and verified.\"",
  P1c: "Phone recording: \"Try to cheat\", + 1 cent, \"Refused by Purser\"",
  P1d: "Phone recording: \"Trick the agent\", \"Blocked: a new IBAN needs a person's Face ID.\"",
  P2a: "Phone recording: /try on purser-try, start a test company, the invoice is read and checked",
  P2b: "Phone recording: /try, sign the exact terms with Face ID, paid on the simulated bank",
  P2c: "Phone recording: /try, change one cent, refused",
  S1: "Screen recording: the test company's console (Overview, Agents, Invoices & books, Transactions, Tokenisation)",
} as const;
export type OwnShot = keyof typeof OWN_FOOTAGE;

/** How the owner records each of his shots: the device, the screen and what to do on it (the shot lists print it). */
export const OWN_HOW: Record<OwnShot, { device: string; where: string; steps: string[] }> = {
  M1: { device: "iPhone, landscape, 1080p 30 fps, on a tripod at eye height", where: "a quiet room, light from the front", steps: ["Say the opening line word for word; look into the lens", "Hold the gaze 1 s after the last word", "Three takes"] },
  M2: { device: "iPhone, landscape, 1080p 30 fps", where: "the same set as M1", steps: ["Say the close word for word", "Three takes"] },
  P1a: { device: "iPhone screen recording", where: `${LIVE}/try/sign`, steps: ["The reading and the advice; keep only a take whose labels say live"] },
  P1b: { device: "iPhone screen recording", where: `${LIVE}/try/sign`, steps: ["The terms, Face ID, \"Signed and verified.\""] },
  P1c: { device: "iPhone screen recording", where: `${LIVE}/try/sign`, steps: ["\"Try to cheat\", + 1 cent, \"Refused by Purser\""] },
  P1d: { device: "iPhone screen recording", where: `${LIVE}/try/sign`, steps: ["\"Trick the agent\", the blocked IBAN"] },
  P2a: { device: "iPhone screen recording (Control Centre), dark mode, Do Not Disturb on", where: "https://purser-try.max-31b.workers.dev/try", steps: ["Start a test company", "Pick the clean sample invoice (Bergtex Textil GmbH, EUR 1,850.00)", "Let the screen show who read it and what the checks found; hold 2 s"] },
  P2b: { device: "iPhone screen recording, plus 2–3 s of a second camera at the Face ID moment", where: "the same test company", steps: ["Open the terms (the card shows the conversion, the bank fee cap and the deadline)", "Sign with Face ID", "Hold on Paid (simulated bank) 2 s"] },
  P2c: { device: "iPhone screen recording", where: "the same test company", steps: ["Change the amount by one cent", "Hold on the refusal 2 s"] },
  S1: { device: "Laptop screen recording, 1440 px wide, dark mode", where: "Purser Cloud's console for the test company of P2 (purser-try.max-31b.workers.dev)", steps: ["Overview, 4 s", "Agents, 4 s", "Invoices & books: the paid invoice, then the journal, 6 s", "Transactions, 4 s", "Tokenisation, 4 s", "No e-mail, keys or personal data on screen"] },
};

export const shot = (id: string): Shot => {
  const s = ALL_SHOTS.find((x) => x.id === id);
  if (!s) throw new Error(`film: no shot ${id}`);
  return s;
};
