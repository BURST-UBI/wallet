// Run with the Vite dev server on :1430. PLAYWRIGHT_MODULE can point to an existing installation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
before(async () => {
  browser = process.env.BROWSER_ENGINE === 'webkit'
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
});
after(async () => { await browser?.close(); });

async function wallet(network, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 750 }, ...options });
  page.on('pageerror', error => console.error('Wallet UI error:', error.message));
  await page.addInitScript((network) => {
    window.isTauri = true;
    window.offline = false;
    window.calls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.calls.push({ command, args });
      if (window.offline) throw new Error('Connection refused');
      switch (command) {
        case 'watch_wallet': {
          if (args.address !== 'brst_test_wallet') throw new Error('Invalid wallet address');
          return {address:args.address, verification_state:'Unknown', watch_only:true};
        }
        case 'lock_wallet': return null;
        case 'signing_device_status': return {head:'1'.repeat(64),grant:'2'.repeat(64),params_hash:'3'.repeat(64),active_here:false,enrolled:true};
        case 'take_over_signing': {
          if (window.takeoverFailure) throw new Error(window.takeoverFailure);
          return null;
        }
        case 'get_node_info': return { block_count: 7, network, faucet_enabled: network === 'test' };
        case 'maintain_wallet': return { received:0, merged:0, held:0 };
        case 'begin_automation': return String(window.calls.filter(call=>call.command==='begin_automation').length);
        case 'cancel_automation': return null;
        case 'get_account_info': return {
          address: 'brst_test_wallet', verification_state: 'verified', verified_at: 1700000000,
          brn_balance: '1234567890123456789', total_brn_burned: '999000000000000000000',
          total_brn_staked: '1000000000000000000', block_count: 7,
        };
        case 'get_brn_components': return window.brnOverride ?? {
          verified_at: 0, total_burned: '0', total_staked: '0', accrual_active: false,
          accrual_stopped_at: 1, as_of: 1,
          rate_history: [{ rate: '1234567890123456789', start: 0, end: null }],
        };
        case 'get_trst_balance': return { active: '2000000000000000000', expired: '1000000000000000000', revoked: '0' };
        case 'get_trst_portfolio': return window.mergePortfolio ?? {total_active:'2000000000000000000',total_expired:'0',total_revoked:'0',batches:[{origin:'a'.repeat(64),amount:'2000000000000000000',originator:'brst_fixture_origin',timestamp:1700000000,expiry_at:null,status:'active',chain_length:1}]};
        case 'merge_trst':
          await new Promise(resolve => setTimeout(resolve, 100));
          if (window.mergeFailure) throw new Error(window.mergeFailure);
          return {accepted:true,hash:'e'.repeat(64)};
        case 'get_governance_proposals': return {proposals:[]};
        case 'get_constitution_context': return {enabled:false,document:{version:'0',articles:[]},revision:'fixture',endorsement_cost:'1'};
        case 'get_scoped_delegations': return {enabled:false,network:'Dev',genesis:'c'.repeat(64),entries:[],cursor:null,parameters:[]};
        case 'get_pending': return { blocks: [] };
        case 'get_account_history': return { history: [] };
        default: throw new Error('Unexpected test command: ' + command);
      }
    } };
  }, network);
  await page.goto('http://127.0.0.1:1430/');
  await page.getByText('Create New Wallet', { exact:true }).waitFor();
  // Fixture injection only; no production keys or backend transaction behavior is mocked as E2E.
  await page.evaluate(async () => {
    // Use the exact module URL loaded by Vite (including its HMR timestamp),
    // otherwise an edited dev server can instantiate a second Zustand store.
    window.fixtureStoreUrl = performance.getEntriesByType('resource').find(e => e.name.includes('/src/stores/wallet-store.ts'))?.name ?? '/src/stores/wallet-store.ts';
    const { useWalletStore } = await import(window.fixtureStoreUrl);
    useWalletStore.setState({ address: 'brst_test_wallet', isLocked: false });
    history.pushState({}, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByText('1.234567', { exact: true }).waitFor({timeout:10000}).catch(async error => {
    console.error('Wallet fixture state:', await page.locator('body').innerText());
    throw error;
  });
  return page;
}

for (const kind of ['transfer','merge','reject']) test(`offline TRST ${kind} keeps its reviewed input and never invokes online submission`,async()=>{
  const page=await wallet('test',{viewport:{width:390,height:844}});
  try {
    await page.evaluate(async kind=>{
      const {useWalletStore}=await import(window.fixtureStoreUrl);
      useWalletStore.getState().setAutomation({autoAccept:false});
      const original=window.__TAURI_INTERNALS__.invoke;
      window.offlineCalls=[];
      window.mergePortfolio={total_active:'2000000000000000002',total_expired:'0',total_revoked:'0',batches:['a','b'].map(id=>({id:id.repeat(64),origin:id.repeat(64),originator:'brst_fixture_origin',amount:'1000000000000000001',status:'active',timestamp:1700000000,expiry_at:null,chain_length:1}))};
      window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
        if(['prepare_offline_review','sign_offline_action','submit_offline_action'].includes(command)) {
          window.offlineCalls.push({command,args});
          if(command==='prepare_offline_review')return {context:'exact '+kind+' 1000000000000000001',review:{title:'Saved '+kind,fields:[['Amount','1.000000000000000001 TRST']]}};
          if(command==='sign_offline_action'){await new Promise(resolve=>setTimeout(resolve,80));return 'c'.repeat(64);}
          return {accepted:true,hash:'c'.repeat(64)};
        }
        if(command==='get_offline_payment')return null;
        if(command==='get_pending'&&kind==='reject')return {blocks:[{hash:'a'.repeat(64),source:'brst_sender',amount:'1000000000000000001',return_credit:false}]};
        return original(command,args);
      };
    },kind);
    if(kind==='transfer') {
      await page.getByRole('button',{name:'Transfer',exact:true}).click();
      await page.getByLabel('Recipient address',{exact:true}).fill('brst_recipient');
      await page.getByLabel('Amount (TRST)',{exact:true}).fill('1.000000000000000001');
      await page.getByRole('button',{name:'Transfer TRST',exact:true}).click();
    } else if(kind==='merge') {
      await page.evaluate(()=>{history.pushState({},'', '/portfolio');dispatchEvent(new PopStateEvent('popstate'));});
      await page.getByRole('button',{name:'Combine batches',exact:true}).click();
      await page.getByRole('dialog').getByRole('checkbox').nth(0).check();
      await page.getByRole('dialog').getByRole('checkbox').nth(1).check();
      await page.getByRole('dialog').getByRole('button',{name:'Review',exact:true}).click();
    } else {
      await page.getByRole('button',{name:'Receive',exact:true}).click();
      await page.getByRole('button',{name:'Review',exact:true}).click();
      await page.getByRole('button',{name:'Return payment…',exact:true}).click();
    }
    await page.getByRole('button',{name:'Sign offline',exact:true}).click();
    const dialog=page.getByRole('dialog').last();
    await dialog.getByRole('button',{name:'Prepare action',exact:true}).click();
    await dialog.getByText('1.000000000000000001 TRST',{exact:true}).waitFor();
    const request=await page.evaluate(()=>window.offlineCalls[0].args.request);
    assert.equal(request.kind,kind);
    if(kind==='transfer')assert.deepEqual(request,{kind,to:'brst_recipient',amount:'1000000000000000001',origin:'a'.repeat(64)});
    if(kind==='merge')assert.equal(request.selected.length,2);
    if(kind==='reject')assert.equal(request.payment,'a'.repeat(64));
    await dialog.getByRole('button',{name:'Sign and save',exact:true}).dblclick();
    await dialog.getByRole('button',{name:'Submit saved action',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Submit saved action',exact:true}).click();
    await dialog.getByText('The network confirmed this action.').waitFor();
    const calls=await page.evaluate(()=>window.offlineCalls);
    assert.deepEqual(calls.map(call=>call.command),['prepare_offline_review','sign_offline_action','submit_offline_action']);
    assert.equal(calls[1].args.context,'exact '+kind+' 1000000000000000001');
    assert.equal(calls[2].args.expectedHash,'c'.repeat(64));
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>['transfer_trst','merge_trst','reject_pending'].includes(call.command)).length),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  } finally {await page.close();}
});

test('revocation notice announces amounts, exposes origins and clears after restoration', async () => {
  const page = await wallet('test', {viewport:{width:390,height:844},hasTouch:true});
  try {
    await page.clock.install();
    await page.evaluate(() => {
      const original=window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke=async (command,args)=> {
        if(command==='get_trst_origins') return {origin:args.origin,complete:true,confirmed:true,origins:[{hash:'a'.repeat(64),originator:'brst_revoked_creator',timestamp:1700000000,confirmed:true,revoked:true}]};
        return original(command,args);
      };
      window.mergePortfolio={total_active:'0',total_expired:'0',total_revoked:'1000000000000000001',batches:[{id:'b'.repeat(64),origin:'a'.repeat(64),originator:'brst_revoked_creator',amount:'1000000000000000001',status:'revoked',timestamp:1700000000,expiry_at:null,chain_length:1}]};
    });
    await page.clock.fastForward(11000);
    const notice=page.getByRole('region',{name:'TRST revocation notice'});
    await notice.getByRole('status').filter({hasText:'1.000000 TRST revoked.'}).waitFor();
    const button=notice.getByRole('button',{name:'Review affected origins'});
    const bounds=await button.boundingBox();
    assert(bounds.height>=44);
    await button.tap();
    await notice.getByText('brst_revoked_creator',{exact:true}).waitFor();
    assert((await notice.innerText()).includes('1.000000000000000001 TRST'));
    assert((await notice.innerText()).includes('Revoked origin'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.REVOCATION_SCREENSHOT) await page.screenshot({path:process.env.REVOCATION_SCREENSHOT});
    await page.clock.fastForward(11000);
    assert.equal(await page.getByRole('region',{name:'TRST revocation notice'}).count(),1);
    await page.evaluate(()=>{window.offline=true;});
    await page.clock.fastForward(11000);
    await notice.getByText('Unable to refresh. Showing the last known revocation.').waitFor();
    assert((await notice.innerText()).includes('1.000000 TRST revoked.'));
    await page.evaluate(()=>{window.offline=false;window.mergePortfolio={total_active:'1000000000000000001',total_expired:'0',total_revoked:'0',batches:[]};});
    await page.clock.fastForward(11000);
    await notice.getByRole('button').waitFor({state:'detached'});
    assert.equal(await notice.innerText(),'');
  } finally { await page.close(); }
});

test('revocation notice ignores stale wallet and node responses', async () => {
  const page=await wallet('test');
  try {
    await page.clock.install();
    await page.evaluate(()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke=(command,args)=>command==='get_trst_portfolio'
        ? new Promise(resolve=>{window.revocationRequests??=[];window.revocationRequests.push({args,resolve});}) : original(command,args);
    });
    await page.clock.fastForward(11000);
    await page.waitForFunction(()=>window.revocationRequests?.length===1);
    await page.evaluate(async()=>{
      const {useWalletStore}=await import(window.fixtureStoreUrl);
      useWalletStore.setState({address:'brst_second_wallet',rpcUrl:'http://127.0.0.1:7079'});
    });
    await page.waitForFunction(()=>window.revocationRequests?.some(request=>request.args.expectedAccount==='brst_second_wallet'&&request.args.rpcUrl==='http://127.0.0.1:7079'));
    await page.evaluate(()=>{
      // StrictMode can mount the replacement twice; identify requests by owner,
      // not an assumed call count. Resolve old responses last.
      for(const request of window.revocationRequests.filter(request=>request.args.expectedAccount==='brst_second_wallet')) request.resolve({total_active:'0',total_expired:'0',total_revoked:'0',batches:[]});
      for(const request of window.revocationRequests.filter(request=>request.args.expectedAccount==='brst_test_wallet')) request.resolve({total_active:'0',total_expired:'0',total_revoked:'9000000000000000000',batches:[]});
    });
    await page.clock.fastForward(1);
    assert.equal(await page.getByRole('region',{name:'TRST revocation notice'}).innerText(),'');
    assert(await page.evaluate(()=>window.revocationRequests.some(request=>request.args.expectedAccount==='brst_second_wallet')));
  } finally { await page.close(); }
});

test('accrual overflow stays unavailable even when burns reduce the net balance', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const max=((1n<<128n)-1n).toString();
      window.brnOverride={verified_at:0,total_burned:max,total_staked:'0',accrual_active:false,accrual_stopped_at:2,as_of:2,rate_history:[{rate:max,start:0,end:null}]};
      history.pushState({},'', '/portfolio');dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByRole('heading',{name:'Your TRST',exact:true}).waitFor();
    await page.evaluate(()=>{history.pushState({},'', '/');dispatchEvent(new PopStateEvent('popstate'));});
    await page.getByRole('status').filter({hasText:'Accrual data unavailable. Retrying…'}).waitFor();
    const balances=page.getByRole('region',{name:'Wallet balances'});
    assert.equal(await balances.locator('.balance-value').first().innerText(),'—');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>['pay','transfer_trst'].includes(c.command)).length),0);
  } finally {await page.close();}
});

