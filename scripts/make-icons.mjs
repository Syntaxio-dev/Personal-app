// Builds every logo-derived image from assets/prysm-logo.jpeg (a purple hexagon on pure black):
//   Android launcher icons (legacy, round and adaptive), splash screens, the Android 12 splash icon,
//   the favicon and the in-app logo.
//
// Run after changing the logo:   npm i --no-save sharp && node scripts/make-icons.mjs
// (sharp is only needed here, so it is not a project dependency.)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'assets', 'prysm-logo.jpeg');
const RES = join(root, 'android', 'app', 'src', 'main', 'res');
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };

const write = (path, buf) => { mkdirSync(dirname(path), { recursive: true }); return sharp(buf).png({ compressionLevel: 9 }).toFile(path); };

// the logo scaled to `frac` of a square (or rectangular) canvas, centred on black
async function onBlack(w, h, frac) {
  const size = Math.round(Math.min(w, h) * frac);
  const logo = await sharp(SRC).resize(size, size).toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: BLACK } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
}

const mask = (size, shape) => {
  const r = shape === 'round' ? size / 2 : size * 0.22;
  return Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
};

const dpis = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const jobs = [];

// launcher icons: legacy square + round (Android 7), adaptive foreground (Android 8+)
for (const [d, k] of Object.entries(dpis)) {
  const legacy = Math.round(48 * k), fg = Math.round(108 * k);
  const full = await onBlack(legacy, legacy, 1);
  for (const [name, shape] of [['ic_launcher', 'square'], ['ic_launcher_round', 'round']]) {
    jobs.push(write(join(RES, `mipmap-${d}`, `${name}.png`), await sharp(full).composite([{ input: mask(legacy, shape), blend: 'dest-in' }]).png().toBuffer()));
  }
  // the hexagon stays inside the 66dp safe zone of the adaptive icon
  jobs.push(write(join(RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), await onBlack(fg, fg, 0.8)));
}

// splash screens (used before Android 12)
const portrait = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [d, [w, h]] of Object.entries(portrait)) {
  jobs.push(write(join(RES, `drawable-port-${d}`, 'splash.png'), await onBlack(w, h, 0.5)));
  jobs.push(write(join(RES, `drawable-land-${d}`, 'splash.png'), await onBlack(h, w, 0.5)));
}
jobs.push(write(join(RES, 'drawable', 'splash.png'), await onBlack(480, 320, 0.5)));

// Android 12+ splash icon: the system crops it to a circle, so keep the hexagon well inside
jobs.push(write(join(RES, 'drawable-nodpi', 'splash_icon.png'), await onBlack(1152, 1152, 0.7)));

// web: favicon and the logo shown inside the app
jobs.push(write(join(root, 'public', 'favicon.png'), await sharp(await onBlack(192, 192, 1)).composite([{ input: mask(192, 'square'), blend: 'dest-in' }]).png().toBuffer()));
jobs.push(write(join(root, 'src', 'assets', 'logo.png'), await sharp(await onBlack(256, 256, 1)).composite([{ input: mask(256, 'square'), blend: 'dest-in' }]).png().toBuffer()));

await Promise.all(jobs);
console.log(`wrote ${jobs.length} images`);
