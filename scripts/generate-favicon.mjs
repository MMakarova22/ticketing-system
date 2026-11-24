// Generates apps/web/public/favicon.ico (16, 32 and 48 px) from apps/web/public/favicon.svg, the hand-written source.
// Run it after changing the SVG, and commit both files:   node scripts/generate-favicon.mjs
//
// The SVG is rendered by the Chromium that Playwright already installs (no extra dependency), in the light color
// scheme (an .ico cannot switch with the theme), on a transparent background. The .ico holds the three PNG images:
// a 6-byte header, one 16-byte directory entry per image, then the PNG data (PNG-in-ICO, supported by all browsers).
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIZES = [16, 32, 48];
const svgPath = fileURLToPath(new URL("../apps/web/public/favicon.svg", import.meta.url));
const icoPath = fileURLToPath(new URL("../apps/web/public/favicon.ico", import.meta.url));
const svg = readFileSync(svgPath, "utf8");

const browser = await chromium.launch();
const pngs = [];
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1, colorScheme: "light" });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    await page.setContent(`<img src="${src}" width="${size}" height="${size}" style="display:block">`);
    await page.locator("img").evaluate((img) => img.decode());
    pngs.push(await page.locator("img").screenshot({ omitBackground: true }));
    await page.close();
  }
} finally {
  await browser.close();
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);
let offset = header.length + 16 * pngs.length;
const entries = pngs.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(SIZES[i], 0); // width
  entry.writeUInt8(SIZES[i], 1); // height
  entry.writeUInt8(0, 2); // no palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(icoPath, Buffer.concat([header, ...entries, ...pngs]));
console.log(`Wrote ${icoPath} (${SIZES.join(", ")} px, ${offset} bytes)`);