test('manual combination reviews active and expired batches without mixing or signing on cancel', async () => {
  for (const status of ['active', 'expired']) {
    const page = await wallet('test', {viewport:{width:390,height:844}});
    try {
      await page.evaluate(status => {
        window.mergePortfolio = {total_active:'14',total_expired:'14',total_revoked:'7',batches:
          [status,status,status === 'active' ? 'expired' : 'active','revoked'].map((state,index)=>({
            id:String(index+1).repeat(64),origin:'a'.repeat(64),amount:'7',originator:'brst_fixture_origin',timestamp:1700000000,expiry_at:1800000000+index,status:state,chain_length:1,
          }))};
        history.pushState({},'', '/portfolio');dispatchEvent(new PopStateEvent('popstate'));
      }, status);
      const trigger = page.getByRole('button',{name:'Combine batches',exact:true});
      await trigger.click();
      const dialog = page.getByRole('dialog');
      assert.equal(await dialog.getByRole('checkbox').count(),3,'revoked batch is not selectable');
      await dialog.getByRole('checkbox').nth(0).check();
      assert.equal(await dialog.getByRole('checkbox').nth(2).isDisabled(),true);
      await dialog.getByRole('checkbox').nth(1).check();
      await dialog.getByRole('button',{name:'Review',exact:true}).click();
      assert.match(await dialog.innerText(), /0\.000000000000000014 TRST/);
      assert.match(await dialog.innerText(), /Newer TRST may expire sooner/);
      if (status === 'expired') assert.match(await dialog.innerText(), /not spendable TRST/);
      await dialog.getByRole('button',{name:'Close',exact:true}).click();
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
      assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='merge_trst').length),0);
      await trigger.click();
      await dialog.getByRole('checkbox').nth(0).check();
      await dialog.getByRole('checkbox').nth(1).check();
      await dialog.getByRole('button',{name:'Review',exact:true}).click();
      if (status === 'expired') await page.evaluate(()=>{window.mergeFailure='Confirmation pending for '+'e'.repeat(64);});
      await dialog.getByRole('button',{name:'Confirm combination',exact:true}).evaluate(button=>{button.click();button.click();});
      await page.getByRole('heading',{name:status==='active'?'Transaction confirmed':'Confirmation pending',exact:true}).waitFor();
      const calls = await page.evaluate(()=>window.calls.filter(c=>c.command==='merge_trst'));
      assert.equal(calls.length,1);
      assert.equal(calls[0].args.selected.length,2);
      assert(calls[0].args.selected.every(batch=>batch.status===status && batch.amount==='7'));
      assert.equal(calls[0].args.expectedAccount,'brst_test_wallet');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
    } finally {await page.close();}
  }
});

test('signing device review requires confirmation and preserves failure recovery', async () => {
  const page = await wallet('test');
  try {
    await page.getByRole('link',{name:'Settings',exact:true}).first().click();
    const trigger = page.getByRole('button',{name:'Signing device',exact:true});
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Use this device',exact:true}).waitFor();
    assert.match(await dialog.innerText(), /unsent transactions from your previous device/);
    assert.equal(await page.evaluate(() => window.calls.filter(c=>c.command==='take_over_signing').length),0);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
    await trigger.click();
    await page.evaluate(() => {window.takeoverFailure='Confirmation pending. Keep the saved transaction.';});
    await dialog.getByRole('button',{name:'Use this device',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'Confirmation pending'}).waitFor();
    assert.equal(await dialog.getByRole('link',{name:'Review saved transaction'}).getAttribute('href'),'/pay/offline');
    assert.equal(await dialog.getByRole('button',{name:'Use this device',exact:true}).count(),0);
    await page.evaluate(() => {window.takeoverFailure=null;});
    await dialog.getByRole('button',{name:'Check again',exact:true}).click();
    await dialog.getByRole('button',{name:'Use this device',exact:true}).click();
    await dialog.getByRole('heading',{name:'This is your signing device'}).waitFor();
    const calls=await page.evaluate(() => window.calls.filter(c=>c.command==='take_over_signing'));
    assert.equal(calls.length,2);
    assert.equal(calls[1].args.reviewedHead,'1'.repeat(64));
    assert.equal(calls[1].args.reviewedGrant,'2'.repeat(64));
    assert.equal(calls[1].args.reviewedParams,'3'.repeat(64));
    assert.equal(calls[1].args.expectedAccount,'brst_test_wallet');
  } finally {await page.close();}
});

test('view-only onboarding opens public data without signing controls or automation', async () => {
  const page = await wallet('test');
  try {
    await page.goto('http://127.0.0.1:1430/onboarding');
    await page.getByRole('button', {name:'View a wallet by address',exact:true}).click();
    await page.getByLabel('Wallet address',{exact:true}).fill('invalid');
    await page.getByRole('button',{name:'View wallet',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Invalid wallet address'}).waitFor();
    await page.getByLabel('Wallet address',{exact:true}).fill('brst_test_wallet');
    await page.getByLabel('Wallet address',{exact:true}).press('Enter');
    await page.getByText('View only · Opened by address. Signing is unavailable.',{exact:true}).waitFor();
    await page.getByText('1.234567',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pay',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Transfer',exact:true}).count(),0);
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => window.calls.some(call => ['begin_automation','maintain_wallet','pay'].includes(call.command))),false);
    await page.evaluate(() => { history.pushState({},'', '/pay/offline'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.waitForURL('http://127.0.0.1:1430/');
    await page.getByRole('link',{name:'Settings',exact:true}).first().click();
    assert.equal(await page.getByRole('button',{name:'Export Private Key',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Change Representative',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Lock Wallet',exact:true}).click();
    await page.waitForURL('**/onboarding');
  } finally { await page.close(); }
});

test('outgoing pending TRST is separate from available money and unknown is not zero', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.outgoingPending = '5000000000000000000';
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const result = await original(command, args);
        if (command === 'get_trst_balance') return { ...result, pending: window.outgoingPending };
        if (command === 'get_trst_portfolio') return { ...result, total_pending: window.outgoingPending };
        return result;
      };
    });
    for (const [amount, label] of [['5000000000000000000', '5.000000'], ['0', '0.000000'], [null, 'Unavailable']]) {
      await page.evaluate(amount => {
        window.outgoingPending = amount;
        history.pushState({}, '', '/history'); dispatchEvent(new PopStateEvent('popstate'));
      }, amount);
      await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Wallet', exact: true }).click();
      const summary = page.getByText('TRST breakdown', { exact: true });
      await summary.focus();
      await page.keyboard.press('Enter');
      const row = page.locator('.trst-breakdown > div').filter({ hasText: 'Awaiting receipt' });
      await row.getByText(label, { exact: true }).waitFor();
      assert.equal(await page.locator('.wallet-balances .balance-value').nth(1).innerText(), '2.000000');
      if (amount === null) await page.getByText('Your node doesn’t report outgoing pending TRST.', { exact: true }).waitFor();
      if (amount && amount !== '0') await page.getByText(/Sent TRST stays attributed to you/).waitFor();
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.body.classList.toggle('dark', theme === 'dark'), theme);
        for (const width of [320, 1000]) {
          await page.setViewportSize({ width, height: 900 });
          assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        }
      }
      if (amount && amount !== '0') await page.screenshot({ path: '/tmp/burst-wallet-pending-sender.png', animations: 'disabled' });
      await page.getByRole('button', { name: 'View origins and expiry' }).click();
      const portfolioRow = page.locator('dl > div').filter({ hasText: 'Sent, awaiting receipt' });
      await portfolioRow.getByText(amount === null ? label : `${label} TRST`, { exact: true }).waitFor();
    }
    assert.equal(await page.evaluate(() => window.calls.some(call => ['send_trst', 'burn_brn', 'receive_pending'].includes(call.command))), false);
  } finally { await page.close(); }
});

for (const control of ['sidebar', 'settings', 'mobile']) test(`wallet lock ${control} waits for native success and exposes failures`, async () => {
  const page = await wallet('test', { viewport: { width: control === 'mobile' ? 390 : 1200, height: 1000 } });
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.lockCalls = 0;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command !== 'lock_wallet') return original(command, args);
        window.lockCalls++;
        return new Promise((resolve, reject) => { window.resolveLock = resolve; window.rejectLock = reject; });
      };
    });
    if (control === 'settings') await page.getByRole('link', { name: 'Settings', exact: true }).click();
    if (control === 'mobile') await page.getByRole('button', { name: 'More', exact: true }).click();
    const button = control === 'settings'
      ? page.locator('.settings-page').getByRole('button', { name: 'Lock Wallet', exact: true })
      : control === 'mobile'
        ? page.getByRole('dialog').getByRole('button', { name: 'Lock wallet', exact: true })
        : page.locator('.app-sidebar').getByRole('button', { name: 'Lock wallet', exact: true });
    await button.click();
    await page.waitForFunction(() => window.lockCalls === 1);
    assert.equal(await page.getByRole('button', { name: 'Locking…', exact: true }).first().isDisabled(), true);
    assert.equal(await page.evaluate(async () => {
      const { useWalletStore } = await import(window.fixtureStoreUrl);
      return useWalletStore.getState().lockWallet();
    }), false);
    assert.equal(await page.evaluate(() => window.lockCalls), 1);
    await page.evaluate(() => window.rejectLock(new Error('Automation state unavailable')));
    await page.getByText('Wallet could not be locked', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(async () => {
      const state = (await import(window.fixtureStoreUrl)).useWalletStore.getState();
      return [state.isLocked, state.address, state.isLocking];
    }), [false, 'brst_test_wallet', false]);
    await button.click();
    await page.waitForFunction(() => window.lockCalls === 2);
    await page.evaluate(() => window.resolveLock());
    await page.getByText('Create New Wallet', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(async () => {
      const state = (await import(window.fixtureStoreUrl)).useWalletStore.getState();
      return [state.isLocked, state.address, state.isLocking];
    }), [true, null, false]);
  } finally { await page.close(); }
});

test('secondary screens load on demand without hiding navigation or losing focus', async () => {
  const page = await wallet('test');
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  try {
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name));
    for (const name of ['settings', 'governance', 'verification', 'portfolio', 'history']) {
      assert.equal(resources.some(url => url.includes(`/src/pages/${name}.tsx`)), false, name + ' loaded on the home screen');
    }
    await page.route('**/src/pages/settings.tsx*', async route => { await delayed; await route.continue(); });
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Loading screen…' }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Wallet navigation', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Lock wallet', exact: true }).isVisible(), true);
    assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true);
    release();
    await page.getByLabel('Node URL', { exact: true }).waitFor();
    assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true);
  } finally { release(); await page.close(); }
});

test('a failed screen chunk preserves the wallet shell and offers keyboard recovery', async () => {
  const page = await wallet('test');
  try {
    await page.route('**/src/pages/governance.tsx*', route => route.abort('failed'));
    await page.getByRole('link', { name: 'Governance', exact: true }).click();
    await page.getByRole('alert').getByText('This screen couldn’t be opened.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Lock wallet', exact: true }).isVisible(), true);
    const back = page.getByRole('link', { name: 'Back to wallet', exact: true });
    assert.ok((await back.boundingBox()).height >= 44);
    await back.focus();
    await back.press('Enter');
    await page.getByText('1.234567', { exact: true }).waitFor();
    assert.equal(await page.locator('#main-content').evaluate(el => el === document.activeElement), true);
  } finally { await page.close(); }
});

test('settings align fields, validate locally and retain receive and security controls', async () => {
  const page = await wallet('test',{viewport:{width:1200,height:1100}});
  try {
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    const node = page.getByLabel('Node URL',{exact:true});
    await node.waitFor();
    await page.locator('label[for="wallet-node-url"]').click();
    assert.equal(await node.evaluate(el => el === document.activeElement),true);
    await node.fill('ftp://invalid.example');
    await node.press('Enter');
    await page.getByRole('alert').getByText(/HTTP or HTTPS/).waitFor();
    assert.equal(await node.getAttribute('aria-invalid'),'true');
    await node.fill('http://127.0.0.1:7077');
    await node.press('Enter');
    assert.equal(await node.getAttribute('aria-invalid'),'false');
    await page.locator('.settings-disclosure summary').filter({hasText:'Allowed senders'}).click();
    const senders=page.getByLabel('Allowed senders (optional)',{exact:true});
    await senders.fill('invalid');
    await page.getByRole('button',{name:'Save Receive Rules',exact:true}).click();
    await page.getByRole('alert').getByText('Enter complete BURST addresses.').waitFor();
    const address='brst_'+'1'.repeat(60);
    await senders.fill(address+'\n'+address);
    await page.getByRole('button',{name:'Save Receive Rules',exact:true}).click();
    assert.deepEqual(await page.evaluate(async () => (await import(window.fixtureStoreUrl)).useWalletStore.getState().trustedSenders),[address]);
    await senders.fill('');
    await page.getByRole('button',{name:'Save Receive Rules',exact:true}).click();
    assert.deepEqual(await page.evaluate(async () => (await import(window.fixtureStoreUrl)).useWalletStore.getState().trustedSenders),[]);
    await page.locator('.settings-disclosure summary').filter({hasText:'Allowed senders'}).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0);
    await page.locator('#main-content').focus();
    for(const theme of ['light','dark']) {
      await page.evaluate(theme => {document.body.classList.toggle('dark',theme === 'dark'); document.querySelector('main').scrollTop=0;},theme);
      await page.screenshot({path:'/tmp/burst-settings-'+theme+'.png'});
      for(const width of [1200,800,500,320]) {
        await page.setViewportSize({width,height:1100});
        assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth),true,theme+' settings '+width);
        assert.deepEqual(await node.evaluate(el => {const s=getComputedStyle(el);return [s.borderRadius,s.height,s.fontSize];}),['8px','44px','16px']);
      }
      await page.screenshot({path:'/tmp/burst-settings-'+theme+'-mobile.png'});
      await page.setViewportSize({width:1200,height:1100});
    }
    assert.equal(await page.locator('.settings-page [data-slot="card"]').count(),0);
    await page.getByRole('button',{name:'Export Private Key',exact:true}).click();
    await page.getByLabel('Wallet password',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(() => window.calls.some(call => ['change_representative','export_private_key'].includes(call.command))),false);
  } finally {await page.close();}
});

