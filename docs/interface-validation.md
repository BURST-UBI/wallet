# Interface validation

Review the behavior being changed at the layer that owns it. A mocked browser
pass cannot establish native signing, and a native development-ledger pass cannot
qualify a packaged release on another operating system.

## Browser fixtures

Use the existing tests under [tests](../tests/) for rendering, navigation, request
states and simulated desktop commands. Check light and dark themes, narrow
layouts down to 320px, keyboard navigation, focus after dialogs, reduced motion,
and loading, empty, error and populated states.

Exercise delayed and failed responses. Preserve known values during refresh,
prevent stale responses from crossing wallet/node contexts, and keep pending
signing outcomes visible. Test cancellation before signing separately from a
submission already in flight. Do not hide real failures to make a fixture pass.

## Native flows

Use the existing native drivers in [tests](../tests/) for the desktop bridge,
key handling and signed ledger operations. Inspect each driver's prerequisites
before running it. Use disposable profiles and a permitted test network; never
reuse a personal wallet profile to satisfy a fixture.

For a payment, verify the signed block, sender state, pending receipt and recipient
claim against the node. For rejection, check the permanent burn, unchanged
recipient balance, returned provenance and sender claim. Check duplicate and
wrong-wallet attempts as well as the successful path.

For recovery and uncertain submissions, preserve the action identity and inspect
its outcome before resubmitting. Read the native recovery driver's scope; opening
a restored wallet alone does not prove that pending actions reconcile correctly.

## Device and release checks

On the supported devices, check software-keyboard overlap, safe areas, scrolling,
text selection, screen-reader navigation and native close behavior with unsaved
work. Inspect short windows as well as narrow ones. A browser unload check does
not establish the native window-close result.

Check the exact packaged artifact on its target platform. Record operating
system, inputs, scenario, result and evidence outside these design guides.
Historical screenshots illustrate a layout; they do not qualify current code.

Before costly validation, follow the protocol's
[validation workflow](../../protocol/spec/VALIDATION_WORKFLOW.md). Reuse unchanged
passing stages and preserve failed evidence. Documentation-only edits need no
application rebuild.

Embedded runs through `tests/native-session.mjs --embedded` check the packaged
origin, CSP, styles and native lock-state IPC in the existing isolated session
before fresh-profile journeys. The assertions live in `tests/native-security.mjs`;
resumed profiles retain their existing recovery checks.
