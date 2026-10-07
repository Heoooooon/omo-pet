import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { encodeApng } from "./apng.ts";
import { apngAlphaMask, hitsMask, insideRect, spritePoint } from "./hit-mask.ts";

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out; // the parser does not check CRCs
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const drawn = (mask: { width: number; data: Uint8Array }) =>
  [...mask.data].flatMap((v, i) => (v ? [[i % mask.width, Math.floor(i / mask.width)]] : []));

test("an RGBA animation's mask is the union of every frame's visible pixels", async () => {
  const w = 4;
  const h = 3;
  const frame = (x: number, y: number) => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    rgba[(y * w + x) * 4 + 3] = 1; // barely visible still counts
    return rgba;
  };
  const bytes = await encodeApng([frame(0, 0), frame(3, 2), frame(1, 1)], w, h, 8);
  const mask = await apngAlphaMask(bytes);
  assert.deepEqual(drawn(mask), [[0, 0], [1, 1], [3, 2]]);
});

test("a 2-bit palette sprite reads alpha from tRNS through every row filter", async () => {
  // 5×4 image, indices 0 (transparent) / 1 (opaque) / 2 (half) / 3 (no tRNS entry → opaque)
  const rows = [
    [0, 1, 0, 0, 2],
    [0, 0, 0, 0, 0],
    [3, 0, 0, 1, 0],
    [0, 0, 2, 0, 0],
  ];
  const pack = (r: number[]) => {
    const out = new Uint8Array(2);
    r.forEach((v, x) => (out[x >> 2] |= v << (6 - 2 * (x & 3))));
    return out;
  };
  const packed = rows.map(pack);
  // Filter row 1 with Sub, row 2 with Up, row 3 with Paeth (bpp = 1).
  const filtered: number[] = [];
  packed.forEach((row, y) => {
    const type = y;
    filtered.push(type === 3 ? 4 : type);
    row.forEach((v, x) => {
      const a = x >= 1 ? row[x - 1] : 0;
      const b = y > 0 ? packed[y - 1][x] : 0;
      const c = x >= 1 && y > 0 ? packed[y - 1][x - 1] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a
        : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : pr;
      filtered.push((v - pred) & 0xff);
    });
  });
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 5);
  new DataView(ihdr.buffer).setUint32(4, 4);
  ihdr.set([2, 3, 0, 0, 0], 8);
  const png = concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", new Uint8Array(12)),
    chunk("tRNS", new Uint8Array([0, 255, 128])),
    chunk("IDAT", await deflate(new Uint8Array(filtered))),
    chunk("IEND", new Uint8Array(0)),
  ]);
  const mask = await apngAlphaMask(png);
  assert.deepEqual(drawn(mask), [[1, 0], [4, 0], [0, 2], [3, 2], [2, 3]]);
});

test("a bundled sprite: transparent corners pass through, the body takes the click", async () => {
  const mask = await apngAlphaMask(new Uint8Array(readFileSync("public/packs/omo-cat/idle.apng")));
  assert.equal(mask.width, 192);
  assert.equal(mask.height, 256);
  assert.equal(hitsMask(mask, 2, 2, 0), false);
  assert.equal(hitsMask(mask, 189, 253, 0), false);
  assert.equal(hitsMask(mask, 96, 150, 0), true);
  const share = mask.data.reduce((n, v) => n + v, 0) / mask.data.length;
  assert.ok(share > 0.15 && share < 0.7, `drawn share ${share}`);
});

test("every bundled pack and state, rockets included, yields a mask with see-through room", async () => {
  for (const pack of readdirSync("public/packs", { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const file of readdirSync(`public/packs/${pack.name}`).filter((f) => f.endsWith(".apng"))) {
      const mask = await apngAlphaMask(new Uint8Array(readFileSync(`public/packs/${pack.name}/${file}`)));
      const share = mask.data.reduce((n, v) => n + v, 0) / mask.data.length;
      assert.ok(share > 0.03 && share < 0.85, `${pack.name}/${file}: drawn share ${share}`);
    }
  }
});

test("the margin lets a click just outside the outline still grab the pet", () => {
  const data = new Uint8Array(20 * 20);
  data[10 * 20 + 10] = 1;
  const mask = { width: 20, height: 20, data };
  assert.equal(hitsMask(mask, 10.5, 10.5, 0), true);
  assert.equal(hitsMask(mask, 14.5, 10.5, 3), false);
  assert.equal(hitsMask(mask, 14.5, 10.5, 4), true);
  assert.equal(hitsMask(mask, 13.5, 13.5, 4), false); // the margin is round, not square
});

test("window points map onto the sprite grid, mirrored when the pet faces left", () => {
  const rect = { left: 32, top: 85, width: 176, height: 235 };
  const size = { width: 192, height: 256 };
  const p = spritePoint(32 + 44, 85 + 117.5, rect, size, false);
  assert.ok(Math.abs(p.x - 48) < 1e-9 && Math.abs(p.y - 128) < 1e-9);
  const m = spritePoint(32 + 44, 85 + 117.5, rect, size, true);
  assert.ok(Math.abs(m.x - 144) < 1e-9);
  assert.ok(insideRect(30, 90, rect, 2));
  assert.ok(!insideRect(29, 90, rect, 2));
});
