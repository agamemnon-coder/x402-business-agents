// The two films as cut lists (the video plan, sections B and C, 12 Nov): the 3:00 submission cut and the jury
// walkthrough, trimmed to about 4:45 so it stays under five minutes (the rule says "under five minutes"). A row is one
// line of narration (Max on camera, or the voice-over) over one or more shots; each shot carries at most one caption
// (8 words, 48 characters) and, where money is shown, its badge. Every row names the claims it carries
// (src/film/claims.ts). A row whose record is not in this repository yet (a stream still on its branch) falls back to
// its timed fallback words, or is dropped and its seconds given to named rows, so the film never says what its records
// do not hold. checkCut() is the honesty and timing check: npm run cut -- --check, and test/film-cuts.test.ts.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLAIMS, claim } from "./claims.js";
import { OWN_FOOTAGE, OWN_HOW, SHOTS, seconds as shotSeconds, type Action, type OwnShot } from "./shots.js";

export const ROOT = resolve(import.meta.dirname, "../..");
export const SITE_URL = "kit11.max-31b.workers.dev";

/** The badges (G.2 rule 1): one in a corner of every shot where money is shown or moves. */
export const BADGES = {
  awx: "Airwallex sandbox · test money",
  metal: "Metal testnet · test USD",
  airi: "Airi test card · test money",
  testworld: "Test world · no money moves",
  standin: "Stand-in · no real account",
  standinRail: "Stand-in rail · no money moved",
  harness: "Test harness · stand-in rails",
  books: "Sandbox · test data",
  simbank: "Simulated bank · test money",
  testco: "Test company · test money",
} as const;
export type Badge = keyof typeof BADGES;

export interface Seg {
  /** A captured shot (the first one with a clip is used), a still, or footage only the owner can record. */
  shot?: string[];
  own?: OwnShot;
  /** An end card: its lines. */
  card?: string[];
  seconds: number;
  /** One caption per shot; a caption with its own window (seconds from the shot's start) for the opening only. */
  caption?: string | { from: number; to: number; text: string }[];
  badge?: Badge;
}

export interface Row {
  id: string;
  /** cam: Max on camera; vo: the voice-over over the screen; card: no voice. */
  kind: "cam" | "vo" | "card";
  words: string;
  segs: Seg[];
  claims: string[];
  /** A chapter starts here (the /watch page and the YouTube description). */
  chapter?: string;
  /** Numbers said rounded, with the exact figure of the record: ["32", "0.3170"] is "32 cents" for USD 0.3170. */
  rounded?: [said: string, exact: string, unit: number][];
  /** What the row needs: claims whose records must hold (their files and strings), or a deployment. */
  needs?: (string | "demo-deployment")[];
  /** When `needs` fails: the fallback row (timed), or none (the row is dropped and its seconds go to `give`). */
  fallback?: Row;
  give?: Record<string, number>;
}

export interface Cut { id: "submission-3" | "walkthrough-5" | "handin-5"; title: string; file: string; rows: Row[]; limit: number }

const s = (shot: string | string[], seconds: number, caption?: Seg["caption"], badge?: Badge): Seg => ({ shot: Array.isArray(shot) ? shot : [shot], seconds, caption, badge });
const own = (o: OwnShot, seconds: number, caption?: Seg["caption"], badge?: Badge): Seg => ({ own: o, seconds, caption, badge });

const OPENING = "Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. That matters, because a limit in a prompt is only a request. Our code checks the limit, and the payment rails check it again.";
const OPENING_CAPTION = [{ from: 0, to: 3, text: "Max · Purser" }, { from: 3, to: 18, text: "Agents pay only within limits the CFO signs" }];
const CLOSE = "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Purser, for Kit 11. Try it yourself.";
export const CLOSE_DEMO_DAY = "Agents do the work. The CFO signs only the exceptions. Card limits, payouts and mandates: our code checks them, and the rail checks again. Scan the code, and try it yourself.";
const CREDITS = "Airwallex sandbox · Metal testnet · test money · Claude by Anthropic";

