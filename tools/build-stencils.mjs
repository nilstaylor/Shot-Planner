#!/usr/bin/env node
/**
 * build-stencils.mjs
 *
 * Scans a folder of PNG stencils and writes the manifest the app reads.
 * Browsers cannot list a directory, so this file is the bridge between
 * "drop a PNG in a folder" and "it shows up in the picker".
 *
 * Layout it expects:
 *
 *   public/stencils/
 *     furniture/dining-table_6x3.png
 *     furniture/armchair_2.5x2.5.png
 *     architecture/door-swing_3x3.png
 *     lighting/1k-fresnel_1.5x1.5.png
 *
 * The folder name becomes the category. The suffix on the filename is the
 * real world footprint in feet, width by depth, measured as the object sits
 * on the floor seen from above. A file with no suffix defaults to 3 by 3 and
 * can be resized on the plan.
 *
 * Usage:
 *   node build-stencils.mjs                     (defaults to public/stencils)
 *   node build-stencils.mjs path/to/stencils
 *   node build-stencils.mjs path/to/stencils --units=m
 */

import { readdir, writeFile, stat } from "node:fs/promises";
import { join, extname, basename, relative, sep } from "node:path";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("-")) || "public/stencils";
const units = (args.find((a) => a.startsWith("--units=")) || "--units=ft").split("=")[1];
const M_TO_FT = 3.28084;

const IMAGE_TYPES = new Set([".png", ".webp", ".svg"]);

const titleCase = (s) =>
  s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** Pulls "sofa_7x3" apart into a name and a footprint. */
function parseName(file) {
  const stem = basename(file, extname(file));
  const m = stem.match(/^(.*?)[_-](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
  if (!m) return { name: titleCase(stem), w: 3, d: 3, sized: false };
  const scale = units === "m" ? M_TO_FT : 1;
  return {
    name: titleCase(m[1]),
    w: +(parseFloat(m[2]) * scale).toFixed(2),
    d: +(parseFloat(m[3]) * scale).toFixed(2),
    sized: true,
  };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (IMAGE_TYPES.has(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

async function main() {
  try {
    await stat(root);
  } catch {
    console.error(`No folder at ${root}. Create it and drop your PNGs in, then run this again.`);
    process.exit(1);
  }

  const files = (await walk(root)).sort();
  const unsized = [];

  const stencils = files.map((full) => {
    const rel = relative(root, full).split(sep).join("/");
    const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "Uncategorized";
    const meta = parseName(rel);
    if (!meta.sized) unsized.push(rel);
    return {
      id: rel.replace(/\.[a-z0-9]+$/i, ""),
      name: meta.name,
      category: titleCase(folder),
      file: rel,
      w: meta.w,
      d: meta.d,
      tint: "light",
    };
  });

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    units: "ft",
    stencils,
  };

  const target = join(root, "manifest.json");
  await writeFile(target, JSON.stringify(manifest, null, 2) + "\n");

  const byCategory = stencils.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + 1;
    return acc;
  }, {});

  console.log(`Wrote ${target}`);
  console.log(`${stencils.length} stencils across ${Object.keys(byCategory).length} categories`);
  for (const [c, n] of Object.entries(byCategory).sort()) console.log(`  ${c}: ${n}`);
  if (unsized.length) {
    console.log(`\n${unsized.length} files have no footprint in the filename and defaulted to 3 by 3 ft:`);
    for (const f of unsized.slice(0, 20)) console.log(`  ${f}`);
    if (unsized.length > 20) console.log(`  and ${unsized.length - 20} more`);
    console.log(`Rename them like sofa_7x3.png to fix the scale.`);
  }
}

main();
