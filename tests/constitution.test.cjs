// Browser interaction contracts; the native certified fixture proves signing.
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openGovernance} = require('./browser-wallet.cjs');
let browser;
before(async () => {browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});});
after(async () => {await browser?.close();});
async function fixture(enabled=true) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(enabled => {
    window.isTauri=true;window.calls=[];
    const address='brst_'+'1'.repeat(60);
    window.context={enabled,document:{version:'0',articles:[{id:'1',title:'Humanity',text:'Old text'},{id:'2',title:'Evidence',text:'Other text'}]},revision:'reviewed-revision',params_hash:'c'.repeat(64),genesis:'d'.repeat(64),endorsement_cost:'1'};
    window.context.parameters=[
      {name:'brn_rate',current:'1000000000000000000',maximum:'340282366920938463463374607431768211455',unit:'brn_per_second',legacy:false},
      {name:'trst_expiry_secs',current:'3600',maximum:'18446744073709551615',unit:'seconds',legacy:false},
      {name:'governance_quorum_bps',current:'6000',maximum:'4294967295',unit:'basis_points',legacy:false},
      {name:'min_verification_age_secs',current:'2592000',maximum:'18446744073709551615',unit:'seconds',legacy:false},
      {name:'neither_penalty_cooldown_secs',current:'604800',maximum:'18446744073709551615',unit:'seconds',legacy:false},
      {name:'neither_penalty_threshold_bps',current:'5000',maximum:'4294967295',unit:'basis_points',legacy:false},
      {name:'neither_window_assignments',current:'100',maximum:'4294967295',unit:'count',legacy:false},
      {name:'min_verifier_brn_balance',current:'50000000000000000000',maximum:'340282366920938463463374607431768211455',unit:'brn',legacy:false},
      {name:'emergency_voting_duration_secs',current:'86400',maximum:'18446744073709551615',unit:'seconds',legacy:false},
      {name:'emergency_quorum_bps',current:'9500',maximum:'4294967295',unit:'basis_points',legacy:false},
      {name:'emergency_supermajority_bps',current:'9500',maximum:'4294967295',unit:'basis_points',legacy:false},
      {name:'governance_promotion_duration_secs',current:'0',maximum:'18446744073709551615',unit:'seconds',legacy:true},
    ];
    window.proposal={hash:'a'.repeat(64),proposer:address,phase:'Exploration',description:'共同の憲法 🌍',param:'constitution',votes_yea:0,votes_nay:0,phase_deadline:Math.floor(Date.now()/1000)+3600,amendment_operations:[{ModifyArticle:{article_number:'1',new_text:'人 🌍'}},{RepealArticle:{article_number:'2'}},{AddArticle:{title:'Rights',text:'Every person.'}}]};
    window.__TAURI_INTERNALS__={invoke:async (command,args) => {
      window.calls.push({command,args});
      switch(command) {
        case 'import_private_key':return {address,verification_state:'verified'};
        case 'get_node_info':return {network:'dev',faucet_enabled:false};
        case 'get_account_info':return {address,verification_state:'verified',brn_balance:'100',block_count:4};
        case 'get_constitution_context':return window.context;
        case 'get_governance_proposals':return {proposals:[window.proposal]};
        case 'get_governance_proposal_info':return window.proposal;
        case 'get_scoped_delegations':return {enabled:true,genesis:'d'.repeat(64),parameters:['brn_rate'],entries:args.incoming?[{owner:'brst_'+'3'.repeat(60),scope:{kind:'proposal',value:'a'.repeat(64)},delegate:address,generation:'1',grant_block:'e'.repeat(64),confirmed:true}]:[],cursor:null};
        case 'propose_parameter':case 'propose_constitution':if(window.rejectDraft) throw new Error('The constitution or network rules changed. Review your amendment again.');return {accepted:true,hash:'a'.repeat(64)};
        case 'withdraw_governance_proposal':if(window.rejectWithdrawal)throw new Error('This proposal can no longer be withdrawn. Refresh its status.');window.proposal.phase='Withdrawn';return {accepted:true,hash:'f'.repeat(64)};
        case 'vote_proposal':case 'vote_with_delegation':case 'endorse_governance_proposal':return {accepted:true,hash:'f'.repeat(64)};
        case 'begin_automation':return '1';
        case 'cancel_automation':return null;
        default:throw new Error('Unexpected command '+command);
      }
    }};
  },enabled);
  await openGovernance(page);
  try {
    await page.getByRole('button',{name:'New amendment',exact:true}).waitFor({timeout:10_000});
  } catch(error) {
    console.error('Constitution fixture did not open:',page.url(),await page.locator('body').innerText());
    await page.close();
    throw error;
  }
  return page;
}
async function addDraft(page) {
  await page.getByRole('button',{name:'New amendment',exact:true}).click();
  await page.getByLabel('Amendment title',{exact:true}).fill('共同の憲法 🌍');
  await page.locator('#amendment-article-title-0').fill('Rights');
  await page.locator('#amendment-text-0').fill('Every person.');
}
test('proposal withdrawal confirms the loss of endorsements, cancels safely and restores focus',async () => {
  const page=await fixture();
  try {
    await page.evaluate(()=>{window.proposal.phase='Proposal';});
    await page.getByRole('button',{name:'Read proposal: 共同の憲法 🌍'}).click();
    const trigger=page.getByRole('region',{name:'Proposal',exact:true}).getByRole('button',{name:'Withdraw proposal',exact:true});
    await trigger.click();
    const dialog=page.getByRole('dialog');
    await dialog.getByText(/not refunded/).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.UI_EVIDENCE)await page.screenshot({path:process.env.UI_EVIDENCE+'/withdrawal-review-mobile.png'});
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    assert(await trigger.evaluate(element=>element===document.activeElement));
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='withdraw_governance_proposal').length),0);
    await trigger.click();
    await dialog.getByRole('button',{name:'Withdraw proposal',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await trigger.waitFor({state:'hidden'});
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.command==='withdraw_governance_proposal'));
    assert.equal(calls.length,1);
    assert.equal(calls[0].args.expectedRevision,'reviewed-revision');
    assert.equal(calls[0].args.expectedAccount,'brst_'+'1'.repeat(60));
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Proposal');
  }finally{await page.close();}
});
test('proposal withdrawal is owner-only and stale phase or native rejection never reports success',async () => {
  const page=await fixture();
  try {
    await page.evaluate(()=>{window.proposal.phase='Proposal';window.proposal.proposer='another wallet';});
    await page.getByRole('button',{name:'Read proposal: 共同の憲法 🌍'}).click();
    assert.equal(await page.getByRole('button',{name:'Withdraw proposal',exact:true}).count(),0);
    await page.getByRole('button',{name:'All proposals',exact:true}).click();
    await page.evaluate(()=>{window.proposal.proposer='brst_'+'1'.repeat(60);});
    await page.getByRole('button',{name:'Read proposal: 共同の憲法 🌍'}).click();
    await page.getByRole('button',{name:'Withdraw proposal',exact:true}).click();
    await page.evaluate(()=>{window.proposal.phase='Exploration';});
    const dialog=page.getByRole('dialog');
    await dialog.getByRole('button',{name:'Withdraw proposal',exact:true}).click();
    await dialog.getByRole('alert').getByText(/no longer available/).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='withdraw_governance_proposal').length),0);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(()=>{window.proposal.phase='Proposal';window.rejectWithdrawal=true;});
    await page.getByRole('region',{name:'Proposal',exact:true}).getByRole('button',{name:'Withdraw proposal',exact:true}).click();
    await dialog.getByRole('button',{name:'Withdraw proposal',exact:true}).click();
    await dialog.getByRole('alert').getByText(/no longer be withdrawn/).waitFor();
    assert(await dialog.getByRole('button',{name:'Withdraw proposal',exact:true}).isDisabled());
  }finally{await page.close();}
});
test('field errors appear after review and clear as the draft is completed',async () => {
  const page=await fixture();
  try {
    await page.getByRole('button',{name:'New amendment',exact:true}).click();
    const title=page.getByLabel('Amendment title',{exact:true});
    assert.equal(await title.getAttribute('aria-invalid'),'false');
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    for(const id of ['amendment-title','amendment-article-title-0','amendment-text-0']) {
      const field=page.locator('#'+id);
      assert.equal(await field.getAttribute('aria-invalid'),'true');
      const description=await field.getAttribute('aria-describedby');
      assert(description);
      assert(await page.locator('#'+description).isVisible());
    }
    assert.equal(await page.getByRole('dialog').count(),0);
    await title.fill('共同の憲法 🌍');
    assert.equal(await title.getAttribute('aria-invalid'),'false');
    await page.locator('#amendment-kind-0').selectOption('repeal');
    assert.equal(await page.locator('#amendment-article-0').getAttribute('aria-invalid'),'true');
    await page.locator('#amendment-article-0').selectOption('1');
    assert.equal(await page.locator('#amendment-article-0').getAttribute('aria-invalid'),'false');
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    await page.getByRole('dialog').getByText('1. Repeal article 1',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_constitution').length),0);
  } finally {await page.close();}
});
test('ordered typed changes are reviewed and published once with exact Unicode and context',async () => {
  const page=await fixture();
  try {
    await addDraft(page);
    await page.getByRole('button',{name:'Add change',exact:true}).click();
    await page.locator('#amendment-kind-1').selectOption('modify');
    await page.locator('#amendment-article-1').selectOption('1');
    await page.locator('#amendment-text-1').fill('人 🌍');
    await page.getByRole('button',{name:'Add change',exact:true}).click();
    await page.locator('#amendment-kind-2').selectOption('repeal');
    await page.locator('#amendment-article-2').selectOption('2');
    await page.getByRole('button',{name:'Move change 2 up',exact:true}).click();
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    const dialog=page.getByRole('dialog');
    assert.equal(await dialog.getByRole('list',{name:'Amendment changes'}).locator('li').count(),3);
    assert.match(await dialog.innerText(),/1\. Replace article 1/);
    assert.match(await dialog.innerText(),/人 🌍/);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_constitution').length),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.UI_EVIDENCE) await page.screenshot({path:process.env.UI_EVIDENCE+'/constitution-review-mobile.png'});
    await dialog.getByRole('button',{name:'Publish amendment',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_constitution'));
    assert.equal(calls.length,1);assert.equal(calls[0].args.expectedRevision,'reviewed-revision');
    assert.deepEqual(calls[0].args.draft,{title:'共同の憲法 🌍',operations:[{ModifyArticle:{article_number:'1',new_text:'人 🌍'}},{AddArticle:{title:'Rights',text:'Every person.'}},{RepealArticle:{article_number:'2'}}]});
  } finally {await page.close();}
});
test('cancel preserves the draft, Unicode counts as characters, stale review cannot resubmit',async () => {
  const page=await fixture();
  try {
    await addDraft(page);
    await page.locator('#amendment-text-0').fill('🌍'.repeat(50000));
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Back to editing'}).click();
    assert.equal(await page.locator('#amendment-text-0').inputValue(),'🌍'.repeat(50000));
    await page.locator('#amendment-text-0').fill('🌍'.repeat(50001));
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    await page.getByRole('alert').getByText(/50,000 characters/).waitFor();
    await page.locator('#amendment-text-0').fill('人 🌍');
    await page.getByRole('button',{name:'Review amendment',exact:true}).click();
    await page.evaluate(()=>{window.rejectDraft=true;});
    await page.getByRole('dialog').getByRole('button',{name:'Publish amendment'}).click();
    await page.getByRole('dialog').getByRole('alert').getByText(/rules changed/).waitFor();
    assert(await page.getByRole('dialog').getByRole('button',{name:'Publish amendment'}).isDisabled());
  } finally {await page.close();}
});
test('full typed amendments can be read and voted on directly or through a proposal grant',async () => {
  const page=await fixture();
  try {
    await page.getByRole('button',{name:'Read proposal: 共同の憲法 🌍'}).click();
    await page.getByRole('region',{name:'Proposal',exact:true}).getByRole('list',{name:'Amendment changes'}).waitFor();
    await page.getByRole('region',{name:'Proposal',exact:true}).getByRole('button',{name:'Support',exact:true}).click();
    await page.getByRole('dialog').getByText('人 🌍',{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Confirm vote'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Delegated to you'}).click();
    await page.getByRole('region',{name:'Voting delegation'}).getByRole('button',{name:'Support',exact:true}).click();
    await page.getByRole('dialog').getByRole('list',{name:'Amendment changes'}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='vote_proposal'||c.command==='vote_with_delegation').length),2);
  } finally {await page.close();}
});
test('publishing stays gated and incomplete operations cannot enable voting',async () => {
  const page=await fixture(false);
  try {
    assert(await page.getByRole('button',{name:'New amendment'}).isDisabled());
    await page.getByText('Read current constitution · Version 0').click();
    await page.getByText('Old text',{exact:true}).waitFor();
    await page.evaluate(()=>{window.proposal.amendment_operations=[{Unknown:{}}];});
    await page.getByRole('button',{name:'Read proposal: 共同の憲法 🌍'}).click();
    assert(await page.getByRole('region',{name:'Proposal',exact:true}).getByRole('button',{name:'Support',exact:true}).isDisabled());
    await page.getByRole('alert').getByText(/complete amendment/).waitFor();
  } finally {await page.close();}
});

test('parameter proposal reviews exact values, preserves cancellation, and submits once',async () => {
  const page=await fixture(false);
  try {
    await page.getByRole('button',{name:'Propose a change',exact:true}).click();
    assert.equal(await page.locator('#governance-parameter option[value="governance_promotion_duration_secs"]').count(),0);
    await page.locator('#governance-parameter').selectOption('brn_rate');
    await page.locator('#governance-new-value').fill('2.000000000000000001');
    await page.locator('#governance-new-value').press('Enter');
    const dialog=page.getByRole('dialog');
    assert.match(await dialog.innerText(),/2\.000000000000000001 BRN per second/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(process.env.UI_EVIDENCE)await page.screenshot({path:process.env.UI_EVIDENCE+'/parameter-review-mobile.png'});
    await dialog.getByRole('button',{name:'Back to editing'}).click();
    assert.equal(await page.locator('#governance-new-value').inputValue(),'2.000000000000000001');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_parameter').length),0);
    await page.getByRole('button',{name:'Review proposal',exact:true}).click();
    await dialog.getByRole('button',{name:'Publish proposal',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_parameter'));
    assert.equal(calls.length,1);
    assert.equal(calls[0].args.newValue,'2000000000000000001');
    assert.equal(calls[0].args.expectedRevision,'reviewed-revision');
  }finally{await page.close();}
});

test('parameter precision, storage limits, no expiry and stale review fail safely',async () => {
  const page=await fixture();
  try {
    const displays = await page.evaluate(async () => {
      const {governanceValue} = await import('/src/lib/governance.ts');
      return [
        governanceValue({param:'ChallengeRewardCap',proposed_value:'1234000000000000000'}),
        governanceValue({param:'GovernanceProposalCost',proposed_value:'1'}),
        governanceValue({param:'GovernanceQuorumBps',proposed_value:'1'}),
        governanceValue({param:'TrstExpirySecs',proposed_value:'18446744073709551615'}),
        governanceValue({param:'MinVerificationAgeSecs',proposed_value:'0'}),
        governanceValue({param:'NeitherPenaltyCooldownSecs',proposed_value:'7'}),
      ];
    });
    assert.deepEqual(displays,['1.234 TRST','0.000000000000000001 BRN','0.01 %','No expiry','0 seconds','7 seconds']);
    await page.getByRole('button',{name:'Propose a change',exact:true}).click();
    await page.locator('#governance-parameter').selectOption('governance_quorum_bps');
    await page.locator('#governance-new-value').fill('60.001');
    await page.getByRole('button',{name:'Review proposal',exact:true}).click();
    assert.equal(await page.locator('#governance-new-value').getAttribute('aria-invalid'),'true');
    await page.locator('#parameter-value-error').getByText(/2 decimal places/).waitFor();
    await page.locator('#governance-new-value').fill('42949672.96');
    await page.locator('#parameter-value-error').getByText(/maximum/).waitFor();
    await page.locator('#governance-new-value').fill('0.01');
    await page.getByRole('button',{name:'Review proposal',exact:true}).click();
    await page.getByRole('dialog').getByText('0.01 %',{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Back to editing'}).click();
    await page.locator('#governance-parameter').selectOption('trst_expiry_secs');
    await page.getByRole('checkbox',{name:'No expiry',exact:true}).check();
    await page.getByRole('button',{name:'Review proposal',exact:true}).click();
    await page.getByRole('dialog').getByText('No expiry',{exact:true}).waitFor();
    await page.evaluate(()=>{window.rejectDraft=true;});
    await page.getByRole('dialog').getByRole('button',{name:'Publish proposal'}).click();
    await page.getByRole('dialog').getByRole('alert').getByText(/rules changed/).waitFor();
    assert(await page.getByRole('dialog').getByRole('button',{name:'Publish proposal'}).isDisabled());
    assert.equal(await page.evaluate(()=>window.calls.find(c=>c.command==='propose_parameter').args.newValue),'18446744073709551615');
  }finally{await page.close();}
});

test('verifier and emergency rules can be proposed without rounding',async () => {
  const page=await fixture(false);
  try {
    for(const [parameter,value,display] of [
      ['min_verification_age_secs','0','0 seconds'],
      ['neither_penalty_cooldown_secs','7','7 seconds'],
      ['neither_penalty_threshold_bps','75.01','75.01 %'],
      ['neither_window_assignments','4','4'],
      ['min_verifier_brn_balance','50.000000000000000001','50.000000000000000001 BRN'],
      ['emergency_voting_duration_secs','60','60 seconds'],
      ['emergency_quorum_bps','95.01','95.01 %'],
      ['emergency_supermajority_bps','96.01','96.01 %'],
    ]) {
      await page.getByRole('button',{name:'Propose a change',exact:true}).click();
      await page.locator('#governance-parameter').selectOption(parameter);
      await page.locator('#governance-new-value').fill(value);
      await page.getByRole('button',{name:'Review proposal',exact:true}).click();
      await page.getByRole('dialog').getByText(display,{exact:true}).waitFor();
      await page.getByRole('dialog').getByRole('button',{name:'Publish proposal',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
    }
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.command==='propose_parameter'));
    assert.deepEqual(calls.map(c=>[c.args.parameter,c.args.newValue]),[
      ['min_verification_age_secs','0'],['neither_penalty_cooldown_secs','7'],
      ['neither_penalty_threshold_bps','7501'],['neither_window_assignments','4'],
      ['min_verifier_brn_balance','50000000000000000001'],['emergency_voting_duration_secs','60'],
      ['emergency_quorum_bps','9501'],['emergency_supermajority_bps','9601'],
    ]);
  }finally{await page.close();}
});
