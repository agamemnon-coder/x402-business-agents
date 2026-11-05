// The premiere's script: its sixteen scenes in order, how long each runs, what the picture is, where the music hits,
// and which scene is a recording slot Max fills (his closing line; his own Face ID and /try/sign recordings can still
// be laid in with --slot). There is no clip 02: the hook was cut (Max, 4 November), and the clips keep their numbers;
// the agents' intro (premiere v3) is 03b, right after the pen. The page (src/film/premiere.html)
// draws each scene for exactly its seconds; npm run video records one clip per scene from it and writes, from the same
// data, the subtitles, the read-aloud script and the script table (docs/video/premiere-script.md), so the words, the
// figures and the pictures cannot drift apart.

import type { Beat } from "../video/plan.js";
import type { PremiereData, VoiceLine } from "./premiere.js";

export interface PremiereScene {
  id: string;
  title: string;
  seconds: number;
  /** "render": the clip is the scene. "slot": a recording goes here; the clip is a stand-in, the overlay labels it. */
  kind: "render" | "slot";
  /** What the picture shows (the script table's picture column). */
  picture: string;
  /** The recording that fills a slot, and who makes it. */
  slot?: string;
  /** What the music does here. */
  music: string;
  /** Seconds to fade in from and out to the background (default 0.45 and 0.5); a black scene sets its own. */
  fade?: [number, number];
  /** The corner credits in the top bar ("Max Geurtsen · Purser", "Built on …"): on every scene but these. */
  credits?: false;
}

export const PREMIERE_SCENES: PremiereScene[] = [
  { id: "01-line", title: "One line", seconds: 3, kind: "render", music: "Silence.", fade: [0, 0], credits: false,
    picture: "Black. One line of white text fades in and out." },
  { id: "03-pen", title: "Who holds the pen?", seconds: 8, kind: "render", music: "The music starts, low and slow.",
    picture: "The question, then the title Purser with Purser's own pen mark." },
  { id: "03b-agents", title: "Three Claude agents", seconds: 16, kind: "render", music: "Low and slow, a soft pulse under each agent.",
    picture: "Three cards, one per agent, each with its Claude model and its job, read from the record; then the limits line, with the Face ID glyph." },
  { id: "04-architecture", title: "How Purser works", seconds: 13, kind: "render", music: "Slowly building.",
    picture: "The diagram builds left to right: agent → rules → person → Airwallex or Metal → books, a payment travelling along it as a soft light pulse; then a second pulse turns red and stops at Airwallex or Metal: the refusal. No logos." },
  { id: "05-price-rise", title: "The price rise, refused by Metal", seconds: 18, kind: "render", music: "Building.",
    picture: "The supplier's price as a line chart, rising from the old price to the new one across the mandate's cap (dashed); Metal's refusal appears as it crosses; the honest label; the refusal's transaction on chain." },
  { id: "06-dispute", title: "The dispute", seconds: 15, kind: "render", music: "Steady.",
    picture: "Twelve order chips, each checked “signed”; the three with wrong data turn “refunded”; the refund of the rest is stamped rejected with Face ID." },
  { id: "07-approval", title: "The approval card", seconds: 7, kind: "render", music: "Thins out.",
    picture: "A phone with the licence payment's approval card, drawn from its exact terms in the record, “Confirm with Face ID” at the bottom." },
  { id: "08-faceid", title: "Face ID", seconds: 8, kind: "render", music: "Almost silent: let the Face ID moment breathe.", fade: [0.3, 0.3],
    picture: "A rendered iPhone with P-0005's approval sheet (its exact terms from the record, as in 07): “Confirm with Face ID” is pressed, the Face ID glyph scans, then “Approved”. A slow camera push-in on the phone. Labelled the whole time as a reconstruction, with the real Face ID's time. (A portrait recording of a real Face ID can still be laid in: `npm run video -- --slot 08-faceid=<file>@<start>-<end>`.)" },
  { id: "09-six-seconds", title: "6 seconds to PAID", seconds: 12, kind: "render", music: "The first hit, on “6 seconds”.",
    picture: "The spec card: the seconds from Face ID to PAID, counting up to the record's figure, said plainly to be simulated in the sandbox; the five timestamps, SENT and PAID marked simulated; the transfer id; “Every id is on /proof”." },
  { id: "10-try-sign", title: "Your turn: /try/sign", seconds: 16, kind: "render", music: "Building again.",
    picture: "A mock of the live /try/sign page in a phone (drawn from its code) beside large captions; or Max's own portrait recording of the page in the same frame (`npm run video -- --slot 10-try-sign=<file>`; sped up to fit if longer, and then labelled so), or in an editor with the overlay `10-try-sign.png`.",
    slot: "Max's iPhone: signing on the live /try/sign page (docs/video/opnames-max.md, 3); the rendered mock is the fallback" },
  { id: "11-one-cent", title: "One cent. Worthless.", seconds: 8, kind: "render", music: "Hard cut to silence: no music, no voice.", fade: [0, 0.45],
    picture: "A slow camera push-in: the amount changes by one cent, its hash changes completely, the same signature is refused. “One cent. Worthless.”" },
  { id: "12-why-face-id", title: "Why Face ID, not a password", seconds: 12, kind: "render", music: "The music comes back, softly.",
    picture: "The question, then the answer in one sentence." },
  { id: "13-specs", title: "Spec cards", seconds: 16, kind: "render", music: "Rhythmic: one card on each beat.",
    picture: "Four fast cards, the big figures counting up to the record's: the tests, the hash-chained audit log, Metal's refusal and the CFO's rejection side by side, decisions by Claude." },
  { id: "14-real", title: "What's real, what's ours", seconds: 13, kind: "render", music: "Steady, lower.",
    picture: "Two columns: real (test money) and ours or simulated." },
  { id: "15-close", title: "Max's closing line", seconds: 14, kind: "slot", music: "Low, under Max's voice.",
    picture: "Max on camera with his name (overlay `15-close.png`), or his voice over the rendered card with the closing line.",
    slot: "Max on camera, or his voice only (docs/video/opnames-max.md, 2)" },
  { id: "16-end", title: "Try it yourself, and the credits", seconds: 13, kind: "render", music: "The last swell, resolving under the credits; fade out with the picture.", fade: [0.45, 1], credits: false,
    picture: "End card: “Try it yourself” and the /try/sign address, test money; after four seconds it gives way to the end credits (9 s, text only, no logos): thank you, built by, voice and music, test money only." },
];

