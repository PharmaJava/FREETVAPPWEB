'use strict';
/*
 * Just enough of the zip format for Tizen's .wgt packages: read every file of one, and write one (deflated), without any
 * library. A .wgt is a plain zip whose files are the web app plus its signatures.
 */
const zlib = require('zlib');

/** The files of a zip: [{name, data: Buffer}] in the order they are stored (folders left out). */
function read(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.slice(start, start + size);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('unsupported zip compression in ' + name);
    files.push({ name, data });
  }
  return files;
}

/** A zip of files ([{name, data}]), each deflated. */
function write(files) {
  const parts = [], dir = [];
  let offset = 0;
  const date = ((2024 - 1980) << 9) | (1 << 5) | 1;   // a fixed date: the same files make the same package
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = zlib.crc32(f.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(0, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(date, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(f.data.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(0, 30); entry.writeUInt16LE(0, 34); entry.writeUInt16LE(0, 36); entry.writeUInt32LE(0o100644 << 16 >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, name, packed);
    dir.push(entry, name);
    offset += head.length + name.length + packed.length;
  }
  const dirBuf = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([dirBuf, end]));
}

module.exports = { read, write };
