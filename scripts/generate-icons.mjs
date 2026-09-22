// scripts/generate-icons.mjs
//
// Regenerates icons/icon-{on,off}-{16,48,128}.png. No dependencies — draws
// into a pixel buffer and writes PNGs by hand.
//
//   node scripts/generate-icons.mjs
//
// Design: rounded square with a diagonal gradient, a white pulse
// (heartbeat) line across the middle, and a status dot top-right.
// ON = violet -> indigo with a green dot; OFF = slate with a grey dot.
// Rendered at 4x and downsampled for anti-aliasing.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SS = 4; // supersample factor

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rgba, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Signed distance to a rounded rect spanning [0,w] x [0,h].
function roundedRectSdf(x, y, w, h, r) {
  const dx = Math.abs(x - w / 2) - (w / 2 - r);
  const dy = Math.abs(y - h / 2) - (h / 2 - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

// Distance from a point to the segment ab.
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01(((px - ax) * vx + (py - ay) * vy) / len2);
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

const PULSE = [
  [0.16, 0.52],
  [0.36, 0.52],
  [0.44, 0.3],
  [0.54, 0.72],
  [0.62, 0.52],
  [0.84, 0.52],
];

function render(size, on) {
  const S = size * SS;
  const corner = S * 0.24;
  const [c0, c1] = on
    ? [
        [124, 58, 237],
        [79, 70, 229],
      ]
    : [
        [72, 74, 88],
        [40, 41, 52],
      ];
  const dotColor = on ? [34, 197, 94] : [150, 152, 165];
  const pulseAlpha = on ? 1 : 0.78;

  const pts = PULSE.map(([x, y]) => [x * S, y * S]);
  const stroke = S * (size >= 48 ? 0.11 : 0.14); // thicker at small sizes
  const dotCx = S * 0.76;
  const dotCy = S * 0.24;
  const dotR = S * (size >= 48 ? 0.11 : 0.13);
  const dotRing = S * 0.035;

  const rows = [];
  const samples = SS * SS;
  for (let py = 0; py < size; py++) {
    const acc = Array.from({ length: size }, () => [0, 0, 0, 0]);
    for (let sy = 0; sy < SS; sy++) {
      const yy = py * SS + sy + 0.5;
      for (let px = 0; px < size; px++) {
        for (let sx = 0; sx < SS; sx++) {
          const xx = px * SS + sx + 0.5;
          const d = roundedRectSdf(xx, yy, S, S, corner);
          if (d > 0.75) continue;
          const cov = clamp01(0.5 - d); // edge anti-aliasing

          const t = clamp01((xx + yy) / (2 * S));
          let r = lerp(c0[0], c1[0], t);
          let g = lerp(c0[1], c1[1], t);
          let b = lerp(c0[2], c1[2], t);

          const hl = 0.1 * (1 - t); // subtle top-left highlight
          r += (255 - r) * hl;
          g += (255 - g) * hl;
          b += (255 - b) * hl;

          let dmin = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            dmin = Math.min(dmin, segDist(xx, yy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
          }
          const pcov = clamp01(stroke / 2 + 0.5 - dmin) * pulseAlpha;
          r = lerp(r, 255, pcov);
          g = lerp(g, 255, pcov);
          b = lerp(b, 255, pcov);

          const dd = Math.hypot(xx - dotCx, yy - dotCy);
          const ring = clamp01(dotR + dotRing + 0.5 - dd) * (1 - clamp01(dotR + 0.5 - dd));
          r = lerp(r, 17, ring);
          g = lerp(g, 17, ring);
          b = lerp(b, 20, ring);

          const dcov = clamp01(dotR + 0.5 - dd);
          r = lerp(r, dotColor[0], dcov);
          g = lerp(g, dotColor[1], dcov);
          b = lerp(b, dotColor[2], dcov);

          const a = acc[px];
          a[0] += r * cov;
          a[1] += g * cov;
          a[2] += b * cov;
          a[3] += cov;
        }
      }
    }
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      const [r, g, b, a] = acc[px];
      const o = 1 + px * 4;
      if (a > 0) {
        row[o] = Math.round(r / a);
        row[o + 1] = Math.round(g / a);
        row[o + 2] = Math.round(b / a);
        row[o + 3] = Math.round((255 * a) / samples);
      }
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

mkdirSync('icons', { recursive: true });
for (const on of [true, false]) {
  for (const size of [16, 48, 128]) {
    const file = `icons/icon-${on ? 'on' : 'off'}-${size}.png`;
    writeFileSync(file, encodePng(size, render(size, on)));
    console.log('wrote', file);
  }
}
