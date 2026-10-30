// The video (4:30): the voice-over script, the English subtitles and the shots, in one place, so the words and the
// pictures cannot drift apart. `npm run video` records every shot at 1920x1080, 60 fps (src/cli/video.ts); Max reads
// the script over the silent master.

export interface Action {
  /** Seconds from the start of the shot. */
  at: number;
  /** Move the cursor to the centre of the selector (highlighted), click it, zoom in on it (scrolling it into view), zoom out, or scroll to it. */
  do: "point" | "click" | "zoom" | "unzoom" | "scroll";
  target?: string;
  scale?: number;
}

export interface Shot {
  /** A path on the recording server (the same pages the relay and npm run judge serve, from the recordings). */
  path: string;
  seconds: number;
  actions?: Action[];
}

export interface Beat {
  id: string;
  title: string;
  /** What Max says. Plain, about 150 words a minute. */
  voice: string;
  shots: Shot[];
}

const live = (scene: string) => `/live?scene=${scene}&present&hold`;
/** A scene of the animation, with the camera moving in on its picture while it plays and back out before the cut. */
const scene = (id: string, seconds: number, scale = 1.25): Shot => ({ path: live(id), seconds, actions: [{ at: 1, do: "zoom", target: ".vis svg", scale }, { at: seconds - 1.6, do: "unzoom" }] });

export const BEATS: Beat[] = [
  {
    id: "b1-hook", title: "Hook",
    voice: "Your company's AI agents are about to start spending money. Buying software, paying suppliers, settling customer claims. So here's the question every CFO will ask: who is holding the pen?",
    shots: [{ path: live("title"), seconds: 6 }, scene("coins", 9)],
  },
  {
    id: "b2-problem", title: "The problem",
    voice: "Today there are two bad options. Hand an agent a card number and hope it behaves. Or approve every single cent yourself. The first is a risk no auditor will sign off. The second means the agent saves you nothing.",
    shots: [{ path: "/?present", seconds: 25, actions: [
      { at: 1, do: "point", target: "#landing h1" }, { at: 3, do: "zoom", target: ".flow", scale: 1.5 }, { at: 5, do: "point", target: ".flow li.bad" }, { at: 12, do: "unzoom" },
      { at: 13, do: "zoom", target: "#p-blocked", scale: 1.5 }, { at: 14, do: "point", target: "#p-blocked" }, { at: 18, do: "point", target: "#p-over" }, { at: 23.4, do: "unzoom" },
    ] }],
  },
  {
    id: "b3-purser", title: "Purser in one sentence",
    voice: "This is Purser. Every AI agent gets its own company card and its own on-chain mandate, with limits the CFO sets. And anything new waits for the CFO's Face ID.",
    shots: [{ path: "/?recorded&present", seconds: 15, actions: [
      { at: 1, do: "point", target: "#cards" }, { at: 2, do: "zoom", target: "#cards", scale: 1.3 }, { at: 7, do: "unzoom" },
      { at: 8, do: "scroll", target: "#budgets" }, { at: 9, do: "zoom", target: "#budgets", scale: 1.3 }, { at: 14, do: "unzoom" },
    ] }],
  },
  {
    id: "b4-card", title: "Wow 1: a company card and Face ID",
    voice: "Meet Northwind Outdoor. Its operations agent buys warehouse software on its own Airwallex card: approved. Then it needs the Pro plan, forty-five euros, on a card that allows thirty. Airwallex declines it. Not our code: the card itself. The agent asks for more. The CFO sees the exact terms on the phone, approves with Face ID, the new limit syncs to the card, and the same purchase goes through. Every step is in the audit log.",
    shots: [
      scene("card", 10),
      { path: "/?recorded&present", seconds: 12, actions: [{ at: 1, do: "point", target: "#cards" }, { at: 2, do: "zoom", target: "#cards", scale: 1.45 }, { at: 11, do: "unzoom" }] },
      { path: "/?recorded&agents&present", seconds: 13, actions: [{ at: 1, do: "point", target: "#agents .agent" }, { at: 2, do: "zoom", target: "#agents .agent .facts", scale: 1.4 }, { at: 12, do: "unzoom" }] },
      scene("faceid", 10),
    ],
  },
  {
    id: "b5-metal", title: "Wow 2: Metal refuses, and the Dispute desk",
    voice: "Now Metal. Our agents also pay per request, a few cents at a time, under mandates that live on chain. When the supplier doubles its price, our agent's own account refuses the payment. Nothing moves, and the customer isn't charged. Purser prices two options, Opus reviews them, and the CFO picks one. And when a customer says: our agent never ordered this, Northwind's Dispute desk checks what it can prove. Every order the customer's agent signed, every payment verified on chain inside the mandate the customer's owner bound. Twelve out of twelve. Not refunded, with a report the customer can check for themselves.",
    shots: [
      scene("refuse", 12),
      scene("dispute", 13),
      { path: "/?recorded&disputes&present", seconds: 16, actions: [{ at: 1, do: "point", target: "#disputes .bk table" }, { at: 2, do: "zoom", target: "#disputes .bk table", scale: 1.3 }, { at: 9, do: "unzoom" }, { at: 10, do: "scroll", target: "#disputes .review-box" }, { at: 11, do: "zoom", target: "#disputes .review-box", scale: 1.3 }, { at: 15, do: "unzoom" }] },
      { path: "/dispute-report", seconds: 14, actions: [{ at: 1, do: "zoom", target: ".outcome", scale: 1.6 }, { at: 6, do: "unzoom" }, { at: 7, do: "scroll", target: "table" }, { at: 8, do: "zoom", target: "table", scale: 1.25 }, { at: 13, do: "unzoom" }] },
    ],
  },
  {
    id: "b6-ask", title: "Wow 3: Ask Purser books a flight",
    voice: "Sometimes the CFO just needs something done. Book a flight to Berlin, at most a hundred and fifty euros. Purser reads it, checks it against the policy, and Airwallex issues a single-use card: airlines only, a hundred and fifty euros, until that day. One booking goes through. A second charge? Declined. The card closed itself.",
    shots: [
      { path: live("ask"), seconds: 24, actions: [{ at: 1, do: "zoom", target: ".vis svg", scale: 1.35 }, { at: 11, do: "zoom", target: ".facts", scale: 1.4 }, { at: 22, do: "unzoom" }] },
      { path: "/?recorded&agents&present", seconds: 16, actions: [
        { at: 1, do: "zoom", target: "#agents .agent:nth-of-type(3) .two", scale: 1.4 }, { at: 3, do: "point", target: "#agents .agent:nth-of-type(3) .two ul.plain li:nth-child(3)" }, { at: 14.5, do: "unzoom" },
      ] },
    ],
  },
  {
    id: "b7-trust", title: "Why you can trust it",
    voice: "Why trust it? Code decides; the models only read and advise. Our red team ran thirty-four attacks: fake invoices, prompt injection, forged approvals. All thirty-four were blocked. Above a threshold, two people must approve. One Face ID freezes every agent and every card. We mapped the controls to the EU AI Act, PSD2 and SOX-style duties. Our Scenario Lab replays eighteen situations end to end: all eighteen as expected. You can see what the AI costs: about nine cents for every thousand euros paid. And every payment lands in the books, double-entry and balanced.",
    shots: [
      { path: "/?present", seconds: 22, actions: [
        { at: 0.5, do: "zoom", target: "#redteam-line", scale: 1.7 }, { at: 1.5, do: "point", target: "#redteam-line" },
        { at: 6, do: "zoom", target: "#security .item:nth-child(2)", scale: 1.5 }, { at: 6.5, do: "point", target: "#security .item:nth-child(2) h3" },
        { at: 10.5, do: "zoom", target: "#security .item:nth-child(3)", scale: 1.5 }, { at: 11, do: "point", target: "#security .item:nth-child(3) h3" },
        { at: 15, do: "zoom", target: "#compliance-line", scale: 1.4 }, { at: 16, do: "point", target: "#compliance-line" }, { at: 20.5, do: "unzoom" },
      ] },
      { path: "/lab?present", seconds: 8, actions: [{ at: 0.5, do: "zoom", target: "#count", scale: 1.6 }, { at: 6.5, do: "unzoom" }] },
      { path: "/?recorded&present", seconds: 10, actions: [{ at: 0.5, do: "zoom", target: "#claude-panel", scale: 1.25 }, { at: 9, do: "unzoom" }] },
      { path: "/?recorded&books&present", seconds: 10, actions: [{ at: 0.5, do: "zoom", target: "#books .bk", scale: 1.25 }, { at: 9, do: "unzoom" }] },
    ],
  },
  {
    id: "b8-vision", title: "Vision",
    voice: "Every company will soon run agents that spend. Purser lets them move at machine speed while the finance team keeps the pen. Built on Airwallex and Metal, powered by Claude. Every euro has a proof.",
    shots: [scene("wall", 8), { path: live("end"), seconds: 17 }],
  },
];

