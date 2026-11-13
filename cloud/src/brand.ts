import { previewTags } from "../../src/ui/meta.js";

// Purser's icon on every page of the cloud (the console, the hands-on demo, the Claude sign-in): the same mark as the
// site header, served by cloud/src/claude/routes.ts from cloud/src/brand.gen.ts (npm run cloud:icons).
export const ICON_LINKS = '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="32x32 48x48"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';

/**
 * The link preview (the owner, 13 Nov): the same tags as every page of the site (src/ui/meta.ts `previewTags`), on the
 * cloud's shareable pages (the console's sign-in, the hands-on demo). Its image is the site's, at an absolute address.
 */
export const PREVIEW_TAGS = previewTags().join("");
