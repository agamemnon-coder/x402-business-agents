// The premiere's script (film v5, 2:42): its eighteen scenes in order, how long each runs and what the picture is. The
// final film is the rendered clips only (a portrait phone recording can still be laid into 08 or 11 with --slot; the
// final film uses none). The voice-over is the narrator's script (docs/video/narrator-script.md), read by an
// AI-generated voice (ElevenLabs) in the third person; the music, AI-generated (ElevenLabs), is mixed afterwards, to
// the scene times in scenes-v5.json. The page (src/film/premiere.html)
// draws each scene for exactly its seconds; npm run video records one clip per scene from it and writes, from the same
// data, the subtitles, the read-aloud script and the script table (docs/video/premiere-script.md), so the words, the
// figures and the pictures cannot drift apart.

import type { Beat } from "../video/plan.js";
import { SCENE_SECONDS, speechSeconds, type PremiereData, type VoiceLine } from "./premiere.js";

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
  /** Where each card starts, in seconds from the scene's start (the spec cards: one card on each beat). */
  beats?: number[];
}

export const PREMIERE_SCENES: PremiereScene[] = [
  { id: "01-hook", title: "The hook", seconds: 6, kind: "render", music: "None in this render (v5: the music is mixed afterwards).", fade: [0, 0], credits: false,
    picture: "Black, a beat of silence, then “AI agents can now spend money.” slams in, large; a hard cut to “So who signs off?”, large, still on black, a pen stroke drawing itself under it." },
  { id: "02-purser", title: "Purser", seconds: 4, kind: "render", music: "None in this render.", fade: [0, 0.5],
    picture: "A straight cut to the wordmark: Purser's own pen mark, the name wiped in, a line drawn under it, and the core line in two lines." },
  { id: "03-agents", title: "Three Claude agents", seconds: 10, kind: "render", music: "None in this render.",
    picture: "Three cards come in 0.7 s apart, one per agent, and each is lit for 3 s in turn: its name, its Claude model and its job, and the limits that hold it: its own Airwallex card and its own Metal mandate, each with the record's figures as the run began; then the limits line." },
  { id: "04-how", title: "How Purser works", seconds: 8, kind: "render", music: "None in this render.",
    picture: "The diagram builds left to right: agent → rules → person → Airwallex or Metal → books, a payment travelling along it as a soft light pulse; then a second pulse turns red at Airwallex or Metal: the box flashes red, “Refused at the limit” under it, both gone within a second. No logos." },
  { id: "05-price", title: "The price rise, refused by Metal", seconds: 12, kind: "render", music: "None in this render.",
    picture: "The supplier's price as a line chart, rising from the old price to the new one across the mandate's cap (dashed); Metal's refusal appears as it crosses; the honest label; the refusal's transaction on chain." },
  { id: "05b-treasury", title: "Treasury's two options", seconds: 8, kind: "render", music: "None in this render.",
    picture: "Treasury's two plans side by side, each within the same total: A (the Sourcing agent's cap up, our price unchanged) and B (our price up); then A is signed with Face ID, with the time, and a small honest line that a labelled test passkey co-signed it." },
  { id: "06-metal", title: "Every Metal payment on chain", seconds: 8, kind: "render", music: "None in this render.",
    picture: "A spec card: the run's Metal payments, counting up to the record's figure, each its own transaction on Metal testnet, no emulator; small under it, the mandate transactions and the refusal on chain." },
  { id: "07-dispute", title: "The dispute", seconds: 10, kind: "render", music: "None in this render.",
    picture: "Twelve order chips, each checked “signed”; the three with wrong data turn “refunded”; the refund of the rest is stamped rejected with Face ID." },
  { id: "08-faceid", title: "Face ID", seconds: 8, kind: "render", music: "None in this render.", fade: [0.3, 0.3],
    picture: "A rendered iPhone with P-0005's approval sheet, its exact terms and their hash from the record: “Confirm with Face ID” is pressed, the Face ID glyph scans, then “Approved”. A slow camera push-in on the phone. Labelled the whole time as a reconstruction, with the real Face ID's time. The final film uses this reconstruction." },
  { id: "09-six", title: "6 seconds to PAID", seconds: 10, kind: "render", music: "None in this render; the drop goes on its cut.",
    picture: "The spec card: the seconds from Face ID to PAID, counting up to the record's figure from the cut, said plainly to be simulated in the sandbox; the five timestamps, SENT and PAID marked simulated; the transfer id; “Every id is on /proof”." },
  { id: "10-why", title: "Why Face ID, not a password", seconds: 10, kind: "render", music: "None in this render.",
    picture: "The question, then the answer in one sentence." },
  { id: "11-turn", title: "Your turn: /try/sign", seconds: 7, kind: "render", music: "None in this render.",
    picture: "A mock of the live /try/sign page in a phone (drawn from its code) beside large captions, labelled as a mock. The final film uses this mock." },
  { id: "12-tamper", title: "One cent. Worthless.", seconds: 8, kind: "render", music: "None in this render; leave the second before “One cent. Worthless.” silent.", fade: [0, 0.45],
    picture: "A slow camera push-in: the amount changes by one cent, its hash changes completely, the same signature is refused; a second of silence; then “One cent. Worthless.”" },
  { id: "13-proof", title: "The proof", seconds: 13, kind: "render", music: "None in this render.", beats: [0, 2.6],
    picture: "Two cards: decisions by Claude, counting up; then the run's stops, the figure with “nothing paid over a limit” beside it, and who stopped what in four rows, each coming in as the voice names it." },
  { id: "13b-value", title: "The agents do the work", seconds: 4, kind: "render", music: "None in this render.",
    picture: "One large line: “The agents do the work. The CFO signs only the exceptions.”" },
  { id: "14-real", title: "What's real, what's ours", seconds: 10, kind: "render", music: "None in this render.",
    picture: "Two columns: real (test money) and ours or simulated." },
  { id: "15-close", title: "The closing line", seconds: 13, kind: "render", music: "None in this render.",
    picture: "The rendered ending, under the narrator's closing line, mirrors the intro: the three beats one by one, the closing line in two lines, then the intro's wordmark lockup with “Starter Kit 11” under it; Max's name and role lower left." },
  { id: "16-end", title: "Try it yourself, and the credits", seconds: 13, kind: "render", music: "None in this render.", fade: [0.45, 1], credits: false,
    picture: "End card: “Try it yourself” and the /try/sign address, test money; after four seconds it gives way to the end credits (9 s, text only, no logos): who does what (built by Max Geurtsen; Airwallex, Metal and Claude by Anthropic, each with its role), the thanks, the AI-generated voice and music, test money only." },
];

