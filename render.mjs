#!/usr/bin/env node
// Render a PICO-8 cart's map layer to a PNG.
//
// Usage:
//   node render.mjs cart.js out.png [--scale 3] [--rows 64]
//
// Works with the JavaScript export PICO-8 produces for the web player
// (the file that contains `var _cartdat=[...]`). The cart's 128x32 map layer
// is used for rows 0-31; rows 32-63 come from the shared sprite-sheet area,
// which is where PICO-8 stores the lower half of a tall map.
import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const PALETTE = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
];

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const [cartPath, outPath] = positional;
if (!cartPath || !outPath) {
  console.error("usage: node render.mjs cart.js out.png [--scale 3] [--rows 64]");
  process.exit(1);
}
const scale = Math.max(1, Math.min(8, Number.parseInt(flag("scale", "3"), 10) || 3));
const rows = Number.parseInt(flag("rows", "64"), 10) === 32 ? 32 : 64;

const source = await readFile(cartPath, "utf8");
const start = source.indexOf("var _cartdat=[");
if (start < 0) throw new Error("no _cartdat array found; is this a PICO-8 JS export?");
const open = source.indexOf("[", start);
const close = source.indexOf("]", open);
const cart = JSON.parse(source.slice(open, close + 1));
if (cart.length !== 0x8000) throw new Error(`expected 32768 bytes of cart data, found ${cart.length}`);

const gfx = cart.slice(0x0000, 0x2000);
const mapLow = cart.slice(0x2000, 0x3000);
const mapHigh = cart.slice(0x1000, 0x2000);

function spritePixel(x, y) {
  const p = y * 128 + x;
  const byte = gfx[p >> 1];
  return p & 1 ? byte >> 4 : byte & 15;
}

const TILES_W = 128;
const width = TILES_W * 8 * scale;
const height = rows * 8 * scale;
const rgb = Buffer.alloc(width * height * 3);

for (let ty = 0; ty < rows; ty++) {
  for (let tx = 0; tx < TILES_W; tx++) {
    const tile = ty < 32 ? mapLow[ty * TILES_W + tx] : mapHigh[(ty - 32) * TILES_W + tx];
    const sx = (tile % 16) * 8;
    const sy = Math.floor(tile / 16) * 8;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const colour = PALETTE[spritePixel(sx + px, sy + py)];
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = (tx * 8 + px) * scale + dx;
            const y = (ty * 8 + py) * scale + dy;
            const o = (y * width + x) * 3;
            rgb[o] = (colour >> 16) & 255;
            rgb[o + 1] = (colour >> 8) & 255;
            rgb[o + 2] = colour & 255;
          }
        }
      }
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const stride = width * 3 + 1;
const raw = Buffer.alloc(stride * height);
for (let y = 0; y < height; y++) rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

await writeFile(outPath, png);
console.log(`${outPath}: ${width}x${height}, ${(png.length / 1024).toFixed(0)} KB`);
