// Builds a synthetic cart, renders it, and checks the PNG it produces.
// Run: node test.mjs
import { writeFile, readFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert";

const cart = new Array(0x8000).fill(0);
// Sprite 1: a solid block of colour 7 in the top-left 8x8 pixels.
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x += 2) {
    const p = y * 128 + x;
    cart[p >> 1] = 0x77;
  }
}
// Put sprite 1 at map position (0, 0) and at row 40, which lives in the shared area.
cart[0x2000] = 1;
cart[0x1000 + 8 * 128] = 1;

const cartFile = "/tmp/pico8-map-test-cart.js";
const outFile = "/tmp/pico8-map-test.png";
await writeFile(cartFile, `var _cartdat=[${cart.join(",")}];`);

execFileSync(process.execPath, ["render.mjs", cartFile, outFile, "--scale", "1"], { stdio: "pipe" });
const png = await readFile(outFile);

assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
assert.equal(png.readUInt32BE(16), 1024, "width is 128 tiles x 8 pixels");
assert.equal(png.readUInt32BE(20), 512, "height is 64 tiles x 8 pixels");

execFileSync(process.execPath, ["render.mjs", cartFile, outFile, "--scale", "1", "--rows", "32"], { stdio: "pipe" });
const shortPng = await readFile(outFile);
assert.equal(shortPng.readUInt32BE(20), 256, "32 rows render at half height");

await unlink(cartFile);
await unlink(outFile);
console.log("ok: renders 64 rows, 32 rows, and a valid PNG header");
