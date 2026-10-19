import assert from 'node:assert/strict';
import {rpc} from './native-env.mjs';
import {until} from './native-certified-utils.mjs';
import {script, wait, click, fill} from './native-ui.mjs';
import {importTestIdentity} from './native-certified-consumer-ui.mjs';

export async function governanceIdentity(seed) {
  const account = await importTestIdentity(seed);
  await script(`history.pushState({}, '', '/governance');dispatchEvent(new PopStateEvent('popstate'));`);
  await wait(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Propose a change' && !b.disabled)`);
  return account;
}

export async function publishParameter(account, parameter, value) {
  const before = (await rpc('account_info', {account})).head;
  await click('Propose a change');
  assert(await script(`const select = document.getElementById('governance-parameter');
    select.value = arguments[0]; select.dispatchEvent(new Event('change', {bubbles:true}));
    return select.value === arguments[0];`, [parameter]));
  await fill('governance-new-value', value);
  await click('Review proposal');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Back to editing');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, before, 'Cancelled parameter review signed a block');
  await click('Review proposal');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Publish proposal');
  await until(async () => {
    const error = await script(`return document.querySelector('[role="dialog"] [role="alert"]')?.textContent`);
    assert(!error, `Parameter publication failed: ${error}`);
    return script(`return !document.querySelector('[role="dialog"]') && !!document.querySelector('[aria-label="Proposal"] .balance-details dd')`);
  });
  const hash = await script(`return document.querySelector('[aria-label="Proposal"] .balance-details dd').textContent.trim()`);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const proposal = await rpc('governance_proposal_info', {hash});
  assert.equal(proposal.param, parameter.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join(''));
  assert.equal(proposal.proposed_value, value);
  assert.equal(proposal.proposer, account);
  assert.equal((await rpc('block_info', {hash})).confirmed, true);
  return hash;
}

export async function readProposal(hash) {
  assert(await script(`const summary = [...document.querySelectorAll('summary')].find(s => s.textContent.trim() === 'Find a proposal by ID');
    if (!summary) return false; if (!summary.parentElement.open) summary.click(); return summary.parentElement.open;`));
  await fill('proposal-hash', hash);
  await click('Read proposal');
  await wait(`document.querySelector('[aria-label="Proposal"] .balance-details dd')?.textContent.trim() === ${JSON.stringify(hash)}`);
}

export async function waitForDelegationReview() {
  try {
    await wait(`!!document.querySelector('[role="dialog"]')`);
  } catch (error) {
    // Restrict diagnostics to public controls, never wallet recovery content.
    console.error('Delegation review state', await script(`
      const region = document.querySelector('[aria-label="Voting delegation"]');
      return {fields: ['delegation-kind','delegation-scope','delegate-address'].map(id => {
        const field = document.getElementById(id);
        return {id, value:field?.value, invalid:field?.getAttribute('aria-invalid'), validation:field?.validationMessage};
      }), alerts:[...(region?.querySelectorAll('[role="alert"]') ?? [])].map(node => node.textContent)};`));
    throw error;
  }
}

async function submitReviewed({account, before, confirm, cancel, review, outcome}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await click(confirm);
    try {
      return await until(async () => {
        const error = await script(`return document.querySelector('[role="dialog"] [role="alert"]')?.textContent`);
        assert(!error, `Reviewed submission failed: ${error}`);
        return outcome();
      });
    } catch (error) {
      // This guard rejects before signing. An ambiguous send must never retry.
      if (attempt || !error.message.includes('node synchronization is not ready')) throw error;
      assert.equal((await rpc('account_info', {account})).head, before,
        'Readiness rejection changed the account; do not retry');
      await click(cancel);
      await wait(`!document.querySelector('[role="dialog"]')`);
      await until(async () => (await rpc('params_hash')).online_signing === 'peer_matches', 180);
      await review();
      console.log('Recovered pre-sign readiness rejection through fresh review');
    }
  }
}

async function confirmDelegationReview(account, begin, expectedText) {
  const before = (await rpc('account_info', {account})).head;
  const review = async () => {
    await begin();
    await waitForDelegationReview();
    for (const text of expectedText) {
      assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [text]),
        'Delegation review omitted the intended scope, person or ballot');
    }
  };
  await review();
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, before, 'Cancelled delegation review signed a block');
  await review();
  await submitReviewed({account, before, confirm:'Confirm', cancel:'Cancel', review,
    outcome:() => script(`return !document.querySelector('[role="dialog"]')`)});
  const after = (await rpc('account_info', {account})).head;
  assert.notEqual(after, before);
  const block = await rpc('block_info', {hash:after});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.previous, before, 'Delegation review published more than one block');
  return block;
}

