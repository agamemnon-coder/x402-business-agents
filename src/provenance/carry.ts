// D24: an origin across an in-process HTTP hop. The customer's request to our own seller is handled outside the code
// path that sent it (the server's handler runs in the context of listen()), so the origin of an agent's own purchase
// would be lost before the upstream purchase starts. The sender parks it under the stock check's number; the handler
// takes it once, and the purchase runs under it.

import { currentOrigin, withOrigin, type Origin } from "./origin.js";

export function originCarrier<T>(upstream: (seq: number) => Promise<T>) {
  const waiting = new Map<number, Origin>();
  return {
    /** The handler's side: the upstream purchase of `seq`, under the origin parked for it, if any. */
    upstream: (seq: number): Promise<T> => {
      const o = waiting.get(seq);
      waiting.delete(seq);
      return o ? withOrigin(o, () => upstream(seq)) : upstream(seq);
    },
    /** The sender's side: call() sends the request for `seq`; the origin in force here goes with it. */
    send: async <R>(seq: number, call: () => Promise<R>): Promise<R> => {
      const o = currentOrigin();
      if (o) waiting.set(seq, o);
      try { return await call(); } finally { waiting.delete(seq); }
    },
  };
}
