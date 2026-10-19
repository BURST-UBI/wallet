// Disposable fixture enrollment, also injected into WebKit; keep closure-free.
export async function enrollSigningDeviceWith(invoke, rpcUrl, address, readReadiness) {
  const args = {rpcUrl, expectedAccount:address};
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    let review;
    try {
      // WebKit's CSP deliberately forbids direct node fetches. The Node-side
      // driver may provide its existing RPC reader; injected callers use IPC.
      if (readReadiness && !['local','peer_matches'].includes((await readReadiness()).online_signing)) {
        await new Promise(resolve => setTimeout(resolve, 300));
        continue;
      }
      review = await invoke('signing_device_status', args);
      if (review.active_here) return;
      await invoke('take_over_signing', {...args,
        reviewedHead:review.head, reviewedGrant:review.grant, reviewedParams:review.params_hash});
      if (!(await invoke('signing_device_status', args)).active_here) {
        throw new Error('Explicit signing-device enrollment did not become active');
      }
      return;
    } catch (error) {
      if (!String(error).includes('node synchronization is not ready')) throw error;
      if (await invoke('get_offline_payment', {expectedAccount:address})) throw error;
      // A confirmed first Open can precede a failed handoff. Never repeat that
      // sequence or an uncertain signature just because readiness changed.
      if (review) {
        const after = await invoke('signing_device_status', args);
        if (after.head !== review.head || after.grant !== review.grant
            || after.params_hash !== review.params_hash || after.active_here) throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Fixture signing readiness timed out before enrollment completed');
}
