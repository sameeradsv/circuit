const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SVG_PATH = path.resolve(__dirname, '../logo.svg');
const OUT_DIR = path.resolve(__dirname, '../frontend/public/icons');

const svgContent = fs.readFileSync(SVG_PATH, 'utf8');

const sizes = [
  { name: 'icon-192.png',          size: 192, maskable: false },
  { name: 'icon-512.png',          size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const { name, size, maskable } of sizes) {
    // Maskable icons need ~10% safe-zone padding (spec: 40% can be clipped)
    const padding = maskable ? Math.round(size * 0.1) : 0;
    const inner = size - padding * 2;

    const html = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${size}px; height: ${size}px;
    background: #0f0f0f;
    display: flex; align-items: center; justify-content: center;
  }
  img { width: ${inner}px; height: ${inner}px; }
</style>
</head>
<body>
  <img src="data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}"/>
</body>
</html>`;

    await page.setViewportSize({ width: size, height: size });
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buffer = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
    fs.writeFileSync(path.join(OUT_DIR, name), buffer);
    console.log(`Generated ${name} (${size}x${size}${maskable ? ', maskable' : ''})`);
  }

  await browser.close();
})();
