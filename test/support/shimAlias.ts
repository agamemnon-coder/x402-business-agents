// What vitest.shim.config.ts swaps: an import of the engine's opener, src/db/open.ts, as the tree writes it
// ("../db/open.js", "../src/db/open.js", "../../src/db/open.js"). test/shim-handle.test.ts holds every import of the
// opener in the tree to this pattern, so that a new spelling cannot slip past the shim unnoticed.
export const OPENER_IMPORT = /^(?:\.\.?\/)+(?:src\/)?db\/open\.js$/;