/** The 3:00 cut: the submission (and Demo Day, with the QR end card). Section B. */
export const SUBMISSION: Cut = {
  id: "submission-3", title: "Purser in three minutes", file: "purser-3min", limit: 180,
  rows: [
    { id: "s01", kind: "cam", words: OPENING, segs: [own("M1", 20, OPENING_CAPTION)], claims: ["C01"] },
    { id: "s02", kind: "vo", words: "This is Purser. Claude agents propose payments. Past a limit, the CFO signs.", segs: [s(["D1a", "T14"], 10)], claims: ["C02"] },
    { id: "s03", kind: "vo", words: "This page is live; anyone can try it. An invoice for 1,850 euros comes in. Claude Sonnet reads it. Claude Opus advises on timing. No model sets the amount or the payee. Code builds the terms.", segs: [own("P1a", 20, "Claude reads; code writes the terms", "testworld")], claims: ["C03", "C04"] },
    { id: "s04", kind: "vo", words: "The CFO signs those exact terms with Face ID: amount, payee, IBAN and expiry.", segs: [own("P1b", 12, "Server checks the signature, not the face", "testworld")], claims: ["C05", "C06"] },
    { id: "s05", kind: "vo", words: "Change one cent after signing, and Purser refuses it. Now a trick: a fake invoice with new bank details. Blocked. A new IBAN needs a person's Face ID.", segs: [own("P1c", 6, "One cent changed → refused", "testworld"), own("P1d", 9, "New IBAN → blocked", "testworld")], claims: ["C07", "C08"] },
    { id: "s06", kind: "vo", words: "That was a test world. In the Airwallex sandbox, with test money, the owner approved paying a 240 euro invoice with Face ID. It was paid by SWIFT 6.3 seconds later. The sandbox simulates the settlement. The signed hash sits in Airwallex's own transfer record.", segs: [s("T9b", 12, "awx-1 · 7 Nov · EUR 240.00 by SWIFT", "awx"), s("T5a", 13, "PAID 6.3 s after Face ID · settlement simulated", "awx")], claims: ["C09", "C10", "C11"] },
    { id: "s07", kind: "vo", words: "Each agent has its own card. Airwallex declined a simulated 45 euro charge: over the limit. The agent asked the CFO for a raise, not a retry.", segs: [s("T9a", 13, "LIMIT_EXCEEDED · card ····2441 · 7 Nov", "awx")], claims: ["C12"] },
    { id: "s08", kind: "vo", words: "On Metal, a price rise went past an agent's mandate cap. We switched our own check off once, on purpose. Metal refused the purchase, on chain.", segs: [s("T2b", 12, "#24 refused on chain · let through on purpose", "metal")], claims: ["C13"] },
    { id: "s09", kind: "vo", words: "Through Airwallex's Airi, a Visa purchase over the limit waited for the CFO's Face ID.", segs: [s(["D4", "T10"], 10, "Visa Intelligent Commerce via Airi · 7 Nov", "airi")], claims: ["C15"] },
    { id: "s10", kind: "vo", words: "The main run's 95 journal entries went to T:0's sandbox, and match line by line.", segs: [s("T11", 12, "T:0 sandbox · 10 Nov · 95 of 95", "books")], claims: ["C16"] },
    { id: "s11", kind: "vo", words: "Don't take our word for it. This is the owner's real signature on that payout. Your browser checks it. Change one cent, and it fails.", segs: [s("T8", 13, "Receipt P-0002 · checked in your browser", "awx")], claims: ["C18"] },
    { id: "s12", kind: "cam", words: CLOSE, segs: [own("M2", 15)], claims: ["C19", "C34"] },
    { id: "s13", kind: "card", words: "", segs: [{ card: [SITE_URL, "Try it yourself", CREDITS], seconds: 3 }], claims: [] },
  ],
};

const WALK_P1 = "This page is live. An invoice for 1,850 euros comes in. Claude Sonnet reads it, and Claude Opus advises on timing. Code builds the terms; no model sets the amount or the payee. The CFO signs with Face ID. The server checks the signature, not the face. Change one cent after that, and Purser refuses it. Plant new bank details, and the payment is blocked until a person signs.";