test('app identity appears once at desktop and mobile widths', async () => {
  const page = await wallet('test');
  try {
    for (const width of [1200,800,760,320]) {
      await page.setViewportSize({width,height:750});
      assert.equal(await page.locator('[data-burst-icon="wallet"]:visible').count(),1,'wallet branding at '+width);
      assert.equal(await page.locator('.mobile-brand').isVisible(),width <= 760);
      assert.equal(await page.locator('.brand-lockup').isVisible(),width > 760);
    }
  } finally {await page.close();}
});

test('balance and form cards share restrained surfaces in both themes and high contrast', async () => {
  const page = await wallet('test');
  try {
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      const cards = await page.locator('.balance-panel').evaluateAll(elements => elements.map(el => {
        const style = getComputedStyle(el);
        return { radius: style.borderRadius, border: style.borderTopWidth, shadow: style.boxShadow, background: style.backgroundColor };
      }));
      assert.equal(cards.length, 2);
      assert.deepEqual(cards[0], cards[1]);
      assert.equal(cards[0].radius, '16px');
      assert.equal(cards[0].border, '0px');
      assert.notEqual(cards[0].shadow, 'none');
    }
    await page.getByRole('button', {name:'Pay',exact:true}).click();
    const card = page.locator('[data-slot="card"]').first();
    assert.equal(await card.evaluate(el => getComputedStyle(el).borderRadius), '16px');
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await card.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.getByLabel('Provider address',{exact:true}).focus();
    assert.equal(await page.getByLabel('Provider address',{exact:true}).evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  } finally { await page.close(); }
});

test('uncertain payments retain a receipt across navigation and cannot be blindly resubmitted', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.sent = 0;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command !== 'pay') return original(command,args);
        window.paymentSigner = args.expectedAccount;
        window.sent++;
        await new Promise(resolve => {window.releasePayment = resolve;});
        throw new Error('confirmation pending for '+ 'f'.repeat(64) + '; check history before retrying');
      };
    });
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByLabel('Provider address',{exact:true}).fill('brst_fixture_recipient');
    await page.getByLabel('Amount (BRN)',{exact:true}).fill('0.25');
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('button',{name:'Confirm Payment',exact:true}).evaluate(button => {button.click(); button.click();});
    await page.getByRole('button',{name:'Submitting…',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await page.evaluate(() => window.sent),1);
    assert.equal(await page.evaluate(() => window.paymentSigner),'brst_test_wallet');
    await page.evaluate(() => window.releasePayment());
    await page.getByRole('heading',{name:'Confirmation pending',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pay',exact:true}).isDisabled(),true);
    await page.getByRole('link',{name:'View activity',exact:true}).click();
    await page.getByRole('link',{name:'Wallet',exact:true}).click();
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('heading',{name:'Confirmation pending',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.sent),1);
    await page.getByRole('button',{name:'I checked activity',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Pay',exact:true}).isEnabled(),true);
  } finally {await page.close();}
});

test('pending account preparation is not shown as a pending payment and can be retried deliberately', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.paymentAttempts = [];
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== 'pay') return original(command, args);
        window.paymentAttempts.push(args);
        if (window.paymentAttempts.length === 1) {
          throw 'account preparation incomplete; requested action was not submitted: node RPC error: confirmation pending for ' + 'f'.repeat(64);
        }
        return { accepted: true, hash: 'a'.repeat(64) };
      };
    });
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await page.getByLabel('Provider address', { exact: true }).fill('brst_fixture_recipient');
    await page.getByLabel('Amount (BRN)', { exact: true }).fill('0.25');
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Payment', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Your action was not submitted.' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Confirmation pending', exact: true }).count(), 0);
    assert.equal(await page.getByText('f'.repeat(64), { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Provider address', { exact: true }).inputValue(), 'brst_fixture_recipient');
    assert.equal(await page.getByLabel('Amount (BRN)', { exact: true }).inputValue(), '0.25');
    assert.equal(await page.evaluate(() => window.paymentAttempts.length), 1);
    await page.getByRole('button', { name: 'Confirm Payment', exact: true }).click();
    await page.getByRole('heading', { name: 'Transaction confirmed', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.paymentAttempts.length), 2);
    const attempts = await page.evaluate(() => window.paymentAttempts);
    assert.deepEqual(attempts[0], attempts[1]);
  } finally { await page.close(); }
});

test('lost submission responses without a hash are also treated as uncertain', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async (command,args) => {if(command === 'pay') throw new Error('request failed: connection closed');return original(command,args);};});
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByLabel('Provider address',{exact:true}).fill('brst_fixture_recipient');
    await page.getByLabel('Amount (BRN)',{exact:true}).fill('0.25');
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();
    await page.getByRole('heading',{name:'Confirmation pending',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Pay',exact:true}).isDisabled(),true);
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-transaction-receipt'));
    await page.getByRole('button',{name:'I checked activity',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.id === 'main-content');
  } finally {await page.close();}
});

test('verification polling failures cannot dismiss an endorsement that is being submitted', async () => {
  const page = await wallet('test');
  try {
    await page.clock.install();
    await page.evaluate(() => {
      const original=window.__TAURI_INTERNALS__.invoke;window.verificationOffline=false;
      window.__TAURI_INTERNALS__.invoke=async (command,args) => {
        if(command === 'get_verification_status') {if(window.verificationOffline) throw new Error('Temporary outage');return {state:'Verified',endorsement_count:3,endorsement_threshold:3,endorsers:[],verifier_votes:[],challenge_active:false};}
        if(command === 'endorse_wallet') return new Promise(resolve => {window.releaseEndorse=() => resolve({accepted:true,hash:'a'.repeat(64)});});
        return original(command,args);
      };
    });
    await page.getByRole('link',{name:'Verification',exact:true}).click();
    await page.getByText('Vouch for someone',{exact:true}).click();
    await page.getByLabel('Their wallet address').fill('brst_fixture_person');
    await page.getByLabel('BRN to spend permanently').fill('0.25');
    await page.getByLabel('BRN to spend permanently').press('Enter');
    await page.getByRole('button',{name:'Burn & Endorse',exact:true}).click();
    await page.waitForFunction(() => !!window.releaseEndorse);
    await page.evaluate(() => {window.verificationOffline=true;});
    await page.clock.fastForward(11000);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await page.getByRole('button',{name:'Burn & Endorse',exact:true}).isDisabled(),true);
    await page.evaluate(() => window.releaseEndorse());
    await page.getByRole('heading',{name:'Transaction confirmed',exact:true}).waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-transaction-receipt'));
  } finally {await page.close();}
});

test('constitutional proposals cannot be voted on without their full amendment text', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original=window.__TAURI_INTERNALS__.invoke;window.includeAmendment=false;
      window.__TAURI_INTERNALS__.invoke=async (command,args) => {
        const proposal={hash:'a'.repeat(64),proposer:'brst_fixture',phase:'Exploration',description:'Amend article one',param:'constitution',proposed_value:'Article one',votes_yea:0,votes_nay:0,phase_deadline:Math.floor(Date.now()/1000)+3600,...(window.includeAmendment ? {amendment_text:'Every verified person has an equal vote.'} : {})};
        if(command === 'get_governance_proposals') return {proposals:[proposal]};
        if(command === 'get_governance_proposal_info') return proposal;
        if(command === 'get_delegation_info') return {delegated_from:[]};
        return original(command,args);
      };
    });
    await page.getByRole('link',{name:'Governance',exact:true}).click();
    await page.getByRole('button',{name:'Read proposal: Amend article one',exact:true}).click();
    await page.getByRole('alert').getByText(/has not provided the complete amendment/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Support',exact:true}).isDisabled(),true);
    await page.evaluate(() => {window.includeAmendment=true;});
    await page.getByRole('button',{name:'All proposals',exact:true}).click();
    await page.getByRole('button',{name:'Read proposal: Amend article one',exact:true}).click();
    await page.getByText('Every verified person has an equal vote.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Support',exact:true}).isEnabled(),true);
  } finally {await page.close();}
});

test('transfers respect origin groups rather than advertising the combined balance as spendable in one send', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_trst_portfolio') return {total_active:'3000000000000000000',total_expired:'0',total_revoked:'0',batches:[['a','1000000000000000000'],['b','2000000000000000000']].map(([origin,amount]) => ({origin:origin.repeat(64),amount,status:'active'}))};
        if (command === 'transfer_trst') {window.transferArgs=args; return {accepted:true,hash:'c'.repeat(64)};}
        return original(command,args);
      };
    });
    await page.getByRole('button',{name:'Transfer',exact:true}).click();
    await page.getByLabel('Recipient address',{exact:true}).fill('brst_fixture_recipient');
    await page.getByLabel('Amount (TRST)',{exact:true}).fill('2.5');
    await page.getByRole('button',{name:'Transfer TRST',exact:true}).click();
    await page.getByRole('alert').getByText(/A single origin must cover/).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByLabel('Amount (TRST)',{exact:true}).fill('1.5');
    await page.getByRole('button',{name:'Transfer TRST',exact:true}).click();
    await page.getByRole('button',{name:'Confirm Transfer',exact:true}).click();
    await page.getByRole('heading',{name:'Transaction confirmed',exact:true}).waitFor();
    assert.equal(await page.evaluate(() => window.transferArgs.origin),'b'.repeat(64));
    assert.equal(await page.evaluate(() => window.transferArgs.amount),'1500000000000000000');
    assert.equal(await page.evaluate(() => window.transferArgs.expectedAccount),'brst_test_wallet');
  } finally {await page.close();}
});

test('governance requires reading a proposal and rechecks its voting round before signing', async () => {
  const page = await wallet('test',{viewport:{width:390,height:844}});
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.proposalPhase='Exploration'; window.voteCalls=0;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        const proposal={hash:'a'.repeat(64),proposer:'brst_'+'1'.repeat(60),phase:window.proposalPhase,description:'Change the discussion period',param:'GovernanceCooldownSecs',proposed_value:'86400',votes_yea:2,votes_nay:1,votes_abstain:0,phase_deadline:Math.floor(Date.now()/1000)+3600};
        if(command === 'get_governance_proposals') return {proposals:[proposal]};
        if(command === 'get_governance_proposal_info') return proposal;
        if(command === 'get_delegation_info') return {delegated_from:[]};
        if(command === 'vote_proposal') {window.voteCalls++; return {accepted:true,hash:'b'.repeat(64)};}
        return original(command,args);
      };
      history.pushState({},'', '/governance');dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByRole('button',{name:'Read proposal: Change the discussion period',exact:true}).click();
    await page.getByText(/86?400 seconds/).waitFor();
    await page.screenshot({path:'/tmp/burst-wallet-proposal.png',animations:'disabled'});
    await page.getByRole('button',{name:'Support',exact:true}).click();
    assert.equal(await page.evaluate(() => window.voteCalls),0);
    await page.evaluate(() => {window.proposalPhase='Cooldown';});
    await page.getByRole('button',{name:'Confirm vote',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').getByText(/proposal changed or the action is no longer available/).waitFor();
    assert.equal(await page.evaluate(() => window.voteCalls),0);
    assert.equal(await page.getByRole('button',{name:'Confirm vote',exact:true}).isDisabled(),true);
  } finally {await page.close();}
});

