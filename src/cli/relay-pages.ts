// npm run relay:pages: writes worker/src/pages.gen.ts (the pages the Worker serves, built from src/). Deploying
// does this too; CI runs it alone so the Worker can be type-checked without Cloudflare credentials.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPages, pagesModule } from "../relay/assets.js";

writeFileSync(resolve(import.meta.dirname, "../../worker/src/pages.gen.ts"), pagesModule(buildPages()));
