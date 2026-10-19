// Browser/IPC contracts; real native and node acceptance are separate evidence.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {openGovernance}=require('./browser-wallet.cjs');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});});
after(async()=>{await browser?.close();});
async function fixture(options={}) {
  const page=await browser.newPage({viewport:{width:options.width||1000,height:850},reducedMotion:'reduce'});
  await page.addInitScript(options=>{
    window.isTauri=true; window.calls=[];
    const account='brst_'+'1'.repeat(60), provider='brst_'+'3'.repeat(60), hash='a'.repeat(64);
    window.pending=options.pending ? {hash,can_discard:!options.attempted,kind:options.kind||'Burn',can_review_payment:!options.kind}:null;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      window.calls.push({command,args});
      switch(command) {
        case 'import_private_key':return {address:account,verification_state:'verified'};
        case 'get_node_info':return {network:'dev',block_count:1,faucet_enabled:false};
        case 'get_account_info':return {address:account,verification_state:'verified',brn_balance:'0',block_count:1};
        case 'get_governance_proposals':return {proposals:options.action ? [{hash,phase:'Exploration',param:'BrnRate',proposed_value:'1000000000000000001'}] : []};
        case 'get_governance_proposal_info':return {hash,phase:'Exploration',phase_projected:false,phase_deadline:Math.floor(Date.now()/1000)+300,param:'BrnRate',proposed_value:'1000000000000000001',votes_yea:0,votes_nay:0,votes_abstain:0};
        case 'get_constitution_context':return {enabled:false,document:{version:'0',articles:[]},revision:'fixture',endorsement_cost:'1'};
        case 'get_scoped_delegations':return {enabled:false,network:'Dev',genesis:hash,parameters:[],entries:[],cursor:null};
        case 'begin_automation':return '1';
        case 'cancel_automation':return null;
        case 'get_pending':return {blocks:[]};
        case 'get_brn_components':return {verified_at:0,total_burned:'0',total_staked:'0',accrual_active:false,accrual_stopped_at:1,as_of:1,rate_history:[{rate:'0',start:0,end:null}]};
        case 'get_trst_balance':return {active:'0',expired:'0',revoked:'0'};
        case 'offline_signing_available':return !options.readOnly;
        case 'get_offline_payment':return window.pending;
        case 'prepare_offline_payment':return 'opaque context with exact raw integers';
        case 'prepare_offline_review':return {context:'opaque action 1000000000000000001',review:{title:'Governance vote',fields:[['Vote','Support'],['Proposed value','1000000000000000001']]}};
        case 'sign_offline_action':await new Promise(r=>setTimeout(r,80));window.pending={hash,can_discard:true,kind:'GovernanceVote',can_review_payment:false};return hash;
        case 'review_saved_offline_action':return {title:'Governance vote',fields:[['Vote','Support'],['Proposal',hash]]};
        case 'submit_offline_action':window.pending.can_discard=false;if(options.lost)throw Error('confirmation pending for '+hash);window.pending=null;return {accepted:true,hash};
        case 'prepare_offline_receive':return {context:'opaque receipt context',review:{kind:'receive',hash:'',provider,amount:'1000000000000000001',payment:'b'.repeat(64)}};
        case 'sign_offline_receive':await new Promise(r=>setTimeout(r,80));window.pending={hash,can_discard:true,kind:'Receive',can_review_payment:true};return hash;
        case 'sign_offline_payment':await new Promise(r=>setTimeout(r,80));window.pending={hash,can_discard:true,kind:'Burn',can_review_payment:true};return hash;
        case 'review_offline_payment':return {kind:options.incoming?'receive':'burn',payment:options.incoming?'b'.repeat(64):null,hash,provider,amount:'1000000000000000001'};
        case 'submit_offline_payment':window.pending.can_discard=false;if(options.lost)throw Error('confirmation pending for '+hash);window.pending=null;return {accepted:true,hash};
        case 'resolve_offline_payment':if(options.unresolved)throw Error('Payment remains unresolved');window.pending=null;return {status:options.resolution||'superseded'};
        case 'discard_offline_payment':window.pending=null;return null;
        default:throw Error('Unexpected IPC '+command);
      }
    }};
  },options);
  await openGovernance(page);
  if (options.action) return page;
  await page.evaluate(incoming=>{history.pushState({},'','/pay/offline'+(incoming?'?receive='+'b'.repeat(64):''));dispatchEvent(new PopStateEvent('popstate'));},options.incoming);
  await page.getByRole('heading',{name:options.kind?'Recover transaction':options.incoming?'Receive offline':'Pay offline',exact:true}).waitFor();
  return page;
}
test('offline governance review prepares once, signs without preparation RPC and preserves exact context',async()=>{
  const page=await fixture({action:true,width:390});
  try {
    await page.getByRole('button',{name:/Read proposal:/}).click();
    await page.getByRole('button',{name:'Support',exact:true}).click();
    await page.getByRole('button',{name:'Sign offline',exact:true}).click();
    const dialog=page.getByRole('dialog').last();
    await dialog.getByRole('button',{name:'Prepare action',exact:true}).click();
    await dialog.getByText('1000000000000000001',{exact:true}).waitFor();
    const before=await page.evaluate(()=>window.calls.length);
    await dialog.getByRole('button',{name:'Sign and save',exact:true}).dblclick();
    await dialog.getByRole('button',{name:'Submit saved action',exact:true}).waitFor();
    const calls=await page.evaluate(start=>window.calls.slice(start),before);
    assert.equal(calls.filter(c=>c.command==='sign_offline_action').length,1);
    assert.equal(calls.find(c=>c.command==='sign_offline_action').args.context,'opaque action 1000000000000000001');
    assert.equal(calls.filter(c=>['prepare_offline_review','submit_offline_action','vote_proposal'].includes(c.command)).length,0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'/tmp/burst-offline-action-review.png'});
    await dialog.getByRole('button',{name:'Submit saved action',exact:true}).click();
    await dialog.getByText('The network confirmed this action.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='submit_offline_action').length),1);
  } finally {await page.close();}
});
test('saved governance action reviews and submits its original hash without signing again',async()=>{
  const page=await fixture({pending:true,kind:'GovernanceVote',lost:true});
  try {
    await page.getByRole('button',{name:'Review saved action',exact:true}).click();
    await page.getByRole('dialog').getByText('Support',{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Submit saved action',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    const calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.find(c=>c.command==='submit_offline_action').args.expectedHash,'a'.repeat(64));
    assert.equal(calls.filter(c=>/^(sign_|submit_offline_payment|prepare_offline_)/.test(c.command)).length,0);
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Discard unsent transaction',exact:true}).count(),0);
  } finally {await page.close();}
});
test('offline receipt preserves its exact context and distinguishes receiving from burning',async()=>{
  const page=await fixture({incoming:true,width:390});
  try {
    await page.getByRole('button',{name:'Prepare offline receipt',exact:true}).click();
    await page.getByText('1.000000000000000001 TRST',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Amount (BRN)').count(),0);
    await page.getByRole('button',{name:'Review offline receipt',exact:true}).click();
    await page.getByRole('dialog').getByText('b'.repeat(64),{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='sign_offline_receive').length),0);
    await page.getByRole('button',{name:'Review offline receipt',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign and save',exact:true}).dblclick();
    await page.getByText('Signed payment, not submitted',{exact:true}).waitFor();
    const calls=await page.evaluate(()=>window.calls);
    assert.equal(calls.filter(c=>c.command==='sign_offline_receive').length,1);
    assert.equal(calls.find(c=>c.command==='sign_offline_receive').args.context,'opaque receipt context');
    assert.equal(calls.find(c=>c.command==='prepare_offline_receive').args.payment,'b'.repeat(64));
    assert.equal(calls.filter(c=>['sign_offline_payment','submit_offline_payment'].includes(c.command)).length,0);
    await page.getByRole('button',{name:'Review and submit',exact:true}).click();
    await page.getByRole('dialog').getByText('Accept this incoming TRST. Its origin and age stay unchanged.',{exact:true}).waitFor();
    await page.getByRole('dialog').getByText('1.000000000000000001 TRST',{exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'/tmp/burst-offline-receipt-mobile.png'});
    await page.setViewportSize({width:320,height:850});
    await page.evaluate(()=>document.body.classList.add('dark'));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Submit payment',exact:true}).evaluate(element=>element===document.activeElement),true);
    await page.screenshot({path:'/tmp/burst-offline-receipt-320-dark.png'});
  } finally {await page.close();}
});
test('offline review cancels without signing and preserves exact amount on one save',async()=>{
  const page=await fixture();
  try {
    await page.getByRole('button',{name:'Prepare offline payment',exact:true}).click();
    await page.getByLabel('Provider address').fill('brst_'+'3'.repeat(60));
    await page.getByLabel('Amount (BRN)').fill('1.000000000000000001');
    await page.getByLabel('Amount (BRN)').press('Enter');
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='sign_offline_payment').length),0);
    await page.getByRole('button',{name:'Review offline payment'}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Sign and save',exact:true}).dblclick();
    await page.getByText('Signed payment, not submitted',{exact:true}).waitFor();
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.command==='sign_offline_payment'));
    assert.equal(calls.length,1);assert.equal(calls[0].args.amount,'1000000000000000001');
    assert.equal(calls[0].args.context,'opaque context with exact raw integers');
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.command==='submit_offline_payment').length),0);
  } finally {await page.close();}
});
test('epoch exclusion is not displayed as confirmation and never signs a replacement',async()=>{
  const page=await fixture({pending:true,attempted:true,resolution:'excluded'});
  try {
    await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
    await page.getByText('The network advanced before this payment was applied. You can prepare a new payment.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Payment confirmed.',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>['sign_offline_payment','submit_offline_payment'].includes(c.command)).length),0);
    assert.equal(await page.getByRole('button',{name:'Prepare offline payment',exact:true}).isEnabled(),true);
  } finally {await page.close();}
});
for (const [resolution,message] of [
  ['excluded','This transaction was not applied. Return to its original screen to review a new action.'],
  ['confirmed','Transaction confirmed.'],
  ['superseded','A different transaction was confirmed in its place. Review your current state before starting again.'],
]) test(`Receive reconciles a ${resolution} receipt without resubmission`,async()=>{
  const page=await fixture({pending:true,attempted:true,kind:'Receive',resolution});
  try {
    await page.evaluate(()=>{
      window.pending.can_review_payment=true;
      history.pushState({},'','/receive');dispatchEvent(new PopStateEvent('popstate'));
    });
    const recovery=page.getByRole('link',{name:'Check saved transaction',exact:true});
    await recovery.waitFor();
    await recovery.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading',{name:'Recover transaction',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Review and submit',exact:true}).count(),0);
    await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
    await page.getByText(message,{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Prepare offline payment',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>/^(sign_|submit_|receive_pending|discard_)/.test(c.command)).length),0);
    await page.getByRole('link',{name:'Return to receiving',exact:true}).click();
    await page.getByRole('heading',{name:'Pending payments',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Check saved transaction',exact:true}).count(),0);
  } finally {await page.close();}
});
test('Receive preserves an unresolved receipt and allows checking again',async()=>{
  const page=await fixture({pending:true,attempted:true,kind:'Receive',unresolved:true});
  try {
    await page.evaluate(()=>{history.pushState({},'','/receive');dispatchEvent(new PopStateEvent('popstate'));});
    await page.getByRole('link',{name:'Check saved transaction',exact:true}).click();
    await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
    await page.getByRole('alert').getByText('Error: Payment remains unresolved',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.pending.hash),'a'.repeat(64));
    assert.equal(await page.getByRole('button',{name:'Check confirmation',exact:true}).isEnabled(),true);
    assert.equal(await page.getByRole('button',{name:'Review and submit',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>/^(sign_|submit_|receive_pending|discard_)/.test(c.command)).length),0);
    await page.getByRole('link',{name:'Back to receiving',exact:true}).click();
    await page.getByRole('link',{name:'Check saved transaction',exact:true}).waitFor();
  } finally {await page.close();}
});
test('recovered draft reviews exact amount, binds its hash, and keeps lost submissions',async()=>{
  const page=await fixture({pending:true,lost:true});
  try {
    await page.getByRole('button',{name:'Review and submit',exact:true}).click();
    await page.getByRole('dialog').getByText('1.000000000000000001 BRN',{exact:true}).waitFor();
    await page.screenshot({path:'/tmp/burst-offline-payment-review.png'});
    await page.getByRole('dialog').getByRole('button',{name:'Submit payment',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    const call=await page.evaluate(()=>window.calls.find(c=>c.command==='submit_offline_payment'));
    assert.equal(call.args.expectedHash,'a'.repeat(64));
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Discard unsent payment',exact:true}).count(),0);
    await page.getByText('Payment awaiting reconciliation',{exact:true}).waitFor();
  } finally {await page.close();}
});
test('read-only recovery remains visible with no writable actions on mobile',async()=>{
  const page=await fixture({pending:true,attempted:true,readOnly:true,width:390});
  try {
    await page.getByText('Payment awaiting reconciliation',{exact:true}).waitFor();
    assert(await page.getByRole('button',{name:'Review and submit',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'Check confirmation',exact:true}).isDisabled());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'/tmp/burst-offline-payment-mobile.png'});
  } finally {await page.close();}
});