test('expiry returns are labelled as owned funds and can be claimed without a return action', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(async () => {
      const { useWalletStore } = await import(window.fixtureStoreUrl);
      useWalletStore.setState({ autoAccept:false });
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'get_pending') return {blocks:[{hash:'a'.repeat(64),source:'brst_test_wallet',amount:'7000000000000000000',return_credit:true}]};
        if (command === 'receive_pending') {
          window.calls.push({command,args});
          return {accepted:true,hash:'b'.repeat(64)};
        }
        return original(command,args);
      };
    });
    await page.getByRole('button', {name:'Receive',exact:true}).click();
    await page.getByText('Returned funds', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Review',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('heading', {name:'Claim returned funds',exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button', {name:'Return payment…',exact:true}).count(),0);
    assert.equal(await dialog.getByText('From', {exact:true}).count(),0);
    for (const width of [1000,320]) {
      await page.setViewportSize({width,height:750});
      const box=await dialog.boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width);
    }
    await page.screenshot({path:'/tmp/burst-wallet-return-credit.png',animations:'disabled'});
    const claim=dialog.getByRole('button',{name:'Claim',exact:true});
    await claim.focus();
    await page.keyboard.press('Enter');
    await dialog.getByText('Returned funds claimed.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='receive_pending').length),1);
    assert.equal(await page.evaluate(()=>window.calls.some(call=>call.command==='reject_pending')),false);
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
  } finally {await page.close();}
});

test('receive reviews expose full details and keep partial batch progress without resubmitting', async () => {
  const page = await wallet('test',{viewport:{width:320,height:700}});
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.receivedHashes=[];
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if(command === 'get_pending') return {blocks:['a','b'].map(id => ({hash:id.repeat(64),source:'brst_'+'1'.repeat(60),amount:'1000000000000000001',block_type:'send'}))};
        if(command === 'receive_pending') {window.receivedHashes.push(args.hash);if(args.hash.startsWith('b')) throw new Error('Connection interrupted');return {accepted:true,hash:'c'.repeat(64)};}
        return original(command,args);
      };
    });
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.getByRole('button',{name:'Review all payments',exact:true}).click();
    assert.equal(await page.getByRole('dialog').getByText('brst_'+'1'.repeat(60),{exact:true}).count(),2);
    assert.equal(await page.getByRole('dialog').getByText('1.000000000000000001 TRST',{exact:true}).count(),2);
    await page.getByRole('button',{name:'Receive all',exact:true}).click();
    await page.getByRole('dialog').getByText('Received 1 of 2.',{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:'Receive all',exact:true}).count(),0);
    assert.deepEqual(await page.evaluate(() => window.receivedHashes),['a'.repeat(64),'b'.repeat(64)]);
    await page.screenshot({path:'/tmp/burst-wallet-receive-review.png',animations:'disabled'});
  } finally {await page.close();}
});

test('pending pages remain bounded, show failures and return to the first page after receiving', async () => {
  const page=await wallet('test',{viewport:{width:320,height:700}});
  try {
    await page.evaluate(async ()=>{
      const store=(await import(window.fixtureStoreUrl)).useWalletStore;
      store.getState().setAutomation({autoAccept:false,mergeLevel:0});
      const original=window.__TAURI_INTERNALS__.invoke;
      window.pageRequests=[];window.pageUnavailable=true;window.receivedHashes=[];
      window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
        if(command==='get_pending') {
          window.pageRequests.push(args);
          if(args.cursor && window.pageUnavailable) throw new Error('Second page unavailable');
          const start=args.cursor?21:1, count=args.cursor?3:20;
          return {blocks:Array.from({length:count},(_,i)=>({hash:String(start+i).padStart(64,'0'),source:'brst_'+'1'.repeat(60),amount:'1000000000000000000',block_type:'burn'})),cursor:!args.cursor && !window.receivedHashes.length?'second':null};
        }
        if(command==='receive_pending') {window.receivedHashes.push(args.hash);return {accepted:true,hash:'f'.repeat(64)};}
        return original(command,args);
      };
      history.pushState({},'', '/receive');dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByRole('button',{name:'Review this page',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).count(),20);
    const firstRow=page.getByRole('button',{name:'Review',exact:true}).first().locator('..');
    const sourceBounds=await firstRow.locator('p').nth(1).boundingBox();
    const reviewBounds=await firstRow.getByRole('button').boundingBox();
    assert(sourceBounds.x+sourceBounds.width<=reviewBounds.x-8,'Sender text overlaps Review');
    const pages=page.getByRole('navigation',{name:'Pending payment pages',exact:true});
    await pages.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('alert').getByText(/Pending payments unavailable/).waitFor();
    assert.equal(await page.getByText('No pending payments',{exact:true}).count(),0);
    assert.equal(await pages.getByRole('button',{name:'Previous',exact:true}).isEnabled(),true);
    await pages.getByRole('button',{name:'Previous',exact:true}).click();
    await page.getByRole('button',{name:'Review this page',exact:true}).waitFor();
    await page.evaluate(()=>{window.pageUnavailable=false;});
    await pages.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('button',{name:'Review',exact:true}).nth(2).waitFor();
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).count(),3);
    await page.getByRole('button',{name:'Review this page',exact:true}).click();
    await page.getByRole('button',{name:'Receive all',exact:true}).click();
    await page.getByRole('dialog').getByText('Received 3 payments.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('button',{name:'Review all payments',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).count(),20);
    assert.equal(await pages.count(),0);
    assert.deepEqual(await page.evaluate(()=>window.receivedHashes),[21,22,23].map(n=>String(n).padStart(64,'0')));
    assert.equal(await page.evaluate(()=>window.pageRequests.at(-1).cursor),null);
    assert.equal(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await page.screenshot({path:'/tmp/burst-wallet-pending-pages-320.png'});
  } finally {await page.close();}
});

test('returning a payment requires a separate confirmation and preserves uncertain receipts', async () => {
  const page = await wallet('test',{viewport:{width:320,height:700}});
  try {
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.getState().setAutomation({autoAccept:false});
      const original = window.__TAURI_INTERNALS__.invoke;
      window.returnCalls=[];
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if(command === 'get_pending') return {blocks:[{hash:'a'.repeat(64),source:'brst_'+'1'.repeat(60),amount:'1000000000000000001',block_type:'send'}]};
        if(command === 'reject_pending') {window.returnCalls.push(args); throw new Error('confirmation pending for '+'b'.repeat(64));}
        return original(command,args);
      };
    });
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.getByRole('button',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'Return payment…',exact:true}).click({timeout:3000});
    await page.getByRole('heading',{name:'Return this payment?',exact:true}).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Back');
    assert.equal(await page.getByRole('button',{name:'Back',exact:true}).evaluate(el => el === document.activeElement),true);
    await page.screenshot({path:'/tmp/burst-wallet-return-review-320.png',animations:'disabled'});
    assert.equal(await page.evaluate(() => window.returnCalls.length),0);
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Return payment…');
    assert.equal(await page.getByRole('button',{name:'Return payment…',exact:true}).evaluate(el => el === document.activeElement),true);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Review');
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).evaluate(el => el === document.activeElement),true);
    assert.equal(await page.evaluate(() => window.returnCalls.length),0);
    await page.getByRole('button',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'Return payment…',exact:true}).click();
    await page.getByRole('button',{name:'Return payment',exact:true}).click();
    await page.getByRole('heading',{name:'Confirmation pending',exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.returnCalls),[{rpcUrl:'http://127.0.0.1:7077',hash:'a'.repeat(64),expectedAccount:'brst_test_wallet'}]);
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).isDisabled(),true);
    await page.getByRole('link',{name:'Activity',exact:true}).click();
    await page.getByRole('link',{name:'Wallet',exact:true}).click();
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.getByRole('heading',{name:'Confirmation pending',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Review',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(() => window.returnCalls.length),1);
    assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth),true);
  } finally {await page.close();}
});

test('return reviews recheck automatic acceptance and wallet identity without signing', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.returnCalls=0;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if(command === 'get_pending') return {blocks:[{hash:'a'.repeat(64),source:'brst_'+'1'.repeat(60),amount:'17',block_type:'burn'}]};
        if(command === 'reject_pending') {window.returnCalls++;return {accepted:true,hash:'b'.repeat(64)};}
        return original(command,args);
      };
    });
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.getByRole('button',{name:'Review',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Return payment…',exact:true}).count(),0);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.getState().setAutomation({autoAccept:false});
    });
    await page.getByRole('button',{name:'Review',exact:true}).click();
    await page.getByRole('button',{name:'Return payment…',exact:true}).click();
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.getState().setAutomation({autoAccept:true});
    });
    await page.getByRole('dialog').getByRole('alert').getByText(/Automatic acceptance is on/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Return payment',exact:true}).isDisabled(),true);
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.getState().setAutomation({autoAccept:false});
      useWalletStore.getState().setAddress('brst_different_wallet');
    });
    await page.getByRole('button',{name:'Return payment',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').getByText(/wallet or connection changed/).waitFor();
    assert.equal(await page.evaluate(() => window.returnCalls),0);
  } finally {await page.close();}
});

test('changing receive settings cancels active and late-starting automation sessions', async () => {
  for (const delayedBegin of [false,true]) {
    const page = await wallet('test');
    page.setDefaultTimeout(5000);
    try {
      await page.clock.install();
      await page.evaluate(delayedBegin => {
        const original=window.__TAURI_INTERNALS__.invoke;
        window.automationEvents=[];
        window.__TAURI_INTERNALS__.invoke=async (command,args) => {
          if (['begin_automation','maintain_wallet','cancel_automation'].includes(command)) {
            window.automationEvents.push({command,args});
            if (command==='begin_automation') {
              if (delayedBegin) await new Promise(resolve=>{window.releaseAutomation=resolve;});
              return '42';
            }
            if (command==='maintain_wallet') {
              await new Promise(resolve=>{window.releaseAutomation=resolve;});
              return {received:1,merged:0,held:0};
            }
            return null;
          }
          return original(command,args);
        };
      },delayedBegin);
      await page.clock.fastForward(2000);
      await page.waitForFunction(()=>!!window.releaseAutomation);
      await page.evaluate(async () => {
        const {useWalletStore}=await import(window.fixtureStoreUrl);
        useWalletStore.getState().setAutomation({autoAccept:false,mergeLevel:0});
      });
      await page.evaluate(()=>window.releaseAutomation());
      await page.waitForFunction(()=>window.automationEvents.some(event=>event.command==='cancel_automation' && event.args.session==='42'));
      await page.clock.fastForward(30000);
      const events=await page.evaluate(()=>window.automationEvents);
      const maintenance=events.filter(event=>event.command==='maintain_wallet');
      assert.equal(maintenance.length,delayedBegin?0:1);
      if (!delayedBegin) assert.equal(maintenance[0].args.automationSession,'42');
      assert.equal(await page.getByText('Automatically received 1 payment',{exact:true}).count(),0);
    } finally {await page.close();}
  }
});

test('normal automation cancellation is quiet but genuine failures remain visible', async () => {
  const page=await wallet('test');page.setDefaultTimeout(5000);
  try {
    await page.clock.install();
    await page.evaluate(async ()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      window.cancelPass=0;
      window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
        if(command==='maintain_wallet') {
          window.cancelPass++;
          if(window.cancelPass===1) throw 'Automation settings changed; remaining payments were not submitted';
          throw 'Node connection unavailable';
        }
        return original(command,args);
      };
      (await import(window.fixtureStoreUrl)).useWalletStore.getState().setAutomation({mergeLevel:0});
    });
    await page.clock.fastForward(2000);
    await page.waitForFunction(()=>window.cancelPass===1);
    assert.equal(await page.locator('.automation-notice').count(),0);
    await page.clock.fastForward(15000);
    await page.getByTitle('Node connection unavailable',{exact:true}).waitFor();
  } finally {await page.close();}
});

test('automatic hold explanations survive later scan pages but clear on recheck or policy change', async () => {
  const page=await wallet('test'); page.setDefaultTimeout(5000);
  try {
    await page.clock.install();
    await page.evaluate(()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      window.scanPass=0;
      window.__TAURI_INTERNALS__.invoke=async (command,args)=>{
        if(command==='maintain_wallet') {
          window.scanPass++;
          return {received:0,merged:0,held:1,
            checked_hashes:window.scanPass===2?['b']:['a'],
            held_reasons:window.scanPass===1?[{hash:'a',reason:'First creator is not a member'}]:window.scanPass===2?[{hash:'b',reason:'Second creator is not a member'}]:[]};
        }
        return original(command,args);
      };
    });
    await page.evaluate(async ()=>{
      (await import(window.fixtureStoreUrl)).useWalletStore.getState().setAutomation({mergeLevel:0});
    });
    await page.clock.fastForward(2000);
    await page.waitForFunction(()=>window.scanPass===1);
    const holds=()=>page.evaluate(async ()=>(await import(window.fixtureStoreUrl)).useWalletStore.getState().groupHolds);
    assert.deepEqual(await holds(),{a:'First creator is not a member'});
    await page.clock.fastForward(15000);
    await page.waitForFunction(()=>window.scanPass===2);
    assert.deepEqual(await holds(),{a:'First creator is not a member',b:'Second creator is not a member'});
    await page.clock.fastForward(15000);
    await page.waitForFunction(()=>window.scanPass===3);
    assert.deepEqual(await holds(),{b:'Second creator is not a member'});
    await page.evaluate(async ()=>{
      const store=(await import(window.fixtureStoreUrl)).useWalletStore;
      store.getState().setGroupPolicy({mode:'any',groups:[{id:'new',name:'New group',description:'',endpoint_url:'https://group.example.test'}],offline_fallback:'review'});
    });
    assert.deepEqual(await holds(),{});
  } finally {await page.close();}
});

