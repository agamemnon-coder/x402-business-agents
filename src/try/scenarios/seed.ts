// A visitor's seed (master list line 315): a whole number that picks one scenario and the story's company. It is not a
// secret and holds nothing about the visitor; the same seed always gives the same scenario ("Replay this scenario"),
// and "Give me another scenario" is a new one. Seeds run from 0 to 2^31 - 1.
import type { Event, Expect, Lang } from "./blocks.js";

/** The story's companies (labels only: every test company is seeded the same). */
export const COMPANIES = ["Harbour Linen (test)", "Polder Print (test)", "Canal Bikes (test)"] as const;

/** A scenario as the Worker holds it (cloud/src/try/scenarios.gen.ts): its files already PDFs. */
export interface ScenarioPdfs { id: string; event: Event; lang: Lang; title: string; expect: Expect; files: { filename: string; base64: string }[] }

export const SEED_MAX = 2 ** 31 - 1;

/** A seed from text: digits only, at most 2^31 - 1; anything else is null. */
export function parseSeed(s: string | null | undefined): number | null {
  if (typeof s !== "string" || !/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n <= SEED_MAX ? n : null;
}

/** A new seed, from the platform's random numbers. */
export function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! & SEED_MAX;
}

/** The scenario and the story's company a seed picks: the same seed, the same pick, always. */
export function pick<T>(library: readonly T[], seed: number): { scenario: T; company: string; index: number } {
  const index = seed % library.length;
  return { scenario: library[index]!, company: COMPANIES[Math.floor(seed / library.length) % COMPANIES.length]!, index };
}