// The scene lengths are Max's (SCENE_SECONDS, film v5), and the voice-over is timed in them: they must agree.
for (const s of PREMIERE_SCENES) if (SCENE_SECONDS[s.id] !== s.seconds) throw new Error(`premiere: ${s.id} is ${s.seconds} s here and ${SCENE_SECONDS[s.id]} s in SCENE_SECONDS`);
if (Object.keys(SCENE_SECONDS).join() !== PREMIERE_SCENES.map((s) => s.id).join()) throw new Error("premiere: the scenes and SCENE_SECONDS list different scenes");

/** Each scene with the second it starts in the film. */
export function premiereTimeline(): (PremiereScene & { start: number })[] {
  let start = 0;
  return PREMIERE_SCENES.map((s) => { const at = { ...s, start }; start += s.seconds; return at; });
}
export const premiereSeconds = () => PREMIERE_SCENES.reduce((n, s) => n + s.seconds, 0);
/** A scene's fades, in and out (seconds). */
export const sceneFade = (s: PremiereScene): [number, number] => s.fade ?? [0.45, 0.5];
/** What the page needs of each scene: when it runs, its fades, and whether the corner credits show. */
export const pageScenes = () => premiereTimeline().map((s) => ({ id: s.id, start: s.start, seconds: s.seconds, kind: s.kind, fade: sceneFade(s), credits: s.credits !== false, ...(s.beats ? { beats: s.beats } : {}) }));
/** "2:56". */
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** What npm run video records: one clip per scene, each played from the second its scene starts. */
export function premiereBeats(data: PremiereData): Beat[] {
  return premiereTimeline().map((s) => ({ id: s.id, title: s.title, voice: (data.voice[s.id] ?? []).map((l) => l.text).join(" "), shots: [{ path: `/premiere?manual&from=${s.start}`, seconds: s.seconds }] }));
}