test('group settings load without trusting, require an explicit save and pin selected endpoints', async () => {
  const page=await wallet('test'); page.setDefaultTimeout(5000);
  try {
    await page.evaluate(()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      window.groupCalls=[];
      window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
        if(command==='load_group_directory') {
          window.groupCalls.push({command,args});
          return Array.from({length:11},(_,i)=>({id:'group-'+i,name:'Community '+i,description:'Local verification',endpoint_url:'https://group'+i+'.example.test'}));
        }
        if(command==='validate_group_policy') {window.groupCalls.push({command,args});return args.policy;}
        return original(command,args);
      };
    });
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    await page.getByText('Group checks',{exact:true}).click();
    await page.getByLabel('Automatic receive checks',{exact:true}).selectOption('any');
    await page.getByRole('button',{name:'Save group rules',exact:true}).click();
    await page.getByRole('alert').getByText('Trust at least one group directly, or use protocol checks only.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.groupCalls.length),0);
    await page.getByLabel('Group directory URL',{exact:true}).fill('file:///tmp/groups');
    await page.getByRole('button',{name:'Load directory',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.groupCalls.length),0);
    await page.getByLabel('Group directory URL',{exact:true}).fill('https://directory.example.test/list.json');
    await page.getByLabel('Group directory URL',{exact:true}).press('Enter');
    const entries=page.getByRole('list',{name:'Directory groups'}).getByRole('listitem');
    await entries.first().waitFor(); assert.equal(await entries.count(),10);
    assert.equal(await page.evaluate(async()=>{const {useWalletStore}=await import(window.fixtureStoreUrl);return useWalletStore.getState().groupPolicy.mode;}),'protocol');
    await page.getByRole('button',{name:'Select Community 0',exact:true}).click();
    assert.equal(await page.getByLabel('Groups they vouch for',{exact:true}).inputValue(),'0');
    await page.getByRole('button',{name:'Select Community 1',exact:true}).click();
    await page.getByLabel('Groups they vouch for',{exact:true}).selectOption('2');
    await page.getByRole('checkbox',{name:'Trust Community 1 directly',exact:true}).uncheck();
    await page.getByRole('checkbox',{name:'Trust Community 0 directly',exact:true}).uncheck();
    await page.getByRole('button',{name:'Save group rules',exact:true}).click();
    await page.getByRole('alert').getByText('Trust at least one group directly, or use protocol checks only.',{exact:true}).waitFor();
    await page.getByRole('checkbox',{name:'Trust Community 0 directly',exact:true}).focus();
    await page.keyboard.press('Space');
    await page.getByRole('alert').getByText('Trust at least one group directly, or use protocol checks only.',{exact:true}).waitFor({state:'hidden'});
    await page.getByLabel('When groups are unavailable',{exact:true}).selectOption('review');
    await page.getByRole('button',{name:'Next',exact:true}).click(); assert.equal(await entries.count(),1);
    await page.getByRole('button',{name:'Save group rules',exact:true}).click();
    await page.getByText('Group rules saved',{exact:true}).waitFor();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('burst-wallet')).state.groupPolicy);
    assert.equal(saved.mode,'any');assert.equal(saved.offline_fallback,'review');assert.equal(saved.groups.length,2);
    assert.equal(saved.max_hops,2);assert.equal(saved.groups[0].trust_directly,true);assert.equal(saved.groups[1].trust_directly,false);
    assert.equal(saved.groups[0].endpoint_url,'https://group0.example.test');
    await page.getByLabel('Group directory URL',{exact:true}).fill('https://another.example.test/list.json');
    await page.evaluate(()=>{
      const original=window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke=async(command,args)=>command==='load_group_directory'
        ? [{id:'group-0',name:'Community 0',description:'Changed listing',endpoint_url:'https://different.example.test'}] : original(command,args);
    });
    await page.getByRole('button',{name:'Load directory',exact:true}).click();
    await page.getByRole('button',{name:'Select Community 0',exact:true}).click();
    await page.getByRole('alert').getByText(/This ID already has a selected endpoint/).waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('burst-wallet')).state.groupPolicy.groups[0].endpoint_url),'https://group0.example.test');
    await page.setViewportSize({width:320,height:800});
    assert(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.getByLabel('Automatic receive checks',{exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:'/tmp/burst-wallet-group-settings-320.png',fullPage:true});
    await page.evaluate(()=>document.body.classList.add('dark'));
    assert(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:'/tmp/burst-wallet-group-settings-dark-320.png',fullPage:true});
  } finally {await page.close();}
});

test('group graph settings preserve legacy rules and reject malformed saved depth or roles', async () => {
  const page=await wallet('test');
  try {
    const results=await page.evaluate(async()=>{
      const {readGroupPolicy}=await import('/src/lib/group-policy.ts');
      const old={mode:'any',offline_fallback:'protocol',groups:[{id:'root',name:'Root',description:'',endpoint_url:'https://root.example.test'}]};
      return {
        legacy:readGroupPolicy(old),
        invalid:[-1,1.5,9,null,'2'].map(max_hops=>readGroupPolicy({...old,max_hops})),
        badRole:readGroupPolicy({...old,groups:[{...old.groups[0],trust_directly:'false'}]}),
        noRoot:readGroupPolicy({...old,max_hops:2,groups:[{...old.groups[0],trust_directly:false}]}),
      };
    });
    assert.equal(results.legacy.max_hops,0);
    assert.equal(results.legacy.groups[0].trust_directly,true);
    assert(results.invalid.every(value=>value===null));
    assert.equal(results.badRole,null);assert.equal(results.noRoot,null);
  } finally {await page.close();}
});

test('unreadable saved group policy blocks automation instead of falling back to protocol-only', async () => {
  const page=await wallet('test'); page.setDefaultTimeout(5000);
  try {
    await page.evaluate(()=>localStorage.setItem('burst-wallet',JSON.stringify({state:{autoAccept:true,mergeLevel:50,groupPolicy:{mode:'any',groups:[]}},version:0})));
    await page.reload();
    await page.getByText('Create New Wallet',{exact:true}).waitFor();
    await page.evaluate(async()=>{
      window.fixtureStoreUrl=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/stores/wallet-store.ts')).name;
      const {useWalletStore}=await import(window.fixtureStoreUrl);
      useWalletStore.setState({address:'brst_test_wallet',isLocked:false});
      history.pushState({},'','/settings');dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.getByText('Group checks',{exact:true}).click();
    await page.getByRole('alert').getByText(/Saved group rules could not be read/).waitFor();
    await page.clock.install();await page.clock.fastForward(16000);
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==='maintain_wallet').length),0);
    assert.equal(await page.evaluate(async()=>{const {useWalletStore}=await import(window.fixtureStoreUrl);return useWalletStore.getState().groupPolicy;}),null);
  } finally {await page.close();}
});

test('slow polling does not starve successful responses or start overlapping requests', async () => {
  const page = await wallet('test');
  try {
    await page.clock.install();
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.pendingReads=0;
      window.__TAURI_INTERNALS__.invoke = (command,args) => {
        if(command !== 'get_pending') return original(command,args);
        window.pendingReads++;
        return new Promise(resolve => {window.releasePending=() => resolve({blocks:[]});});
      };
    });
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.waitForFunction(() => !!window.releasePending);
    const initialReads = await page.evaluate(() => window.pendingReads);
    await page.clock.fastForward(25000);
    assert.equal(await page.evaluate(() => window.pendingReads),initialReads);
    await page.evaluate(() => window.releasePending());
    await page.getByText('No pending payments',{exact:true}).waitFor();
  } finally {await page.close();}
});

test('reduced motion keeps TRST disclosures immediate without rotating animation', {timeout:45_000}, async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(10_000);
  try {
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('link',{name:'TRST',exact:true}).click();
    const disclosure=page.getByRole('button', {name:/Origin account/}).first();
    await disclosure.waitFor();
    const properties=await disclosure.locator('svg.transition-transform').evaluate(el => getComputedStyle(el).transitionProperty);
    assert.doesNotMatch(properties,/transform|all/);
    await disclosure.click();
    assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
  } finally {await page.close();}
});

test('computes BRN locally, handles lowercase verification and keeps scaled TRST states separate', async () => {
  const page = await wallet();
  try {
    assert.equal(await page.getByText('Wallet not verified', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Wallet', exact: true }).getAttribute('aria-current'), 'page');
    assert.equal(await page.getByRole('link', { name: 'Wallet', exact: true }).evaluate(el => el.classList.contains('nav-item')), true);
    await page.getByText('TRST breakdown', { exact: true }).click();
    const breakdown = page.locator('.trst-breakdown');
    await breakdown.getByText('2.000000', {exact:true}).waitFor();
    await breakdown.getByText('1.000000', {exact:true}).waitFor();
    assert.equal(await breakdown.getByText('3.000000', {exact:true}).count(), 0);
    await page.screenshot({ path: '/tmp/burst-wallet-dashboard.png', fullPage: true, animations: 'disabled' });
  } finally { await page.close(); }
});

test('endpoint changes refetch, show offline state and recover on retry', async () => {
  const page = await wallet();
  try {
    await page.evaluate(async () => {
      window.offline = true;
      const { useWalletStore } = await import(window.fixtureStoreUrl);
      useWalletStore.getState().setRpcUrl('http://127.0.0.1:9999');
    });
    await page.getByText('Wallet data unavailable', { exact: true }).waitFor();
    await page.getByText('Offline', { exact: true }).waitFor();
    assert.equal(await page.getByText('Wallet not verified', { exact: true }).count(), 0);
    assert.equal(await page.getByText('1.234567', { exact: true }).count(), 0);
    await page.screenshot({ path: '/tmp/burst-wallet-offline.png', fullPage: true });
    await page.evaluate(() => { window.offline = false; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByText('1.234567', { exact: true }).waitFor();
  } finally { await page.close(); }
});

test('reload never restores an unlocked UI from persisted flags', async () => {
  const page = await wallet();
  try {
    await page.evaluate(() => localStorage.setItem('burst-wallet', JSON.stringify({
      state: { address: 'brst_test_wallet', isLocked: false, rpcUrl: 'http://127.0.0.1:9999' }, version: 0,
    })));
    await page.reload();
    await page.getByText('Create New Wallet', { exact: true }).waitFor();
    const state = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/stores/wallet-store.ts'))?.name ?? '/src/stores/wallet-store.ts';
      return (await import(url)).useWalletStore.getState();
    });
    assert.equal(state.isLocked, true);
    assert.equal(state.address, null);
    assert.equal(state.rpcUrl, 'http://127.0.0.1:9999');
  } finally { await page.close(); }
});

test('network banner distinguishes test funds, mainnet and unknown legacy nodes', async () => {
  for (const [network, message] of [
    ['test', 'Testnet · Test funds only, no real value.Test faucet enabled.'],
    ['dev', 'Devnet · Test funds only, no real value.Test faucet disabled.'],
    ['live', 'Mainnet · Real transactions. Test tools are unavailable.'],
    [undefined, 'Network unknown. Do not assume this is mainnet.'],
  ]) {
    const page = await wallet(network);
    try { assert.equal(await page.locator('.network-notice').textContent(), message); }
    finally { await page.close(); }
  }
});

test('appearance changes preserve wallet state and remain readable at desktop minimum size', async () => {
  const page = await wallet('test');
  try {
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('dark')), false);
    await page.screenshot({path:'/tmp/burst-wallet-home.png',animations:'disabled'});
    await page.getByRole('button', { name: 'Use dark appearance' }).click();
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('dark')), true);
    await page.getByText('1.234567', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/burst-wallet-dark.png', animations: 'disabled' });
    await page.setViewportSize({ width: 800, height: 600 });
    assert.equal(await page.getByRole('button', { name: 'Pay', exact: true }).count(), 1);
    assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.getByRole('button', { name: 'Use light appearance' }).click();
    await page.screenshot({ path: '/tmp/burst-wallet-compact.png', animations: 'disabled' });
    assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.evaluate(() => window.calls.some(call => ['pay', 'transfer_trst', 'lock_wallet'].includes(call.command))), false);
    await page.getByRole('button', { name: 'Use dark appearance' }).click();
    await page.reload();
    await page.getByText('Create New Wallet', { exact:true }).waitFor();
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('dark')), true);
  } finally { await page.close(); }
});

test('welcome keeps every recovery route and supports keyboard selection', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto('http://127.0.0.1:1430/onboarding');
    await page.getByRole('button', { name: 'Create New Wallet', exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/burst-wallet-welcome.png', animations: 'disabled' });
    await page.getByText('More ways to restore', { exact: true }).click();
    await page.getByRole('button', { name: 'Import Private Key', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load Keystore', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create New Wallet', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Generate Wallet', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Import Mnemonic', exact: true }).focus();
    await page.keyboard.press('Space');
    await page.getByPlaceholder("word1 word2 word3 ...").waitFor();
  } finally { await page.close(); }
});