/** Each scene with the second it starts in the film. */
export function premiereTimeline(): (PremiereScene & { start: number })[] {
  let start = 0;
  return PREMIERE_SCENES.map((s) => { const at = { ...s, start }; start += s.seconds; return at; });
}
export const premiereSeconds = () => PREMIERE_SCENES.reduce((n, s) => n + s.seconds, 0);
/** A scene's fades, in and out (seconds). */
export const sceneFade = (s: PremiereScene): [number, number] => s.fade ?? [0.45, 0.5];
/** What the page needs of each scene: when it runs, its fades, and whether the corner credits show. */
export const pageScenes = () => premiereTimeline().map((s) => ({ id: s.id, start: s.start, seconds: s.seconds, kind: s.kind, fade: sceneFade(s), credits: s.credits !== false }));
/** "2:56". */
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * What npm run video records: one clip per scene, each played from the second its scene starts, and one extra clip,
 * the end card naming an AI voice (used instead of 16-end only if the voice-over is AI-generated).
 */
export function premiereBeats(data: PremiereData): Beat[] {
  const beats: Beat[] = premiereTimeline().map((s) => ({ id: s.id, title: s.title, voice: (data.voice[s.id] ?? []).map((l) => l.text).join(" "), shots: [{ path: `/premiere?manual&from=${s.start}`, seconds: s.seconds }] }));
  const end = premiereTimeline().find((s) => s.id === "16-end")!;
  beats.push({ id: "16-end-ai-voice", title: "Try it yourself (AI voice credit)", voice: "", shots: [{ path: `/premiere?manual&from=${end.start}&credits=ai`, seconds: end.seconds }] });
  return beats;
}

/** The scenes in the master, in order (the AI-voice end card is a spare). */
export const MASTER_CLIPS = PREMIERE_SCENES.map((s) => s.id);
/** The recording slots, each with its overlay (letterbox bars and label, a transparent PNG). */
export const OVERLAYS = ["08-faceid", "10-try-sign", "15-close"] as const;

// ---- Words: a voice-over line lasts as long as it takes to say at an unhurried pace ----

