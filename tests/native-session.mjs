// Owns the disposable daemon, isolated desktop profile and WebDriver session.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, open, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cancellation.abort(new Error(signal)));
const scopedFixture = process.argv.includes('--scoped-delegation-fixture');
const constitutionFixture = process.argv.includes('--constitution-fixture');
const parameterFixture = process.argv.includes('--parameter-fixture');
const appealFixture = process.argv.includes('--appeal-fixture');
const offlinePanelFixture = process.argv.includes('--offline-panel-fixture');
const expiryReturnFixture = process.argv.includes('--expiry-return-fixture');
const expiredMergeFixture = process.argv.includes('--expired-merge-fixture');
const groupsFixture = process.argv.includes('--groups-only');
const signerOnly = process.argv.includes('--signer-only');
const paymentsOnly = process.argv.includes('--payments-only');
const devicePhase = process.argv.includes('--device-phase');
const deviceHandoff = process.argv.includes('--device-handoff-only') || devicePhase;
assert(!devicePhase || ['prepare','takeover','recover','stale','contest'].includes(process.env.NATIVE_DEVICE_PHASE), 'Choose an explicit device phase');
assert(!devicePhase || process.env.NATIVE_DEVICE_EVIDENCE, 'Device phases require retained shared evidence');
const graphFixture = process.argv.includes('--group-graph-only');
const offlineSparseRecovery = process.argv.includes('--offline-sparse-recovery-only');
const onlineRecovery = process.argv.includes('--online-payment-recovery-only');
const offlineExistingReceipt = process.argv.includes('--offline-existing-receive-only') || offlineSparseRecovery;
const offlineReceiveFixture = process.argv.includes('--offline-receive-only') || offlineExistingReceipt;
const offlineFixture = process.argv.includes('--offline-only') || offlineReceiveFixture || onlineRecovery || offlinePanelFixture;
const offlineChallengeBaseline = offlineFixture && process.env.NATIVE_OFFLINE_ACTION === 'challenge' && !!process.env.NATIVE_OFFLINE_BASELINE;
const challengeSetup = offlineFixture && process.env.NATIVE_OFFLINE_ACTION === 'challenge' ? process.env.NATIVE_CHALLENGE_SETUP : null;
const offlineInspection = process.argv.includes('--offline-inspect-only');
const offlineProposalReadback = process.argv.includes('--offline-proposal-readback-only') || offlineInspection;
assert(!offlineProposalReadback || (process.env.NATIVE_OFFLINE_BASELINE && process.argv.includes('--embedded')), 'Offline proposal readback requires retained evidence and --embedded');
assert(!onlineRecovery || !offlineReceiveFixture, 'Choose online payment or offline receipt recovery');
const forkFixture = process.argv.includes('--offline-fork-fixture');
const certifiedLifecycle = process.argv.includes('--certified-lifecycle');
const delegationReview = process.argv.includes('--certified-delegation-review');
const certifiedGovernance = process.argv.includes('--certified-governance') || delegationReview;
const numericGovernanceRecovery = certifiedGovernance && !delegationReview
  && /^[0-9a-f]{64}$/.test(process.env.NATIVE_GOVERNANCE_RESUME_NUMERIC || '');
