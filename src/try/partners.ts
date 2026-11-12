// One plain line per screen naming whose part ran there (master list line 176), derived from this visitor's own
// answers: who read the invoice (the engine's read_by), where the money moved (the pay answer, and the sandbox rail's
// rows only when they ran), and recorded runs as dated links, never as something that ran for this visitor.
// Text only, no logos. Never "endorsed", "certified" or "approved by" (test/try-partners.test.ts).
import { T0_ROW } from "./books.js";

export type Screen = "invoice" | "at_work" | "approve" | "pay" | "books" | "company";

export interface VisitorFacts {
  /** InvoiceView.read_by of the visitor's invoice: "parser", "claude:<model>" or "claude-scan:<model>". */
  read_by?: string | null;
  /** The pay answer's outcome, and how many Airwallex sandbox calls ran for it (C9's rows). */
  pay?: { outcome: string; sandbox_calls: number } | null;
}

/** The model id in a read_by, or null when Purser's code read it. */
export function modelOf(readBy: string | null | undefined): string | null {
  const m = /^claude(?:-scan)?:(.+)$/.exec(readBy ?? "");
  return m ? m[1]!.slice(0, 60) : null;
}

/** The line for a screen, or null when no partner's part ran there for this visitor. */
export function partnerLine(screen: Screen, f: VisitorFacts): { text: string; href?: string } | null {
  switch (screen) {
    case "invoice":
    case "at_work": {
      if (f.read_by === undefined || f.read_by === null) return null;
      const model = modelOf(f.read_by);
      return { text: model ? `Claude ${model} read this invoice; Purser's code checked it.` : "Purser's code read this invoice (Claude not used)." };
    }
    case "approve":
      return { text: "Your passkey signed on this device; Purser's verifier checked it." };
    case "pay": {
      if (!f.pay) return null;
      if (f.pay.outcome !== "paid" && f.pay.outcome !== "paid_once") return { text: "Nothing paid: Purser's code refused it." };
      return { text: f.pay.sandbox_calls > 0 ? "Paid on the simulated bank (test money), then once on the Airwallex sandbox (test money)." : "Paid on the simulated bank (test money)." };
    }
    case "books":
      return { text: T0_ROW.text, href: T0_ROW.href };
    case "company":
      return null;
  }
}

/** Words no partner line may use. */
export const BANNED_PARTNER_WORDS = /\b(endorsed|endorses|endorsement|certified|certifies|approved by|partnered with|official partner)\b/i;
