// Mocked IPC tests enter through onboarding, so they use the app's own store
// instance instead of importing a possibly different Vite/HMR module instance.
exports.openGovernance = async function openGovernance(page) {
  await page.addInitScript(() => {
    localStorage.setItem('burst-wallet',JSON.stringify({state:{autoAccept:false},version:0}));
  });
  await page.goto('http://127.0.0.1:1430/onboarding');
  await page.getByText('More ways to restore',{exact:true}).click();
  await page.getByRole('button',{name:'Import Private Key',exact:true}).click();
  await page.locator('#wallet-private-key').fill('00'.repeat(32));
  await page.getByRole('button',{name:'Import',exact:true}).click();
  await page.getByRole('button',{name:'Continue without file',exact:true}).click();
  await page.getByRole('button',{name:'Go to Dashboard',exact:true}).waitFor();
  await page.evaluate(() => {
    window.storeUrl=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/src/stores/wallet-store.ts'))?.name ?? '/src/stores/wallet-store.ts';
    history.pushState({},'','/governance');dispatchEvent(new PopStateEvent('popstate'));
  });
};
