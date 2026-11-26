// The Worker's static assets when Purser Cloud runs on Node (tests, browser checks, local runs): cloud/src/node.ts
// registers a reader here; the Worker never imports node.ts, so in production only the ASSETS binding serves them.
let reader: ((path: string) => Uint8Array | null) | null = null;

export function setLocalAssets(read: (path: string) => Uint8Array | null): void { reader = read; }

/** A static asset's bytes from the local reader, or null (always null in the Worker). */
export function localAsset(path: string): Uint8Array | null { return reader ? reader(path) : null; }
