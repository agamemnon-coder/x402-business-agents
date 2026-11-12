// SPIKE: shared by the probes.
export interface Attempt<T> { ok: boolean; ms: number; value?: T; error?: string }
/** Runs one check and reports what happened instead of throwing, so one failure does not hide the next check. */
export async function attempt<T>(fn: () => T | Promise<T>): Promise<Attempt<T>> {
  const t = performance.now();
  try { return { ok: true, value: await fn(), ms: Math.round((performance.now() - t) * 10) / 10 }; }
  catch (e) { return { ok: false, error: String((e as Error)?.stack ?? e).split("\n").slice(0, 4).join(" | ").slice(0, 700), ms: Math.round((performance.now() - t) * 10) / 10 }; }
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b instanceof Uint8Array ? b : b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256 = async (b: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof b === "string" ? new TextEncoder().encode(b) : b));

/** The checks of a probe, each run only when the request asks for it (?only=name) or asks for none in particular. */
export function steps(req: Request) {
  const only = new URL(req.url).searchParams.get("only");
  const out: Record<string, unknown> = {};
  return {
    out,
    async step<T>(name: string, fn: () => T | Promise<T>, timeoutMs = 15_000): Promise<Attempt<T> | null> {
      if (only && !name.startsWith(only)) return null;
      const r = await Promise.race([attempt(fn), new Promise<Attempt<T>>((res) => setTimeout(() => res({ ok: false, ms: timeoutMs, error: `no result within ${timeoutMs} ms (it hangs)` }), timeoutMs))]);
      out[name] = r;
      return r;
    },
  };
}
