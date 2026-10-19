import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('src/components/burst-icons.tsx', root), 'utf8');
const icons = {};
new Function('exports', 'require', ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText)(icons, createRequire(import.meta.url));

test('both apps use the same whitepaper-derived icon geometry', () => {
  assert.equal(source, fs.readFileSync(new URL('../node-gui/src/components/burst-icons.tsx', root), 'utf8'));
  assert.doesNotMatch(source, /lucide-react|<image|data:image/);
});

test('standalone SVG assets are generated from the actual React components', () => {
  for (const [name, component] of Object.entries({burst:'BurstMark', brn:'BrnIcon', trst:'TrstIcon', wallet:'WalletIcon', node:'NodeIcon'})) {
    const expected = renderToStaticMarkup(createElement(icons[component], {width:512,height:512}));
    for (const app of ['', '../node-gui/']) {
      assert.equal(fs.readFileSync(new URL(app+'public/icons/'+name+'.svg',root),'utf8').trim(), expected);
    }
    assert.match(expected, /viewBox="0 0 24 24"/);
    assert.match(expected, /aria-hidden="true"/);
    assert.match(expected, /focusable="false"/);
  }
});

test('token centers stay solid and decorative symbols expose no extra accessible names', () => {
  const brn=renderToStaticMarkup(createElement(icons.BrnIcon,{tone:'monochrome'}));
  const trst=renderToStaticMarkup(createElement(icons.TrstIcon,{tone:'monochrome'}));
  assert.match(brn,/class="burst-icon-core"/);
  assert.match(trst,/class="burst-icon-core"/);
  for (const component of [icons.TrstIcon, icons.WalletIcon, icons.BurstMark]) {
    const color = renderToStaticMarkup(createElement(component));
    assert.match(color, /class="burst-icon-core"[^>]+fill="#2059A6"/);
    assert.doesNotMatch(color, /burst-icon-ring/);
  }
  assert.doesNotMatch(brn+trst,/aria-label=|role="img"|<title/);
});

test('wallet and node launchers use distinct generated asset families', () => {
  for (const [app, name] of [['','wallet'],['../node-gui/','node']]) {
    const html=fs.readFileSync(new URL(app+'index.html',root),'utf8');
    assert.match(html,new RegExp('/icons/'+name+'\\.svg'));
    const config=JSON.parse(fs.readFileSync(new URL(app+'src-tauri/tauri.conf.json',root),'utf8'));
    for(const file of config.bundle.icon) {
      assert.match(file,/^icons-whitepaper\//);
      assert.ok(fs.statSync(new URL(app+'src-tauri/'+file,root)).size > 0);
    }
  }
});
