import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc(buf) {
  let crcv = 0xffffffff;
  for (const b of buf) {
    let c = (crcv ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcv = (crcv >>> 8) ^ c;
  }
  return (crcv ^ 0xffffffff) >>> 0;
}
const chunk = (t, d) => {
  const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};

function png(size, out) {
  const s = size / 512;
  const px = (x, y) => {
    const X = x / s, Y = y / s;
    if (X >= 144 && X <= 368 && Y >= 80 && Y <= 432) {
      for (const [y0, y1, w] of [[140, 158, 144], [196, 214, 144], [252, 270, 90]]) {
        if (Y >= y0 && Y <= y1 && X >= 184 && X <= 184 + w) return [15, 118, 110];
      }
      return [255, 255, 255];
    }
    return [15, 118, 110];
  };
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = px(x, y);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
png(192, 'public/icon-192.png');
png(512, 'public/icon-512.png');
