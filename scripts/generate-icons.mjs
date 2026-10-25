#!/usr/bin/env node
/**
 * Regenerates every app icon from the sources in brand/ (copies of the files in the project root):
 *   eqltab-icon.svg           default, 1024x1024 full-bleed square
 *   eqltab-icon-dark.svg      dark appearance (its colours drive the favicon's dark mode)
 *   eqltab-icon-mono.svg      single-colour silhouette on transparent (themed / monochrome uses)
 *   eqltab-favicon.svg        32x32, tuned for small sizes; all favicons come from this, not the 1024 icon
 *   eqltab-lockup-light.svg   icon + wordmark for light backgrounds (header, sign-in)
 *   eqltab-lockup-dark.svg    icon + wordmark for dark backgrounds / dark mode
 * Run: npm run icons
 *
 * Writes (Next.js file conventions, so no <link> tags are needed):
 *   src/app/icon.svg                  favicon.svg; switches to the dark icon's colours in dark mode
 *   public/icons/favicon-16/32/48.png favicon PNGs (not linked, so browsers use the switching SVG)
 *   src/app/favicon.ico               16, 32, 48
 *   src/app/apple-icon.png            180 from the default icon, full bleed (iOS rounds it)
 *   public/icons/icon-192.png, icon-512.png       PWA, default icon
 *   public/icons/icon-maskable-512.png            PWA maskable (the mark is inside the 80% safe zone)
 *   public/icons/icon-monochrome-512.png          PWA monochrome, from the mono icon
 *   src/app/opengraph-image.png       1200x630 link preview: the default icon on the brand colour
 *   public/brand/<prefix>-lockup-light.svg, -dark.svg   served for the in-app logo
 *
 * This is a web-only app: there are no iOS, Android or desktop targets to write.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "eqltab"; // lowercase app name; keep in sync with APP_SLUG in src/lib/brand.ts
const src = async (name) => readFile(join(root, `brand/${PREFIX}-${name}.svg`));
const [icon, dark, mono, favicon] = await Promise.all([src("icon"), src("icon-dark"), src("icon-mono"), src("favicon")]);

/**
 * The favicon with a prefers-color-scheme rule, so the browser tab shows the dark icon in dark mode.
 * Colours come from the two 1024 icons: background = the square's fill, mark = the circle's fill.
 */
function adaptiveFavicon() {
  const fills = (svg) => {
    const t = svg.toString();
    return { bg: t.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1], fg: t.match(/<circle[^>]*fill="(#[0-9a-f]{6})"/i)[1] };
  };
  const light = fills(icon), night = fills(dark);
  let t = favicon.toString();
  t = t.replaceAll(`fill="${light.bg}"`, 'class="bg"').replaceAll(`fill="${light.fg}"`, 'class="fg"');
  if (!t.includes('class="bg"') || !t.includes('class="fg"')) throw new Error("favicon colours don't match the default icon");
  const style = `<style>.bg{fill:${light.bg}}.fg{fill:${light.fg}}@media (prefers-color-scheme:dark){.bg{fill:${night.bg}}.fg{fill:${night.fg}}}</style>`;
  return Buffer.from(t.replace(/(<svg[^>]*>)/, `$1\n  ${style}`));
}
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
await out("src/app/icon.svg", adaptiveFavicon());
for (const f of fav) await out(`public/icons/favicon-${f.size}.png`, f.data);
await out("src/app/favicon.ico", ico(fav));
await out("src/app/apple-icon.png", await png(icon, 180));
await out("public/icons/icon-192.png", await png(icon, 192));
await out("public/icons/icon-512.png", await png(icon, 512));
await out("public/icons/icon-maskable-512.png", await png(icon, 512));
await out("public/icons/icon-monochrome-512.png", await png(mono, 512));

// Open Graph: the icon at 360px, centred on a canvas of the icon's own background colour
const brandBg = icon.toString().match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1];
await out("src/app/opengraph-image.png", await sharp({ create: { width: 1200, height: 630, channels: 4, background: brandBg } })
  .composite([{ input: await png(icon, 360), gravity: "centre" }]).png({ compressionLevel: 9 }).toBuffer());
for (const v of ["light", "dark"]) await out(`public/brand/${PREFIX}-lockup-${v}.svg`, await src(`lockup-${v}`));
