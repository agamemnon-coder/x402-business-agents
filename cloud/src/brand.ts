import { previewTags } from "../../src/ui/meta.js";
import { ICON_VERSION } from "../../src/ui/brand/mark.js";

// Purser's icon on every page of the cloud (the console, the hands-on demo, the Claude sign-in): the same mark as the
// site header, served by cloud/src/claude/routes.ts from src/ui/brand/icons.gen.ts (npm run cloud:icons). The query
// (ICON_VERSION) makes a browser that kept an older icon fetch this one.
export const ICON_LINKS = `<link rel="icon" href="/favicon.svg?v=${ICON_VERSION}" type="image/svg+xml"><link rel="icon" href="/favicon.ico?v=${ICON_VERSION}" sizes="32x32 48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${ICON_VERSION}">`;

/**
 * The link preview (the owner, 13 Nov): the same tags as every page of the site (src/ui/meta.ts `previewTags`), on the
 * cloud's shareable pages (the console's sign-in, the hands-on demo). Its image is the site's, at an absolute address.
 */
export const PREVIEW_TAGS = previewTags().join("");

/** The cloud's icon, as an MCP Implementation.icons entry (serverInfo) and the OAuth metadata's logo. */
export const iconsOf = (origin: string) => [
  { src: `${origin}/icon.png?v=${ICON_VERSION}`, mimeType: "image/png", sizes: ["512x512"] },
  { src: `${origin}/favicon.svg?v=${ICON_VERSION}`, mimeType: "image/svg+xml", sizes: ["any"] },
];
