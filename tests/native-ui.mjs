import assert from 'node:assert/strict';
import { base } from './native-env.mjs';

export async function script(code, args = [], async = false) {
  const response = await fetch(`${base}/execute/${async ? 'async' : 'sync'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: code, args }), signal: AbortSignal.timeout(45000),
  });
  const { value } = await response.json();
  assert(response.ok && !value?.error, JSON.stringify(value));
  return value;
}
export async function wait(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await script(`return ${condition}`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Onboarding can display recovery words. Never copy the page into test logs.
  assert.fail(`Native UI did not reach ${condition}`);
}
export async function click(text) {
  assert(await script(`const button = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? b.textContent.trim()) === arguments[0]);
    if (!button || button.disabled) return false; button.click(); return true;`, [text]), `Unavailable button: ${text}`);
}
export async function fill(id, value) {
  assert(await script(`const input = document.getElementById(arguments[0]); if (!input || input.disabled) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, arguments[1]);
    input.dispatchEvent(new Event('input', { bubbles: true })); return true;`, [id, value]), `Unavailable input: ${id}`);
}
