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
  for (const [name, shape] of [['ic_prysm', 'square'], ['ic_prysm_round', 'round']]) {
    jobs.push(write(join(RES, `mipmap-${d}`, `${name}.png`), await sharp(full).composite([{ input: mask(legacy, shape), blend: 'dest-in' }]).png().toBuffer()));
  }
  // the hexagon stays inside the 66dp safe zone of the adaptive icon
  jobs.push(write(join(RES, `mipmap-${d}`, 'ic_prysm_foreground.png'), await onBlack(fg, fg, 0.8)));
  // themed icon (Android 13+): the hexagon as a flat silhouette the launcher can tint
  const monoCrop = await sharp(SRC).extract({ left: 189, top: 175, width: 880, height: 880 }).resize(Math.round(fg * 0.62), Math.round(fg * 0.62)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mono = Buffer.alloc(fg * fg * 4);
  const off = Math.round((fg - monoCrop.info.width) / 2);
  for (let y = 0; y < monoCrop.info.height; y++) {
    for (let x = 0; x < monoCrop.info.width; x++) {
      const i = (y * monoCrop.info.width + x) * 3;
      const o = ((y + off) * fg + (x + off)) * 4;
      mono[o] = mono[o + 1] = mono[o + 2] = 255;
      mono[o + 3] = Math.max(0, Math.min(255, (Math.max(monoCrop.data[i], monoCrop.data[i + 1], monoCrop.data[i + 2]) - 24) * 4));
    }
  }
  jobs.push(sharp(mono, { raw: { width: fg, height: fg, channels: 4 } }).png().toFile(join(RES, `mipmap-${d}`, 'ic_prysm_mono.png')));
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

// notification icon: Android only uses the shape (alpha) of a status-bar icon, so it is a white hexagon
// cut out of the logo (the black background and the gap between the halves become transparent)
const crop = await sharp(SRC).extract({ left: 189, top: 175, width: 880, height: 880 }).toBuffer();
for (const [d, px] of Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 })) {
  const { data, info } = await sharp(crop).resize(px, px).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const m = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 255;
    out[i * 4 + 3] = Math.max(0, Math.min(255, (m - 24) * 4));
  }
  const file = join(RES, `drawable-${d}`, 'ic_stat_prysm.png');
  mkdirSync(dirname(file), { recursive: true });
  jobs.push(sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file));
}

// web: favicon and the logo shown inside the app
jobs.push(write(join(root, 'public', 'favicon.png'), await sharp(await onBlack(192, 192, 1)).composite([{ input: mask(192, 'square'), blend: 'dest-in' }]).png().toBuffer()));
jobs.push(write(join(root, 'src', 'assets', 'logo.png'), await sharp(await onBlack(256, 256, 1)).composite([{ input: mask(256, 'square'), blend: 'dest-in' }]).png().toBuffer()));

await Promise.all(jobs);
console.log(`wrote ${jobs.length} images`);