/** The jury walkthrough: section C, trimmed to about 4:45 (under five minutes) with every claim kept. */
export const WALKTHROUGH: Cut = {
  id: "walkthrough-5", title: "Purser: the walkthrough", file: "purser-5min", limit: 299,
  rows: [
    { id: "w01", kind: "cam", chapter: "What Purser does", words: OPENING, segs: [own("M1", 20, OPENING_CAPTION)], claims: ["C01"] },
    { id: "w02", kind: "vo", words: "This is Purser. Claude agents propose payments. Past a limit, the CFO signs the exact terms with a passkey.", segs: [s(["D1a", "T14"], 11)], claims: ["C02"] },
    { id: "w03", kind: "vo", chapter: "Sign the exact terms", words: WALK_P1, segs: [own("P1a", 11, "Claude reads; code writes the terms", "testworld"), own("P1b", 10, "Server checks the signature, not the face", "testworld"), own("P1c", 8, "One cent changed → refused", "testworld"), own("P1d", 11, "New IBAN → blocked", "testworld")], claims: ["C03", "C04", "C05", "C06", "C07", "C08"] },
    {
      id: "w04", kind: "vo", chapter: "Purser Cloud", needs: ["C20", "C21", "demo-deployment"],
      words: "This is Purser Cloud, for small companies, in a demo world of test companies. Invoices arrive in an inbox. The checks hold one with changed bank details. Another waits for the CFO. A paid one shows its currency exchange, its double-entry booking, and its PDF, filed under its own hash. Nothing here is real: no real account, no real money, no model called.",
      segs: [s("D5-B", 33, "Purser Cloud · test companies", "standin")], claims: ["C20", "C21"],
      fallback: {
        id: "w04", kind: "vo", chapter: "Purser Cloud",
        words: "This is Purser Cloud, for small companies, in screenshots of a test company. Invoices arrive in an inbox, with what is due, what is blocked, and why. The CFO can approve several at once. In a sandbox run, three test companies got Airwallex accounts through Purser. One payout, signed with a test passkey, was paid, with Purser's fee and simulated settlement.",
        segs: [s("T7a", 7, "Screenshots · test company · test money", "standin"), s("T7b", 7, "Screenshots · test company · test money", "standin"), s("T7c", 7, "Screenshots · test company · test money", "standin"), s("T5d", 12, "Sandbox run · 10 Nov · 1 payout PAID", "awx")],
        claims: ["C20b", "C32", "C10"],
      },
    },
    { id: "w05", kind: "vo", chapter: "The agents and Claude", words: "In the main run on 3 November, the agents made 24 decisions with Claude Haiku, Sonnet and Opus. None fell back to a script. Routine payments ran as plain code. The agents' 24 decisions cost Claude 32 cents.", segs: [s("T3", 19, "Main run · 3 Nov · 24 decisions · USD 0.3170")], claims: ["C22", "C33"], rounded: [["32", "0.3170", 0.01]] },
    { id: "w06", kind: "vo", chapter: "Airwallex: the card limit", words: "On Airwallex, each agent has its own card. Airwallex declined a simulated 45 euro charge: over the limit. The agent read the decline and asked the CFO for a raise, not a retry. After Face ID, the same charge went through.", segs: [s("T9a", 19, "awx-1 · 7 Nov · declined, then approved", "awx")], claims: ["C12", "C23"] },
    { id: "w07", kind: "vo", chapter: "Airwallex: the payouts", words: "A 240 euro invoice was paid by SWIFT 6.3 seconds after Face ID, with simulated settlement. For an 1,850 euro invoice, Purser bought only the missing 623 euros 50.", segs: [s("T5a", 9, "PAID 6.3 s after Face ID · settlement simulated", "awx"), s("T9c", 9, "Bought only EUR 623.50 · quote 1605354b…", "awx")], claims: ["C09", "C10", "C25"] },
    {
      id: "w08", kind: "vo", chapter: "Two locks on one payout", needs: ["C26p"],
      words: "With Airwallex's approval workflow on, a payout waited until the owner approved it in Airwallex. Then it was paid. Purser's own lock was a test passkey.",
      segs: [s("D3", 13, "Two locks · paid 12 Nov · settlement simulated", "awx")], claims: ["C26", "C26p", "C10"],
      fallback: { id: "w08", kind: "vo", chapter: "Two locks on one payout", words: "With Airwallex's approval workflow on, a payout that Purser had signed with a test passkey stayed on hold at Airwallex, waiting for a person.", segs: [s("T13", 13, "Two locks · 10 Nov · held IN_APPROVAL", "awx")], claims: ["C26"] },
    },
    { id: "w09", kind: "vo", chapter: "Metal: the mandate holds", words: "In the main run, 86 Metal payments stayed inside the limits. Each agent has a cap per payment. The supplier doubled its price, past the Sourcing agent's cap. We switched our own check off once, on purpose. Metal refused the purchase, on chain.", segs: [s("T2a", 9, "86 payments inside the limits · 3 Nov", "metal"), s("T2b", 8, "#24 refused on chain · let through on purpose", "metal"), s("T4", 4, "#24 refused on chain · let through on purpose", "metal")], claims: ["C13", "C14", "C28"] },
    { id: "w10", kind: "vo", chapter: "Visa via Airi", words: "Visa Intelligent Commerce, through Airwallex's Airi. A 12 euro purchase needed no CFO approval in Purser. A 45 euro purchase, over the limit, waited for Face ID. A shop the CFO does not allow was refused before Airi was asked. It passed on the fourth try.", segs: [s(["D4", "T10"], 20, "Visa Intelligent Commerce via Airi · 7 Nov", "airi")], claims: ["C15", "C29"] },
    {
      id: "w11", kind: "vo", chapter: "The books", needs: ["C17"],
      words: "The main run's 95 journal entries were posted to T:0's sandbox, and T:0 matches our books line by line. In a Moneybird sandbox, a test company's purchase invoices read back with zero differences.",
      segs: [s("T11", 9, "T:0 sandbox · 10 Nov · 95 of 95", "books"), s("T5e", 9, "Moneybird sandbox · 12 Nov · test data", "standinRail")], claims: ["C16", "C17"],
      fallback: { id: "w11", kind: "vo", chapter: "The books", words: "The main run's 95 journal entries were posted to T:0's sandbox, and T:0 matches our books line by line. A second push posted none again: all 95 were already there.", segs: [s("T11", 18, "T:0 sandbox · 10 Nov · 95 of 95", "books")], claims: ["C16"] },
    },
    { id: "w12", kind: "vo", chapter: "Attacks in tests", needs: ["C30"], words: "We attacked Purser in tests: 48 attacks, each with part of the system in hostile hands. Money moved in none.", segs: [s("D6", 10, "48 attacks · money moved in 0", "harness")], claims: ["C30"], give: { w05: 4, w14: 4 } },
    { id: "w13", kind: "vo", chapter: "Check it yourself", words: "Check us yourself. This is the owner's real signature on the 240 euro payout. Your browser checks it. Change one cent, and it fails.", segs: [s("T8", 13, "Receipt P-0002 · checked in your browser", "awx")], claims: ["C18"] },
    { id: "w14", kind: "vo", chapter: "What is not done", words: "What is not done: Airwallex refused three payouts from two new test companies. It wants their registration number. Sandbox settlement is simulated.", segs: [s("T12", 12, "10 Nov · 3 payouts refused by Airwallex", "awx")], claims: ["C32", "C10"] },
    { id: "w15", kind: "cam", chapter: "Close", words: CLOSE, segs: [own("M2", 15)], claims: ["C19", "C34"] },
    { id: "w16", kind: "card", words: "", segs: [{ card: [SITE_URL, "Try it yourself", CREDITS], seconds: 3 }], claims: [] },
  ],
};

