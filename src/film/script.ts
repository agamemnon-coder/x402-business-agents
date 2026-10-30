// The film's script: its ten scenes in order, how long each runs and what Max says over it. The film page
// (src/film/film.html) animates each scene for exactly its seconds; the video plan (src/video/plan.ts) records the
// same scenes and writes the subtitles and the script to read from these words.

export interface FilmScene { id: string; title: string; seconds: number; voice: string }

export const FILM_SCENES: FilmScene[] = [
  { id: "open", title: "Hook", seconds: 12,
    voice: "AI agents are starting to spend company money: software, suppliers, refunds. So every CFO asks the same question: who is holding the pen?" },
  { id: "problem", title: "The problem", seconds: 12,
    voice: "Give an agent a card number and hope, or approve every cent yourself. One is a risk no auditor signs off. The other saves you nothing." },
  { id: "reveal", title: "Purser", seconds: 14,
    voice: "Purser gives every AI agent its own company card and its own on-chain mandate, with limits the CFO sets once. Anything new waits for Face ID." },
  { id: "card", title: "A company card, and Face ID", seconds: 22,
    voice: "Watch. The operations agent buys software: approved by Airwallex. Then the Pro plan, forty-five euros, on a thirty euro limit: declined, by the bank itself. The agent asks for more. The CFO checks the exact terms and approves with Face ID. The limit moves to fifty, and the same purchase goes through." },
  { id: "bill", title: "A euro bill, paid", seconds: 22,
    voice: "A euro invoice arrives: eighteen hundred and fifty. The finance agent checks balances and reserve floors, takes a live quote and converts only the missing three hundred and seventy. One Face ID covers the rate, the payee and the fee. Airwallex pays it by SWIFT: paid." },
  { id: "metal", title: "On chain with Metal", seconds: 30,
    voice: "On Metal, agents pay per request, cents at a time, under mandates that live on chain. When the supplier doubles its price, the payment hits the mandate's cap and bounces: nothing moves, and the customer is not charged. Purser prices two options, Opus reviews them, the CFO signs one, and the mandates are replaced on chain. Mandates, x402, signed orders, payouts, clearing and a receive policy: all live on Metal testnet." },
  { id: "dispute", title: "The Dispute desk", seconds: 20,
    voice: "Then a customer says: our agent never ordered this, refund everything. Northwind's Dispute desk checks the proof: every order signed by their agent, every payment inside their mandate on chain, every delivery matched. Twelve of twelve. Not refunded." },
  { id: "ask", title: "Ask Purser", seconds: 14,
    voice: "Need something once? Ask Purser: a flight to Berlin, at most one hundred and fifty euros. Airwallex issues a single-use card. The booking goes through; a second charge is declined." },
  { id: "trust", title: "Why you can trust it", seconds: 17,
    voice: "Code decides; the models only read and advise. Thirty-four red-team attacks: all blocked. Eighteen scenarios: all as expected. Two people above a threshold, one Face ID to freeze everything, and nine cents of AI per thousand euros paid." },
  { id: "end", title: "Purser", seconds: 10,
    voice: "Purser. Agents move at machine speed, and the CFO keeps the pen. Every euro has a proof." },
];

/** Each scene with the second it starts. */
export const filmTimeline = () => {
  let start = 0;
  return FILM_SCENES.map((s) => { const at = { id: s.id, start, seconds: s.seconds }; start += s.seconds; return at; });
};
