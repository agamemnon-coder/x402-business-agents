/* global require, process, module, URL */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded by node --require without a transform */
// The test suite makes 0 external calls (Max, 6 November). Loaded before every test file (test/support/noNetwork.ts)
// and, through NODE_OPTIONS, into every child process a test starts (a CLI under tsx). It refuses any HTTP request to a
// host that is not this machine, before anything is sent: fetch, http(s).request and http(s).get. Plain CommonJS so a
// child's `--require` can load it without a transform.
"use strict";
const http = require("node:http");
const https = require("node:https");

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
const isLocal = (host) => !host || LOCAL.has(host) || host.endsWith(".localhost");
// Each refusal is also noted in NETLOG_FILE when set, so a logging preload's count includes what this guard stopped.
const fs = require("node:fs");
const refuse = (host, how) => {
  if (process.env.NETLOG_FILE) try { fs.appendFileSync(process.env.NETLOG_FILE, `${process.pid} guard-refused ${how} ${host}\n`); } catch { /* the count is best effort */ }
  return new Error(`no network in the test suite: ${how} to ${host} refused before it was sent (test/support/no-network.cjs)`);
};

function hostOf(input) {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input.url === "string") return new URL(input.url).hostname;
    if (input && (input.hostname || input.host)) return String(input.hostname || input.host).replace(/:\d+$/, "");
  } catch { /* not a URL: the call itself will fail */ }
  return undefined;
}

if (!globalThis.__noNetworkGuard) {
  globalThis.__noNetworkGuard = true;
  const realFetch = globalThis.fetch;
  if (realFetch) {
    globalThis.fetch = function guardedFetch(input, init) {
      const host = hostOf(input);
      if (!isLocal(host)) return Promise.reject(refuse(host, "fetch"));
      return realFetch.call(this, input, init);
    };
  }
  for (const [name, mod] of [["http", http], ["https", https]]) {
    for (const fn of ["request", "get"]) {
      const real = mod[fn];
      mod[fn] = function guardedRequest(a, ...rest) {
        const host = hostOf(a);
        if (!isLocal(host)) throw refuse(host, `${name}.${fn}`);
        return real.call(this, a, ...rest);
      };
    }
  }
}

module.exports = { isLocal };
