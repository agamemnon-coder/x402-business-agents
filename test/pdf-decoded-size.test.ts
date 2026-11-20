// The deflate-bomb check before a PDF reaches the reader (src/ap/pdfText.ts checkDecodedSize): every stream's filter
// chain is followed (ASCIIHex and ASCII85, then deflate, deflate inside deflate) and counted against the budget, across
// streams; the expanding filters an invoice never needs are refused; a damaged or cut stream is left for the reader.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkDecodedSize } from "../src/ap/pdfText.js";

const pdf = (...parts: (string | Buffer)[]) => new Uint8Array(Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), ...parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p))]));
const obj = (n: number, filter: string, data: Buffer | string, eol = "\n") => Buffer.concat([
  Buffer.from(`${n} 0 obj\n<< /Length ${data.length}${filter ? ` /Filter ${filter}` : ""} >>\nstream${eol}`, "latin1"), Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1"), Buffer.from("\nendstream\nendobj\n", "latin1"),
]);
/** ASCII85 of bytes, as a PDF writes it (z for four zero bytes, ~> at the end). */
function a85(b: Buffer): string {
  let out = "";
  for (let i = 0; i < b.length; i += 4) {
    const chunk = Buffer.alloc(4);
    b.copy(chunk, 0, i, Math.min(i + 4, b.length));
    const n = Math.min(4, b.length - i);
    let v = chunk.readUInt32BE(0);
    if (v === 0 && n === 4) { out += "z"; continue; }
    const d: string[] = [];
    for (let k = 0; k < 5; k++) { d.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85); }
    out += d.slice(0, n + 1).join("");
  }
  return `<~${out}~>`;
}
const bomb = (bytes: number) => deflateSync(Buffer.alloc(bytes));
const tooBig = /decoded would be more than .* \(a compression bomb\?\); it was not read/;

describe("the budget on a PDF's decoded streams", () => {
  it("counts a deflate stream, deflate inside deflate, and every stream together", () => {
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", bomb(800))), 1000)).not.toThrow();
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", bomb(800)), obj(2, "/Fl", bomb(800))), 1000)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", deflateSync(bomb(5000)))), 1000)).toThrow(tooBig);
  });

  it("decodes ASCIIHex and ASCII85 before the deflate behind them, and counts both", () => {
    const hexed = `${bomb(5000).toString("hex")}>`;
    expect(() => checkDecodedSize(pdf(obj(1, "[/ASCIIHexDecode /FlateDecode]", hexed)), 1000)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "[/AHx /Fl]", hexed)), 100_000)).not.toThrow();
    expect(() => checkDecodedSize(pdf(obj(1, "[/ASCII85Decode /FlateDecode]", a85(bomb(5000)))), 1000)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "[/A85 /Fl]", a85(bomb(500)))), 100_000)).not.toThrow();
    // Hex text alone counts what it decodes to: an odd last digit is padded, as the reader pads it.
    expect(() => checkDecodedSize(pdf(obj(1, "/ASCIIHexDecode", "0".repeat(41))), 20)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "/AHx", "0".repeat(41))), 21)).not.toThrow();
    // ASCII85's "z" is four zero bytes.
    expect(() => checkDecodedSize(pdf(obj(1, "/A85", `<~${"z".repeat(10)}~>`)), 39)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "/A85", `<~${"z".repeat(10)}~>`)), 40)).not.toThrow();
  });

  it("refuses LZW and RunLength, which an invoice never needs", () => {
    expect(() => checkDecodedSize(pdf(obj(1, "/LZWDecode", "x")))).toThrow("the PDF uses the LZWDecode filter, which an invoice never needs; it was not read");
    expect(() => checkDecodedSize(pdf(obj(1, "[/AHx /RL]", "00>")))).toThrow("the PDF uses the RL filter");
  });

  it("leaves a damaged, cut or unknown stream to the reader, and finds streams after a CR line end", () => {
    const damaged = Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff]); // a zlib header, then a block of the reserved type
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", damaged)), 10)).not.toThrow();
    expect(() => checkDecodedSize(pdf(obj(1, "/DCTDecode", Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(5000)]))), 10)).not.toThrow();
    // Data that is deflate is counted whatever filter its dictionary names.
    expect(() => checkDecodedSize(pdf(obj(1, "/DCTDecode", bomb(5000))), 1000)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", bomb(5000), "\r")), 1000)).toThrow(tooBig);
    expect(() => checkDecodedSize(pdf(obj(1, "/FlateDecode", bomb(5000), "\r\n")), 1000)).toThrow(tooBig);
    // "stream" with no line end after it is no stream; one never ended stops the scan.
    expect(() => checkDecodedSize(pdf("1 0 obj << >> streamX endobj\n"), 10)).not.toThrow();
    expect(() => checkDecodedSize(pdf(`1 0 obj << /Filter /FlateDecode >>\nstream\n${"x".repeat(50)}`), 10)).not.toThrow();
  });
});
