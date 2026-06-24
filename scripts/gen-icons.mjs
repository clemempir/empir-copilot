#!/usr/bin/env node
/**
 * Rasterise packages/extension/assets/brand/empir-icon.svg en PNG aux tailles
 * requises par les manifests Chrome MV3 et Firefox WebExtension.
 * Sortie : packages/extension/public/icon/{16,32,48,96,128}.png
 *
 * Usage : `node scripts/gen-icons.mjs` (ou `pnpm gen:icons`).
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SVG = resolve(REPO_ROOT, "packages/extension/assets/brand/empir-icon.svg");
const OUT_DIR = resolve(REPO_ROOT, "packages/extension/public/icon");
const SIZES = [16, 32, 48, 96, 128];

const svg = await readFile(SVG);
await mkdir(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = await sharp(svg).resize(size, size).png().toBuffer();
  const out = resolve(OUT_DIR, `${size}.png`);
  await writeFile(out, png);
  console.log(`✔ ${out} (${png.byteLength} B)`);
}
