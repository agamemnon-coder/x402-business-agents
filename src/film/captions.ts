// What is burned into the picture, as one ASS file per cut (libass, through ffmpeg's ass filter): the captions (lower
// third, one per shot), the badges (top right, on every shot where money is shown), the end card, and, until the
// owner's footage is in, the placeholder cards that say what goes there ("Max on camera", "phone recording"). In a
// draft without a voice, the narration runs as a small line at the bottom so the timing can be read.

import { OWN_FOOTAGE } from "./shots.js";
import { narration, onScreen, type Placed } from "./cuts.js";

export const W = 1920, H = 1080;
/** The phone frame on a 1920x1080 picture: a portrait recording sits in it, its corners rounded (src/film/slots.ts). */
export const PHONE_BOX = { x: 1240, y: 150, w: 380, h: 822, r: 52 } as const;
/** Film v10: the letterbox (2.39:1): bars of 138 px above and below a 1920x804 picture. */
export const BAR = 138;
/** Film v10: the phone frame inside the letterboxed picture, right of centre; the step's words stand left of it. */
export const PHONE_BOX_LB = { x: 1236, y: 162, w: 356, h: 756, r: 44 } as const;

const t = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** ASS text: braces and backslashes would be read as overrides; a line break is \N. */
export const assText = (s: string) => s.replace(/\\/g, "⧵").replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\n/g, "\\N");

/** A rounded rectangle as an ASS drawing (\p1), from (0,0). */
export function roundRect(w: number, h: number, r: number): string {
  const k = Math.round(r * 0.45);
  return [`m ${r} 0`, `l ${w - r} 0`, `b ${w - k} 0 ${w} ${k} ${w} ${r}`, `l ${w} ${h - r}`, `b ${w} ${h - k} ${w - k} ${h} ${w - r} ${h}`, `l ${r} ${h}`, `b ${k} ${h} 0 ${h - k} 0 ${h - r}`, `l 0 ${r}`, `b 0 ${k} ${k} 0 ${r} 0`].join(" ");
}

const HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter SemiBold,46,&H00F6F1EE,&H00F6F1EE,&H38110C0A,&H00000000,0,0,0,0,100,100,0,0,3,18,0,1,96,96,92,1
Style: Badge,Inter Medium,28,&H00F6F1EE,&H00F6F1EE,&H40271D19,&H00000000,0,0,0,0,100,100,0,0,3,12,0,9,48,48,100,1
Style: Card,Inter SemiBold,64,&H00F6F1EE,&H00F6F1EE,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,96,96,0,1
Style: Small,Inter Medium,32,&H00BDADA4,&H00BDADA4,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,96,96,0,1
Style: Draft,Inter Medium,30,&H00D0D0D0,&H00D0D0D0,&H90000000,&H00000000,0,1,0,0,100,100,0,0,3,10,0,2,240,240,20,1
Style: Frame,Inter,20,&H00372B26,&H00372B26,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: BarCaption,Inter SemiBold,40,&H00F6F1EE,&H00F6F1EE,&H00000000,&H00000000,0,0,0,0,100,100,0.4,0,1,0,0,5,96,96,0,1
Style: BarBadge,Inter Medium,24,&H00B9C2CC,&H00B9C2CC,&H00000000,&H00000000,0,0,0,0,100,100,0.6,0,1,0,0,6,64,64,0,1
Style: Corner,Inter Medium,22,&H0075706B,&H0075706B,&H00000000,&H00000000,0,0,0,0,100,100,0.6,0,1,0,0,4,64,64,0,1
Style: Title,Inter SemiBold,76,&H00F6F1EE,&H00F6F1EE,&H00000000,&H00000000,0,0,0,0,100,100,-0.5,0,1,0,0,5,120,120,0,1
Style: Step,Inter SemiBold,62,&H00F6F1EE,&H00F6F1EE,&H00000000,&H00000000,0,0,0,0,100,100,-0.4,0,1,0,0,4,120,120,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