const WPM = 150;
export const lineSeconds = (text: string) => (text.split(/\s+/).length / WPM) * 60;

const stamp = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** A line in cues of at most 11 words, split evenly (12 words make two cues of 6, never 11 and 1). */
function cues(text: string): string[] {
  const sentences = text.match(/[^.!?:]+[.!?:]+/g) ?? [text];
  const out = sentences.flatMap((s) => {
    const words = s.trim().split(/\s+/);
    const size = Math.ceil(words.length / Math.ceil(words.length / 11));
    const parts: string[] = [];
    for (let i = 0; i < words.length; i += size) parts.push(words.slice(i, i + size).join(" "));
    return parts;
  });
  // A sentence of a word or two ("Real:") joins its neighbour, so no cue blinks past.
  for (let i = 0; i < out.length; i++) {
    if (out.length > 1 && out[i]!.split(/\s+/).length < 3) {
      const j = i + 1 < out.length ? i + 1 : i - 1;
      out[j] = j > i ? `${out[i]} ${out[j]}` : `${out[j]} ${out[i]}`;
      out.splice(i, 1);
      i = -1;
    }
  }
  return out;
}

/** Every voice-over line with its place in the film: start and end in seconds, from the scene's start. */
export function voiceTimeline(data: PremiereData): { scene: string; who: VoiceLine["who"]; text: string; from: number; to: number }[] {
  const out: { scene: string; who: VoiceLine["who"]; text: string; from: number; to: number }[] = [];
  for (const s of premiereTimeline()) {
    const lines = data.voice[s.id] ?? [];
    lines.forEach((l, i) => {
      const next = i + 1 < lines.length ? s.start + lines[i + 1]!.at : s.start + s.seconds;
      out.push({ scene: s.id, who: l.who, text: l.text, from: s.start + l.at, to: Math.min(next - 0.1, s.start + l.at + lineSeconds(l.text) + 0.4) });
    });
  }
  return out;
}

/** The subtitle cues on the script's times: each voice-over line in short cues, spread over the line by length. */
export function premiereCues(data: PremiereData): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  for (const l of voiceTimeline(data)) {
    const parts = cues(l.text);
    const total = parts.reduce((k, c) => k + c.length, 0);
    let at = l.from;
    for (const c of parts) {
      const d = (c.length / total) * (l.to - l.from);
      out.push({ from: at, to: at + d - 0.05, text: c });
      at += d;
    }
  }
  return out;
}

/** English subtitles (out/video/subtitles.srt, docs/video/subtitles.srt): text only. */
export function premiereSrt(data: PremiereData): string {
  return premiereCues(data).map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join("\n");
}

/** The voice-over to read aloud, with the second each line starts (out/video/script.md, docs/video/script.md). */
export function premiereReadAloud(data: PremiereData): string {
  const total = premiereSeconds();
  const words = voiceTimeline(data).reduce((k, l) => k + l.text.split(/\s+/).length, 0);
  const lines = [
    `# Purser, the premiere: the voice-over (${clock(total)})`, "",
    "Generated by `npm run video` from `src/film/premiere.ts` (the words and figures) and `src/film/premiereScript.ts` (the times); the script with its pictures and sources is [premiere-script.md](premiere-script.md).",
    `Each line starts at the time shown. ${words} words in ${clock(total)}: calm, with the silences left in. Max reads every line in his own voice; **Max:** marks his own two lines, said as himself (the opening and the closing). The spare end card \`16-end-ai-voice.mp4\`, which credits an AI-generated voice, is not used.`, "",
  ];
  for (const s of premiereTimeline()) {
    const vs = data.voice[s.id] ?? [];
    lines.push(`## ${clock(s.start)} ${s.title} (${s.seconds} s, clip \`${s.id}.mp4\`)`, "");
    if (!vs.length) lines.push(s.id === "11-one-cent" ? "*Silence: no voice, no music.*" : "*No voice-over.*", "");
    for (const v of vs) lines.push(`- ${clock(s.start + v.at)}${v.who === "Max" ? " **Max:**" : ""} ${v.text}`);
    if (vs.length) lines.push("");
  }
  return lines.join("\n");
}

