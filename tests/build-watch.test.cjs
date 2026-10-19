const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

test('TypeScript build metadata does not reload an active wallet page', {timeout:30_000}, async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
  try {
    const page=await browser.newPage();
    await page.goto('http://127.0.0.1:1430/onboarding');
    await page.getByText('Create New Wallet',{exact:true}).waitFor();
    await page.evaluate(()=>{window.buildWatchProbe='preserved';});
    let navigations=0;
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
    const compiler=spawn(process.execPath,['node_modules/typescript/bin/tsc','-b','--force'],{stdio:'pipe'});
    let output='';
    compiler.stdout.on('data',chunk=>{output+=chunk;});
    compiler.stderr.on('data',chunk=>{output+=chunk;});
    const code=await new Promise((resolve,reject)=>{compiler.once('error',reject);compiler.once('exit',resolve);});
    assert.equal(code,0,output);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(()=>window.buildWatchProbe),'preserved');
    assert.equal(navigations,0,'generated build metadata caused a page reload');
  } finally {await browser.close();}
});
