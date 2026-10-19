import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/components/burst-icons.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const icons = {};
new Function('exports', 'require', compiled)(icons, createRequire(import.meta.url));

for (const app of [root, path.resolve(root, '../node-gui')]) {
  if (fs.readFileSync(path.join(app, 'src/components/burst-icons.tsx'), 'utf8') !== source) {
    throw new Error('Wallet and node icon components differ. Reconcile them before exporting.');
  }
  const out = path.join(app, 'public/icons');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, component] of Object.entries({ burst: 'BurstMark', brn: 'BrnIcon', trst: 'TrstIcon', wallet: 'WalletIcon', node: 'NodeIcon' })) {
    const svg = renderToStaticMarkup(createElement(icons[component], { width: 512, height: 512 }));
    fs.writeFileSync(path.join(out, name + '.svg'), svg + '\n');
    if (name === 'burst') fs.writeFileSync(path.join(app, 'public/burst-mark.svg'), svg + '\n');
  }
}
console.log('Exported five vector icons to both apps.');