/**
 * The hand-in film (the owner, 13 Nov: "the hand-in video, under 5 minutes, is now the most important thing"), under
 * 4:45: the problem, Kit 11's core, the hands-on demo on Max's phone, Face ID checked on chain and a refusal on chain
 * (Metal, 12 Nov), Airwallex's card limit, Visa via Airi (12 Nov), two locks PAID, the books Claude codes, Purser Cloud,
 * the proof page, what is not done, the close. Each line rests on the runs of 3, 7, 10 and 12 November.
 */
export const HANDIN: Cut = {
  id: "handin-5", title: "Purser: the hand-in film", file: "purser-handin", limit: 284,
  rows: [
    { id: "h01", kind: "cam", chapter: "The problem", words: "Hi, I'm Max. Purser lets AI agents pay company bills, but only within limits the CFO signs with Face ID. A limit in a prompt is only a request. Here the agent proposes, the CFO signs, and the payment rails enforce it.", segs: [own("M1", 20, OPENING_CAPTION)], claims: ["C01"] },
    { id: "h02", kind: "vo", chapter: "Kit 11's core", words: "In the main run on 3 November, three Claude agents made 24 decisions. Past a limit, an agent only proposes. The CFO signs the exact terms. Airwallex and Metal each hold the limit again, on their own side.", segs: [s(["D1a", "T14"], 8), s("T3", 14, "Main run · 3 Nov · 24 decisions · USD 0.3170")], claims: ["C22", "C02", "C19"] },
    { id: "h03", kind: "vo", chapter: "Try it: your own test company", words: "This is the hands-on demo: your own test company, gone after 24 hours, with test money on a simulated bank. An invoice for 1,850 euros comes in. The screen says who read it and what the checks found. The CFO signs the exact terms with Face ID. Change one cent, and it is refused.", segs: [own("P2a", 16, "Your own test company · 24 hours", "simbank"), own("P2b", 17, "The CFO signs the exact terms", "simbank"), own("P2c", 13, "One cent changed → refused", "simbank")], claims: ["C44", "C05"] },
    { id: "h04", kind: "vo", chapter: "Face ID, checked on chain", words: "On Metal, the agent's limit now lives in a passkey account. The account checks the signatures itself, on chain: the CFO's passkey, on an iPhone with Face ID, and a second approver, here a labelled test passkey.", segs: [s("F0", 13, "Two passkeys · checked on chain · 12 Nov", "metal"), s("F1", 11, "Second approver: a labelled test passkey", "metal")], claims: ["C40"] },
    { id: "h05", kind: "vo", chapter: "Refused on chain", words: "The agent paid 5 cents inside its mandate. Then 6 cents, over the cap: refused on chain. Both owners signed a higher cap, and the same 6 cents went through.", segs: [s("F2", 8, "0.06 over the 0.05 cap · refused on chain", "metal"), s("F1b", 12, "Both owners signed · cap 0.10 · paid", "metal")], claims: ["C40r"], rounded: [["5", "0.05", 0.01], ["6", "0.06", 0.01]] },
    { id: "h06", kind: "vo", chapter: "Airwallex: the card limit", words: "On Airwallex, each agent has its own card. Airwallex itself declined a simulated 45 euro charge, over the limit.", segs: [s("T9a", 12, "LIMIT_EXCEEDED · card ····2441 · 7 Nov", "awx")], claims: ["C12"] },
    { id: "h07", kind: "vo", chapter: "Visa via Airi", words: "Through Visa Intelligent Commerce and Airwallex's Airi, Claude chose the rail. A 45 euro purchase above the limit waited for Face ID. The signed terms' hash sits in Airi's mandate and in Airwallex's payment record.", segs: [s("V3", 18, "Visa via Airi · 12 Nov · hash read back", "airi")], claims: ["C42"] },
    { id: "h08", kind: "vo", chapter: "Two locks, then PAID", words: "Two locks on one payout. Purser's, signed with a test passkey, and Airwallex's own approval. The payout waited at Airwallex until the owner approved it there. Then it was paid, with simulated settlement.", segs: [s("D3", 11, "Two locks · PAID 12 Nov · settlement simulated", "awx"), s("T5f", 10, "Approved in Airwallex's web app · 12 Nov", "awx")], claims: ["C26", "C41", "C10"] },
    { id: "h09", kind: "vo", chapter: "The books, coded by Claude", words: "The books keep themselves. For each test invoice, Claude's Coder agent chose the account, the VAT code and the cost centre, and wrote why. Code checks every choice before it is booked.", segs: [s("B1", 23, "Coded by Claude · checked by code", "testco")], claims: ["C43"] },
    { id: "h10", kind: "vo", chapter: "Purser Cloud", words: "This is Purser Cloud's console for a test company: the overview, invoices, transactions and books. It reads and manages, and it never pays. Payments are approved on the CFO's phone with Face ID.", segs: [own("S1", 22, "Purser Cloud · a test company", "testco")], claims: ["C45"] },
    { id: "h11", kind: "vo", chapter: "The proof", words: "Every line of this film has its record. The proof page lists what Purser guarantees, who enforces it, and the evidence.", segs: [s("PR1", 18)], claims: ["C46"] },
    { id: "h12", kind: "vo", chapter: "What is not done", words: "What is not done: in the Visa sandbox, a credential reused on a bigger payment was not refused. There, only Purser holds the limit. Settlement is simulated.", segs: [s("V3n", 14, "Sandbox did not refuse · only Purser held", "airi")], claims: ["C42n", "C10"] },
    { id: "h13", kind: "cam", chapter: "Close", words: CLOSE, segs: [own("M2", 15)], claims: ["C19", "C34"] },
    { id: "h14", kind: "card", words: "", segs: [{ card: [SITE_URL, "Try it yourself", CREDITS], seconds: 3 }], claims: [] },
  ],
};

