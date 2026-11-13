// /.well-known/security.txt (RFC 9116) for both Workers: the relay (worker/src/core.ts) and Purser Cloud
// (cloud/src/app.ts). How to report a vulnerability, as SECURITY.md says: a private GitHub security advisory.
// Expires is required by the RFC and should be less than a year away: renew it before then.

const REPO = "https://github.com/agamemnon-coder/x402-business-agents";
export const SECURITY_TXT_EXPIRES = "2027-05-01T00:00:00.000Z";

export const SECURITY_TXT = [
  `Contact: ${REPO}/security/advisories/new`,
  `Expires: ${SECURITY_TXT_EXPIRES}`,
  `Policy: ${REPO}/blob/main/SECURITY.md`,
  "Preferred-Languages: en, nl",
  "",
].join("\n");