/** One table cell: Markdown that stays in its cell. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

/** What a scene shows, in words, from the strings the page draws. */
function onScreen(id: string, sc: Record<string, unknown>): string {
  const q = (s: unknown) => `“${String(s).replace(/^“|”$/g, "")}”`;
  const list = (a: unknown) => (a as unknown[]).map((x) => (Array.isArray(x) ? x.join(": ") : String(x)));
  switch (id) {
    case "01-line": return q(sc.line);
    case "03-pen": return `${q(sc.question)} → **${sc.title}** · ${sc.sub}`;
    case "03b-agents": return [`**${sc.head}**`, ...(sc.agents as { name: string; model: string; job: string }[]).map((a) => `**${a.name}** · ${a.model}: ${a.job}`), `${sc.limits} ${sc.beyond}`].join("\n");
    case "04-architecture": return (sc.nodes as { t: string; s: string }[]).map((x) => `**${x.t}** (${x.s})`).join(" → ");
    case "05-price-rise": return [sc.kicker, `${sc.supplier} ${sc.rise}: **${sc.from} → ${sc.to}** ${sc.unit}`, sc.cap, q(sc.letThrough), `**${sc.refused}** ${sc.reason}`, `${sc.txLabel}: \`${sc.txFull}\` (${sc.txWhere})`, `Footnote, the run's own label: ${q(sc.label)}`].join("\n");
    case "06-dispute": return [sc.kicker, q(sc.claim), `Orders ${list(sc.orders).join(" ")}: ${sc.signed}`, `${list(sc.refunded).join(", ")}: ${sc.refundLine}`, `${sc.rest} → **${sc.rejected}** (${sc.rejectedWhen})`].join("\n");
    case "07-approval": return [`Phone: ${sc.pid}; ${q(sc.what)}`, ...list(sc.rows), `${sc.hashLabel} \`${sc.hash}\`; button ${q(sc.button)}`, `Beside it: ${list(sc.side).join(" ")}`, `Caption: ${sc.caption}`].join("\n");
    case "08-faceid": return [`Phone: ${sc.pid}; ${q(sc.what)}; ${q(sc.button)} → ${q(sc.approved)}`, `Beside it: ${list(sc.side).join(" ")} ${sc.when}`, `Label, the whole scene: ${q(sc.recon)}`].join("\n");
    case "09-six-seconds": return [`**${sc.big} ${sc.unit}** ${sc.line}`, `**${sc.simulated}**`, ...list(sc.steps).map((x) => `${x.replace(": ", " UTC: ")}`), `${sc.transferLabel} \`${sc.transfer}\` · ${sc.detail}`, `**${sc.look}** (${sc.where})`, `Footnote: ${sc.foot}`].join("\n");
    case "10-try-sign": return [`Label ${q(sc.label)} · ${sc.url}`, `Phone (mock): ${q(sc.h1)}; ${sc.agent} (${sc.tag}): ${q(sc.says)}`, ...list(sc.facts), `${q(sc.check)}; ${q(sc.sign)} → ${q(sc.verified)}, ${q(sc.executed)} → ${q(sc.tamper)}`, `Captions: ${list(sc.side).join(" ")}`, `Under the phone: ${sc.mockNote}`].join("\n");
    case "11-one-cent": return [`**${sc.from}** ${sc.plus} → **${sc.to}**`, sc.hashes, q(sc.refused), `**${q(sc.last)}**`].join("\n");
    case "12-why-face-id": return `**${sc.q}**\n${list(sc.a).join(" ")}`;
    case "13-specs": return (sc.cards as { big: string; label: string; small: string }[]).map((c) => `**${c.big}** ${c.label} (${c.small})`).join("\n");
    case "14-real": return `**${sc.realHead}** (${sc.realNote}): ${list(sc.real).join(", ")}\n**${sc.oursHead}:** ${list(sc.ours).join(", ")}`;
    case "15-close": return `Fallback card: ${list(sc.lines).join(" ")}\nName (on camera): ${sc.name} · ${sc.role}`;
    case "16-end": return `**${sc.cta}** · ${sc.url}\n${sc.foot}\n${sc.mark}\nEnd credits: ${(sc.roll as [string, string][]).map((r) => r.filter(Boolean).join(" ")).join(" · ")} · ${q((sc.credits as { max: string }).max)} (or, with an AI voice, clip \`16-end-ai-voice.mp4\`: ${q((sc.credits as { ai: string }).ai)}) · ${sc.last}`;
    default: return "";
  }
}

