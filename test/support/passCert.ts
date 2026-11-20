// A throwaway Apple Wallet pass configuration for tests: an RSA key and a self-signed "WWDR" that issues a "Pass Type
// ID" certificate, made at run time with the pass module's own DER writer. Never a real key or certificate; nothing is
// written to disk or committed.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { der, int, oid, seq, setOf, utcTime } from "../../cloud/src/walletPass.js";

const name = (cn: string) => seq(setOf(seq(oid("2.5.4.3"), der(0x0c, new TextEncoder().encode(cn)))));
function certificate(subject: string, issuer: string, pub: KeyObject, signer: KeyObject, serial: number): Uint8Array {
  const alg = seq(oid("1.2.840.113549.1.1.11"), Uint8Array.of(0x05, 0x00));
  const spki = new Uint8Array(pub.export({ type: "spki", format: "der" }));
  const tbs = seq(der(0xa0, int(2)), int(serial), alg, name(issuer), seq(utcTime(new Date("2026-01-01T00:00:00Z")), utcTime(new Date("2027-01-01T00:00:00Z"))), name(subject), spki);
  return seq(tbs, alg, der(0x03, Uint8Array.of(0), new Uint8Array(sign("sha256", tbs, signer))));
}
export const pem = (label: string, b: Uint8Array) => `-----BEGIN ${label}-----\n${Buffer.from(b).toString("base64").replace(/.{64}/g, "$&\n")}\n-----END ${label}-----\n`;

export function throwawayPassEnv() {
  const wwdrKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const passKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wwdr = certificate("Throwaway WWDR (test)", "Throwaway WWDR (test)", wwdrKeys.publicKey, wwdrKeys.privateKey, 7);
  const cert = certificate("Pass Type ID: pass.test.purser (throwaway)", "Throwaway WWDR (test)", passKeys.publicKey, wwdrKeys.privateKey, 0x80123);
  return {
    cert, wwdr, passKeys,
    env: {
      PASS_TYPE_ID: "pass.test.purser.agents", TEAM_ID: "ABCDE12345",
      PASS_CERT_PEM: pem("CERTIFICATE", cert), PASS_WWDR_PEM: pem("CERTIFICATE", wwdr),
      PASS_KEY_PEM: passKeys.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    },
  };
}
