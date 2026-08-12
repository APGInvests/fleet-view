/**
 * fv_icons.js — generate the PWA icon set into ../icons/.
 *
 * Spec (Andy, 2026-08-11): black background #141414, yellow lightning bolt
 * #F2C230, no lettering, bold enough to read at 44 px on a home screen.
 *
 * Two bolt scales:
 *  - "any" icons + apple-touch-icon: bolt fills ~82% of the canvas height.
 *  - "maskable": bolt at ~62% so Android's circle crop (80%-diameter safe
 *    zone) never clips a point.
 *
 * Run:  cd tools && node fv_icons.js
 * Regenerating is idempotent — same inputs, same bytes modulo PNG metadata.
 */
'use strict';
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BG = '#141414', BOLT = '#F2C230';
const OUT = path.join(__dirname, '..', 'icons');

/* One bolt, drawn in a 0..100 box, centered. Chunky kinked bolt — the classic
   silhouette, wide enough to survive 44 px. */
const BOLT_PATH = 'M58 2 L20 56 h18 L34 98 L80 40 h-20 L70 2 Z';

function svg(scalePct, transparent) {
  const s = scalePct, off = (100 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  ${transparent ? '' : `<rect width="100" height="100" fill="${BG}"/>`}
  <g transform="translate(${off} ${off}) scale(${s / 100})">
    <path d="${BOLT_PATH}" fill="${BOLT}"/>
  </g>
</svg>`;
}

async function png(scalePct, size, file) {
  await sharp(Buffer.from(svg(scalePct, false)), { density: 300 })
    .resize(size, size).png().toFile(path.join(OUT, file));
  console.log('  ' + file + '  ' + size + 'px');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await png(82, 192, 'icon-192.png');
  await png(82, 512, 'icon-512.png');
  await png(62, 192, 'icon-maskable-192.png');
  await png(62, 512, 'icon-maskable-512.png');
  await png(82, 180, 'apple-touch-icon.png');
  await png(82, 32, 'favicon-32.png');
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg(82, false));
  console.log('  favicon.svg');
  console.log('done → ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