/** The facts each scene shows or says, by key (the source column). */
const USES: Record<string, string[]> = {
  "03b-agents": ["run.agents", "specs.byClaude", "specs.decisions", "team.sourcingModel", "team.sourcingJob", "team.supportModel", "team.supportJob", "team.treasuryModel", "team.treasuryJob"],
  "05-price-rise": ["run.day", "run.agents", "price.supplier", "price.old", "price.new", "price.cap", "price.query", "price.reason", "price.tx", "price.txAt", "price.explorer", "price.label"],
  "06-dispute": ["dispute.customer", "dispute.claim", "dispute.orders", "dispute.count", "dispute.signed", "dispute.refunded", "dispute.refundCount", "dispute.refundTotal", "dispute.rest", "dispute.proposal", "dispute.rejectedAt"],
  "07-approval": ["licence.proposal", "licence.vendor", "licence.amount", "licence.method", "licence.invoice", "licence.fxBuy", "licence.fxSell", "licence.feeMax", "licence.by", "licence.model", "licence.expires", "licence.hash"],
  "08-faceid": ["licence.proposal", "licence.vendor", "licence.amount", "licence.method", "licence.invoice", "licence.fxBuy", "licence.fxSell", "licence.feeMax", "licence.by", "licence.model", "licence.expires", "licence.hash", "paid.faceAt"],
  "09-six-seconds": ["paid.seconds", "paid.faceAt", "paid.fxAt", "paid.createdAt", "paid.sentAt", "paid.paidAt", "paid.simulated", "paid.transfer", "paid.fee", "paid.conversion"],
  "10-try-sign": ["try.proposal", "try.amount", "try.aloneLimit", "try.hash"],
  "11-one-cent": ["try.amount", "try.tampered", "try.hash", "try.tamperedHash"],
  "13-specs": ["specs.tests", "specs.files", "specs.auditRows", "specs.stopped", "specs.stoppedMetal", "specs.stoppedCfo", "specs.stoppedAirwallex", "specs.decisions", "specs.byClaude", "specs.fallbacks", "specs.sourcing", "specs.support", "specs.treasury"],
};
export const factsUsed = (id: string) => USES[id] ?? [];

/** No figure: where the scene's words come from instead. */
const WORDS_FROM: Record<string, string> = {
  "01-line": "Max's structure (no figure).",
  "03-pen": "No figure. Max's opening (docs/video/max-opening-close.md).",
  "04-architecture": "No figure. The books: Purser's own double-entry books (src/accounting/); the film shows no booking in an outside accounting system.",
  "12-why-face-id": "No figure. The reason: docs/phone-approval.md (\"The passkey signs the SHA-256 of the exact terms … any change after signing makes it worthless\"); README.md, Words (\"the CFO's Face ID signs that hash\"). \"Password\", not \"PIN\": a passkey may itself be unlocked with the device's PIN, or Touch ID (README.md, Try it yourself); what counts is that it signs these exact terms, so the film does not say Face ID is required.",
  "14-real": "No figure. README.md, \"What is real, what is mock\"; docs/claims.md (the second approver: `SECOND_APPROVER` in src/config/brand.ts).",
  "15-close": "No figure. Max's closing (docs/video/max-opening-close.md, \"Slot\"); what it says of the run: see the 13-specs and 05–09 rows, and the Face ID decisions below.",
  "16-end": "No figure. The address: the hosted /try/sign (live since 4 November). The credits: who the film thanks and who made it (Max, premiere v3); the music: Mixkit track 124, Mixkit Stock Music Free License.",
};

