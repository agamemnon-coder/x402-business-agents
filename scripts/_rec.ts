import { readFileSync, writeFileSync } from "node:fs";
import { recordsPdf } from "../src/engine/recordsPdf.js";
const x = JSON.parse(readFileSync("/tmp/claude-0/why/batch.json", "utf8"));
x.company = "Dune Outdoor Wear (test)";
writeFileSync("/tmp/claude-0/why/rec.pdf", await recordsPdf(x, "https://purser-try.max-31b.workers.dev/try"));
