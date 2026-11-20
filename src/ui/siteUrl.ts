/**
 * The site's public origin, in a module of its own with no imports: the site's Worker (worker/src/core.ts, through
 * src/lib/siteIndex.ts) reads it without pulling src/ui/meta.ts's brand, pricing and Airwallex imports into its build.
 */
export const SITE_URL = "https://kit11.max-31b.workers.dev";