export const CUTS: Record<Cut["id"], Cut> = { "submission-3": SUBMISSION, "walkthrough-5": WALKTHROUGH, "handin-5": HANDIN };

// ---- Which rows hold today -------------------------------------------------------------------------------------------

const text = (p: string) => (existsSync(resolve(ROOT, p)) ? readFileSync(resolve(ROOT, p), "utf8") : null);
/** A claim holds when its record is in this repository and every key string is found in its sources. */
export function claimHolds(id: string): boolean {
  const c = claim(id);
  const files = c.sources.map(text);
  if (files[0] === null) return false;
  const all = files.filter((f): f is string => f !== null).join("\n");
  return c.keys.every((k) => all.includes(k));
}
/** The demo deployment of Purser Cloud (form B): none yet (12 Nov); its row uses the screenshots until one exists. */
export const DEMO_DEPLOYMENT_URL = "";

export interface Placed { row: Row; start: number; seconds: number; segs: (Seg & { start: number })[] }

/** The rows as they will be cut today: each row or its fallback, dropped rows' seconds given, placed in time. */
export function resolveCut(cut: Cut, o: { holds?: (need: string) => boolean; demoDay?: boolean } = {}): Placed[] {
  const holds = o.holds ?? ((n: string) => (n === "demo-deployment" ? DEMO_DEPLOYMENT_URL !== "" : claimHolds(n)));
  const chosen: Row[] = [];
  const extra: Record<string, number> = {};
  for (const r of cut.rows) {
    if (!r.needs || r.needs.every(holds)) { chosen.push(r); continue; }
    if (r.fallback) { chosen.push(r.fallback); continue; }
    for (const [id, add] of Object.entries(r.give ?? {})) extra[id] = (extra[id] ?? 0) + add;
  }
  let t = 0;
  return chosen.map((r0) => {
    let r = r0;
    if (o.demoDay && r.kind === "cam" && r.words === CLOSE) r = { ...r, words: CLOSE_DEMO_DAY, claims: ["C19"] };
    if (o.demoDay && r.kind === "card") r = { ...r, segs: [{ card: [SITE_URL, "Scan the code · try it yourself", CREDITS], seconds: 3 }] };
    const add = extra[r.id] ?? 0;
    // Given seconds lengthen the row's last shot (a longer hold).
    const segs = r.segs.map((g, i) => ({ ...g, seconds: g.seconds + (i === r.segs.length - 1 ? add : 0) }));
    let at = t;
    const placed = segs.map((g) => { const p = { ...g, start: at }; at += g.seconds; return p; });
    const p: Placed = { row: r, start: t, seconds: at - t, segs: placed };
    t = at;
    return p;
  });
}
export const total = (placed: Placed[]) => placed.reduce((k, p) => k + p.seconds, 0);

// ---- Spoken words ----------------------------------------------------------------------------------------------------

