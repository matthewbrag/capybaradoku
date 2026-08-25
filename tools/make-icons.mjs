// Generate simple placeholder PNG app icons (no external deps) — a capybara
// blob on a grassy background. Replace these with the real capybara art later.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

function png(size, path) {
  const w = size,
    h = size;
  const buf = Buffer.alloc(w * h * 4);
  const cx = w / 2,
    cy = h * 0.56;
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    buf[o] = r;
    buf[o + 1] = g;
    buf[o + 2] = b;
    buf[o + 3] = a;
  };
  const inEllipse = (x, y, ex, ey, rx, ry) => ((x - ex) / rx) ** 2 + ((y - ey) / ry) ** 2 <= 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // grassy gradient background
      const t = y / h;
      set(x, y, Math.round(150 - 20 * t), Math.round(200 - 40 * t), Math.round(120 - 30 * t));
    }
  }
  // ears
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inEllipse(x, y, cx - w * 0.2, cy - h * 0.22, w * 0.1, h * 0.1)) set(x, y, 107, 74, 47);
      if (inEllipse(x, y, cx + w * 0.2, cy - h * 0.22, w * 0.1, h * 0.1)) set(x, y, 107, 74, 47);
    }
  // head/body
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inEllipse(x, y, cx, cy, w * 0.3, h * 0.3)) set(x, y, 125, 86, 54);
      if (inEllipse(x, y, cx, cy + h * 0.12, w * 0.16, h * 0.11)) set(x, y, 90, 61, 40);
    }
  // eyes
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inEllipse(x, y, cx - w * 0.11, cy - h * 0.03, w * 0.035, h * 0.035)) set(x, y, 30, 20, 14);
      if (inEllipse(x, y, cx + w * 0.11, cy - h * 0.03, w * 0.035, h * 0.035)) set(x, y, 30, 20, 14);
    }

  // encode PNG
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter type 0
    buf.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const out = Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, out);
  console.error("wrote", path, out.length, "bytes");
}

png(180, join(dir, "icon-180.png"));
png(192, join(dir, "icon-192.png"));
png(512, join(dir, "icon-512.png"));