/** The script table (docs/video/premiere-script.md): time | clip | picture | text on screen | voice-over | sources. */
export function premiereTable(data: PremiereData): string {
  const total = premiereSeconds();
  const lines = [
    `# Purser, the premiere: the script (${clock(total)})`, "",
    "**Generated** by `npm run video -- --docs` from `src/film/premiere.ts` and `src/film/premiereScript.ts`; edit those, not this file",
    "(`test/premiere.test.ts` fails when it is out of date). The same code draws the film (`src/film/premiere.html`, recorded",
    "at 1920×1080 and 60 frames a second, letterboxed to 2.39:1), writes the subtitles and the read-aloud script, and",
    "stops the build when a figure is missing from its source.", "",
    `One run only: the main run of 3 November 2026 in world \`main-1\` ([run log](../runs/2026-11-03-main-run.md)). Every figure about the run is read from its record, \`docs/demo/main-run.json\`; the test count from the README's test line; the /try/sign mock's figures from that page's own code. Test money throughout: the Airwallex sandbox and Metal testnet. Total ${clock(total)}.`, "",
    "How to cut it, where the music goes and what Max records: [README.md](README.md) and [opnames-max.md](opnames-max.md).", "",
    "| Time | Clip | Picture | Text on screen | Voice-over | Source of each figure |",
    "|---|---|---|---|---|---|",
  ];
  for (const s of premiereTimeline()) {
    const sc = data.screen[s.id] ?? {};
    const vo = (data.voice[s.id] ?? []).map((v) => `${v.who === "Max" ? "**Max:** " : ""}${v.text}`).join("\n") || (s.id === "11-one-cent" ? "*Silence.*" : "—");
    const used = factsUsed(s.id).map((k) => `${k.replace(/^\w+\./, "")} = \`${data.facts[k]!.value.length > 70 ? `${data.facts[k]!.value.slice(0, 67)}…` : data.facts[k]!.value}\`: ${data.facts[k]!.source}`);
    const src = used.length ? used.join("\n") : WORDS_FROM[s.id] ?? "";
    const pic = `${s.kind === "slot" ? "**Slot.** " : ""}${s.picture}${s.slot ? `\nRecording: ${s.slot}.` : ""}`;
    lines.push(`| ${clock(s.start)}–${clock(s.start + s.seconds)} | \`${s.id}.mp4\` (${s.seconds} s) | ${cell(pic)} | ${cell(onScreen(s.id, sc))} | ${cell(vo)} | ${cell(src)} |`);
  }
  lines.push("", "## Checked against the run", "",
    `- **${data.facts["paid.seconds"]!.value} seconds from Face ID to PAID:** ${data.facts["paid.seconds"]!.source}. The run log's timings say the same. PAID is the sandbox's status, and the settlement is simulated: Purser moves the transfer to SENT and then PAID itself, through Airwallex's sandbox simulation API (\`settleInSandbox\`, src/executors/invoicePayment.ts). The scene says so on screen and in the voice-over, and points to /proof instead of asking anyone to look the sandbox id up.`,
    `- **Metal ${data.facts["specs.stoppedMetal"]!.value} + the CFO ${data.facts["specs.stoppedCfo"]!.value}:** the spec card says the two stops as what they were (Metal refused a purchase over its cap; the CFO rejected a proposal), with Airwallex ${data.facts["specs.stoppedAirwallex"]!.value}; together the ${data.facts["specs.stopped"]!.value} stopped at a limit that the site, the README and the video script count (\`test/premiere.test.ts\` compares it with \`src/redesign/run.ts\`). Not in the film, because it is another run's: the line the site shows below that figure, about the separate TAP run of 2 November.`,
    `- **The tests:** the README's test line, read when the film is built (${data.facts["specs.tests"]!.value} tests in ${data.facts["specs.files"]!.value} files when this file was generated). Render the spec cards again after the README's line changes: \`npm run video -- 13-specs\`.`,
    `- **Max's closing line** ("Claude decided … I signed only what went beyond them"): ${data.facts["specs.byClaude"]!.value} of ${data.facts["specs.decisions"]!.value} decisions by Claude; ${data.facts["run.faceIds"]!.value} decisions with Max's Face ID (${data.facts["run.faceIds"]!.source}).`,
    "- **Face ID (08) is a reconstruction:** the rendered approval sheet carries P-0005's exact terms from the record, and says on screen that it is a reconstruction and when the real Face ID was (the record's `proposal.approved`). Max's own recording of a real Face ID can still be laid in with `--slot`.",
    "- **Face ID, not a password:** the reason is the docs' own (docs/phone-approval.md); \"password\", because a passkey may itself be unlocked with a PIN. The film does not say the server proves Face ID: /try/sign checks no attestation (docs/claims.md), so it says the server checks the signature.",
    "- **Kept out:** logos of others, any seal of approval, safety counts, and other runs' figures.", "");
  return lines.join("\n");
}