/** Words a whole number takes when read aloud ("one thousand eight hundred fifty" is 5; "ninety-five" is 1). */
export function integerWords(n: number): number {
  if (n < 100) return 1;
  if (n < 1000) return 2 + (n % 100 ? 1 : 0);
  if (n < 1_000_000) return integerWords(Math.floor(n / 1000)) + 1 + (n % 1000 ? integerWords(n % 1000) : 0);
  return 3;
}
/** Words a number token takes when read: "6.3" is "six point three", "T:0" is "T zero". */
export function numberWords(tok: string): number {
  const t = tok.replace(/^[^\d]*?(?=\d)/, "").replace(/[^\d.,:]+$/, "");
  const lead = /[A-Za-z]/.test(tok.replace(/\d.*$/, "")) ? 1 : 0;
  if (t.includes(":")) return lead + t.split(":").filter(Boolean).length;
  const [int, dec] = t.replace(/,/g, "").split(".");
  return lead + integerWords(Number(int)) + (dec ? 1 + dec.length : 0);
}
/** Words as spoken: numbers read out, a hyphenated word one word. */
export function spokenWords(line: string): number {
  return line.split(/\s+/).filter(Boolean).reduce((k, w) => k + (/\d/.test(w) ? numberWords(w) : /[A-Za-z]/.test(w) ? 1 : 0), 0);
}
export const sentences = (line: string) => line.split(/(?<=[.!?])\s+/).filter((x) => /[A-Za-z]/.test(x)).length;
/** 150 words a minute (the plan's pace). */
export const WPM = 150;
/** Seconds a row needs: a VO line its words plus 1.0 s (0.4 s lead, 0.6 s tail); Max on camera 0.4 s a sentence. */
export function needed(r: Row): number {
  const speak = (spokenWords(r.words) / WPM) * 60;
  return Math.round((r.kind === "vo" ? speak + 1 : r.kind === "cam" ? speak + 0.4 * sentences(r.words) : 0) * 10) / 10;
}
/** Where a VO line starts within its row. */
export const VO_LEAD = 0.4;

// ---- Captions ---------------------------------------------------------------------------------------------------------

export const captionWords = (c: string) => c.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
export interface OnScreen { at: number; to: number; text: string; kind: "caption" | "badge" | "card"; row: Row }
/** Everything burned into the picture, in time: captions (merged when one runs over two shots), badges, card lines. */
export function onScreen(placed: Placed[]): OnScreen[] {
  const out: OnScreen[] = [];
  for (const p of placed) for (const g of p.segs) {
    const caps = typeof g.caption === "string" ? [{ from: 0, to: g.seconds, text: g.caption }] : (g.caption ?? []);
    for (const c of caps) {
      const prev = out.findLast((x) => x.kind === "caption");
      const at = g.start + c.from, to = g.start + Math.min(c.to, g.seconds);
      if (prev && prev.text === c.text && Math.abs(prev.to - at) < 0.001) prev.to = to;
      else out.push({ at, to, text: c.text, kind: "caption", row: p.row });
    }
    if (g.badge) {
      const prev = out.findLast((x) => x.kind === "badge");
      if (prev && prev.text === BADGES[g.badge] && Math.abs(prev.to - g.start) < 0.001) prev.to = g.start + g.seconds;
      else out.push({ at: g.start, to: g.start + g.seconds, text: BADGES[g.badge], kind: "badge", row: p.row });
    }
    for (const line of g.card ?? []) out.push({ at: g.start, to: g.start + g.seconds, text: line, kind: "card", row: p.row });
  }
  return out;
}

// ---- The check --------------------------------------------------------------------------------------------------------

/** The number tokens of a line: "1,850", "6.3", "0.3170", "2441", "1605354b" (a date's day and an id's digits too). */
export const numbers = (line: string) => [...line.matchAll(/\d[\da-f,.]*/gi)].map((m) => m[0].replace(/[.,]+$/, ""));
/** A number is in a text as a whole token (not inside a longer number or id): "45" in "EUR 45.00", not in "1450". */
export function inText(n: string, src: string): boolean {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [n, n.replace(/,/g, "")].some((v) => new RegExp(`(?<![0-9a-z])${esc(v)}(?![0-9a-z]|,[0-9])`, "i").test(src));
}

/** The claims of a payout PAID in the Airwallex sandbox, whose settlement the sandbox simulates. */
const AIRWALLEX_PAID = new Set(["C09", "C25", "C26", "C26p", "C32", "C41"]);