const certifiedExclusion = process.argv.includes('--certified-exclusion');
const exclusionRestart = process.argv.includes('--certified-exclusion-restart');
assert(!exclusionRestart || (certifiedExclusion && !process.env.NATIVE_RECOVER_ACTION), 'Exclusion restart requires a fresh certified exclusion journey');
const exclusionRecovery = certifiedExclusion && process.env.NATIVE_EXCLUSION_PHASE === 'recover';
assert(!exclusionRecovery || (!exclusionRestart && !process.env.NATIVE_RECOVER_ACTION && process.env.NATIVE_RESUME_DATA_DIR && process.env.NATIVE_RESULT_PATH), 'Exclusion recovery requires retained app data and its prepared report');
const exclusionFollowthrough = process.argv.includes('--certified-exclusion-followthrough');
assert(!exclusionFollowthrough || (certifiedExclusion && !exclusionRestart && !process.env.NATIVE_RECOVER_ACTION && process.env.NATIVE_RESUME_DATA_DIR && process.env.NATIVE_EXCLUSION_BASE_REPORT), 'Exclusion followthrough requires retained app data and original evidence');
const onlineExclusion = process.argv.includes('--online-exclusion');
assert(!onlineExclusion || certifiedExclusion, '--online-exclusion requires --certified-exclusion');
const certifiedOnboarding = process.argv.includes('--certified-onboarding');
const certifiedReadiness = process.argv.includes('--certified-readiness');
const historyFixture = process.argv.includes('--history-only');
const legacyMigration = process.argv.includes('--legacy-migration-only');
const embedded = process.argv.includes('--embedded') || process.env.NATIVE_EMBEDDED === '1';
const returnRecovery = process.argv.includes('--return-recovery');
if (returnRecovery) {
  assert(process.env.NATIVE_RESUME_DATA_DIR, 'Return recovery requires the original app profile');
  assert(/^[0-9a-f]{64}$/.test(process.env.NATIVE_EXPECTED_EXCLUDED_PAYMENT || ''), 'Return recovery requires the exact retained payment');
}
const certifiedFixture = certifiedOnboarding || certifiedLifecycle || certifiedGovernance || certifiedExclusion || certifiedReadiness;
assert([certifiedOnboarding, certifiedLifecycle, certifiedGovernance, certifiedExclusion, certifiedReadiness].filter(Boolean).length <= 1, 'Choose one certified journey');
const externalFixture = scopedFixture || constitutionFixture || parameterFixture || appealFixture || offlinePanelFixture || expiryReturnFixture || expiredMergeFixture || certifiedFixture || forkFixture || returnRecovery || historyFixture || devicePhase;
assert([scopedFixture,constitutionFixture,parameterFixture,appealFixture,expiryReturnFixture,expiredMergeFixture,groupsFixture,signerOnly,deviceHandoff,graphFixture,offlineFixture,offlineProposalReadback,certifiedFixture,forkFixture,returnRecovery,historyFixture,legacyMigration].filter(Boolean).length<=1, 'Choose one desktop fixture');
if (externalFixture) {
  assert(process.env.NATIVE_FIXTURE_RPC_URL && (scopedFixture ? process.env.NATIVE_PROPOSAL : historyFixture ? process.env.NATIVE_HISTORY_REFERENCE : process.env.NATIVE_RESULT_PATH),
    'Desktop tests must be started by the disposable Rust node fixture');
  const endpoint = new URL(process.env.NATIVE_FIXTURE_RPC_URL);
  assert.equal(endpoint.hostname, '127.0.0.1');
  assert.equal(endpoint.protocol, 'http:');
}
const deadline = externalFixture || groupsFixture || signerOnly || deviceHandoff || graphFixture || offlineFixture || offlineProposalReadback || legacyMigration
  ? setTimeout(() => cancellation.abort(new Error('Native wallet test timed out')), certifiedFixture ? 600000 : 180000)
  : null;
const evidence = await mkdtemp(join(tmpdir(), 'burst-native-wallet-'));
assert(!process.env.NATIVE_RESUME_DATA_DIR || certifiedLifecycle || certifiedOnboarding || numericGovernanceRecovery || returnRecovery || exclusionFollowthrough || exclusionRecovery || (devicePhase && ['recover','stale'].includes(process.env.NATIVE_DEVICE_PHASE)), 'Existing app data requires an explicit recovery journey');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BURST_'))),
  XDG_CONFIG_HOME: join(evidence, 'config'),
  XDG_DATA_HOME: process.env.NATIVE_RESUME_DATA_DIR || join(evidence, 'data'),
  XDG_CACHE_HOME: join(evidence, 'cache'),
  GDK_BACKEND: 'x11',
  NATIVE_EVIDENCE: evidence,
  NATIVE_OFFLINE_RECEIVE: offlineReceiveFixture ? '1' : '0',
  NATIVE_OFFLINE_EXISTING_RECEIPT: offlineExistingReceipt ? '1' : '0',
  NATIVE_OFFLINE_SPARSE_RECOVERY: offlineSparseRecovery ? '1' : '0',
  NATIVE_ONLINE_PAYMENT_RECOVERY: onlineRecovery ? '1' : '0',
  NATIVE_ONLINE_EXCLUSION: onlineExclusion ? '1' : '0',
  NATIVE_PARAMETER: parameterFixture ? '1' : '0',
  NATIVE_CERTIFIED_ONBOARDING: certifiedFixture ? '1' : '0',
  NATIVE_HISTORY_ONLY: historyFixture ? '1' : '0',
  NATIVE_RETURN_RECOVERY: returnRecovery ? '1' : '0',
  NATIVE_EXPIRED_MERGE: expiredMergeFixture ? '1' : '0',
};
delete env.WAYLAND_DISPLAY;
for (const path of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME]) {
  if (path === process.env.NATIVE_RESUME_DATA_DIR) {
    assert((await stat(path)).isDirectory(), 'Resumed app data must already exist');
  } else {
    await mkdir(path, { mode: 0o700 });
  }
}
if (legacyMigration) {
  const { seedLegacyProfile } = await import('./native-legacy-migration.mjs');
  await seedLegacyProfile(env.XDG_DATA_HOME, evidence);
}
async function port() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const number = server.address().port;
  await new Promise(resolveClosed => server.close(resolveClosed));
  return number;
}
const rpcPort = await port();
const driverPort = await port();
const nativePort = await port();
const challengePeer = offlineFixture && process.env.NATIVE_OFFLINE_ACTION === 'challenge' && !offlineChallengeBaseline;
const challengeP2pPort = challengePeer ? await port() : 0;
assert.equal(new Set([rpcPort, driverPort, nativePort]).size, 3, 'port allocation collided; rerun');
const rpcUrl = externalFixture ? process.env.NATIVE_FIXTURE_RPC_URL : `http://127.0.0.1:${rpcPort}`;
const server = `http://127.0.0.1:${driverPort}`;
const children = [];
const logs = [];
let session;
let frontendServer;

