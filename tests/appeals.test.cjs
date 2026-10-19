// Synthetic IPC contracts. Native signing and network recovery are separate checks.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openGovernance} = require('./browser-wallet.cjs');
let browser;
before(async () => { browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH}); });
after(async () => { await browser?.close(); });
const target = 'brst_' + '3'.repeat(60);

async function fixture(options = {}) {
  const page = await browser.newPage({viewport:{width:options.width || 1000,height:850}, reducedMotion:'reduce'});
  await page.addInitScript(options => {
    window.isTauri = true;
    window.calls = [];
    const account = 'brst_' + '1'.repeat(60);
    window.__TAURI_INTERNALS__ = {invoke: async (command,args) => {
      window.calls.push({command,args});
      switch(command) {
        case 'import_private_key': return {address:account,verification_state:options.revoked?'revoked':'verified'};
        case 'get_node_info': return {block_count:7,network:'dev',faucet_enabled:false};
        case 'get_account_info': return {address:account,verification_state:options.revoked?'revoked':'verified',brn_balance:'0',block_count:7};
        case 'get_verification_status': return {state:options.revoked?'revoked':'verified',endorsement_count:0,endorsement_threshold:1,endorsers:[],verifier_votes:[],challenge_active:false,selection_available:false};
        case 'get_appeal_review':
          if (options.lookupError) throw new Error('Node unavailable');
          return {account:args.target,enabled:options.enabled!==false,challenge_active:!!options.active,required_stake:'50000000000000000001',
            outcome:options.empty?null:{hash:'a'.repeat(64),checkpoint:'b'.repeat(64),reason:'Fraud',legitimate:false,completed_at:1790000000}};
        case 'appeal_wallet':
          await new Promise(resolve => setTimeout(resolve,100));
          if (window.submitError) throw new Error(window.submitError);
          return {accepted:true,hash:'c'.repeat(64)};
        case 'get_governance_proposals': return {proposals:[]};
        case 'get_constitution_context': return {enabled:false,document:{version:'0',articles:[]},revision:'fixture',endorsement_cost:'1'};
        case 'get_scoped_delegations': return {enabled:false,network:'Dev',genesis:'c'.repeat(64),parameters:[],entries:[],cursor:null};
        case 'begin_automation': return '1';
        case 'cancel_automation': return null;
        case 'get_pending': return {blocks:[]};
        case 'get_brn_components': return {verified_at:0,total_burned:'0',total_staked:'0',accrual_active:false,accrual_stopped_at:1,as_of:1,rate_history:[{rate:'0',start:0,end:null}]};
        case 'get_trst_balance': return {active:'0',expired:'0',revoked:'0'};
        default: throw new Error('Unexpected command: '+command);
      }
    }};
  }, options);
  await openGovernance(page);
  await page.evaluate(() => { history.pushState({},'','/verification'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('heading',{name:'Verification',exact:true}).waitFor();
  await page.getByText('Appeal a decision',{exact:true}).click();
  return page;
}
async function lookup(page) {
  await page.getByLabel('Wallet address',{exact:true}).fill(target);
  await page.getByLabel('Wallet address',{exact:true}).press('Enter');
}

test('lookup, exact stake, keyboard cancellation and one reviewed submission', async () => {
  const page = await fixture();
  try {
    await lookup(page);
    await page.getByText('50.000000000000000001 BRN',{exact:true}).waitFor();
    await page.getByRole('region',{name:'Appeal a decision',exact:true}).screenshot({path:'/tmp/burst-appeal-desktop.png'});
    await page.getByRole('button',{name:'Review appeal',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Review appeal',exact:true}).evaluate(el => el === document.activeElement),true);
    assert.equal(await page.evaluate(() => window.calls.filter(c=>c.command==='appeal_wallet').length),0);
    await page.getByRole('button',{name:'Review appeal',exact:true}).press('Enter');
    await page.getByRole('button',{name:'Stake and appeal',exact:true}).click();
    await page.getByRole('heading',{name:'Transaction confirmed',exact:true}).waitFor();
    const submissions = await page.evaluate(() => window.calls.filter(c=>c.command==='appeal_wallet'));
    assert.equal(submissions.length,1);
    assert.equal(submissions[0].args.expectedAccount,'brst_'+'1'.repeat(60));
    assert.equal(submissions[0].args.reviewed.outcome.hash,'a'.repeat(64));
    assert.equal(submissions[0].args.reviewed.required_stake,'50000000000000000001');
    assert.equal(await page.getByRole('button',{name:'Review appeal',exact:true}).isDisabled(),true);
  } finally { await page.close(); }
});

test('gate, revoked sponsor, active review, missing outcome and lookup failure cannot sign', async () => {
  for (const options of [{enabled:false},{revoked:true},{active:true},{empty:true},{lookupError:true}]) {
    const page = await fixture(options);
    try {
      await lookup(page);
      await page.getByText(options.lookupError?'Couldn’t load this decision.':options.empty?'No certified challenge outcome is available to appeal.':'Fraud confirmed',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Review appeal',exact:true}).count(),0);
      assert.equal(await page.evaluate(() => window.calls.some(c=>c.command==='appeal_wallet')),false);
    } finally { await page.close(); }
  }
});

test('preflight errors are not uncertain submissions and a changed connection closes review', async () => {
  const page = await fixture();
  try {
    await lookup(page);
    await page.getByRole('button',{name:'Review appeal',exact:true}).click();
    await page.evaluate(() => { window.submitError='appeal not submitted: node RPC error: request failed'; });
    await page.getByRole('button',{name:'Stake and appeal',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Confirmation pending',exact:true}).count(),0);
    await page.evaluate(async () => { const {useWalletStore}=await import(window.storeUrl); useWalletStore.setState({rpcUrl:'http://127.0.0.1:9999'}); });
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button',{name:'Stake and appeal',exact:true}).count(),0);
  } finally { await page.close(); }
});

test('320px touch layout keeps values and review controls in bounds in both themes', async () => {
  const page = await fixture({width:320});
  try {
    await lookup(page);
    await page.getByText('Fraud confirmed',{exact:true}).waitFor();
    for (const dark of [false,true]) {
      await page.evaluate(dark => document.body.classList.toggle('dark',dark),dark);
      const region = page.getByRole('region',{name:'Appeal a decision',exact:true});
      await region.scrollIntoViewIfNeeded();
      assert.equal(await region.evaluate(el => el.scrollWidth <= el.clientWidth),true);
      await region.screenshot({path:`/tmp/burst-appeal-${dark?'dark':'light'}.png`});
    }
    await page.getByRole('button',{name:'Review appeal',exact:true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth),true);
    await dialog.screenshot({path:'/tmp/burst-appeal-confirm.png'});
  } finally { await page.close(); }
});

test('a native signer mismatch stays unsubmitted and a wallet switch discards the review', async () => {
  const page = await fixture();
  try {
    await lookup(page);
    await page.getByRole('button',{name:'Review appeal',exact:true}).click();
    await page.evaluate(() => { window.submitError='appeal not submitted: Your wallet changed. Review this appeal again.'; });
    await page.getByRole('button',{name:'Stake and appeal',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('heading',{name:'Confirmation pending',exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Transaction confirmed',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Stake and appeal',exact:true}).isEnabled(),true);
    await page.evaluate(async () => {
      const {useWalletStore}=await import(window.storeUrl);
      useWalletStore.setState({address:'brst_'+'2'.repeat(60)});
    });
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.calls.filter(c=>c.command==='appeal_wallet').length),1);
  } finally { await page.close(); }
});
