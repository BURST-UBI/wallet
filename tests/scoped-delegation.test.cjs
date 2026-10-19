// Browser contracts with mocked IPC, not native signing or network evidence.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openGovernance} = require('./browser-wallet.cjs');
let browser;
before(async () => {browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH});});
after(async () => {await browser?.close();});

async function fixture({enabled = true, verified = true, width = 1000, phase = 'Exploration', projected = false, listProposals = false} = {}) {
  const page = await browser.newPage({viewport:{width,height:850}});
  await page.addInitScript(({enabled, verified, phase, projected, listProposals}) => {
    window.isTauri = true;
    window.calls = [];
    const account = 'brst_' + '1'.repeat(60);
    const recipient = 'brst_' + '3'.repeat(60);
    const proposal = {hash:'a'.repeat(64),proposer:account,description:'Update BRN rate',param:'BrnRate',phase,
      phase_projected:projected,phase_deadline:Math.floor(Date.now()/1000)+3600,votes_yea:20,votes_nay:0,votes_abstain:0};
    window.__TAURI_INTERNALS__ = {invoke: async (command,args) => {
      window.calls.push({command,args});
      const entry = {owner:account,scope:{kind:'parameter',value:'brn_rate'},generation:'2',delegate:recipient,grant_block:'b'.repeat(64),confirmed:true};
      switch(command) {
        case 'import_private_key': return {address:account,verification_state:verified?'verified':'revoked'};
        case 'get_node_info': return {block_count:7,network:'dev',faucet_enabled:false};
        case 'get_account_info': if (window.accountError) throw new Error('Node unavailable'); return {address:account,verification_state:verified?'verified':'revoked',brn_balance:'0',block_count:7};
        case 'get_governance_proposals': return {proposals:listProposals?[proposal]:[]};
        case 'get_constitution_context': return {enabled:false,document:{version:'0',articles:[]},revision:'fixture',endorsement_cost:'1'};
        case 'get_governance_proposal_info': return proposal;
        case 'get_scoped_delegations': return {enabled,network:'Dev',genesis:'c'.repeat(64),parameters:['brn_rate','trst_expiry_secs'],entries:args.incoming?[{...entry,owner:recipient,delegate:account}]:args.scope?.kind==='proposal'?[]:[entry],cursor:null};
        case 'set_scoped_delegation': case 'vote_with_delegation': await new Promise(resolve => setTimeout(resolve,100)); return {accepted:true,hash:'d'.repeat(64)};
        case 'begin_automation': return '1';
        case 'cancel_automation': return null;
        case 'maintain_wallet': return {received:0,merged:0,held:0};
        case 'get_pending': return {blocks:[]};
        case 'get_brn_components': return {verified_at:0,total_burned:'0',total_staked:'0',accrual_active:false,accrual_stopped_at:1,as_of:1,rate_history:[{rate:'0',start:0,end:null}]};
        case 'get_trst_balance': return {active:'0',expired:'0',revoked:'0'};
        default: throw new Error('Unexpected command: '+command);
      }
    }};
  }, {enabled,verified,phase,projected,listProposals});
  await openGovernance(page);
  await page.getByRole('heading',{name:'Voting delegation'}).waitFor();
  await page.getByText(enabled?'Your delegates':'Scoped delegation is not enabled on this node yet.',{exact:true}).waitFor();
  return page;
}

test('scoped registration reviews scope and generation before one submission', async () => {
  const page = await fixture();
  try {
    await page.getByLabel('Delegate’s address',{exact:true}).fill('brst_'+'3'.repeat(60));
    await page.getByRole('button',{name:'Review delegation',exact:true}).click();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.innerText(),/BRN rate/);
    await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const calls = await page.evaluate(() => window.calls.filter(call => call.command==='set_scoped_delegation'));
    assert.equal(calls.length,1);assert.equal(calls[0].args.generation,'2');
    assert.deepEqual(calls[0].args.scope,{kind:'parameter',value:'brn_rate'});
    assert.equal(calls[0].args.expectedAccount,'brst_'+'1'.repeat(60));
    assert.equal(calls[0].args.expectedGenesis,'c'.repeat(64));
  } finally {await page.close();}
});

test('projected results stay provisional in list and detail without blocking scheduled voting', async () => {
  for (const phase of ['Exploration', 'Rejected', 'Activated']) {
    const page = await fixture({phase,projected:true,listProposals:true});
    try {
      const label = phase === 'Exploration' ? 'Voting · Provisional' : 'Result pending';
      await page.getByRole('region',{name:'Community proposals'}).getByText(label,{exact:true}).waitFor();
      await page.getByRole('button',{name:'Read proposal: Update BRN rate',exact:true}).click();
      const detail = page.getByRole('region',{name:'Proposal',exact:true});
      await detail.getByText(label,{exact:true}).waitFor();
      await detail.getByRole('status').getByText('Phase and vote counts are provisional until the network confirms them.',{exact:true}).waitFor();
      assert.equal(await detail.getByText('In effect',{exact:true}).count(),0);
      assert.equal(await detail.getByText('Not passed',{exact:true}).count(),0);
      if (process.env.UI_EVIDENCE && phase === 'Rejected') await page.screenshot({path:process.env.UI_EVIDENCE+'/governance-projected.png',fullPage:true});
      if (phase === 'Exploration') {
        assert.equal(await detail.getByRole('button',{name:'Support',exact:true}).isEnabled(),true);
        await detail.getByRole('button',{name:'Support',exact:true}).click();
        await page.getByRole('dialog').getByText(label,{exact:true}).waitFor();
        await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
        assert.equal(await page.evaluate(() => window.calls.filter(call=>call.command==='vote_proposal').length),0);
      }
    } finally {await page.close();}
  }
});