/** The scenes in the master, in order. */
export const MASTER_CLIPS = PREMIERE_SCENES.map((s) => s.id);
/** The scenes a portrait recording can still be laid into, each with its overlay (letterbox bars and label, a
 * transparent PNG). The final film lays in none. */
export const OVERLAYS = ["08-faceid", "11-turn"] as const;

/** The scene times for the mix (scenes-v5.json): each scene's id, start and end, in seconds. */
export const scenesJson = () => premiereTimeline().map((s) => ({ id: s.id, start: s.start, end: s.start + s.seconds }));

// ---- Words: a voice-over line lasts as long as it takes to say at an unhurried pace ----

/** How long a line takes to say, at the narrator's calm pace (about 2.5 words a second). */
export const lineSeconds = speechSeconds;

const stamp = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** A line in cues of at most 11 words, split evenly (12 words make two cues of 6, never 11 and 1). */
function cues(text: string): string[] {
  // A stop inside a word ("I.D.") does not end the sentence; one before a space does.
  const sentences = text.match(/(?:[^.!?:]|[.!?:](?=\S))+[.!?:]+/g) ?? [text];
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
      out.push({ scene: s.id, who: l.who, text: l.text, from: s.start + l.at, to: Math.min(next - 0.1, s.start + l.at + l.seconds + 0.4) });
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
    `Each line starts at the time shown. ${words} words in ${clock(total)}: calm, with the silences left in. The narrator is an AI-generated voice (ElevenLabs), speaking in the third person; it reads every line of [narrator-script.md](narrator-script.md), and the music is AI-generated too (ElevenLabs), as the end card credits both. The times are the scenes' (scenes-v5.json), each line about half a second in.`, "",
  ];
  for (const s of premiereTimeline()) {
    const vs = data.voice[s.id] ?? [];
    lines.push(`## ${clock(s.start)} ${s.title} (${s.seconds} s, clip \`${s.id}.mp4\`)`, "");
    if (!vs.length) lines.push("*No voice-over.*", "");
    for (const v of vs) lines.push(`- ${clock(s.start + v.at)} **${v.who}:** ${v.text}`);
    if (vs.length) lines.push("");
  }
  return lines.join("\n");
}

/** One table cell: Markdown that stays in its cell. */
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "<br>");

