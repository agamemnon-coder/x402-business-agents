// SPIKE: everything the engine needs, loaded only when a company's object is first asked to do engine work
// (lazyWorker.ts imports this file with import(), which wrangler's bundle keeps as a lazy module).
import { Engine as RealEngine } from "./leadWorker.js";

(globalThis as { __purserEngineLoadedAt?: number }).__purserEngineLoadedAt = Date.now();

export function make(ctx: unknown, env: unknown): { handle(method: string, args: unknown[]): Promise<unknown> } {
  const real = new (RealEngine as unknown as new (c: unknown, e: unknown) => Record<string, (...a: unknown[]) => Promise<unknown>>)(ctx, env);
  return { handle: (method, args) => real[method]!(...args) };
}