test('narrow wallet keeps navigation, balances and actions reachable without overflow', {timeout:45_000}, async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(10_000);
  try {
    for (const width of [320, 500, 800]) {
      await page.setViewportSize({ width, height: 700 });
      await page.getByRole('button', { name: 'Receive', exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'main overflow at ' + width + ': ' + JSON.stringify(await page.locator('main').evaluate(main => [...main.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > main.getBoundingClientRect().right).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 60) })))));
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true, 'body overflow at ' + width);
      if (width <= 760) { await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('link', { name: 'Settings', exact: true }).waitFor(); await page.keyboard.press('Escape'); }
      else assert.equal(await page.getByRole('link', { name: 'Settings', exact: true }).count(), 1);
    }
    await page.setViewportSize({ width: 800, height: 600 });
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
    const pay = await page.getByRole('button', { name: 'Pay', exact: true }).boundingBox();
    await page.screenshot({ path: '/tmp/burst-wallet-refined.png' });
    assert.ok(pay && pay.y + pay.height < 560, 'primary action should be visible without scrolling at desktop minimum: ' + JSON.stringify(pay));
  } finally { await page.close(); }
});

test('receive clipboard denial and RPC failure have actionable states', async () => {
  const page = await wallet('test');
  try {
    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } }));
    await page.getByRole('button', { name: 'Copy address', exact: true }).click();
    await page.getByText("Couldn’t copy. Select and copy your address below.", { exact: true }).waitFor();
    await page.evaluate(() => { window.offline = true; });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Pending payments unavailable. Check your connection and refresh.', { exact: true }).waitFor();
    assert.equal(await page.getByText('No pending blocks', { exact: true }).count(), 0);
  } finally { await page.close(); }
});

test('brand and token icons are inline and help is available on hover, keyboard and click', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    assert.equal(await page.locator('.brand-lockup svg').count(), 1);
    assert.equal(await page.locator('.wallet-balances svg image').count(), 0);
    const brn = page.getByRole('button', { name: 'BRN', exact: true });
    await brn.hover();
    await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /birthright income/);
    await page.keyboard.press('Escape');
    await page.mouse.move(0, 0);
    await brn.focus();
    await page.getByRole('tooltip').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    const trst = page.getByRole('button', { name: 'Active TRST', exact: true });
    await trst.click();
    await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /fraudulent origin can be revoked/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.brand-mark').count(), 0);
    await page.screenshot({ path: '/tmp/burst-docs-wallet.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Use dark appearance' }).click();
    await page.screenshot({ path: '/tmp/burst-docs-wallet-dark.png', animations: 'disabled' });
  } finally { await page.close(); }
});

test('help definitions can be tapped and dismissed on touch screens', async () => {
  const page = await wallet('test', { hasTouch: true, viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  try {
    await page.getByRole('button', { name: 'BRN', exact: true }).tap();
    await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /birthright income/);
    await page.locator('header').tap({ position: { x: 10, y: 10 } });
    await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  } finally { await page.close(); }
});

test('named type roles retain size and color; captions and controls stay readable', async () => {
  const page = await wallet('test');
  try {
    const styles = await page.evaluate(() => {
      const caption = document.querySelector('.text-caption');
      const control = document.querySelector('a.nav-item');
      const balance = document.querySelector('.balance-value');
      return [caption, control, balance].map(el => getComputedStyle(el).fontSize);
    });
    assert.deepEqual(styles, ['13px', '14px', '36px']);
    const classes = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/lib/utils.ts'))?.name ?? '/src/lib/utils.ts';
      return (await import(url)).cn('text-heading text-foreground', 'text-caption text-muted-foreground');
    });
    assert.equal(classes, 'text-caption text-muted-foreground');
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForFunction(() => { const main = document.querySelector('main'); return main.scrollWidth <= main.clientWidth; });
  } finally { await page.close(); }
});

test('Enter reviews payments without sending; confirmation restores focus and fits short windows', async () => {
  const page = await wallet('test');
  try {
    for (const [route, field, amountLabel, action] of [
      ['Pay', 'Provider address', 'Amount (BRN)', 'Pay'],
      ['Transfer', 'Recipient address', 'Amount (TRST)', 'Transfer TRST'],
    ]) {
      await page.getByRole('link', { name: 'Wallet', exact: true }).click();
      await page.getByRole('button', { name: route, exact: true }).click();
      await page.getByLabel(field, { exact: true }).waitFor();
      await page.screenshot({ path: '/tmp/burst-polished-' + route.toLowerCase() + '.png', animations: 'disabled' });
      await page.getByLabel(field, { exact: true }).fill('brst_fixture_recipient');
      await page.getByLabel(amountLabel, { exact: true }).fill('0.25');
      await page.getByLabel(amountLabel, { exact: true }).press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert.equal(await page.evaluate(() => window.calls.some(c => ['pay', 'transfer_trst'].includes(c.command))), false);
      await page.setViewportSize({ width: 320, height: 400 });
      const box = await dialog.boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 400);
      const close = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
      assert.ok(close.width >= 44 && close.height >= 44);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).scrollIntoViewIfNeeded();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(label => document.activeElement?.textContent?.trim() === label, action);
      assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.setViewportSize({ width: 1000, height: 750 });
    }
  } finally { await page.close(); }
});

test('touch controls keep 44px targets and payment inputs compute to 16px', async () => {
  const page = await wallet('test', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const help = await page.getByRole('button', { name: 'BRN', exact: true }).boundingBox();
    assert.ok(help.width >= 44 && help.height >= 44);
    await page.getByRole('button', { name: 'Pay', exact: true }).click();
    for (const name of ['Provider address', 'Amount (BRN)']) {
      assert.equal(await page.getByLabel(name, { exact: true }).evaluate(el => getComputedStyle(el).fontSize), '16px');
    }
  } finally { await page.close(); }
});

test('pending failures never look like no pending payments', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(async () => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === 'get_pending') return Promise.reject(new Error('Pending unavailable'));
        return original(command, args);
      };
      (await import(window.fixtureStoreUrl)).useWalletStore.getState().setRpcUrl('http://127.0.0.1:9998');
    });
    await page.getByText('Pending payments unavailable. Retrying…', { exact: true }).waitFor();
    assert.equal(await page.getByText('No pending payments', { exact: true }).count(), 0);
    await page.getByText('TRST breakdown', { exact: true }).click();
    await page.locator('.trst-breakdown').getByText('2.000000', { exact: true }).waitFor();
    await page.locator('.trst-breakdown').getByText('1.000000', { exact: true }).waitFor();
  } finally { await page.close(); }
});

test('recovery backup gate survives compact layout without invoking a real wallet', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
  try {
    await page.addInitScript(() => {
      window.isTauri = true;
      window.fixtureCalls = [];
      window.__TAURI_INTERNALS__ = { invoke: async command => {
        window.fixtureCalls.push(command);
        if (command === 'create_wallet') return {
          address: 'brst_fixture_only', verification_state: 'unverified',
          recovery_phrase: Array.from({ length: 24 }, (_, i) => 'fixture' + i).join(' '),
        };
        throw new Error('Unexpected fixture command: ' + command);
      } };
    });
    await page.goto('http://127.0.0.1:1430/onboarding');
    await page.getByRole('button', { name: 'Create New Wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Generate Wallet', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save & Continue', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Continue without file', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    await page.getByRole('checkbox').check();
    assert.equal(await page.getByRole('button', { name: 'Continue without file', exact: true }).isDisabled(), false);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls), ['create_wallet']);
  } finally { await page.close(); }
});

test('repeated Enter cannot issue concurrent keystore unlock requests', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      window.isTauri = true;
      window.fixtureCalls = [];
      window.__TAURI_INTERNALS__ = { invoke: async command => {
        window.fixtureCalls.push(command);
        if (command === 'load_keystore_cmd') return true;
        if (command === 'unlock_wallet') return new Promise(() => {});
        throw new Error('Unexpected fixture command: ' + command);
      } };
    });
    await page.goto('http://127.0.0.1:1430/onboarding');
    await page.getByText('More ways to restore', { exact: true }).click();
    await page.getByRole('button', { name: 'Load Keystore', exact: true }).click();
    await page.getByLabel('Keystore file', { exact: true }).fill('/fixture-only/not-a-real-keystore');
    await page.getByLabel('Keystore file', { exact: true }).press('Enter');
    await page.getByLabel('Password', { exact: true }).fill('fixture-only');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Unlock', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.fixtureCalls.filter(c => c === 'unlock_wallet').length), 1);
  } finally { await page.close(); }
});


test('activity labels native block balances truthfully and retries a failed older page', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.historyFail = true;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== 'get_account_history') return original(command, args);
        const later = args.cursor && atob(args.cursor) !== '0';
        if (later && window.historyFail) throw new Error('Older page unavailable');
        return { account:'brst_test_wallet', history:[{hash: later ? 'older-block' : 'native-send-block', block_type:'Send', account:'brst_test_wallet', amount:'2345000000000000000',timestamp:1700000000}], cursor:later ? undefined : btoa('25') };
      };
    });
    await page.getByRole('link', {name:'Activity',exact:true}).click();
    await page.getByText('2.345000', {exact:true}).waitFor();
    assert.equal(await page.getByText('TRST balance', {exact:true}).count(),1);
    assert.doesNotMatch(await page.locator('main').innerText(), /[+−]2\.345000|To:|From:/);
    await page.locator('main summary').click();
    await page.getByText('native-send-block', {exact:true}).waitFor();
    await page.getByRole('button', {name:'Next',exact:true}).click();
    await page.getByRole('alert').getByText('Older page unavailable').waitFor();
    assert.equal(await page.getByText('native-send-block', {exact:true}).count(),1);
    await page.evaluate(() => { window.historyFail = false; });
    await page.getByRole('button', {name:'Try again',exact:true}).click();
    await page.getByRole('status').getByText('Entries 26–26',{exact:true}).waitFor();
    assert.equal(await page.locator('main details').count(),1);
    assert.equal(await page.getByRole('button', {name:'Next',exact:true}).isDisabled(),true);
    await page.getByRole('button', {name:'Previous',exact:true}).click();
    await page.getByRole('status').getByText('Entries 1–1',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button', {name:'Previous',exact:true}).isDisabled(),true);
  } finally { await page.close(); }
});

test('activity keeps one bounded page while navigating forward and backward', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== 'get_account_history') return original(command,args);
        const start = args.cursor ? Number(atob(args.cursor)) : 0;
        return {history:Array.from({length:Math.min(25,110-start)},(_,index)=>({hash:`block-${start+index}`,account:'brst_test_wallet',block_type:'Send',amount:'1',timestamp:1700000000})),cursor:start+25<110 ? btoa(String(start+25)) : undefined};
      };
    });
    await page.getByRole('link',{name:'Activity',exact:true}).click();
    for (const [step,offset] of [0,25,50,75,100,75,50,25,0].entries()) {
      await page.getByRole('status').getByText(`Entries ${offset+1}–${Math.min(offset+25,110)}`,{exact:true}).waitFor();
      assert.equal(await page.locator('main details').count(),Math.min(25,110-offset));
      assert.deepEqual(await page.locator('main details').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('dt')].find(dt=>dt.textContent==='Block').nextElementSibling.textContent)),Array.from({length:Math.min(25,110-offset)},(_,index)=>`block-${offset+index}`));
      if (offset === 100 && process.env.UI_EVIDENCE_DIR) {
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:require('node:path').join(process.env.UI_EVIDENCE_DIR,'activity-narrow.png')});
      }
      if (step < 8) await page.getByRole('button',{name:step<4?'Next':'Previous',exact:true}).click();
    }
  } finally { await page.close(); }
});

test('activity distinguishes account maintenance and verification from incoming payments', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== 'get_account_history') return original(command, args);
        return { history: ['ChangeRepresentative', 'VerificationVote', 'GovernanceVote', 'Burn', 'Send', 'Receive', 'Merge', 'RejectReceive', 'FutureOperation', 'constructor', '__proto__'].map((block_type, index) => ({
          hash: 'activity-block-' + index, block_type, account: 'brst_test_wallet', amount: '1000000000000000000', timestamp: 1700000000,
        })) };
      };
    });
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    for (const label of ['Account updated', 'Verification vote', 'Proposal vote', 'Paid with BRN', 'Sent TRST', 'Received TRST', 'TRST combined', 'Payment returned', 'Account activity']) {
      await page.locator('main summary').filter({ hasText: label }).first().waitFor();
    }
    assert.equal(await page.locator('main summary .lucide-arrow-down-left').count(), 1);
    assert.equal(await page.locator('main summary .lucide-arrow-up-right').count(), 1);
    const unknown = page.locator('main summary').filter({ hasText: 'Account activity' });
    assert.equal(await unknown.count(), 3);
    await unknown.first().focus();
    await page.keyboard.press('Enter');
    await page.getByText('FutureOperation', { exact: true }).waitFor();
    assert.equal(await page.getByText('TRST balance', { exact: true }).count(), 11);
    for (const width of [1000, 320]) {
      await page.setViewportSize({ width, height: 800 });
      assert.ok(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: '/tmp/burst-wallet-activity-' + width + '.png' });
    }
    await page.getByRole('link', {name:'Wallet',exact:true}).click();
    await page.locator('.activity-section').getByText('Payment returned',{exact:true}).waitFor();
    await page.locator('.activity-section').getByText('Account updated',{exact:true}).waitFor();
    assert.equal(await page.locator('.activity-row .lucide-arrow-down-left').count(),1);
    assert.equal(await page.locator('.activity-row .lucide-arrow-up-right').count(),1);
  } finally { await page.close(); }
});

