#!/usr/bin/env node
/**
 * Regenerates every app icon from brand/eqlshare-icon.svg (1024x1024, full-bleed square).
 * Run: npm run icons
 *
 * Writes (Next.js file conventions, so no <link> tags are needed):
 *   src/app/icon.svg            modern browsers
 *   src/app/favicon.ico         16, 32, 48
 *   src/app/apple-icon.png      180, full bleed (iOS rounds the corners itself)
 *   public/icons/icon-192.png   PWA
 *   public/icons/icon-512.png   PWA
 *   public/icons/icon-maskable-512.png  PWA maskable (the mark already sits inside the 80% safe zone)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const master = await readFile(join(root, "brand/eqlshare-icon.svg"));
const png = (size) => sharp(master, { density: 72 * (size / 1024) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** ICO container holding PNG images (supported by every current browser and Windows Vista+). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((x) => x.data)]);
}

const out = async (rel, data) => {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), data);
  console.log(`wrote ${rel}`);
};

await out("src/app/icon.svg", master);
await out("src/app/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })))));
await out("src/app/apple-icon.png", await png(180));
await out("public/icons/icon-192.png", await png(192));
await out("public/icons/icon-512.png", await png(512));
await out("public/icons/icon-maskable-512.png", await png(512));
