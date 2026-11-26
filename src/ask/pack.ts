// Ask Purser's knowledge pack (20 Nov): the only thing the public chat may answer from. Built from the repository's own
// public docs and records (README, llms.txt, docs/*.md), split at their headings into short passages, each with the
// link to its place on GitHub. npm run cloud:ask-pack writes it into cloud/src/ask/pack.gen.ts for the Worker;
// test/cloud-ask.test.ts fails when that file is behind its sources. Nothing private is read: only files that are
// already public in the repository, and only the ones listed here.
import { readFileSync } from "node:fs";
import { REPO_BLOB } from "../redesign/metalStory.js";

/** One passage: where it is from (the file and its heading), its link, and its text, cleaned. */
export interface AskChunk { id: number; doc: string; title: string; url: string; text: string }

/** The sources, in the order the chat prefers them; `max` caps the passages one file adds. */
export const ASK_SOURCES: readonly { path: string; label: string; max: number }[] = [
  { path: "llms.txt", label: "Purser in one page (llms.txt)", max: 20 },
  { path: "README.md", label: "README", max: 30 },
  { path: "docs/how-it-works.md", label: "How it works", max: 12 },
  { path: "docs/cfo-policy.md", label: "The CFO's policy", max: 10 },
  { path: "docs/phone-approval.md", label: "Approving with Face ID", max: 10 },
  { path: "docs/security.md", label: "Security and threat model", max: 18 },
  { path: "docs/fraud-and-injection.md", label: "Fraud and prompt injection", max: 6 },
  { path: "docs/integrations/README.md", label: "Integrations", max: 16 },
  { path: "docs/connect-claude.md", label: "Connect Claude", max: 10 },
  { path: "docs/ask-purser.md", label: "Task cards (one sentence, one card)", max: 6 },
  { path: "docs/business/model.md", label: "Business model and pilot pricing", max: 10 },
  { path: "docs/enterprise.md", label: "Enterprise", max: 4 },
  { path: "docs/see-it.md", label: "See it", max: 6 },
  { path: "docs/claims.md", label: "Claims and their proof", max: 8 },
  // 26 Nov (Max: "did you put the new upgrades in, the agents and multi entities?"): the latest release and the
  // governance map, so Ask Purser answers about entities, the emergency stop, negotiation, cash and FX and compliance.
  { path: "docs/releases/v1.5.0.md", label: "What's new in v1.5.0", max: 12 },
  { path: "docs/governance.md", label: "Governance", max: 10 },
];

/** A passage's most characters: about 300 tokens, so six of them stay well under the chat's input budget. */
export const CHUNK_MAX = 1_200;
const CHUNK_MIN = 80;

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
export function githubSlug(heading: string): string {
  return stripUntilStable(heading.trim().toLowerCase(), /<[^>]*>/g).replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}

/** Removes every match of `re`, again and again until nothing changes, so a removal cannot join two halves into a new match. */
function stripUntilStable(text: string, re: RegExp): string {
  for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(re, ""); }
  return text;
}

/** Markdown as plain text a model reads well: no HTML, images, badges or fences; absolute links kept as "text (url)". */
export function cleanMarkdown(md: string): string {
  // Badges (a linked image) go before lone images, or each would leave an empty "[](link)" behind; a row of links only
  // (a page's "jump to" row, 26 Nov) and GitHub's alert markers ("> [!NOTE]") carry nothing a model needs.
  const noSummary = stripUntilStable(md, /<!--[\s\S]*?-->/g)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^(?:\[[^\]\n]+\]\([^)\s]+\)\s*·\s*)+\[[^\]\n]+\]\([^)\s]+\)\s*$/gm, "")
    .replace(/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gm, "").replace(/^>\s?/gm, "")
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, "$1. ");
  return stripUntilStable(noSummary, /<[^>]+>/g)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/^\s*\|\s*/gm, "").replace(/\s*\|\s*$/gm, "").replace(/\s+\|\s+/g, " | ")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:]|$)/g, "$1$2").replace(/`([^`]+)`/g, "$1")
    .replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/^ $/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text cut at a sentence end within the cap (never mid-word). */
function cap(text: string, max = CHUNK_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("\n- "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "))).trim() + " …";
}

/** One file's passages: a passage per heading (levels 1 to 3), outside code fences. */
export function chunksOf(path: string, md: string, label: string, max: number): Omit<AskChunk, "id">[] {
  const out: Omit<AskChunk, "id">[] = [];
  let title = label, anchor = "", buf: string[] = [], fence = false;
  const flush = () => {
    const text = cap(cleanMarkdown(buf.join("\n")));
    if (text.length >= CHUNK_MIN) out.push({ doc: path, title: title === label ? label : `${label}: ${title}`, url: `${REPO_BLOB}${path}${anchor ? `#${anchor}` : ""}`, text });
    buf = [];
  };
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { flush(); title = cleanMarkdown(h[2]!); anchor = githubSlug(h[2]!.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")); continue; }
    buf.push(line);
  }
  flush();
  return out.slice(0, max);
}

/** Every passage, numbered from 1, from the files in ASK_SOURCES as they are in the repository now. */
export function askPackChunks(read: (path: string) => string = (p) => readFileSync(p, "utf8")): AskChunk[] {
  return ASK_SOURCES.flatMap((s) => chunksOf(s.path, read(s.path), s.label, s.max)).map((c, i) => ({ id: i + 1, ...c }));
}

/** cloud/src/ask/pack.gen.ts, as npm run cloud:ask-pack writes it. */
export function askPackFile(chunks: AskChunk[] = askPackChunks()): string {
  return `// Generated by npm run cloud:ask-pack from the repository's public docs (src/ask/pack.ts). Do not edit by hand.
import type { AskChunk } from "../../../src/ask/pack.js";

export const ASK_PACK: readonly AskChunk[] = ${JSON.stringify(chunks, null, 0).replace(/\},\{/g, "},\n{")};
`;
}