test('governance recovery identifies the action and cannot use payment resubmission',async()=>{
  const page=await fixture({pending:true,attempted:true,kind:'GovernanceProposal',unresolved:true,width:320});
  try {
    await page.getByText('Proposal awaiting confirmation',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Back to wallet',exact:true}).getAttribute('href'),'/');
    assert.equal(await page.getByRole('link',{name:'Back to payments',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Review and submit',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:/Discard/}).count(),0);
    await page.getByRole('button',{name:'Check confirmation',exact:true}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('alert').getByText('Error: Payment remains unresolved',{exact:true}).waitFor();
    await page.getByText('Proposal awaiting confirmation',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>/^(sign_|submit_|discard_)/.test(c.command)).length),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:'/tmp/burst-action-recovery-light.png'});
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    await page.screenshot({path:'/tmp/burst-action-recovery-dark.png'});
  } finally {await page.close();}
});

test('excluded governance action returns to the wallet without offering a new payment',async()=>{
  const page=await fixture({pending:true,attempted:true,kind:'GovernanceVote',resolution:'excluded'});
  try {
    await page.getByText('Governance vote awaiting confirmation',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Check confirmation',exact:true}).click();
    await page.getByText('This transaction was not applied. Return to its original screen to review a new action.',{exact:true}).waitFor();
    await page.getByRole('link',{name:'Return to wallet',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Prepare offline payment',exact:true}).count(),0);
    assert.equal(await page.getByText('Transaction confirmed.',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>/^(sign_|submit_)/.test(c.command)).length),0);
  } finally {await page.close();}
});