/** Every problem of a cut as it will be made today: timing, captions, badges, and each number against its records. */
export function checkCut(cut: Cut, o: { demoDay?: boolean } = {}): string[] {
  const out: string[] = [];
  const placed = resolveCut(cut, o);
  const len = total(placed);
  if (len > cut.limit) out.push(`${cut.id}: ${len} s is over ${cut.limit} s`);
  for (const p of placed) {
    const r = p.row, need = needed(r);
    if (need > p.seconds) out.push(`${r.id}: needs ${need} s, has ${p.seconds}`);
    if (r.kind === "cam" && p.seconds > 20) out.push(`${r.id}: Max on camera longer than 20 s`);
    for (const c of r.claims) if (!CLAIMS.some((x) => x.id === c)) out.push(`${r.id}: unknown claim ${c}`);
    for (const c of r.claims) if (!claimHolds(c)) out.push(`${r.id}: claim ${c} does not hold in its record`);
    // PAID in the Airwallex sandbox is said with its simulated settlement (rule 2); a Metal testnet payment settles on chain.
    if (/\bPAID\b|\bpaid\b/.test(r.words + r.segs.map((g) => (typeof g.caption === "string" ? g.caption : "")).join(" ")) && r.kind === "vo" && r.claims.some((c) => AIRWALLEX_PAID.has(c)) && !/simulat/i.test(r.words + JSON.stringify(r.segs)) && !r.claims.includes("C10")) out.push(`${r.id}: PAID without "settlement simulated"`);
    for (const g of p.segs) {
      if (g.shot && !g.shot.some((id) => SHOTS.some((x) => x.id === id))) out.push(`${r.id}: no shot ${g.shot.join("/")}`);
      if (g.own && !(g.own in OWN_FOOTAGE)) out.push(`${r.id}: no own footage ${g.own}`);
    }
    // Every number said or shown is found in the records of the row's claims (or is a stated rounding of one).
    const sources = r.claims.flatMap((c) => claim(c).sources).map(text).filter((x): x is string => x !== null).join("\n");
    const shown = r.segs.flatMap((g) => (typeof g.caption === "string" ? [g.caption] : (g.caption ?? []).map((c) => c.text)));
    for (const [where, line] of [["said", r.words], ...shown.map((c) => ["shown", c] as const)] as const) {
      for (const n of numbers(line)) {
        if (inText(n, sources)) continue;
        const rd = (r.rounded ?? []).find(([said]) => said === n);
        if (rd && sources.includes(rd[1]) && Math.round(Number(rd[1]) / rd[2]) === Number(rd[0])) continue;
        out.push(`${r.id}: ${where} number ${n} is not in the records of ${r.claims.join(", ") || "(no claim)"}`);
      }
    }
  }
  for (const x of onScreen(placed)) {
    if (x.kind !== "caption") continue;
    if (captionWords(x.text) > 8 || x.text.length > 48) out.push(`${x.row.id}: caption "${x.text}" is over 8 words or 48 characters`);
    if (x.to - x.at < Math.max(1.5, (captionWords(x.text) / 10) * 1.5)) out.push(`${x.row.id}: caption "${x.text}" on screen too briefly`);
  }
  const caps = onScreen(placed).filter((x) => x.kind === "caption").sort((a, b) => a.at - b.at);
  for (let i = 1; i < caps.length; i++) if (caps[i]!.at < caps[i - 1]!.to - 0.001) out.push(`${caps[i]!.row.id}: two captions at once`);
  // Money on screen carries a badge (rule 1): a shot whose caption or row names an amount, PAID or a rail.
  for (const p of placed) for (const g of p.segs) {
    const cap = typeof g.caption === "string" ? g.caption : "";
    if (/EUR|USD|PAID|LIMIT_EXCEEDED|refused|test money|payout/i.test(cap) && !/decisions/.test(cap) && !g.badge) out.push(`${p.row.id}: money on screen without a badge ("${cap}")`);
    if (g.own?.startsWith("P1") && g.badge !== "testworld") out.push(`${p.row.id}: the phone walk needs the test-world badge`);
  }
  // The opening says what Purser does within 15 s.
  const first = placed[0]!;
  const what = first.row.words.indexOf("Purser lets AI agents pay");
  if (what < 0 || (spokenWords(first.row.words.slice(0, what + "Purser lets AI agents pay company bills".length)) / WPM) * 60 > 15) out.push("the opening does not say what Purser does within 15 s");
  // Wording rules (G.2): no gendered pronoun for the CFO, no partner claims, no hype words.
  for (const p of placed) {
    const w = p.row.words;
    if (/\b(he|she|his|her|him)\b/i.test(w)) out.push(`${p.row.id}: a gendered pronoun`);
    if (/certified|endorsed|approved by Airwallex|partnered with|revolutionary|seamless|guaranteed/i.test(w)) out.push(`${p.row.id}: a forbidden word`);
    if (/refused/.test(w) && /Metal refused/.test(w) && !/on purpose/.test(w)) out.push(`${p.row.id}: the Metal refusal without "on purpose"`);
  }
  return out;
}