const ev = (layer: number, a: number, b: number, style: string, text: string) => `Dialogue: ${layer},${t(a)},${t(b)},${style},,0,0,0,,${text}`;

/**
 * The ASS file of a cut. `filled` names the owner's shots that have footage (no placeholder card then); `draft` adds
 * the narration line at the bottom (a cut without a voice yet).
 */
export function assFile(placed: Placed[], o: { filled?: Set<string>; draft?: boolean; notes?: { at: number; to: number; text: string }[]; letterbox?: boolean } = {}): string {
  if (o.letterbox) return letterboxAss(placed, o);
  const lines: string[] = [];
  // A shot not captured yet: a plain card saying which, so a draft is never mistaken for the finished film.
  for (const n of o.notes ?? []) {
    lines.push(ev(3, n.at, n.to, "Small", `{\\an4\\pos(300,440)\\fs30\\1c&H00B0B0&}NOT CAPTURED YET`));
    lines.push(ev(3, n.at, n.to, "Small", `{\\an4\\pos(300,500)\\fs40\\1c&HF6F1EE&}${assText(n.text)}`));
  }
  for (const x of onScreen(placed)) {
    if (x.kind === "caption") lines.push(ev(5, x.at + 0.15, x.to - 0.1, "Caption", `{\\fad(180,180)}${assText(x.text)}`));
    if (x.kind === "badge") lines.push(ev(5, x.at, x.to, "Badge", `{\\fad(120,120)}${assText(x.text)}`));
  }
  for (const p of placed) for (const g of p.segs) {
    const a = g.start, b = g.start + g.seconds;
    if (g.card) {
      const [url, line, credits] = g.card;
      lines.push(ev(3, a, b, "Card", `{\\pos(960,470)\\fad(250,0)}${assText(url!)}`));
      lines.push(ev(3, a, b, "Small", `{\\pos(960,560)\\fad(250,0)}${assText(line!)}`));
      if (credits) lines.push(ev(3, a, b, "Small", `{\\pos(960,980)\\fs24\\fad(250,0)}${assText(credits)}`));
    }
    if (g.own && !o.filled?.has(g.own)) {
      const phone = g.own.startsWith("P");
      if (phone) {
        const { x, y, w, h, r } = PHONE_BOX;
        // The phone frame: a 10 px bezel around the box, an empty screen with the label.
        lines.push(ev(1, a, b, "Frame", `{\\pos(${x - 10},${y - 10})\\p1\\bord0\\shad0\\1c&H372B26&}${roundRect(w + 20, h + 20, r + 10)}{\\p0}`));
        lines.push(ev(2, a, b, "Frame", `{\\pos(${x},${y})\\p1\\bord0\\shad0\\1c&H271D19&}${roundRect(w, h, r)}{\\p0}`));
        lines.push(ev(3, a, b, "Small", `{\\pos(${x + w / 2},${y + h / 2 - 40})\\fs30}PHONE RECORDING`));
        lines.push(ev(3, a, b, "Small", `{\\pos(${x + w / 2},${y + h / 2 + 10})\\fs24}goes here`));
      }
      lines.push(ev(3, a, b, "Small", `{\\an4\\pos(${phone ? 140 : 300},${phone ? 300 : 440})\\fs30\\1c&H00B0B0&}PLACEHOLDER · ${g.own}`));
      lines.push(ev(3, a, b, "Small", `{\\an4\\pos(${phone ? 140 : 300},${phone ? 360 : 500})\\fs40\\1c&HF6F1EE&}${assText(phone ? wrap(OWN_FOOTAGE[g.own], 38) : OWN_FOOTAGE[g.own])}`));
    }
  }
  if (o.draft) for (const n of narration(placed)) lines.push(ev(6, n.at, n.to, "Draft", `${n.who === "Max" ? "Max: " : "VO: "}${assText(n.text)}`));
  return HEADER + lines.join("\n") + "\n";
}