export const beatSeconds = (b: Beat) => b.shots.reduce((s, x) => s + x.seconds, 0);
export const totalSeconds = () => BEATS.reduce((s, b) => s + beatSeconds(b), 0);

const stamp = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** English subtitles: each beat's words in short lines, spread over the beat by length. */
export function subtitlesSrt(): string {
  const out: string[] = [];
  let t = 0, n = 1;
  for (const b of BEATS) {
    const len = beatSeconds(b);
    const sentences = b.voice.match(/[^.!?:]+[.!?:]+/g) ?? [b.voice];
    const chunks = sentences.flatMap((s) => {
      const words = s.trim().split(/\s+/);
      const parts: string[] = [];
      for (let i = 0; i < words.length; i += 11) parts.push(words.slice(i, i + 11).join(" "));
      return parts;
    });
    const total = chunks.reduce((s, c) => s + c.length, 0);
    let at = t + 0.3;
    const usable = len - 0.6;
    for (const c of chunks) {
      const d = (c.length / total) * usable;
      out.push(`${n++}\n${stamp(at)} --> ${stamp(at + d - 0.05)}\n${c}\n`);
      at += d;
    }
    t += len;
  }
  return out.join("\n");
}

/** The script for Max to read, with the time each beat starts. */
export function scriptMarkdown(): string {
  let t = 0;
  const lines = [
    "# Purser: the video script (4:30)", "",
    "Read it over the silent master (`master.mp4`). Each beat starts at the time shown; the subtitles (`subtitles.srt`) carry the same words.",
    "About 150 words a minute leaves room to breathe.", "",
  ];
  for (const b of BEATS) {
    const m = Math.floor(t / 60), s = Math.round(t % 60);
    lines.push(`## ${m}:${String(s).padStart(2, "0")} ${b.title} (${beatSeconds(b)} s, clip \`${b.id}.mp4\`)`, "", b.voice, "");
    t += beatSeconds(b);
  }
  return lines.join("\n");
}
