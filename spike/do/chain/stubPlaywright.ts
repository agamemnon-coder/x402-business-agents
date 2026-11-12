// workerd only (wrangler alias "playwright" -> this file). The engine's dispatcher (src/executors/index.ts) reaches
// the Airi hosted checkout, which opens a browser with Playwright: 6.4 MB that cannot run in a Worker, and that
// wrangler cannot even bundle (it requires chromium-bidi files that are not installed). A payables company never runs it.
export const chromium = {
  launch(): never { throw new Error("no browser in a Durable Object: the Airi hosted checkout runs on a runner"); },
};