test('portfolio linear reference is separate from balance and accessible on touch', async () => {
  const page = await wallet('test', {viewport:{width:390,height:844},hasTouch:true});
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.referenceBps = 5000;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => command === 'get_trst_portfolio'
        ? {total_active:'1000000000000000000',total_expired:'0',total_revoked:'0',total_pending:'0',batches:[{
          origin:'a'.repeat(64),origin_kind:'burn',originator:'brst_creator',amount:'1000000000000000000',
          timestamp:1700000000,expiry_at:1900000000,status:'active',reference_value_bps:window.referenceBps}]}
        : original(command,args);
    });
    await page.getByRole('button',{name:'More',exact:true}).click();
    await page.getByRole('link',{name:'TRST',exact:true}).click();
    await page.getByRole('button').filter({hasText:'Created from BRN by'}).click();
    await page.getByText('50%',{exact:true}).waitFor();
    await page.getByText('Pricing guide only. Balance unchanged.',{exact:true}).waitFor();
    const referenceHelp = page.getByRole('button',{name:'Linear reference',exact:true});
    const helpBounds = await referenceHelp.boundingBox();
    const expiryBounds = await page.getByText('Expires',{exact:true}).boundingBox();
    const disclaimerBounds = await page.getByText('Pricing guide only. Balance unchanged.',{exact:true}).boundingBox();
    assert.ok(helpBounds.height >= 44);
    assert.ok(helpBounds.y >= expiryBounds.y + expiryBounds.height);
    assert.ok(helpBounds.y + helpBounds.height <= disclaimerBounds.y);
    await referenceHelp.tap();
    try {
      await page.getByRole('tooltip').filter({hasText:'does not reduce your TRST amount'}).waitFor();
    } catch (error) {
      console.error('Reference help state', await referenceHelp.evaluate(el => ({
        state: el.getAttribute('data-state'), description: el.getAttribute('aria-describedby'),
        focused: document.activeElement === el,
        tooltips: Array.from(document.querySelectorAll('[role="tooltip"]'), tip => tip.textContent),
      })));
      await page.screenshot({path:'/tmp/burst-wallet-linear-reference-failure.png'});
      throw error;
    }
    await page.keyboard.press('Escape');
    assert.ok(await page.getByText('1.000000',{exact:true}).count() >= 1);
    assert.ok(await page.locator('main').evaluate(el=>el.scrollWidth <= el.clientWidth+1));
    await page.screenshot({path:'/tmp/burst-wallet-linear-reference-mobile.png'});
    for (const [value,text] of [[null,'Unavailable'],[0,'0%'],[10000,'100%'],[10001,'Unavailable']]) {
      await page.getByRole('link',{name:'Wallet',exact:true}).click();
      await page.evaluate(value=>{window.referenceBps=value;},value);
      await page.getByRole('button',{name:'More',exact:true}).click();
      await page.getByRole('link',{name:'TRST',exact:true}).click();
      await page.getByRole('button').filter({hasText:'Created from BRN by'}).click();
      await page.getByText(text,{exact:true}).waitFor();
    }
  } finally { await page.close(); }
});

test('large portfolios remain paged without losing totals or entries', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command !== 'get_trst_portfolio') return original(command, args);
        return { total_active:'51000000000000000000', total_expired:'0', total_revoked:'0', total_pending:'0',
          batches:Array.from({length:51}, (_,i) => ({id:String(i),origin:'origin-'+i,origin_kind:'burn',
            originator:'brst_creator',amount:'1000000000000000000',timestamp:1700000000,expiry_at:null,status:'active'})) };
      };
    });
    await page.getByRole('link',{name:'TRST',exact:true}).click();
    const rows = page.getByRole('button').filter({hasText:'Created from BRN by'});
    await page.getByText('Page 1 of 3',{exact:true}).waitFor();
    await page.getByText('51.000000',{exact:true}).waitFor();
    assert.equal(await rows.count(),25);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByText('Page 2 of 3',{exact:true}).waitFor();
    assert.equal(await rows.count(),25);
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByText('Page 3 of 3',{exact:true}).waitFor();
    await page.getByText('51.000000',{exact:true}).waitFor();
    assert.equal(await rows.count(),1);
    await rows.first().click();
    await page.getByText('origin-50',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Previous',exact:true}).click();
    await page.getByText('Page 2 of 3',{exact:true}).waitFor();
    assert.equal(await rows.count(),25);
  } finally {await page.close();}
});

test('representative setting submits with Enter once while pending', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.repCalls = 0;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if(command !== 'change_representative') return original(command,args);
        window.repCalls++;
        return await new Promise(resolve => {window.finishRep=()=>resolve({accepted:true,hash:'a'.repeat(64)});});
      };
    });
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    const input=page.getByLabel('Representative address',{exact:true});
    await input.fill('brst_'+'1'.repeat(60));
    await input.press('Enter');
    await page.waitForFunction(()=>window.repCalls===1);
    await input.press('Enter');
    assert.equal(await page.evaluate(()=>window.repCalls),1);
    await page.evaluate(()=>window.finishRep());
    await page.waitForFunction(()=>document.querySelector('#representative-address').value==='');
  } finally {await page.close();}
});

test('portfolio distinguishes original burns, merges and unknown legacy origins', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command !== 'get_trst_portfolio') return original(command,args);
        return { total_active:'3',total_expired:'0',total_revoked:'0',batches:[
          {id:'holding-one',origin:'shared-origin',origin_kind:'merge',originator:'brst_merger',amount:'1',timestamp:1700000000,expiry_at:null,status:'active'},
          {id:'holding-two',origin:'shared-origin',origin_kind:'merge',originator:'brst_merger',amount:'2',timestamp:1700000000,expiry_at:null,status:'active'},
          {id:'burn-holding',origin:'original-burn',origin_kind:'burn',originator:'brst_creator',amount:'3',timestamp:1700000000,expiry_at:null,status:'active'},
          {id:'legacy-holding',origin:'legacy-origin',originator:'brst_legacy',amount:'4',timestamp:1700000000,expiry_at:null,status:'active'},
        ]};
      };
    });
    await page.getByRole('link', {name:'TRST',exact:true}).click();
    await page.getByRole('button').filter({hasText:'Combined by'}).first().waitFor();
    const merged = page.getByRole('button').filter({hasText:'Combined by'});
    assert.equal(await merged.count(),2);
    assert(await merged.first().evaluate(button => {
      const rows = [...button.parentElement.parentElement.children];
      return rows.slice(0,-1).every((row,index) => parseFloat(getComputedStyle(row).borderBottomWidth)>0 || parseFloat(getComputedStyle(rows[index+1]).borderTopWidth)>0);
    }),'portfolio entries need visible dividers');
    assert.equal(await page.getByRole('button').filter({hasText:'Created from BRN by'}).count(),1);
    assert.equal(await page.getByRole('button').filter({hasText:'Origin account'}).count(),1);
    await merged.first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'View original creators',exact:true}).waitFor();
    assert.equal(await page.getByText('Merged by',{exact:true}).count(),1);
    assert.equal(await page.getByText('Full Originator',{exact:true}).count(),0);
    assert.equal(await page.getByText('Lifecycle Progress',{exact:true}).count(),0);
    assert.equal(await page.getByText('Not available',{exact:true}).count(),0);
    assert(!errors.some(error=>/same key|unique.*key/i.test(error)),errors.join('\n'));
    await page.setViewportSize({width:320,height:800});
    assert.ok(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await merged.first().evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:'/tmp/burst-wallet-merge-origin-320.png',fullPage:true});
    await page.getByRole('button',{name:'Use dark appearance'}).click();
    await page.screenshot({path:'/tmp/burst-wallet-merge-origin-dark-320.png',fullPage:true});
  } finally { await page.close(); }
});

test('merged origin inspection is lazy, bounded, retryable and reset when the node changes', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.originRequests = [];
      window.originWaiters = [];
      window.originsReady = false;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_trst_portfolio') return {total_active:'1',total_expired:'0',total_revoked:'0',batches:[{
          id:'merged-holding',origin:'a'.repeat(64),origin_kind:'merge',originator:'brst_merger',amount:'1',timestamp:1700000000,expiry_at:null,status:'active',
        }]};
        if (command !== 'get_trst_origins') return original(command,args);
        window.originRequests.push(args);
        if (!window.originsReady) {
          await new Promise(resolve => { window.originWaiters.push(resolve); });
          throw new Error('Origin history is unavailable');
        }
        return {origin:args.origin,complete:true,confirmed:false,origins:Array.from({length:11},(_,i)=>({
          hash:i.toString(16).padStart(64,'0'),originator:'brst_creator_'+i,timestamp:1700000000+i,confirmed:i!==0,revoked:i===0,
        }))};
      };
    });
    await page.getByRole('link',{name:'TRST',exact:true}).click();
    await page.getByRole('button').filter({hasText:'Combined by'}).click();
    assert.equal(await page.evaluate(()=>window.originRequests.length),0);
    await page.getByRole('button',{name:'View original creators',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('status').filter({hasText:'Loading original creators…'}).waitFor().catch(async error => {
      console.error('Origin inspector state:',await page.locator('main').innerText(),await page.evaluate(()=>window.originRequests));
      throw error;
    });
    await page.evaluate(()=>window.originWaiters.forEach(resolve=>resolve()));
    await page.getByRole('alert').getByText('Origin history is unavailable',{exact:true}).waitFor();
    await page.evaluate(()=>{window.originsReady=true;});
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    const entries = page.getByRole('list',{name:'Original BRN payments'}).getByRole('listitem');
    await entries.first().waitFor();
    assert.equal(await entries.count(),10);
    await page.getByText('This origin is not confirmed.',{exact:true}).waitFor();
    await page.getByText('Revoked origin',{exact:true}).waitFor();
    await page.getByText('Unconfirmed payment',{exact:true}).waitFor();
    await page.getByText('Original payment ID',{exact:true}).first().click();
    await page.getByText('0'.repeat(64),{exact:true}).waitFor();
    await page.setViewportSize({width:320,height:800});
    assert.ok(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.getByRole('region',{name:'Original creators',exact:true}).evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:'/tmp/burst-wallet-origin-inspector-320.png',fullPage:true});
    await page.getByRole('button',{name:'Next',exact:true}).click();
    assert.equal(await entries.count(),1);
    await page.getByText('brst_creator_10',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Next',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Previous',exact:true}).click();
    assert.equal(await entries.count(),10);
    const requests = await page.evaluate(()=>window.originRequests.length);
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.setState({rpcUrl:'http://127.0.0.1:7778'});
    });
    await page.getByRole('button').filter({hasText:'Combined by'}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Original creators',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.originRequests.length),requests);
  } finally { await page.close(); }
});

test('incoming payment review inspects original creators without receiving or returning', async () => {
  const page = await wallet('test');
  page.setDefaultTimeout(5000);
  try {
    await page.evaluate(async () => {
      const {useWalletStore} = await import(window.fixtureStoreUrl);
      useWalletStore.setState({autoAccept:false});
      const original = window.__TAURI_INTERNALS__.invoke;
      window.paymentOriginRequests = [];
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_pending') return {blocks:[{hash:'a'.repeat(64),source:'brst_sender_not_creator',amount:'17',timestamp:1700000000}]};
        if (command === 'get_payment_origins') {
          window.paymentOriginRequests.push(args);
          return {payment:args.payment,confirmed:false,provenance:{origin:'b'.repeat(64),confirmed:true,complete:true,origins:[{
            hash:'c'.repeat(64),originator:'brst_actual_creator',timestamp:1600000000,confirmed:true,revoked:false,
          }]}};
        }
        return original(command,args);
      };
    });
    await page.getByRole('button',{name:'Receive',exact:true}).click();
    await page.getByRole('button',{name:'Review',exact:true}).click();
    const dialog = page.getByRole('dialog');
    assert.equal(await page.evaluate(()=>window.paymentOriginRequests.length),0);
    await dialog.getByRole('button',{name:'View original creators',exact:true}).click();
    await dialog.getByRole('region',{name:'Original creators',exact:true}).getByText('brst_actual_creator',{exact:true}).waitFor();
    await dialog.getByText('This payment’s origin history is not fully confirmed.',{exact:true}).waitFor();
    await dialog.getByText('brst_sender_not_creator',{exact:true}).waitFor();
    assert(await page.evaluate(()=>window.paymentOriginRequests.every(args=>args.payment==='a'.repeat(64))));
    await page.setViewportSize({width:320,height:800});
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:'/tmp/burst-wallet-payment-origin-review-320.png',fullPage:true});
    await dialog.getByRole('button',{name:'Hide original creators',exact:true}).click();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.calls.filter(call=>['receive_pending','reject_pending'].includes(call.command)).length),0);
  } finally { await page.close(); }
});

