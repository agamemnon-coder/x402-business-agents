// ASVS 4.0.3 V1.7.2 (docs/security/asvs-l2.md): the Workers' logs leave the isolate for a remote store. Workers Logs
// (`observability`) keeps every log line of each Worker, the request lines and the security.* events among them, at
// Cloudflare for querying, with every request sampled (head_sampling_rate 1: nothing dropped). The security log in D1 or
// the relay's Durable Object and its alarms on /v1/health and /health are the alerting side.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripJsonComments } from "./support/wranglerConfig.js";

const CONFIGS = ["cloud/wrangler.jsonc", "cloud/wrangler.try.jsonc", "worker/wrangler.jsonc"];

describe("each deployed Worker ships its logs (V1.7.2)", () => {
  for (const f of CONFIGS) {
    it(`${f}: Workers Logs on, every request kept`, () => {
      const c = JSON.parse(stripJsonComments(readFileSync(f, "utf8"))) as { observability?: { enabled?: boolean; head_sampling_rate?: number; logs?: { enabled?: boolean; invocation_logs?: boolean } } };
      expect(c.observability?.enabled).toBe(true);
      expect(c.observability?.head_sampling_rate).toBe(1);
      expect(c.observability?.logs?.enabled).toBe(true);
      expect(c.observability?.logs?.invocation_logs).toBe(true);
    });
  }
});
