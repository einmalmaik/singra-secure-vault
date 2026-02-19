const sharp = require('sharp');
const path = require('path');

const src = path.join(__dirname, '..', 'new-logo.png');
const pub = path.join(__dirname, '..', 'public');

async function run() {
  // PWA icons
  await sharp(src).resize(192, 192).png().toFile(path.join(pub, 'pwa-192.png'));
  await sharp(src).resize(512, 512).png().toFile(path.join(pub, 'pwa-512.png'));

  // Maskable icons (20% padding, dark background matching --background)
  const bg = { r: 11, g: 18, b: 32, alpha: 1 };

  const inner192 = Math.round(192 * 0.8);
  const pad192 = Math.round((192 - inner192) / 2);
  const buf192 = await sharp(src).resize(inner192, inner192).png().toBuffer();
  await sharp({ create: { width: 192, height: 192, channels: 4, background: bg } })
    .composite([{ input: buf192, left: pad192, top: pad192 }])
    .png().toFile(path.join(pub, 'pwa-192-maskable.png'));

  const inner512 = Math.round(512 * 0.8);
  const pad512 = Math.round((512 - inner512) / 2);
  const buf512 = await sharp(src).resize(inner512, inner512).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
    .composite([{ input: buf512, left: pad512, top: pad512 }])
    .png().toFile(path.join(pub, 'pwa-512-maskable.png'));

  // singra-icon.png for OG/social (256x256)
  await sharp(src).resize(256, 256).png().toFile(path.join(pub, 'singra-icon.png'));

  // favicon as 48x48 PNG saved as .ico (modern browsers support PNG favicons)
  const ico16 = await sharp(src).resize(16, 16).png().toBuffer();
  const ico32 = await sharp(src).resize(32, 32).png().toBuffer();
  const ico48 = await sharp(src).resize(48, 48).png().toBuffer();
  // Simple ICO: just use 32x32 PNG as favicon.ico
  await sharp(src).resize(32, 32).png().toFile(path.join(pub, 'favicon.ico'));

  console.log('All icons generated successfully!');
}

run().catch(e => { console.error(e); process.exit(1); });