/** What a scene shows, in words, from the strings the page draws. */
function onScreen(id: string, sc: Record<string, unknown>): string {
  const q = (s: unknown) => `“${String(s).replace(/^“|”$/g, "")}”`;
  const list = (a: unknown) => (a as unknown[]).map((x) => (Array.isArray(x) ? x.join(": ") : String(x)));
  switch (id) {
    case "01-hook": return `${q(sc.line)} → ${q(sc.question)}`;
    case "02-purser": return `**${sc.title}** · ${list(sc.core).join(" ")} · ${sc.sub}`;
    case "03-agents": return [`**${sc.head}**`, ...(sc.agents as { name: string; model: string; job: string; card: string; mandate: string }[]).map((a) => `**${a.name}** · ${a.model}: ${a.job} · ${sc.cardLabel}: ${a.card} · ${sc.mandateLabel}: ${a.mandate}`), `${sc.note}`, `${sc.limits}`].join("\n");
    case "04-how": return `${(sc.nodes as { t: string; s: string }[]).map((x) => `**${x.t}** (${x.s})`).join(" → ")}\nThe refused payment: the Airwallex or Metal box flashes red, ${q(sc.refusedTag)} under it`;
    case "05b-treasury": return [sc.kicker, ...(sc.options as { tag: string; id: string; lines: string[] }[]).map((o) => `**${o.tag}** ${o.id}: ${o.lines.join(", ")}`), `${sc.within} ${sc.unit}`, `${sc.signed}: ${sc.signedWhen}`, `Small: ${sc.second}`].join("\n");
    case "06-metal": return `**${sc.big}** ${sc.label} · ${sc.line}\n${sc.small}`;
    case "05-price": return [sc.kicker, `${sc.supplier} ${sc.rise}: **${sc.from} → ${sc.to}** ${sc.unit}`, sc.cap, q(sc.letThrough), `**${sc.refused}** ${sc.reason}`, `${sc.txLabel}: \`${sc.txFull}\` (${sc.txWhere})`, `Footnote, the run's own label: ${q(sc.label)}`].join("\n");
    case "07-dispute": return [sc.kicker, q(sc.claim), `Orders ${list(sc.orders).join(" ")}: ${sc.signed}`, `${list(sc.refunded).join(", ")}: ${sc.refundLine}`, `${sc.rest} → **${sc.rejected}** (${sc.rejectedWhen})`].join("\n");
    case "08-faceid": return [`Phone: ${sc.pid}; ${q(sc.what)}; ${q(sc.button)} → ${q(sc.approved)}`, `Beside it: ${list(sc.side).join(" ")} ${sc.when}`, `Label, the whole scene: ${q(sc.recon)}`].join("\n");
    case "09-six": return [`**${sc.big} ${sc.unit}** ${sc.line}`, `**${sc.simulated}**`, ...list(sc.steps).map((x) => `${x.replace(": ", " UTC: ")}`), `${sc.transferLabel} \`${sc.transfer}\` · ${sc.detail}`, `**${sc.look}** (${sc.where})`, `Footnote: ${sc.foot}`].join("\n");
    case "11-turn": return [`Label ${q(sc.label)} · ${sc.url}`, `Phone (mock): ${q(sc.h1)}; ${sc.agent} (${sc.tag}): ${q(sc.says)}`, ...list(sc.facts), `${q(sc.check)}; ${q(sc.sign)} → ${q(sc.verified)}, ${q(sc.executed)} → ${q(sc.tamper)}`, `Captions: ${list(sc.side).join(" ")}`, `Under the phone: ${sc.mockNote}`].join("\n");
    case "12-tamper": return [`**${sc.from}** ${sc.plus} → **${sc.to}**`, sc.hashes, q(sc.refused), `**${q(sc.last)}**`].join("\n");
    case "10-why": return `**${sc.q}**\n${list(sc.a).join(" ")}`;
    case "13-proof": return (sc.cards as { big?: string; label?: string; small?: string; figure?: string; sub?: string; rows?: { big: string; label: string }[] }[])
      .map((c) => (c.rows ? `**${c.figure}** · ${c.sub}: ${c.rows.map((r) => `**${r.big}** ${r.label}`).join(" | ")}` : `**${c.big}** ${c.label} (${c.small})`)).join("\n");
    case "13b-value": return `**${list(sc.line).join(" ")}**`;
    case "14-real": return `**${sc.realHead}** (${sc.realNote}): ${list(sc.real).join(", ")}\n**${sc.oursHead}:** ${list(sc.ours).join(", ")}`;
    case "15-close": return `${list(sc.beats).join(" / ")} → ${list(sc.line).join(" ")} → **${sc.title}** (the intro's wordmark) · ${sc.sub}\nLower left: ${sc.name} · ${sc.role}`;
    case "16-end": return `**${sc.cta}** · ${sc.url}\n${sc.foot}\n${sc.mark}\nEnd credits, ${sc.head}: ${(sc.roll as [string, string][]).map((r) => `**${r[0]}**: ${r[1]}`).join(" · ")} · ${sc.thanks} · ${q(sc.credit)} · ${sc.last}`;
    default: return "";
  }
}

