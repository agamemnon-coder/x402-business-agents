// Film v10's narrator (npm run voice10): an AI voice from ElevenLabs' voice library, and how a word is respelt so the
// voice says it as the film writes it. The subtitles keep the film's own spelling.

/** The narrator: a calm, warm, professional English voice from the account's voices (an AI voice; no real person imitated). */
export const VOICE_10 = { id: process.env.VOICE_ID ?? "70HFmYdPmz1aKiKW6Zx3", name: "Ian (ElevenLabs voice library): professional, warm, calm", model: "eleven_multilingual_v2" };
/** How a word is spelt for the voice (the subtitles keep the film's spelling). */
export const SAY: [RegExp, string][] = [[/T:0/g, "T-zero"], [/\bAiri\b/g, "Airee"], [/\bVAT\b/g, "V.A.T."], [/\bCFO\b/g, "C.F.O."], [/e-mail/g, "email"], [/1,850 euros/g, "eighteen hundred and fifty euros"]];
export const spoken = (w: string) => SAY.reduce((t, [a, b]) => t.replace(a, b), w);

