import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { base, rpcUrl } from './native-env.mjs';
async function script(script, args=[]) {
  const {value} = await (await fetch(`${base}/execute/sync`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script,args}),signal:AbortSignal.timeout(10000)})).json();
  assert(!value?.error, JSON.stringify(value)); return value;
}
async function click(text) {
  assert(await script(`const buttons=[...document.querySelectorAll('button,[role="button"]')];const b=buttons.find(b=>b.textContent.trim()===arguments[0]) ?? buttons.find(b=>b.textContent.includes(arguments[0]));if(!b || b.disabled)return false;b.click();return true`,[text]), `Button unavailable: ${text}`);
}
async function wait(condition) {
  for(let i=0;i<80;i++){if(await script(`return ${condition}`))return;await new Promise(r=>setTimeout(r,100));}
  assert.fail('Native UI did not reach expected state');
}
console.log('Native onboarding: opening the in-app route');
await script(`history.pushState({},'', '/onboarding');dispatchEvent(new PopStateEvent('popstate'));return true;`);
console.log('Native onboarding: checking the recovery flow');
await wait(`document.body.innerText.includes('Create New Wallet')`);
await click('Create New Wallet');
await wait(`document.body.innerText.includes('Generate Wallet')`);
await click('Generate Wallet');
await wait(`!!document.querySelector('[aria-label="Recovery phrase"]')`);
assert.equal(await script(`return document.querySelector('[aria-label="Recovery phrase"]').children.length`),24);
assert.equal(await script(`return [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Continue without file')).disabled`),true);
// Disposable test identity. Do not photograph, log or persist its phrase.
await script(`document.querySelector('input[type="checkbox"]').click()`);
await click('Continue without file');
await wait(`document.body.innerText.includes('Go to Dashboard')`);
await script(`document.querySelector('.settings-disclosure summary').click();return true;`);
await script(`const select=document.querySelector('select');select.value='any';select.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
await wait(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Go to Dashboard')?.disabled`);
await click('Save group rules');
await wait(`document.body.innerText.includes('Trust at least one group directly, or use protocol checks only.')`);
assert.equal(await script(`return [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Go to Dashboard').disabled`),true);
await script(`const select=document.querySelector('select');select.value='protocol';select.dispatchEvent(new Event('change',{bubbles:true}));return true;`);
await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Go to Dashboard')?.disabled`);
await click('Go to Dashboard');
await wait(`!!document.querySelector('a[href="/settings"]')`);
await script(`document.querySelector('a[href="/settings"]').click()`);
await wait(`document.body.innerText.includes('Receive & merge')`);
assert.equal(await script(`return document.querySelector('input[type="checkbox"]').checked`),true);
assert.equal(await script(`return document.querySelector('#merge-level').value`),'50');
await script(`const input=document.querySelector('#wallet-node-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);input.dispatchEvent(new Event('input',{bubbles:true}))`, [rpcUrl]);
await click('Save');
await script(`document.querySelector('a[href="/"]').click()`);
await wait(`document.querySelector('.connection-state')?.textContent.includes('Connected')`);
await wait(`document.body.innerText.includes('Wallet not verified')`);
assert.equal(await script(`return !!document.querySelector('[aria-label="Recovery phrase"]')`),false);
const screenshot = await (await fetch(`${base}/screenshot`, {signal:AbortSignal.timeout(10000)})).json();
assert.equal(typeof screenshot.value,'string','Native screenshot failed');
await writeFile(join(process.env.NATIVE_EVIDENCE || '/tmp', 'burst-native-wallet-dashboard.png'),Buffer.from(screenshot.value,'base64'));
await click('Lock wallet');
await wait(`document.body.innerText.includes('Create New Wallet')`);
console.log('PASS native onboarding backup gate, 24-word display, configurable group policy with unsaved/invalid-rule navigation guard, default automation settings, local Dev dashboard and lock');