// ---- What the cut writes ---------------------------------------------------------------------------------------------

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const srtTime = (sec: number) => {
  const ms = Math.round(sec * 1000), h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s2 = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
/** The narration's timing within a row: at the lead, as long as the words take at 150 a minute. */
export function lineWindow(p: Placed): [number, number] {
  const at = p.start + (p.row.kind === "vo" ? VO_LEAD : 0.2);
  return [at, Math.min(p.start + p.seconds - 0.2, at + needed(p.row) - (p.row.kind === "vo" ? 1 : 0))];
}
/** Each sentence of the narration, timed in proportion to its words (for the .srt and the transcript). */
export function narration(placed: Placed[]): { at: number; to: number; text: string; who: "Max" | "Voice-over"; row: string }[] {
  const out: { at: number; to: number; text: string; who: "Max" | "Voice-over"; row: string }[] = [];
  for (const p of placed) {
    if (!p.row.words) continue;
    const [a, b] = lineWindow(p);
    const parts = p.row.words.split(/(?<=[.!?])\s+/);
    const w = parts.map((x) => Math.max(1, spokenWords(x)));
    const sum = w.reduce((k, x) => k + x, 0);
    let t = a;
    parts.forEach((x, i) => { const d = ((b - a) * w[i]!) / sum; out.push({ at: t, to: t + d, text: x, who: p.row.kind === "cam" ? "Max" : "Voice-over", row: p.row.id }); t += d; });
  }
  return out;
}
export const srt = (placed: Placed[]) => narration(placed).map((n, i) => `${i + 1}\n${srtTime(n.at)} --> ${srtTime(n.to)}\n${n.text}\n`).join("\n");

/** Chapters: where each starts (a row with `chapter`), as the film is cut today. */
export const chapters = (placed: Placed[]) => placed.filter((p) => p.row.chapter).map((p) => ({ at: Math.round(p.start), title: p.row.chapter! }));

/** The script table as rendered (the plan's B or C), with claim ids and what is still a placeholder. */
export function scriptMarkdown(cut: Cut, placed: Placed[]): string {
  const rows = placed.map((p) => {
    const shots = p.segs.map((g) => (g.own ? `**${g.own}** (placeholder: ${OWN_FOOTAGE[g.own]})` : g.card ? "end card" : g.shot!.join(" / "))).join(" → ");
    const caps = p.segs.map((g) => (typeof g.caption === "string" ? g.caption : (g.caption ?? []).map((c) => c.text).join("; "))).filter(Boolean).join(" → ");
    const badges = [...new Set(p.segs.map((g) => (g.badge ? BADGES[g.badge] : "")).filter(Boolean))].join(", ");
    return `| ${clock(p.start)}–${clock(p.start + p.seconds)} | ${shots} | ${p.row.kind === "cam" ? "MAX-CAM" : p.row.kind === "vo" ? "VO" : "—"}: ${p.row.words || "—"} | ${caps || "—"}${badges ? ` + badge ${badges}` : ""} | ${p.row.claims.join(", ") || "—"} |`;
  });
  const ch = chapters(placed).map((c) => `${clock(c.at)} ${c.title}`).join("\n");
  return `# ${cut.title} (${clock(total(placed))})\n\nMade by \`npm run cut -- ${cut.id}\` from src/film/cuts.ts. Spoken words: ${placed.reduce((k, p) => k + spokenWords(p.row.words), 0)} at ${WPM} a minute.\n\n| Time | Shot | Narration | Caption | Claims |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n## Chapters (for the YouTube description)\n\n${ch}\n`;
}

/** What a shot's actions do, in words, for the shot list. */
const doing = (a: Action) => ("hold" in a ? `hold ${a.hold} s` : "scroll" in a ? `scroll to "${a.scroll}" (${a.s} s)` : "click" in a ? `click "${a.click}"` : "pick" in a ? `pick ${a.pick}` : `highlight "${a.highlight.join("\", \"")}"`);

/** The shot list per scene: time, shot, who records it and how, the exact address or screen, what is done, caption, badge. */
export function shotListMarkdown(cut: Cut, placed: Placed[]): string {
  const lines: string[] = [`# ${cut.title}: the shot list (${clock(total(placed))})`, "", `Made by \`npm run cut -- --docs ${cut.id}\` from src/film/cuts.ts and src/film/shots.ts. Who records: **Max (iPhone)** or **Max (screen)** for his own footage; **capture** for a page shot (\`npm run capture -- <id>\`: Playwright, dark, 1440x900, frame by frame, GETs only).`, ""];
  for (const p of placed) {
    lines.push(`## ${clock(p.start)}–${clock(p.start + p.seconds)} · ${p.row.chapter ?? (p.row.kind === "card" ? "End card" : p.row.id)} (${p.row.id})`, "");
    for (const g of p.segs) {
      const cap = typeof g.caption === "string" ? g.caption : (g.caption ?? []).map((c) => c.text).join(" → ");
      const tail = [cap ? `caption "${cap}"` : "", g.badge ? `badge "${BADGES[g.badge]}"` : ""].filter(Boolean).join("; ");
      if (g.own) {
        const how = OWN_HOW[g.own];
        lines.push(`- **${g.own}**, ${g.seconds} s · **Max (${/screen recording|Laptop/.test(how.device) && !/iPhone/.test(how.device) ? "screen" : "iPhone"})** · ${how.device}`, `  - Where: ${how.where}`, `  - Do: ${how.steps.join("; ")}`, ...(tail ? [`  - On screen: ${tail}`] : []));
      } else if (g.card) {
        lines.push(`- End card, ${g.seconds} s: ${g.card.join(" · ")} (drawn by the cut)`);
      } else {
        const shot = g.shot!.map((id) => SHOTS.find((x) => x.id === id)).find((x) => x !== undefined)!;
        const alt = g.shot!.length > 1 ? ` (or ${g.shot!.filter((x) => x !== shot.id).join(", ")})` : "";
        lines.push(`- **${shot.id}**${alt}, ${g.seconds} s · **capture** · ${shot.what}`, `  - Where: ${shot.still ?? (shot.urls ?? []).join(" or ")}`, `  - Do: ${shot.actions.map(doing).join(", then ")} (${shotSeconds(shot)} s)`, ...(shot.must.length ? [`  - Must show: ${shot.must.map((m) => `"${m}"`).join(", ")}`] : []), ...(tail ? [`  - On screen: ${tail}`] : []));
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