/** Break a line at spaces to at most `n` characters a line (ASS \N). */
export function wrap(s: string, n: number): string {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) { if (cur && (cur + " " + w).length > n) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
  if (cur) out.push(cur);
  return out.join("\n");
}

/**
 * Film v10's burned-in words, letterboxed as film v8: the caption in the bar below, the badge in the bar above (right),
 * a quiet credit in the bar above (left); title cards large in the picture; beside a recording, its step large on the
 * left of the phone frame (the caption is the step, so it is not repeated in the bar).
 */
function letterboxAss(placed: Placed[], o: { draft?: boolean; notes?: { at: number; to: number; text: string }[] }): string {
  const lines: string[] = [];
  const end = placed.at(-1)!.start + placed.at(-1)!.seconds;
  const cardAt = placed.find((p) => p.row.kind === "card")?.start ?? end;
  lines.push(ev(4, 0.5, cardAt, "Corner", `{\\an4\\pos(64,${BAR / 2})\\fad(600,300)}Purser · Starter Kit 11`));
  for (const n of o.notes ?? []) {
    lines.push(ev(3, n.at, n.to, "Small", `{\\an4\\pos(300,440)\\fs30\\1c&H00B0B0&}NOT CAPTURED YET`));
    lines.push(ev(3, n.at, n.to, "Small", `{\\an4\\pos(300,500)\\fs40\\1c&HF6F1EE&}${assText(n.text)}`));
  }
  const recAt = new Set(placed.flatMap((p) => p.segs.filter((g) => g.rec).map((g) => Math.round(g.start * 1000))));
  for (const x of onScreen(placed)) {
    if (x.kind === "caption" && !recAt.has(Math.round(x.at * 1000))) lines.push(ev(5, x.at + 0.2, x.to - 0.15, "BarCaption", `{\\pos(960,${H - BAR / 2})\\fad(260,220)}${assText(x.text)}`));
    if (x.kind === "badge") lines.push(ev(5, x.at, x.to, "BarBadge", `{\\an6\\pos(${W - 64},${BAR / 2})\\fad(200,200)}${assText(x.text)}`));
  }
  for (const p of placed) for (const g of p.segs) {
    const a = g.start, b = g.start + g.seconds;
    if (g.title) {
      const [first, ...rest] = g.title;
      const top = 540 - (rest.length * 70) / 2 - 10;
      lines.push(ev(3, a, b, "Title", `{\\pos(960,${top})\\fad(700,500)}${assText(first!)}`));
      rest.forEach((l, i) => lines.push(ev(3, a + 0.9 + i * 0.7, b, "Small", `{\\pos(960,${top + 110 + i * 70})\\fs42\\fad(600,500)}${assText(l)}`)));
    }
    if (g.rec && typeof g.caption === "string") {
      lines.push(ev(3, a + 0.2, b - 0.1, "Step", `{\\an4\\pos(140,520)\\fad(300,250)}${assText(g.caption.split(" · ").map((l) => wrap(l, 26)).join("\n"))}`));
      lines.push(ev(3, a + 0.2, b - 0.1, "Small", `{\\an4\\pos(140,${g.caption.includes("·") ? 700 : 640})\\fs28\\1c&HB9C2CC&\\fad(300,250)}Recorded from the live page · virtual test passkey`));
    }
    if (g.card) {
      const [url, line, credits] = g.card;
      lines.push(ev(3, a, b, "Card", `{\\pos(960,470)\\fad(400,0)}${assText(url!)}`));
      lines.push(ev(3, a, b, "Small", `{\\pos(960,560)\\fad(400,0)}${assText(line!)}`));
      if (credits) lines.push(ev(3, a, b, "Small", `{\\pos(960,${H - BAR / 2})\\fs24\\fad(400,0)}${assText(credits)}`));
    }
  }
  if (o.draft) for (const n of narration(placed)) lines.push(ev(6, n.at, n.to, "Draft", `VO: ${assText(n.text)}`));
  return HEADER + lines.join("\n") + "\n";
}