test('portfolio and activity outages never appear as empty balances or empty activity', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (['get_trst_portfolio','get_account_history'].includes(command)) throw new Error('Fixture data unavailable');
        return original(command,args);
      };
    });
    await page.getByRole('link', {name:'TRST',exact:true}).click();
    await page.getByRole('heading', {name:'TRST unavailable'}).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /No TRST batches|0\.000000/);
    await page.getByRole('link', {name:'Activity',exact:true}).click();
    await page.getByRole('alert').waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /No activity yet/);
  } finally { await page.close(); }
});

test('mobile More navigation moves focus to the destination, while Escape restores More', async () => {
  const page = await wallet('test', {viewport:{width:390,height:844}});
  try {
    await page.getByRole('button', {name:'More',exact:true}).click();
    await page.getByRole('dialog').getByRole('link', {name:'Settings',exact:true}).click();
    await page.waitForFunction(() => document.activeElement?.id === 'main-content');
    await page.getByRole('button', {name:'More',exact:true}).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'More');
  } finally { await page.close(); }
});

test('cancelling key export clears the password and discards late synthetic results', async () => {
  const page = await wallet('test');
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => command === 'export_private_key'
        ? new Promise(resolve => { window.finishFixtureExport = () => resolve('NOT-A-REAL-KEY'); })
        : original(command,args);
    });
    await page.getByRole('link', {name:'Settings',exact:true}).click();
    await page.getByRole('button', {name:'Export Private Key',exact:true}).click();
    await page.getByLabel('Wallet password', {exact:true}).fill('fixture-only-password');
    await page.getByRole('button', {name:'Reveal private key',exact:true}).click();
    await page.waitForFunction(() => !!window.finishFixtureExport);
    await page.getByRole('button', {name:'Cancel',exact:true}).click();
    await page.evaluate(() => window.finishFixtureExport());
    await page.getByRole('button', {name:'Export Private Key',exact:true}).click();
    assert.equal(await page.getByLabel('Wallet password', {exact:true}).inputValue(),'');
    assert.equal(await page.getByRole('button', {name:'Show private key',exact:true}).count(),0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Export Private Key');
  } finally { await page.close(); }
});


test('all wallet routes fit narrow touch screens in both appearances', async () => {
  const page = await wallet('test',{viewport:{width:320,height:700},hasTouch:true,isMobile:true});
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      const now = Math.floor(Date.now()/1000);
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_trst_portfolio') return {total_active:'2000000000000000000',total_expired:'0',total_revoked:'0',batches:[{origin:'a'.repeat(64),originator:'brst_'+'1'.repeat(60),amount:'2000000000000000000',timestamp:now-100,expiry_at:now+31536000,status:'active',chain_length:1}]};
        if (command === 'get_verification_status') return {state:'Verified',verified_at:now-100,endorsement_count:3,endorsement_threshold:3,endorsers:[],verifier_votes:[],challenge_active:false};
        if (command === 'get_delegation_info') return {delegated_from:[]};
        return original(command,args);
      };
    });
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.body.classList.toggle('dark',theme === 'dark'),theme);
      for (const route of ['/','/pay','/transfer','/receive','/portfolio','/history','/verification','/governance','/settings']) {
        await page.evaluate(route => { history.pushState({},'',route); dispatchEvent(new PopStateEvent('popstate')); },route);
        await page.waitForFunction(() => !document.querySelector('main [data-slot="skeleton"]'));
        // Wait until the route has painted before measuring layout.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const overflow = await page.locator('main').evaluate(el => ({scroll:el.scrollWidth,client:el.clientWidth}));
        assert(overflow.scroll <= overflow.client, theme+' '+route+': '+JSON.stringify(overflow));
        if (['/','/pay','/portfolio'].includes(route)) await page.screenshot({path:'/tmp/burst-wallet-'+theme+'-'+(route.slice(1)||'home')+'-mobile.png',animations:'disabled'});
      }
    }
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});

test('theme text tokens meet normal-text contrast and input boundaries remain visible', async () => {
  const page = await wallet('test');
  try {
    await page.getByRole('button',{name:'Pay',exact:true}).click();
    await page.getByLabel('Provider address',{exact:true}).waitFor();
    for (const theme of ['light','dark']) {
      await page.evaluate(theme => document.body.classList.toggle('dark',theme === 'dark'),theme);
      const contrasts = await page.evaluate(() => {
        const context = document.createElement('canvas').getContext('2d',{willReadFrequently:true});
        const style = getComputedStyle(document.body);
        function luminance(token) {
          context.fillStyle = style.getPropertyValue('--color-'+token).trim();
          context.fillRect(0,0,1,1);
          const rgb = [...context.getImageData(0,0,1,1).data].slice(0,3).map(x => x/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        }
        const pairs = [['foreground','background'],['muted-foreground','background'],['muted-foreground','secondary'],['primary-foreground','primary'],['destructive','card'],['warning','card'],['success','card'],['input','background']];
        return pairs.map(([front,back]) => { const a=luminance(front),b=luminance(back); return {front,back,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}; });
      });
      for (const pair of contrasts) assert(pair.ratio >= (pair.front === 'input' ? 3 : 4.5), theme+' '+JSON.stringify(pair));
      assert.equal(await page.getByLabel('Provider address',{exact:true}).evaluate(el => { const probe=document.createElement('span'); probe.style.color='var(--color-input)'; document.body.append(probe); const expected=getComputedStyle(probe).color; probe.remove(); return getComputedStyle(el).borderTopColor === expected; }),true,'Input must use its contrast-tested border token');
    }
  } finally { await page.close(); }
});

test('consumer home distinguishes paused and zero-rate income, reputation and revoked TRST', async () => {
  const page = await wallet('test');
  try {
    await page.getByText('Income is paused for this wallet',{exact:true}).waitFor();
    await page.getByRole('region',{name:'Non-transferable TRST'}).getByText(/kept as reputation/).waitFor();
    await page.getByText('Income details',{exact:true}).click();
    await page.getByText('1.234567890123456789',{exact:true}).waitFor();
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_brn_components') return {verified_at:0,total_burned:'0',total_staked:'0',accrual_active:true,accrual_stopped_at:null,as_of:1,rate_history:[{rate:'0',start:0,end:null}]};
        if (command === 'get_trst_balance') return {active:'2000000000000000000',expired:'1000000000000000000',revoked:'500000000000000000'};
        if (command === 'get_account_history') return {history:[{hash:'synthetic-send',account:'brst_test_wallet',block_type:'Send',amount:'999000000000000000000',timestamp:1700000000}]};
        return original(command,args);
      };
    });
    await page.getByRole('link',{name:'Activity',exact:true}).click();
    await page.getByRole('link',{name:'Wallet',exact:true}).click();
    await page.getByText('Income is off on this network',{exact:true}).waitFor();
    await page.getByText('Sent TRST',{exact:true}).waitFor();
    assert.match(await page.getByRole('region',{name:'Non-transferable TRST'}).innerText(), /0\.500000 TRST revoked/);
    assert.doesNotMatch(await page.locator('.activity-section').innerText(), /999\.000000|brst_test_wallet|TRST balance/);
  } finally { await page.close(); }
});

test('verification capability distinguishes paused, unknown and available reviews', async () => {
  const page = await wallet('test');
  try {
    await page.clock.install();
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.reviewCapability = false;
      window.reviewState = 'Verified';
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_verification_status') return {state:window.reviewState,endorsement_count:3,endorsement_threshold:3,endorsers:[],verifier_votes:[],challenge_active:false,selection_available:window.reviewCapability};
        return original(command,args);
      };
    });
    for (const capability of [false,null,true]) {
      await page.evaluate(capability => {window.reviewCapability=capability; history.pushState({},'','/history'); dispatchEvent(new PopStateEvent('popstate'));},capability);
      await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
      await page.evaluate(() => {history.pushState({},'','/verification'); dispatchEvent(new PopStateEvent('popstate'));});
      await page.getByText('Vouch for someone',{exact:true}).click();
      await page.getByLabel('Their wallet address',{exact:true}).waitFor();
      await page.getByText('Report a wallet',{exact:true}).click();
      if (capability === true) {
        await page.getByLabel('Reason for re-verification',{exact:true}).waitFor();
      } else {
        await page.getByText(capability === false ? 'Identity reviews are paused on this node.' : "Your node hasn't reported whether identity reviews are available.",{exact:true}).waitFor();
        await page.getByText('Endorsements can be recorded, but cannot complete verification on this node yet.',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('Reason for re-verification',{exact:true}).count(),0);
        for (const theme of ['light','dark']) {
          await page.evaluate(theme => document.body.classList.toggle('dark',theme === 'dark'),theme);
          for (const width of [1000,320]) {
            await page.setViewportSize({width,height:900});
            assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth),true);
          }
        }
      }
    }
    await page.locator('#challenge-address').fill('brst_'+'1'.repeat(60));
    await page.getByLabel('BRN to put at risk',{exact:true}).fill('500');
    await page.getByLabel('BRN to put at risk',{exact:true}).press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => {window.reviewCapability=false;});
    await page.clock.fastForward(11000);
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:'Submit Challenge',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(() => window.calls.some(call => ['endorse_wallet','challenge_wallet'].includes(call.command))),false);
    await page.screenshot({path:'/tmp/burst-wallet-verification-paused.png',animations:'disabled'});
    await page.getByLabel('Their wallet address',{exact:true}).fill('brst_'+'1'.repeat(60));
    await page.getByLabel('BRN to spend permanently',{exact:true}).fill('336');
    await page.getByLabel('BRN to spend permanently',{exact:true}).press('Enter');
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => {window.reviewState='Revoked';});
    await page.clock.fastForward(11000);
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:'Burn & Endorse',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(() => {window.reviewState='Voting';});
    await page.clock.fastForward(11000);
    await page.getByText('Review on hold',{exact:true}).waitFor();
    assert.equal(await page.getByText('Voting in Progress',{exact:true}).count(),0);
    assert.equal(await page.evaluate(() => window.calls.some(call => ['endorse_wallet','challenge_wallet'].includes(call.command))),false);
  } finally {await page.close();}
});

test('verification shows the next step and keeps community tools contextual', async () => {
  const page = await wallet('test',{viewport:{width:320,height:700},hasTouch:true,isMobile:true});
  try {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.verificationFixture = 'Unverified';
      window.__TAURI_INTERNALS__.invoke = async (command,args) => {
        if (command === 'get_verification_status') return {state:window.verificationFixture,verified_at:1700000000,endorsement_count:1,endorsement_threshold:3,endorsers:[],verifier_votes:[],challenge_active:window.verificationFixture === 'Challenged',selection_available:true};
        return original(command,args);
      };
    });
    for (const state of ['Unverified','Voting','Deactivated','Revoked','Challenged','Verified']) {
      await page.evaluate(state => { window.verificationFixture=state; history.pushState({},'','/history'); dispatchEvent(new PopStateEvent('popstate')); }, state);
      await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
      await page.evaluate(() => { history.pushState({},'','/verification'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.waitForFunction(() => !document.querySelector('main [data-slot="skeleton"]'));
      if (state === 'Unverified') {
        await page.getByRole('button',{name:'Share your address',exact:true}).waitFor();
        assert.match(await page.locator('main').innerText(), /Endorsements alone do not verify/);
        await page.locator('main').evaluate(el => { el.scrollTop=0; });
        await page.screenshot({path:'/tmp/burst-wallet-verification-next-step.png',animations:'disabled'});
      } else assert.equal(await page.getByRole('button',{name:'Share your address',exact:true}).count(),0);
      if (state === 'Verified' || state === 'Challenged') {
        assert.equal(await page.getByLabel('Their wallet address',{exact:true}).isVisible(),false);
        await page.locator('main').evaluate(el => { el.scrollTop=0; });
        await page.screenshot({path:'/tmp/burst-wallet-verification-verified.png',animations:'disabled'});
        await page.getByText('Vouch for someone',{exact:true}).click();
        await page.getByLabel('Their wallet address',{exact:true}).waitFor();
        await page.getByText('Report a wallet',{exact:true}).click();
        await page.getByLabel('Reason for re-verification',{exact:true}).waitFor();
        assert.match(await page.locator('main').innerText(), /permanently spend your BRN/);
        assert.doesNotMatch(await page.locator('main').innerText(), /BRN has been accruing/);
      } else assert.equal(await page.getByText('Vouch for someone',{exact:true}).count(),0);
      if (state === 'Deactivated') assert.match(await page.locator('main').innerText(), /legitimate TRST has not been revoked/);
      assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth),true,state);
    }
    await page.locator('main').evaluate(el => { el.scrollTop=0; });
    await page.screenshot({path:'/tmp/burst-wallet-consumer-verification.png',animations:'disabled'});
    assert.equal(await page.evaluate(() => window.calls.some(call => ['endorse_wallet','challenge_wallet'].includes(call.command))),false);
  } finally { await page.close(); }
});
