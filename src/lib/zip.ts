// A zip archive with no new dependency and the same bytes every time: the files in the order given, each stored as is
// (method 0, no compression, so no zlib version can change a byte), one fixed timestamp, no extra fields, no comment.
// Enough for a download of a few text files (the month-end pack, src/accounting/monthPack.ts); not a general zip writer.

import { crc32 } from "node:zlib";

export interface ZipEntry { path: string; content: string | Uint8Array }

/** The MS-DOS date and time a zip stores, from a UTC date and time (seconds in steps of two). */
export function dosTime(iso: string): { time: number; date: number } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1980) throw new Error(`not a zip time: ${iso}`);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function zipStore(entries: ZipEntry[], at: string): Buffer {
  const { time, date } = dosTime(at);
  const seen = new Set<string>();
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(e.path) || seen.has(e.path)) throw new Error(`bad or repeated path in the zip: ${e.path}`);
    seen.add(e.path);
    const name = Buffer.from(e.path, "utf8");
    const body = typeof e.content === "string" ? Buffer.from(e.content, "utf8") : Buffer.from(e.content);
    const crc = crc32(body) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
    // Extra field, comment, disk number, internal attributes: none. External attributes: 0. Offset of the local header.
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** The entries of a zip this module wrote (stored, no extras): for the tests and for anyone checking a pack. */
export function unzipStore(zip: Buffer): { path: string; content: Buffer; crcOk: boolean }[] {
  const out: { path: string; content: Buffer; crcOk: boolean }[] = [];
  for (let i = 0; i + 4 <= zip.length && zip.readUInt32LE(i) === 0x04034b50;) {
    if (zip.readUInt16LE(i + 8) !== 0) throw new Error("not a stored entry");
    const size = zip.readUInt32LE(i + 18), n = zip.readUInt16LE(i + 26), x = zip.readUInt16LE(i + 28);
    const path = zip.subarray(i + 30, i + 30 + n).toString("utf8");
    const content = zip.subarray(i + 30 + n + x, i + 30 + n + x + size);
    out.push({ path, content, crcOk: (crc32(content) >>> 0) === zip.readUInt32LE(i + 14) });
    i += 30 + n + x + size;
  }
  return out;
}