export async function setProposalDelegate(account, proposal, delegate) {
  await click('Your delegates');
  await wait(`!!document.getElementById('delegation-kind')`);
  assert(await script(`const select = document.getElementById('delegation-kind');
    select.value = 'proposal'; select.dispatchEvent(new Event('change', {bubbles:true}));
    return select.value === 'proposal';`));
  await fill('delegation-scope', proposal);
  if (delegate) await fill('delegate-address', delegate);
  const action = delegate ? 'Review delegation' : 'Revoke for this scope';
  await wait(`[...document.querySelectorAll('[aria-label="Voting delegation"] button')].some(b => b.textContent.trim() === ${JSON.stringify(action)} && !b.disabled)`);
  const block = await confirmDelegationReview(account, () => click(action),
    [delegate ? 'Review delegation' : 'Revoke delegation?', proposal, ...(delegate ? [delegate] : [])]);
  assert.equal(block.block_type, delegate ? 'Delegate' : 'RevokeDelegation');
}

export async function supportDelegatedProposal(account, entry, proposal) {
  await readProposal(proposal.hash);
  await click('Delegated to you');
  const scopeLabel = `Proposal ${proposal.hash.slice(0, 8)}…`;
  const ownerLabel = `${entry.owner.slice(0, 12)}…${entry.owner.slice(-6)}`;
  const locate = `const region = document.querySelector('[aria-label="Voting delegation"]');
    const label = [...(region?.querySelectorAll('p') ?? [])].find(p => p.textContent === arguments[0]
      && p.parentElement.textContent.includes(arguments[1]));
    const button = [...(label?.parentElement.parentElement.querySelectorAll('button') ?? [])]
      .find(b => b.textContent.trim() === 'Support');`;
  await until(() => script(`${locate} return !!button && !button.disabled;`, [scopeLabel, ownerLabel]));
  const begin = async () => assert(await script(`${locate}
    if (!button || button.disabled) return false; button.click(); return true;`, [scopeLabel, ownerLabel]));
  const contents = (proposal.amendment_operations ?? []).flatMap(operation => operation.AddArticle ? [operation.AddArticle.text] : []);
  const block = await confirmDelegationReview(account, begin, ['Review delegated ballot', entry.owner, 'Support', ...contents]);
  assert.equal(block.block_type, 'GovernanceVote');
  assert.equal(block.link, proposal.hash);
}

export async function publishArticle(account, draft) {
  assert.equal(draft.operations.length, 1);
  const article = draft.operations[0].AddArticle;
  assert(article);
  const before = (await rpc('account_info', {account})).head;
  const previous = await script(`return document.querySelector('[aria-label="Proposal"] .balance-details dd')?.textContent.trim()`);
  await click('New amendment');
  await fill('amendment-title', draft.title);
  await fill('amendment-article-title-0', article.title);
  await fill('amendment-text-0', article.text);
  await click('Review amendment');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [article.text]),
    'Amendment review did not preserve the complete Unicode article');
  await click('Back to editing');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, before, 'Cancelled amendment review signed a block');
  await click('Review amendment');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  const hash = await submitReviewed({account, before, confirm:'Publish amendment', cancel:'Back to editing',
    review:async () => {
      assert.equal(await script(`return document.getElementById('amendment-text-0').value`), article.text);
      await click('Review amendment');
      await wait(`!!document.querySelector('[role="dialog"]')`);
      assert(await script(`return document.querySelector('[role="dialog"]').textContent.includes(arguments[0])`, [article.text]));
    },
    outcome:() => script(`const hash = document.querySelector('[aria-label="Proposal"] .balance-details dd')?.textContent.trim();
      return !document.querySelector('[role="dialog"]') && hash && hash !== arguments[0] ? hash : false;`, [previous])});
  assert.match(hash, /^[0-9a-f]{64}$/);
  const proposal = await rpc('governance_proposal_info', {hash});
  assert.equal(proposal.proposer, account);
  assert.deepEqual(proposal.amendment_operations, draft.operations);
  const block = await rpc('block_info', {hash});
  assert.equal(block.confirmed, true);
  assert.equal(block.account, account);
  assert.equal(block.previous, before);
  return hash;
}

export async function supportSelectedProposal(account, hash) {
  await wait(`[...document.querySelectorAll('[aria-label="Proposal"] button')].some(b => b.textContent === 'Support' && !b.disabled)`);
  const head = (await rpc('account_info', {account})).head;
  await click('Support');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Cancel');
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal((await rpc('account_info', {account})).head, head, 'Cancelled governance vote signed a block');
  await click('Support');
  await wait(`!!document.querySelector('[role="dialog"]')`);
  await click('Confirm vote');
  await until(async () => {
    const error = await script(`return document.querySelector('[role="dialog"] [role="alert"]')?.textContent`);
    assert(!error, `Governance vote failed: ${error}`);
    return script(`return !document.querySelector('[role="dialog"]')`);
  });
  const after = (await rpc('account_info', {account})).head;
  assert.notEqual(after, head);
  const block = await rpc('block_info', {hash:after});
  assert.equal(block.confirmed, true);
  assert.equal(block.block_type, 'GovernanceVote');
  assert.equal(block.account, account);
  assert.equal(block.link, hash);
  return after;
}