/** The facts each scene shows or says, by key (the source column). */
const USES: Record<string, string[]> = {
  "03-agents": ["run.agents", "specs.byClaude", "specs.decisions", "team.sourcingModel", "team.sourcingJob", "team.sourcingCard", "team.sourcingMandate", "team.supportModel", "team.supportJob", "team.supportCard", "team.supportMandate", "team.treasuryModel", "team.treasuryJob", "team.treasuryCard", "team.treasuryMandate"],
  "05b-treasury": ["treasury.at", "treasury.a", "treasury.b", "treasury.aCap", "treasury.aPrice", "treasury.bPrice", "treasury.total", "treasury.signedAt", "treasury.cosigner"],
  "06-metal": ["metal.payments", "metal.mandates", "metal.chainRefusals"],
  "05-price": ["run.day", "run.agents", "price.supplier", "price.old", "price.new", "price.cap", "price.query", "price.reason", "price.tx", "price.txAt", "price.explorer", "price.label"],
  "07-dispute": ["dispute.customer", "dispute.claim", "dispute.orders", "dispute.count", "dispute.signed", "dispute.refunded", "dispute.refundCount", "dispute.refundTotal", "dispute.rest", "dispute.proposal", "dispute.rejectedAt"],
  "08-faceid": ["licence.proposal", "licence.vendor", "licence.amount", "licence.method", "licence.invoice", "licence.fxBuy", "licence.fxSell", "licence.feeMax", "licence.by", "licence.model", "licence.expires", "licence.hash", "paid.faceAt"],
  "09-six": ["paid.seconds", "paid.faceAt", "paid.fxAt", "paid.createdAt", "paid.sentAt", "paid.paidAt", "paid.simulated", "paid.transfer", "paid.fee", "paid.conversion"],
  "11-turn": ["try.proposal", "try.amount", "try.aloneLimit", "try.hash"],
  "12-tamper": ["try.amount", "try.tampered", "try.hash", "try.tamperedHash"],
  "13-proof": ["specs.decisions", "specs.byClaude", "specs.fallbacks", "specs.sourcing", "specs.support", "specs.treasury", "specs.stops", "specs.overLimit", "specs.stopsClaude", "specs.stopsMetal", "specs.stopsCfo", "specs.stopsPlanted"],
};
export const factsUsed = (id: string) => USES[id] ?? [];

