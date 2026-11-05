// Max's own recordings in the premiere (npm run video -- --slot 08-faceid=<file>[@<start>-<end>] --slot 11-turn=<file>):
// portrait phone recordings, composed into a rounded phone frame beside the scene's captions. The page draws the scene
// with an empty frame at the box below (?rec=x,y,w,h&recfor=<scene>); ffmpeg then lays the recording, cut to its
// window, scaled to the box, its corners rounded by a mask, into that frame, fading with the scene. Without a file the
// scene keeps its rendered picture: the Face ID reconstruction (08) or the /try/sign mock (10).

/** The scenes that take a phone recording. */
export const SLOT_SCENES = ["08-faceid", "11-turn"] as const;
export type SlotScene = (typeof SLOT_SCENES)[number];

export interface SlotFile { id: SlotScene; file: string; from: number | null; to: number | null }

/** `--slot 08-faceid=<file>@<start>-<end>` (or `--slot=…`), any number of times; the rest of the arguments unchanged. */
export function parseSlotArgs(argv: string[]): { slots: SlotFile[]; rest: string[] } {
  const slots: SlotFile[] = [], rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    let spec: string | undefined;
    if (a === "--slot") spec = argv[++i];
    else if (a.startsWith("--slot=")) spec = a.slice("--slot=".length);
    else { rest.push(a); continue; }
    if (!spec) throw new Error("video: --slot needs <scene>=<file>[@<start>-<end>]");
    const m = /^([0-9]{2}-[a-z-]+)=(.+?)(?:@(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?))?$/.exec(spec);
    if (!m) throw new Error(`video: --slot ${spec}: expected <scene>=<file>[@<start>-<end>] (seconds)`);
    const id = m[1] as SlotScene;
    if (!SLOT_SCENES.includes(id)) throw new Error(`video: --slot ${id}: only ${SLOT_SCENES.join(" and ")} take a recording`);
    const from = m[3] === undefined ? null : Number(m[3]), to = m[4] === undefined ? null : Number(m[4]);
    if (from !== null && to !== null && to <= from) throw new Error(`video: --slot ${spec}: the window ends before it starts`);
    if (slots.some((s) => s.id === id)) throw new Error(`video: --slot ${id} given twice`);
    slots.push({ id, file: m[2]!, from, to });
  }
  return { slots, rest };
}

/** Where the recording sits on the 1920x1080 stage: 700 px tall inside the picture, as wide as its own aspect. */
export function slotBox(id: SlotScene, aspect: number): { x: number; y: number; w: number; h: number } {
  if (!(aspect > 0.3 && aspect <= 0.8)) throw new Error(`video: ${id} takes a portrait phone recording (width/height ${aspect.toFixed(2)})`);
  const h = 700, w = Math.round((h * aspect) / 2) * 2;
  return { x: id === "08-faceid" ? 360 : 190, y: 138 + 52, w, h };
}

/** The inner corner radius of the phone frame the page draws around the box (its border is 10 px, its radius 54). */
export const SLOT_RADIUS = 44;

/**
 * How the recording's window fills the scene: as it is when it fits (its last frame held to the end), sped up to fit
 * when it is longer, and then the scene says so on screen.
 */
export function slotSpeed(windowSeconds: number, sceneSeconds: number): number {
  return windowSeconds > sceneSeconds ? Math.round((windowSeconds / sceneSeconds) * 100) / 100 : 1;
}

/** The ffmpeg mask for the box: white inside a rounded rectangle of radius r, black outside (a geq expression). */
export function maskExpr(r: number): string {
  const corner = (cx: string, cy: string, inX: string, inY: string) => `${inX}*${inY}*gt(hypot(${cx},${cy}),${r})`;
  return `255*not(${[
    corner(`${r}-X`, `${r}-Y`, `lt(X,${r})`, `lt(Y,${r})`),
    corner(`X-(W-${r})`, `${r}-Y`, `gt(X,W-${r})`, `lt(Y,${r})`),
    corner(`${r}-X`, `Y-(H-${r})`, `lt(X,${r})`, `gt(Y,H-${r})`),
    corner(`X-(W-${r})`, `Y-(H-${r})`, `gt(X,W-${r})`, `gt(Y,H-${r})`),
  ].join("+")})`;
}

/**
 * The filter that lays the recording (input 1, already cut to its window) and the mask (input 2) into the scene's clip
 * (input 0): sped up when needed, at 60 fps, cover-scaled to the box, held on its last frame, cut to the scene, faded
 * with the scene, its corners rounded.
 */
export function slotFilter(o: { box: { x: number; y: number; w: number; h: number }; seconds: number; speed: number; fade: [number, number] }): string {
  const { box, seconds, speed, fade } = o;
  const fades = [fade[0] > 0 ? `fade=t=in:st=0:d=${fade[0]}:alpha=1` : "", fade[1] > 0 ? `fade=t=out:st=${(seconds - fade[1]).toFixed(3)}:d=${fade[1]}:alpha=1` : ""].filter(Boolean);
  return [
    `[1:v]setpts=(PTS-STARTPTS)/${speed},fps=60,scale=${box.w}:${box.h}:force_original_aspect_ratio=increase,crop=${box.w}:${box.h},setsar=1,tpad=stop_mode=clone:stop_duration=${seconds},trim=duration=${seconds},format=yuva420p[r]`,
    `[2:v]scale=${box.w}:${box.h},format=gray[m]`,
    `[r][m]alphamerge${fades.length ? `,${fades.join(",")}` : ""}[rm]`,
    `[0:v][rm]overlay=${box.x}:${box.y}:eof_action=pass,format=yuv420p[v]`,
  ].join(";");
}
