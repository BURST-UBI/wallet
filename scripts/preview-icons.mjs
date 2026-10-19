import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.PLAYWRIGHT_MODULE) throw new Error('Set PLAYWRIGHT_MODULE to your installed Playwright package directory.');
const { chromium } = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 830 }, deviceScaleFactor: 2 });
  const names = ['brn', 'trst', 'wallet', 'node'];
  const labels = ['BRN', 'TRST', 'Wallet', 'Node'];
  const svg = name => fs.readFileSync(path.join(root, 'public/icons', name + '.svg'), 'utf8');
  const assets = path.join(root, 'dist/assets');
  const css = fs.readdirSync(assets).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(assets, name), 'utf8')).join('\n');
  await page.setContent(`<!doctype html><html><head><style>${css}</style><style>
    html,body{margin:0;height:auto;overflow:auto;background:#f8f8f7;color:#242424;font-family:Arial,sans-serif}
    main{padding:38px 48px}h1{font-size:28px;font-weight:600;letter-spacing:-.8px;margin:6px 0 34px}
    .eyebrow,.label{font-size:12px;color:#696967} .eyebrow{letter-spacing:1.2px;text-transform:uppercase}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:28px;text-align:center}
    .original{border-bottom:1px solid #dfdfdc;padding:0 0 24px;margin-bottom:28px}
    .original img{width:160px;height:92px;object-fit:contain;margin:0 auto 10px}
    .new svg{width:76px;height:76px;margin:0 auto 18px}.new h2{font-size:16px;font-weight:600;margin:0}
    .sizes{display:flex;align-items:center;justify-content:center;gap:22px;height:90px}
    .sizes svg:nth-child(1){width:16px;height:16px}.sizes svg:nth-child(2){width:24px;height:24px}.sizes svg:nth-child(3){width:32px;height:32px}
    .dark{background:#202124;border-radius:20px;padding:28px 0;margin-top:20px}.dark svg{width:40px;height:40px;margin:auto}
    footer{margin-top:28px;display:flex;justify-content:space-between;font-size:12px;color:#696967}
    @media(forced-colors:active){.dark{background:Canvas;border:1px solid CanvasText}}
  </style></head><body><main><div class="eyebrow">Burst · icon family</div><h1>From the whitepaper, redrawn for the app.</h1>
    <section class="grid original">${names.map(name => `<div><img alt="Original ${name}" src="data:image/png;base64,${fs.readFileSync(path.join(root, 'src/assets/burst-docs', name + '.png')).toString('base64')}"><p class="label">Original</p></div>`).join('')}</section>
    <section class="grid new">${names.map((name,i) => `<div>${svg(name)}<h2>${labels[i]}</h2></div>`).join('')}</section>
    <section class="grid">${names.map(name => `<div class="sizes">${svg(name).repeat(3)}</div>`).join('')}</section>
    <section class="grid dark">${names.map(name => `<div>${svg(name)}</div>`).join('')}</section>
    <footer><span>16 / 24 / 32 px · vector geometry</span><span>Solid token centers · distinct wallet and node silhouettes</span></footer>
  </main></body></html>`);
  await page.locator('.original img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  const out = path.join(root, 'docs/design/previews');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'whitepaper-icon-family.png'), fullPage: true });
  await page.emulateMedia({ forcedColors: 'active' });
  const contrast = await page.locator('.new [data-burst-icon]').evaluateAll(icons => icons.map(icon => ({
    name: icon.dataset.burstIcon,
    body: getComputedStyle(icon.querySelector('.burst-icon-body')).fill,
    cutout: getComputedStyle(icon.querySelector('.burst-icon-cutout')).fill,
    core: icon.querySelector('.burst-icon-core') ? getComputedStyle(icon.querySelector('.burst-icon-core')).fill : null,
  })));
  assert.equal(contrast.length, 4);
  for (const icon of contrast) {
    assert.notEqual(icon.body, icon.cutout, icon.name + ' must retain its cutout');
    assert.equal(icon.core, icon.body, icon.name + ' center must retain contrast');
  }
  await page.screenshot({ path: path.join(out, 'whitepaper-icon-family-forced-colors.png'), fullPage: true });
  console.log('Rendered preview and verified all four icons in forced-colors mode.', contrast);
} finally {
  await browser.close();
}
