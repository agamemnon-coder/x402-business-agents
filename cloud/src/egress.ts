// The allow rule for addresses a company or a client sets for Purser Cloud to call (ASVS 4.0.3 V12.6.1): the alert
// webhook (./monitor.ts), Slack and Teams alert targets (./alerts.ts) and a Claude client's metadata document
// (./claude/oauth.ts). Checked when the address is set and again before each request, so an address stored before the
// rule, or written past it, is never called. Partner APIs (Airwallex, Twilio, Resend, Moneybird) are fixed hosts in the
// code and do not come through here.
//
// Allowed: https, port 443, no credentials, a public host name with a letter TLD. Refused: any address literal (every
// IPv4 spelling the URL parser reads as one: 0x7f.0.0.1, 2130706433, 0177.0.0.1; any IPv6), local and reserved names,
// cloud metadata hosts, and names that map to an address (nip.io, sslip.io and the like, or a name that carries four
// numbers as its labels). A public name whose DNS points at a private address is the one case a name check cannot see;
// the Worker's fetch runs on Cloudflare's network and the request carries no credential of Purser's.
// The documentation names (.example, .test, .invalid) do not resolve on the public internet and are left to fail there.
// Small fixed lists and one short regex: nothing heavy at import (the Workers' startup limit).

const RESERVED_SUFFIXES = ["localhost", "local", "internal", "intranet", "home", "lan", "corp", "localdomain", "arpa", "onion", "alt"];
const METADATA_HOSTS = ["metadata", "metadata.goog", "metadata.google.internal", "instance-data", "metadata.azure.com", "metadata.tencentyun.com", "metadata.platformequinix.com"];
/** Services whose names resolve to the address written in them. */
const ADDRESS_NAME_SERVICES = ["nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "vcap.me", "lacolhost.com", "traefik.me", "1u.ms", "rbndr.us"];
/** Four numbers 0-255 as labels or dash-separated parts: a name that spells an address. */
const EMBEDDED_IPV4 = /(?:^|[.-])(?:\d{1,3})[.-](?:\d{1,3})[.-](?:\d{1,3})[.-](?:\d{1,3})(?=[.-]|$)/;

const under = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

/** Why Purser will not call this address, or null when it may. */
export function egressProblem(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 500) return "the address is too long";
  let u: URL;
  try { u = new URL(raw); } catch { return "not a URL"; }
  if (u.protocol !== "https:") return "the address must be https";
  if (u.username || u.password) return "no credentials in the address";
  if (u.port && u.port !== "443") return "the address must use port 443";
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || host.includes(":") || /^[\d.]+$/.test(host)) return "the address must name a host, not an IP address";
  if (host.endsWith(".") || !host.includes(".")) return "the address must be a public host name";
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(tld) && !/^xn--/.test(tld)) return "the address must be a public host name";
  if (RESERVED_SUFFIXES.some((s) => under(host, s))) return "the address must be a public host name, not a local or reserved one";
  if (METADATA_HOSTS.some((s) => under(host, s))) return "a cloud metadata host is never called";
  if (ADDRESS_NAME_SERVICES.some((s) => under(host, s)) || EMBEDDED_IPV4.test(host)) return "the address must not be a name that spells an IP address";
  return null;
}

/** egressProblem as a guard: true when the address may be called. */
export const egressAllowed = (raw: string): boolean => egressProblem(raw) === null;