test('certified outcomes retain their final label without a provisional warning', async () => {
  for (const [phase,label] of [['Activated','In effect'],['Rejected','Not passed']]) {
    const page = await fixture({phase,projected:false,listProposals:true});
    try {
      await page.getByRole('button',{name:'Read proposal: Update BRN rate',exact:true}).click();
      const detail = page.getByRole('region',{name:'Proposal',exact:true});
      await detail.getByText(label,{exact:true}).waitFor();
      assert.equal(await detail.getByRole('status').count(),0);
      assert.equal(await detail.getByRole('button',{name:'Support',exact:true}).count(),0);
    } finally {await page.close();}
  }
});

test('governance reads current verification without visiting the dashboard and clears it on connection failure', async () => {
  const page = await fixture();
  try {
    await page.locator('.wallet-identity').getByText('Verified',{exact:true}).waitFor();
    await page.evaluate(async () => {
      window.accountError = true;
      const {useWalletStore} = await import(window.storeUrl);
      useWalletStore.setState({rpcUrl:'http://127.0.0.1:9999'});
    });
    await page.locator('.wallet-identity').getByText('Status unavailable',{exact:true}).waitFor();
    assert.equal(await page.locator('.wallet-identity').getByText('Verified',{exact:true}).count(),0);
  } finally {await page.close();}
});

test('governance amounts are readable without rounding away raw units', async () => {
  const page = await fixture();
  try {
    const values = await page.evaluate(async () => {
      const {governanceTitle,governanceValue} = await import('/src/lib/governance.ts');
      return [
        governanceTitle({description:'Change BrnRate to 2000000000000000000'}),
        governanceValue({param:'BrnRate',proposed_value:'1'}),
        governanceValue({param:'BrnRate',proposed_value:'0'}),
        governanceTitle({description:'Each person has one vote.',param:'constitution'}),
        governanceTitle({description:'Change the discussion period',param:'GovernanceCooldownSecs',proposed_value:'86400'}),
      ];
    });
    assert.deepEqual(values,['Change BRN rate to 2 BRN per second','0.000000000000000001 BRN per second','0 BRN per second','Each person has one vote.','Change the discussion period']);
  } finally {await page.close();}
});

test('revoked owners can revoke and mobile controls do not overflow', async () => {
  const page = await fixture({verified:false,width:390});
  try {
    assert.equal(await page.getByRole('button',{name:'Review delegation',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'Revoke for this scope'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.calls.find(call=>call.command==='set_scoped_delegation').args.delegate),null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
    if (process.env.UI_EVIDENCE) await page.screenshot({path:process.env.UI_EVIDENCE+'/scoped-mobile.png',fullPage:true});
  } finally {await page.close();}
});

test('delegate reads a matching proposal and reviews a secondary ballot', async () => {
  const page = await fixture();
  try {
    await page.getByText('Find a proposal by ID',{exact:true}).click();
    await page.getByLabel('Proposal ID',{exact:true}).fill('a'.repeat(64));
    await page.getByRole('button',{name:'Read proposal',exact:true}).click();
    await page.getByRole('heading',{name:'Update BRN rate'}).waitFor();
    const delegation = page.getByRole('region',{name:'Voting delegation'});
    await delegation.getByRole('button',{name:'Delegated to you'}).click();
    await delegation.getByRole('button',{name:'Support',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    const calls = await page.evaluate(() => window.calls.filter(call=>call.command==='vote_with_delegation'));
    assert.equal(calls.length,1);assert.equal(calls[0].args.vote,'yea');assert.equal(calls[0].args.entry.generation,'2');
    if (process.env.UI_EVIDENCE) await page.screenshot({path:process.env.UI_EVIDENCE+'/scoped-desktop.png',fullPage:true});
  } finally {await page.close();}
});

test('gate stays visible and changing wallets cancels an unsigned review', async () => {
  const disabled = await fixture({enabled:false});
  try {assert.equal(await disabled.getByRole('button',{name:'Review delegation',exact:true}).count(),0);} finally {await disabled.close();}
  const page = await fixture();
  try {
    await page.getByRole('button',{name:'Revoke for this scope'}).click();
    await page.evaluate(async () => {const {useWalletStore} = await import(window.storeUrl);useWalletStore.setState({address:'brst_'+'4'.repeat(60)});});
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.calls.filter(call=>call.command==='set_scoped_delegation').length),0);
  } finally {await page.close();}
});
