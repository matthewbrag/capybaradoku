// Build the app icons: the capybara art composited over the lime/grass-green
// background (#7fb069), full-bleed square (the OS applies the corner mask).
// Pure Node — decodes the source PNG, box-downscales it, alpha-composites over
// the background, and re-encodes at 180/192/512. Run: node tools/make-app-icon.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const BG = [0x7f, 0xb0, 0x69]; // lime / grass green
const COVERAGE = 0.82; // fraction of the icon the capybara spans

// --- Minimal PNG decoder (8-bit RGBA, non-interlaced) ---
function decodePNG(buf) {
  let p = 8; // skip signature
  let w, h;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      const bitDepth = data[8],
        colorType = data[9],
        interlace = data[12];
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0)
        throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  const paeth = (a, b, c) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a),
      pb = Math.abs(pp - b),
      pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const val = raw[rp++];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let recon;
      if (ft === 0) recon = val;
      else if (ft === 1) recon = val + a;
      else if (ft === 2) recon = val + b;
      else if (ft === 3) recon = val + ((a + b) >> 1);
      else if (ft === 4) recon = val + paeth(a, b, c);
      else throw new Error("bad filter " + ft);
      out[y * stride + x] = recon & 0xff;
    }
  }
  return { w, h, data: out };
}

// --- Minimal PNG encoder (8-bit RGBA) ---
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
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
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// --- Compose one icon at the given size ---
function makeIcon(src, size) {
  const out = Buffer.alloc(size * size * 4);
  // fill with opaque background
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = BG[0];
    out[i * 4 + 1] = BG[1];
    out[i * 4 + 2] = BG[2];
    out[i * 4 + 3] = 255;
  }
  const content = Math.round(size * COVERAGE);
  const scale = content / Math.max(src.w, src.h);
  const dw = Math.round(src.w * scale),
    dh = Math.round(src.h * scale);
  const ox = Math.floor((size - dw) / 2),
    oy = Math.floor((size - dh) / 2);
  const sstride = src.w * 4;

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      // box-average the source region mapping to this dest pixel
      const sx0 = Math.floor(dx / scale),
        sx1 = Math.max(sx0 + 1, Math.ceil((dx + 1) / scale));
      const sy0 = Math.floor(dy / scale),
        sy1 = Math.max(sy0 + 1, Math.ceil((dy + 1) / scale));
      let sA = 0,
        sR = 0,
        sG = 0,
        sB = 0,
        n = 0;
      for (let sy = sy0; sy < sy1 && sy < src.h; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.w; sx++) {
          const o = sy * sstride + sx * 4;
          const a = src.data[o + 3];
          sA += a;
          sR += src.data[o] * a; // premultiplied
          sG += src.data[o + 1] * a;
          sB += src.data[o + 2] * a;
          n++;
        }
      }
      if (n === 0) continue;
      const aAvg = sA / n;
      const alpha = aAvg / 255;
      let r = BG[0],
        g = BG[1],
        b = BG[2];
      if (aAvg > 0) {
        const fr = sR / n / aAvg,
          fg = sG / n / aAvg,
          fb = sB / n / aAvg;
        r = fr * alpha + BG[0] * (1 - alpha);
        g = fg * alpha + BG[1] * (1 - alpha);
        b = fb * alpha + BG[2] * (1 - alpha);
      }
      const po = ((oy + dy) * size + (ox + dx)) * 4;
      out[po] = Math.round(r);
      out[po + 1] = Math.round(g);
      out[po + 2] = Math.round(b);
      out[po + 3] = 255;
    }
  }
  return encodePNG(size, size, out);
}

const src = decodePNG(readFileSync(join(dir, "assets", "capybara.png")));
console.error(`source ${src.w}x${src.h}`);
for (const size of [180, 192, 512]) {
  const png = makeIcon(src, size);
  const path = join(dir, "icons", `icon-${size}.png`);
  writeFileSync(path, png);
  console.error(`wrote ${path} (${png.length} bytes)`);
}
