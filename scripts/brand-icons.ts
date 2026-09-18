/**
 * Every app icon, generated from the one vector mark.
 *
 *   npm run brand:icons
 *
 * `public/brand/trador-mark.svg` is the source of truth. Each raster below is
 * rendered from it rather than hand-exported, because a set of icons exported
 * one at a time drifts: one gets re-cropped, one keeps the old colour, and the
 * home-screen icon quietly stops matching the favicon. Change the SVG, run
 * this, and every size moves together.
 *
 * Three framings, because the platforms crop differently:
 *
 *   - **Home-screen icons** (PWA, Apple, the 1024 master) sit on white with the
 *     mark at 64% of the width — the proportion of the original artwork. iOS
 *     rounds the corners itself and refuses transparency, so these are opaque.
 *   - **Maskable** keeps the mark inside Android's safe zone. The launcher crops
 *     to a circle, a squircle or a teardrop depending on the phone, and only the
 *     central 80% is guaranteed to survive — so the mark shrinks to 52%.
 *   - **Favicons** are transparent with the mark filling the square. At 16px
 *     every pixel of padding is a pixel of mark lost, and a browser tab is
 *     already a frame.
 */

import {readFileSync} from "node:fs";
import path from "node:path";

import sharp from "sharp";

const BRAND = path.join(process.cwd(), "public", "brand");
const MARK = readFileSync(path.join(BRAND, "trador-mark.svg"));

/** The mark's own proportions, from its viewBox (805 × 570). */
const ASPECT = 805 / 570;

const WHITE = {r: 255, g: 255, b: 255, alpha: 1};
const CLEAR = {r: 0, g: 0, b: 0, alpha: 0};

async function icon(
  file: string,
  size: number,
  markShare: number,
  background: typeof WHITE,
): Promise<void> {
  const width = Math.round(size * markShare);
  const height = Math.round(width / ASPECT);

  // Rendered at high density before resizing, so small sizes are downsampled
  // from a sharp source rather than rasterised straight at a blurry 16px.
  const mark = await sharp(MARK, {density: 1200})
    .resize(width, height, {fit: "contain", background: CLEAR})
    .png()
    .toBuffer();

  await sharp({create: {width: size, height: size, channels: 4, background}})
    .composite([
      {
        input: mark,
        left: Math.round((size - width) / 2),
        top: Math.round((size - height) / 2),
      },
    ])
    .png()
    .toFile(path.join(BRAND, file));

  console.log(`  ${file.padEnd(24)} ${size}×${size}`);
}

async function main(): Promise<void> {
  console.log("Trador icons, from public/brand/trador-mark.svg\n");

  // Home screen. Opaque, because iOS rejects transparent touch icons.
  await icon("app-icon-home.png", 1024, 0.64, WHITE);
  await icon("pwa-icon-512.png", 512, 0.64, WHITE);
  await icon("pwa-icon-192.png", 192, 0.64, WHITE);
  await icon("apple-icon.png", 180, 0.64, WHITE);

  // Android's launcher mask. Inside the 80% safe circle.
  await icon("pwa-icon-maskable.png", 512, 0.52, WHITE);

  // Browser tabs. Transparent, mark as large as the square allows.
  await icon("favicon-128.png", 128, 0.94, CLEAR);
  await icon("favicon-64.png", 64, 0.94, CLEAR);
  await icon("favicon-32.png", 32, 0.94, CLEAR);
  await icon("favicon-16.png", 16, 0.96, CLEAR);

  console.log("\nDone.");
}

void main();
