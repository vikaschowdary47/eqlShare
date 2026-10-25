#!/usr/bin/env node
/**
 * Regenerates every app icon from the sources in brand/ (copies of the files in the project root):
 *   eqlshare-icon.svg       default, 1024x1024 full-bleed square
 *   eqlshare-icon-dark.svg  dark appearance (drawn in-app by LogoMark in ui.tsx; no web file needs it)
 *   eqlshare-icon-mono.svg  single-colour silhouette on transparent (themed / monochrome uses)
 *   eqlshare-favicon.svg    32x32, tuned for small sizes; all favicons come from this, not the 1024 icon
 * Run: npm run icons
 *
 * Writes (Next.js file conventions, so no <link> tags are needed):
 *   src/app/icon.svg                  favicon.svg for modern browsers
 *   src/app/icon1.png..icon3.png      favicon PNGs 16, 32, 48
 *   src/app/favicon.ico               16, 32, 48
 *   src/app/apple-icon.png            180 from the default icon, full bleed (iOS rounds it)
 *   public/icons/icon-192.png, icon-512.png       PWA, default icon
 *   public/icons/icon-maskable-512.png            PWA maskable (the mark is inside the 80% safe zone)
 *   public/icons/icon-monochrome-512.png          PWA monochrome, from the mono icon
 *
 * This is a web-only app: there are no iOS, Android or desktop targets to write.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "eqlshare";
const src = async (name) => readFile(join(root, `brand/${PREFIX}-${name}.svg`));
const [icon, mono, favicon] = await Promise.all([src("icon"), src("icon-mono"), src("favicon")]);
// Render each SVG at 4x its target size, then downscale, so small sizes stay crisp
const png = (svg, size, base = 1024) => sharp(svg, { density: 72 * (size / base) * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

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

const fav = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size, 32) })));
await out("src/app/icon.svg", favicon);
for (const [i, f] of fav.entries()) await out(`src/app/icon${i + 1}.png`, f.data);
await out("src/app/favicon.ico", ico(fav));
await out("src/app/apple-icon.png", await png(icon, 180));
await out("public/icons/icon-192.png", await png(icon, 192));
await out("public/icons/icon-512.png", await png(icon, 512));
await out("public/icons/icon-maskable-512.png", await png(icon, 512));
await out("public/icons/icon-monochrome-512.png", await png(mono, 512));