/** No figure: where the scene's words come from instead. */
const WORDS_FROM: Record<string, string> = {
  "01-hook": "No figure. The hook, as Max wrote it for the film (5 November).",
  "13b-value": "No figure. Max's line for the film (v5): the agents do the work, the CFO signs only the exceptions.",
  "02-purser": "No figure. Who built it, as the README's \"Who does what\" says; the core line under the wordmark is the README's first line, word for word.",
  "04-how": "No figure. The books: Purser's own double-entry books (src/accounting/); the film shows no booking in an outside accounting system.",
  "10-why": "No figure. The reason: docs/phone-approval.md (\"The passkey signs the SHA-256 of the exact terms … any change after signing makes it worthless\"); README.md, Words (\"the CFO's Face ID signs that hash\"). \"Password\", not \"PIN\": a passkey may itself be unlocked with the device's PIN, or Touch ID (README.md, Try it yourself); what counts is that it signs these exact terms, so the film does not say Face ID is required.",
  "14-real": "No figure. README.md, \"What is real, what is mock\"; docs/claims.md (the second approver: `SECOND_APPROVER` in src/config/brand.ts).",
  "15-close": "No figure. The closing line (docs/video/narrator-script.md, 15-close); what it says of the run: see the 13-proof and 05–09 rows, and the Face ID decisions below.",
  "16-end": "No figure. The address: the hosted /try/sign (live since 4 November). The credits: who does what, as README.md (\"Who does what\") and docs/claims.md have it; the voice-over and the music of the final film, both AI-generated (ElevenLabs).",
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
    "How to cut it and where the music goes: [README.md](README.md). The voice-over is an AI-generated voice (ElevenLabs) reading [narrator-script.md](narrator-script.md) in the third person; the music is AI-generated (ElevenLabs); the film needs no recording of Max.", "",
    "| Time | Clip | Picture | Text on screen | Voice-over | Source of each figure |",
    "|---|---|---|---|---|---|",
  ];
  for (const s of premiereTimeline()) {
    const sc = data.screen[s.id] ?? {};
    const vo = (data.voice[s.id] ?? []).map((v) => `**${v.who}:** ${v.text}`).join("\n") || "—";
    const used = factsUsed(s.id).map((k) => `${k.replace(/^\w+\./, "")} = \`${data.facts[k]!.value.length > 70 ? `${data.facts[k]!.value.slice(0, 67)}…` : data.facts[k]!.value}\`: ${data.facts[k]!.source}`);
    const src = used.length ? used.join("\n") : WORDS_FROM[s.id] ?? "";
    const pic = `${s.kind === "slot" ? "**Slot.** " : ""}${s.picture}${s.slot ? `\nRecording: ${s.slot}.` : ""}`;
    lines.push(`| ${clock(s.start)}–${clock(s.start + s.seconds)} | \`${s.id}.mp4\` (${s.seconds} s) | ${cell(pic)} | ${cell(onScreen(s.id, sc))} | ${cell(vo)} | ${cell(src)} |`);
  }
  lines.push("", "## Checked against the run", "",
    `- **${data.facts["paid.seconds"]!.value} seconds from Face ID to PAID:** ${data.facts["paid.seconds"]!.source}. The run log's timings say the same. PAID is the sandbox's status, and the settlement is simulated: Purser moves the transfer to SENT and then PAID itself, through Airwallex's sandbox simulation API (\`settleInSandbox\`, src/executors/invoicePayment.ts). The scene says so on screen and in the voice-over, and points to /proof instead of asking anyone to look the sandbox id up.`,
    `- **The stops (${data.facts["specs.stops"]!.value}, ${data.facts["specs.overLimit"]!.value} paid over a limit):** Claude ${data.facts["specs.stopsClaude"]!.value}, Metal ${data.facts["specs.stopsMetal"]!.value}, the CFO ${data.facts["specs.stopsCfo"]!.value}, the planted instruction ${data.facts["specs.stopsPlanted"]!.value}; the film stops when they do not add up to the record's count, or when Metal's differ from the record's refusals on chain. The site, the README and the form say the same sentence (\`test/premiere.test.ts\` compares it with \`src/redesign/run.ts\`). Not in the film, because it is another run's: the line the site shows below that figure, about the separate TAP run of 2 November.`,
    `- **The closing line** ("Claude decided, Airwallex and Metal held the limits, and the CFO signed only what went beyond them"): ${data.facts["specs.byClaude"]!.value} of ${data.facts["specs.decisions"]!.value} decisions by Claude; ${data.facts["run.faceIds"]!.value} decisions with Max's Face ID (${data.facts["run.faceIds"]!.source}).`,
    "- **The agents' limits (03b)** are each card's and each mandate's as the run began (src/config/policy.ts), checked against the record where it shows them; in the run the Sourcing agent's mandate was replaced (P-0002, 0.04 a payment) after the price rise, and its card raised to EUR 46.00 a purchase (P-0006).",
    "- **Face ID (08) is a reconstruction:** the rendered approval sheet carries P-0005's exact terms from the record, and says on screen that it is a reconstruction and when the real Face ID was (the record's `proposal.approved`).",
    "- **Face ID, not a password:** the reason is the docs' own (docs/phone-approval.md); \"password\", because a passkey may itself be unlocked with a PIN. The film does not say the server proves Face ID: /try/sign checks no attestation (docs/claims.md), so it says the server checks the signature.",
    "- **Kept out:** logos of others, any seal of approval, safety counts, and other runs' figures.", "");
  return lines.join("\n");
}