async function stopOwned(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolveExit => child.once('exit', resolveExit));
  process.kill(-child.pid, 'SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
  }, 5000);
  await exited;
  clearTimeout(timer);
}

async function launch(binary, args, logName, childEnv = env) {
  const log = await open(join(evidence, logName), 'w', 0o600);
  logs.push(log);
  const child = spawn(binary, args, { env: childEnv, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.once('error', error => { child.launchError = error; });
  children.push(child);
  return child;
}
async function untilReady(child, check) {
  for (let attempt = 0; attempt < 150; attempt++) {
    cancellation.signal.throwIfAborted();
    if (child.launchError) throw child.launchError;
    assert(child.exitCode === null, `Process exited; see ${evidence}`);
    if (await check()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  assert.fail(`Readiness timed out; see ${evidence}`);
}
async function driverCall(path, body) {
  const response = await fetch(`${server}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(45000)]),
  });
  const reply = await response.json();
  assert(response.ok && !reply.value?.error, JSON.stringify(reply));
  return reply.value;
}

async function serveFrontend() {
  const config = JSON.parse(await readFile(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const frontendUrl = new URL(config.build.devUrl);
  assert(['localhost', '127.0.0.1'].includes(frontendUrl.hostname));
  assert.equal(frontendUrl.protocol, 'http:');
  const reservation = createServer();
  await new Promise((ready, reject) => {
    reservation.once('error', reject);
    reservation.listen(Number(frontendUrl.port), '127.0.0.1', ready);
  });
  await new Promise(closed => reservation.close(closed));
  const frontend = await launch(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'), 'build', root,
  ], 'frontend.log');
  const built = await new Promise((done, reject) => {
    frontend.once('error', reject);
    frontend.once('exit', done);
  });
  assert.equal(built, 0, `Frontend build failed; see ${evidence}`);
  const dist = resolve(root, 'dist');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  frontendServer = createHttpServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, frontendUrl).pathname);
      let file = resolve(dist, `.${pathname}`);
      if (file !== dist && !file.startsWith(`${dist}${sep}`)) {
        response.writeHead(403).end(); return;
      }
      if (!extname(pathname)) file = join(dist, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      response.end(body);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
    }
  });
  await new Promise((ready, reject) => {
    frontendServer.once('error', reject);
    frontendServer.listen(Number(frontendUrl.port), '127.0.0.1', ready);
  });
}

try {
  if (!embedded) await serveFrontend();
  if (!externalFixture) {
  if (offlineProposalReadback || offlineChallengeBaseline) await cp(join(process.env.NATIVE_OFFLINE_BASELINE,'ledger'),join(evidence,'ledger'),{recursive:true,errorOnExist:true,force:false});
  if (challengeSetup) for (const name of ['ledger','peer-ledger']) await cp(join(challengeSetup,name),join(evidence,name),{recursive:true,errorOnExist:true,force:false});
  await writeFile(join(evidence, 'public-dev.key'), '00'.repeat(32), { mode: 0o600 });
  const daemon = await launch(process.env.BURST_DAEMON || resolve(root, '../protocol/target/release/burst-daemon'), [
    '--network', 'dev', '--data-dir', join(evidence, 'ledger'), '--port', String(challengeP2pPort),
    '--rpc-bind', '127.0.0.1', '--rpc-port', String(rpcPort), '--disable-upnp',
    '--representative-key-file', join(evidence, 'public-dev.key'), 'node', 'run',
  ], 'daemon.log');
  await untilReady(daemon, async () => {
    let response;
    try {
      response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'node_info' }), signal: AbortSignal.timeout(1000) });
    } catch { return false; }
    const info = (await response.json()).result;
    if (!info) return false;
    assert.equal(info.network, 'dev');
    if (!offlineProposalReadback && !offlineChallengeBaseline && !challengeSetup) assert.equal(info.verified_count, 1, 'expected a fresh disposable ledger');
    return true;
  });
  if (challengePeer) {
    await writeFile(join(evidence,'public-challenge-peer.key'),'51'.repeat(32),{mode:0o600});
    const peerRpcPort=await port();
    const peer=await launch(process.env.BURST_DAEMON || resolve(root,'../protocol/target/release/burst-daemon'),[
      '--network','dev','--data-dir',join(evidence,'peer-ledger'),'--port','0',
      '--rpc-bind','127.0.0.1','--rpc-port',String(peerRpcPort),'--disable-upnp',
      '--bootstrap-peers',`127.0.0.1:${challengeP2pPort}`,
      '--representative-key-file',join(evidence,'public-challenge-peer.key'),'node','run',
    ],'challenge-peer.log');
    await untilReady(peer,async()=>{
      try {
        const response=await fetch(`http://127.0.0.1:${peerRpcPort}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'node_info'}),signal:AbortSignal.timeout(1000)});
        const info=(await response.json()).result;
        return info?.network==='dev' && info.peer_count>0;
      } catch { return false; }
    });
  }
  }
  if (offlineProposalReadback) {
    const baseline = process.env.NATIVE_OFFLINE_BASELINE;
    const manifest = JSON.parse(await readFile(join(baseline,'offline-payment.json'),'utf8'));
    if (!offlineInspection) assert.equal(manifest.proposalAction,true);
    const query = async (action,args={}) => {
      const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...args}),signal:AbortSignal.timeout(10000)});
      assert(response.ok);const body=await response.json();assert(!body.error,JSON.stringify(body));return body.result??body;
    };
    if (offlineInspection) {
      const status={};
      for (const [label,action,args] of [
        ['action','block_info',{hash:manifest.pending.hash}],
        ['owner','account_info',{account:manifest.account}],
        ['target','verification_status',{account:manifest.receiver}],
        ['slot','confirmed_account_slot',{account:manifest.account,previous:manifest.before.head}],
      ]) {
        try {status[label]=await query(action,args);} catch(error) {status[label]={error:error.message};}
      }
      await writeFile(join(evidence,'offline-inspection.json'),JSON.stringify(status,null,2));
      console.log('Retained offline action inspection (no submission): '+JSON.stringify(status));
    } else {
    const block=await query('block_info',{hash:manifest.pending.hash});
    assert.equal(block.confirmed,true);assert.equal(block.block_type,'GovernanceProposal');
    assert.equal(block.previous,manifest.before.head);
    const proposal=await query('governance_proposal_info',{hash:manifest.pending.hash});
    assert.equal(proposal.hash,manifest.pending.hash);
    assert.equal(proposal.param,'BrnRate');assert.equal(proposal.proposed_value,'2000000000000000001');
    const account=await query('account_info',{account:manifest.account});
    assert.equal(BigInt(account.block_count),BigInt(manifest.before.block_count)+1n);
    const journal=join(baseline,'data','com.burst.wallet','offline-payments');
    assert.equal(await readFile(join(journal,'completed',manifest.account,`confirmed-by-${manifest.pending.hash}-${manifest.pending.hash}.json`),'utf8'),manifest.journal);
    await assert.rejects(readFile(join(journal,`${manifest.account}.json`)),{code:'ENOENT'});
    await assert.rejects(readFile(join(journal,`attempted-${manifest.pending.hash}.marker`)),{code:'ENOENT'});
    console.log('PASS retained offline proposal: original hash and exact content confirmed, one ledger action, byte-exact archived journal and no pending action or attempt marker');
    }
  } else {
  const application = process.env.WALLET_BINARY || resolve(root, 'src-tauri/target/debug/burst-wallet-gui');
  let driverEnv = env;
  if (appealFixture || offlinePanelFixture || expiryReturnFixture || expiredMergeFixture) {
    const fixtureTime = appealFixture || offlinePanelFixture ? process.env.NATIVE_APPEAL_TIME : process.env.NATIVE_RETURN_TIME;
    assert.equal(process.platform, 'linux');
    assert(process.env.NATIVE_FAKETIME_LIBRARY?.startsWith('/'));
    assert(/^\d+$/.test(fixtureTime || ''));
    // Keep WebDriver, the harness, monotonic timers and filesystem dates real.
    driverEnv = { ...env, LD_PRELOAD: process.env.NATIVE_FAKETIME_LIBRARY,
      FAKETIME: fixtureTime, FAKETIME_FMT: '%s',
      FAKETIME_ONLY_CMDS: basename(application), FAKETIME_DONT_FAKE_MONOTONIC: '1', NO_FAKE_STAT: '1' };
  }
  const driverArgs = ['-a', '-s', '-screen 0 1440x1000x24',
    process.env.TAURI_DRIVER || 'tauri-driver', '--port', String(driverPort),
    '--native-port', String(nativePort), '--native-driver', '/usr/bin/WebKitWebDriver'];
  let activeEnv = env;
  let driver = await launch('xvfb-run', driverArgs, 'webdriver.log', driverEnv);
  await untilReady(driver, async () => {
    try { return (await fetch(`${server}/status`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  });
  const created = await driverCall('/session', { capabilities: { alwaysMatch: {
    'tauri:options': { application },
  } } });
  session = created.sessionId;
  assert(session);
  await driverCall(`/session/${session}/timeouts`, { script: 120000, pageLoad: 30000 });
  const rendered = async () => (await driverCall(`/session/${session}/execute/sync`, {
    script: 'return !!window.__TAURI_INTERNALS__?.invoke && !!document.querySelector("button")', args: [],
  })) === true;
  await untilReady(driver, rendered);
  if (embedded) {
    const url = await driverCall(`/session/${session}/execute/sync`, {
      script: 'return location.href', args: [],
    });
    assert.match(url, /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost)/,
      'Embedded acceptance must not use a development server');
  }
  // Configure the node while locked, before UI automation could sign anything.
  await driverCall(`/session/${session}/execute/sync`, {
    script: 'localStorage.setItem("burst-wallet", JSON.stringify({state:{rpcUrl:arguments[0]},version:0}));return true;',
    args: [rpcUrl],
  });
  await driverCall(`/session/${session}/refresh`, {});
  await untilReady(driver, rendered);
  const tests = delegationReview ? ['native-delegation-review.mjs'] : certifiedReadiness ? ['native-certified-readiness.mjs'] : historyFixture ? ['native-history.mjs'] : certifiedGovernance ? ['native-certified-governance.mjs'] : certifiedLifecycle ? ['native-certified-lifecycle.mjs'] : certifiedFixture ? ['native-certified-onboarding.mjs'] : expiryReturnFixture ? ['native-expiry-return.mjs'] : appealFixture ? ['native-appeal.mjs'] : graphFixture ? ['native-group-graph.mjs'] : groupsFixture ? ['native-groups.mjs'] : scopedFixture ? ['native-scoped-delegation.mjs'] : constitutionFixture || parameterFixture ? ['native-constitution.mjs'] : paymentsOnly || expiredMergeFixture ? ['native-payments.mjs'] : ['native-wallet.mjs', 'native-onboarding.mjs', 'native-signer.mjs', 'native-payments.mjs', 'native-ui-payment.mjs', 'native-return.mjs', 'native-automation.mjs', 'native-groups.mjs'];
  for (const [index, test] of (deviceHandoff ? Array(devicePhase ? 1 : 4).fill('native-device-handoff.mjs') : exclusionRestart ? ['native-certified-exclusion.mjs', 'native-certified-exclusion.mjs'] : signerOnly ? ['native-signer.mjs'] : legacyMigration ? ['native-legacy-migration.mjs', 'native-legacy-migration.mjs'] : returnRecovery ? ['native-return.mjs', 'native-automation.mjs', 'native-groups.mjs'] : forkFixture ? ['native-offline-fork.mjs', 'native-offline-fork.mjs'] : certifiedExclusion ? [process.env.NATIVE_RECOVER_ACTION ? 'native-certified-action-recovery.mjs' : 'native-certified-exclusion.mjs'] : onlineRecovery ? ['native-offline.mjs', 'native-offline.mjs'] : offlineFixture ? ['native-offline.mjs', 'native-offline.mjs', 'native-offline.mjs'] : tests).entries()) {
    if ((deviceHandoff || offlineFixture || forkFixture || legacyMigration || exclusionRestart) && index > 0) {
      const closed = await fetch(`${server}/session/${session}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
      assert(closed.ok, 'Could not close the first native app session');
      session = null;
      if (deviceHandoff && (index === 1 || index === 3)) {
        await stopOwned(driver);
        activeEnv = index === 3 ? env : {...env,
          XDG_DATA_HOME:join(evidence,'device-b-data'), XDG_CONFIG_HOME:join(evidence,'device-b-config'),
          XDG_CACHE_HOME:join(evidence,'device-b-cache')};
        if (index === 1) for (const path of [activeEnv.XDG_DATA_HOME,activeEnv.XDG_CONFIG_HOME,activeEnv.XDG_CACHE_HOME]) await mkdir(path,{mode:0o700});
        driver = await launch('xvfb-run', driverArgs, `webdriver-device-${index}.log`, activeEnv);
        await untilReady(driver, async () => {
          try { return (await fetch(`${server}/status`, {signal:AbortSignal.timeout(1000)})).ok; }
          catch { return false; }
        });
      }
      if (forkFixture) {
        await untilReady(driver, async () => {
          try { return !!JSON.parse(await readFile(`${process.env.NATIVE_RESULT_PATH}.ready`, 'utf8')).winner; }
          catch (error) { if (error.code === 'ENOENT') return false; throw error; }
        });
      }
      const restarted = await driverCall('/session', { capabilities: { alwaysMatch: {
        'tauri:options': { application },
      } } });
      session = restarted.sessionId;
      assert(session);
      await driverCall(`/session/${session}/timeouts`, { script: 120000, pageLoad: 30000 });
      await untilReady(driver, rendered);
    }
    const stepPath = join(evidence, `${index}-${test}.log`);
    const stepLog = await open(stepPath, 'wx', 0o600);
    console.log(`Running ${test}; durable output: ${stepPath}`);
    try {
      const child = spawn(process.execPath, [fileURLToPath(new URL(test, import.meta.url))], {
        cwd: root, env: { ...activeEnv, NODE_RPC_URL: rpcUrl, WEBDRIVER_URL: server, WEBDRIVER_SESSION: session,
          ...(deviceHandoff ? {NATIVE_DEVICE_PHASE:devicePhase ? process.env.NATIVE_DEVICE_PHASE : ['prepare','takeover','recover','stale'][index]} : {}),
          ...(exclusionRestart ? { NATIVE_EXCLUSION_PHASE: ['prepare', 'recover'][index] } : {}),
          ...(exclusionFollowthrough ? { NATIVE_EXCLUSION_PHASE: 'followthrough' } : {}),
          ...(offlineFixture ? { NATIVE_OFFLINE_PHASE: (onlineRecovery ? ['prepare', 'reconcile'] : ['prepare', 'recover', 'reconcile'])[index] } : {}),
          ...(forkFixture ? { NATIVE_OFFLINE_PHASE: ['prepare', 'reconcile'][index] } : {}) },
        stdio: ['ignore', stepLog.fd, stepLog.fd],
        signal: cancellation.signal,
      });
      const code = await new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', resolveExit);
      });
      assert.equal(code, 0, `${test} failed; see ${evidence}`);
    } finally {
      await stepLog.close();
      process.stdout.write(await readFile(stepPath, 'utf8'));
    }
  }
  }
} finally {
  if (deadline) clearTimeout(deadline);
  if (session) await fetch(`${server}/session/${session}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
    .catch(error => console.error('Session cleanup:', error.message));
  for (const child of children.reverse()) {
    await stopOwned(child);
  }
  for (const log of logs) await log.close();
  if (frontendServer?.listening) {
    frontendServer.closeAllConnections();
    await new Promise(closed => frontendServer.close(closed));
  }
  console.log(`Native wallet evidence and disposable app data: ${evidence}`);
}
