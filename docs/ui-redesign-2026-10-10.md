# UI redesign verification — 2026-10-10

## Icon follow-up

The whitepaper-derived SVG family now supersedes the first-pass monogram, Flame and Layers symbols described below. Both apps use distinct wallet/node headers, favicons and native icon assets. See the [source and regeneration notes](design/icons.md) and [original-to-new preview](design/previews/whitepaper-icon-family.png). This is an icon-only refinement, with no protocol or transaction changes.

## 1. Verdict

Ship for local UI testing. This is a verified interface iteration, not a mainnet readiness or end-to-end ledger certification. Economic, consensus and ledger rules, Azure infrastructure and real wallet transactions were not changed. This follow-up adds read-only governance RPC data/native adapters and hardens wallet-client submission reporting; those changes are described below.

The implementation follows the Emil foundations/forms/typography/surfaces/accessibility/performance/production-check guidance, Clay's restrained spacing and type principles, and the authenticated Interface Craft articles [Less but better](https://www.interfacecraft.dev/library/less-but-better), [Typography details](https://www.interfacecraft.dev/library/typography-details), and [Layout and alignment](https://www.interfacecraft.dev/library/layout-and-alignment). This was not an exhaustive read of the entire Interface Craft library, nor an application of every unrelated installed skill.

Wallet home now separates BRN payments from active TRST transfers; mobile uses labeled bottom navigation. Both apps share neutral surfaces, consistent 1.5px Lucide icons, a new Burst mark, and generated native icons. Detailed functionality remains available through community/tools navigation and disclosures.

The subsequent whitepaper/deck/website pass changed the wallet's information hierarchy, not just its appearance. BRN is labeled birthright, income follows the actual rate and accrual status, and expired/revoked holdings stay visible outside the spendable totals. Verification shows a person's next step; endorsement and challenge forms are contextual disclosures. Exact 18-decimal BRN and TRST values are available in details. Emil's writing guidance informed the shorter, less technical labels.

See [product model and source differences](design/product-model.md) for the governance-stage contradiction, expiry reactivation requirement, and remaining consumer gaps. Proposal browsing and review are implemented. Original-creator inspection and group-aware automatic acceptance are connected; transitive groups, weighted origin rules, scoped delegation and end-to-end verification coordination remain open.

The follow-up also replaces blind vote-by-ID signing with browse → read → review → confirm. It adds full constitutional amendment text, closes voting when that text is unavailable, and rechecks the current phase before signing. Receive reviews expose the full sender, exact amount and payment ID; batch acceptance keeps partial progress and stops on failure. Transfers disclose their single-origin maximum. Confirmed and uncertain action receipts survive navigation in memory.

Native wallet, node dashboard and daemon debug binaries were rebuilt. **Existing running sessions were not terminated.** Reopen the wallet only after saving its recovery material; use the updated daemon when testing full constitutional text. The running older release daemon does not gain new RPC fields merely because the source was rebuilt.

## 2. Findings and fixes

The retained first-pass rows describe the earlier redesign. Follow-up rows below identify the current implementation locations.

### A. Accessibility

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| BLOCKER | Unassociated labels and unnamed key visibility control | Associated verification fields at src/pages/verification.tsx:278; named key control at src/pages/settings.tsx:258 | Inputs and actions need accessible names | Fixed |
| BLOCKER | Portfolio batches and node proposals were clickable divs | Native button disclosures in src/pages/portfolio.tsx; node-gui/src/pages/governance.tsx:90 | Keyboard users could not open them | Fixed |
| BLOCKER | Controlled dialogs lacked focus return; mobile More could steal destination focus | Explicit focus restoration in src/pages/settings.tsx:242, src/pages/verification.tsx:384 and node explorer/governance; navigation-aware close at src/components/layout.tsx:105 | Avoid lost focus after cancellation or navigation | Fixed |
| SHOULD FIX | Node tabs had ~28px touch height | Minimum 44px in node-gui/src/components/ui/tabs.tsx:29 | Small touch targets were difficult to operate | Fixed |

| BLOCKER | Successful confirmations returned focus to newly disabled submit buttons | Receipt focus at src/components/transaction-receipt.tsx:6 and payment/verification close handlers; acknowledgement returns to main | Keep keyboard focus after signing | Fixed and tested |
| SHOULD FIX | Onboarding and proposal navigation removed focused controls | Step heading focus at src/pages/onboarding.tsx:73; proposal section focus at governance.tsx:55 | New views have a meaningful focus destination | Fixed |
| SHOULD FIX | Receive review was a long full-dialog scroll on narrow screens | Separate bounded content scroll in src/pages/receive.tsx:96 | Keep review header, outcome and action visible | Fixed and visually checked at 320px |

### B. Performance

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| SHOULD FIX | Node loaded every route and Recharts at startup (~878 KB main JS) | Lazy routes at node-gui/src/App.tsx:6; lazy chart at node-gui/src/pages/overview.tsx:19; main JS 384.85 KB | Defer secondary tools and chart parsing; chart loads only after two samples | Fixed |
| SHOULD FIX | Background wallet reads replaced known values with skeletons | Initial-only placeholders in src/pages/dashboard.tsx, pay.tsx, transfer.tsx, receive.tsx and verification.tsx | Preserve reading position and displayed context during polling | Fixed |
| POLISH | Changing balance digits could shift | Tabular numerals in src/app.css:133 and amount components | Stable width while values update | Fixed |

### C. Mobile

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| BLOCKER | Secondary node headers clipped controls at 320px | Shrinking/truncated title with nonshrinking controls in node-gui/src/components/layout.tsx:71 | Connection and appearance remain reachable | Fixed |
| SHOULD FIX | Node verification tabs and log filter row overflowed | Stacked narrow tabs in node-gui/src/pages/verification.tsx:132; wrapping log controls in logs.tsx:83 | No page-level horizontal overflow | Fixed |
| SHOULD FIX | Icon-only narrow sidebar | Labeled four-item bottom navigation and More dialog in both layouts | Clear mobile destinations with 44px targets | Fixed |

| SHOULD FIX | Technical identifiers were permanently truncated | Full selectable Identifier dialogs in node-gui/src/components/identifier.tsx:5 | Touch/keyboard users can inspect the actual account or hash | Fixed |

### D. Forms and security UI

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| BLOCKER | Cancel could retain an export password and accept a late key result | Shared cleanup and request-session invalidation in src/pages/settings.tsx:51,113 | No old export result reappears after cancellation | Fixed and regression-tested |
| SHOULD FIX | Node endpoint changed while typing | Validated draft form, explicit Connect in node-gui/src/components/layout.tsx:43 | Avoid requests to half-entered endpoints | Fixed |
| SHOULD FIX | Repeated confirmation could invoke twice; pending dialog could be dismissed | Ref guards and pending close gates in src/pages/pay.tsx and transfer.tsx | Preserve intentional signing flow and outcome | Fixed |
| SHOULD FIX | Semantic input border was overridden by unlayered global CSS | Base-layer default at src/app.css:129 and contrast-tested input colors at :39/:91 | Actual input boundaries now use their intended accessible color | Fixed |

| BLOCKER | Configuration could overwrite a different path or discard concurrent edits | Loaded-file binding, busy edit lock, memory draft and discard review in node-gui/src/pages/config.tsx:21 | Save the reviewed buffer to its actual loaded file | Fixed and regression-tested |
| BLOCKER | Unsaved editor changes disappeared after navigation/exit | Memory draft and app-lifetime beforeunload guard at node-gui/src/pages/config.tsx:10,15 | Navigation keeps draft; exit warns while dirty | Fixed in browser; native window-close behavior still needs device verification |
| SHOULD FIX | Endorse/challenge inputs did not submit with Enter | Semantic forms in src/pages/verification.tsx | Keyboard review must not bypass confirmation | Fixed and tested |

### E. Stability and states

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| BLOCKER | Account history displayed post-block balance as signed transaction amount, owner as counterparty | Neutral balance labels and expandable full identifiers in src/pages/history.tsx:83 and dashboard.tsx:100 | RPC fields must not misrepresent transfers | Fixed |
| BLOCKER | Portfolio/history/delegation failures looked empty or undelegated | Explicit errors and retry in src/pages/portfolio.tsx:152, history.tsx:78 and governance.tsx | Unknown is not zero or absent | Fixed |
| BLOCKER | Node representative failure was blank; verification failure remained a skeleton | Query errors and retry in node-gui/src/pages/governance.tsx:340 and explorer.tsx:170 | Users can identify and recover from failure | Fixed |
| SHOULD FIX | Explorer could not reach history beyond the first 20 blocks | Cursor navigation and retry in node-gui/src/pages/explorer.tsx | Older and newer pages remain available; labels are neutral because native order is ascending | Fixed |
| SHOULD FIX | Chart parsed comma-formatted token values; consensus weight was divided by token precision | Raw-unit chart conversion in node-gui/src/pages/overview.tsx; raw consensus weight and verified people in governance.tsx:370 | Charts and verified-human voting weight must retain the correct meaning | Fixed |

| BLOCKER | Slow polling superseded every outstanding response | In-flight generation guards in src/hooks/use-wallet.ts:34 and node-gui/src/hooks/use-rpc.ts:43 | A response slower than the polling interval must still be shown | Fixed and tested in both apps |
| BLOCKER | Lost submission responses became retryable payment failures | Memory receipt store at src/hooks/use-transaction.ts:7; locally signed hash retained in protocol/wallet_core/src/signed_client.rs | Avoid blind duplicate payments; unrelated response hashes cannot confirm this transaction | Fixed; browser and native mock-HTTP tests |
| BLOCKER | Status polling errors unmounted an in-progress endorsement dialog | Inline status errors in src/pages/verification.tsx; action outcome retained separately | Background reads cannot hide a pending write | Fixed and tested |
| SHOULD FIX | Same failed node query could not be retried | Explicit refetch in node-gui/src/pages/explorer.tsx:414, verification.tsx:55, merger-graph.tsx:45 | Repeating a query must issue a new request | Fixed |

### F. Motion

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| SHOULD FIX | Broad transition-all declarations | Narrow properties, no animated width changes in both apps | Avoid accidental layout animation | Fixed |
| SHOULD FIX | Logs smoothly forced the reader to the bottom each refresh | Explicit instant jump action in node-gui/src/pages/logs.tsx:127 | Preserve reading position and reduced-motion expectations | Fixed |

Disclosure chevrons no longer animate movement under reduced motion (src/app.css). Protocol clocks, polling cadence, and unlocked-wallet automation intentionally remain active. They are functionality, not decorative animation.

### G. Theming

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| SHOULD FIX | Inconsistent surface/type/color treatment | Shared semantic palette and type roles in both src/app.css files; documented in docs/design/tokens.md | Consistent light/dark hierarchy without gradients or glass effects | Fixed |
| SHOULD FIX | Input contrast was not tested against actual rendered styling | Contrast tests for seven text pairs and input boundary in tests/dashboard.test.cjs | Token values alone do not prove the cascade uses them | Fixed |

See [neutral color changes](design/color-changes.md). Both themes and all nine routes per app were opened in isolated Chromium fixture contexts. This is not a claim that every possible data combination or every pixel has been contrast-audited.

### H. Content and leftovers

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| SHOULD FIX | Mixed tiny/bold badge and title styles | 13/14/18/24/36px named roles with 400 weight; native touch input exception at 16px | Readable, consistent hierarchy | Fixed |
| SHOULD FIX | Long explanatory panels competed with core actions | Short visible copy, supplemental HelpLabel definitions and details | Reduce clutter without concealing risk or protocol meaning | Fixed |
| SHOULD FIX | “One wallet = one vote” and “Recent” claims obscured verified-human identity / native history ordering | “One verified human, one vote”; “Account activity”; neutral pagination | Match actual semantics without changing consensus | Fixed |

Old artwork was retained. New shell/favicon/native bundle references use the new mark. No new UI library was installed. No real keys or supplied authentication cookie were used. Design docs were tested against a separate agent's notification-settings sketch; ambiguous checkbox and secondary-button rules were clarified.

I. Marketing and SEO: not applicable; these are native product applications, not marketing routes.

## 3. Needs a device or a human

Needs a device:

- On real iOS/Android hardware, open More and payment confirmations with the software keyboard visible; check safe-area padding, scroll reachability, and absence of input zoom.
- With VoiceOver/TalkBack or a desktop screen reader, navigate the sidebar/bottom navigation, details, errors, and confirmation dialogs.
- In the actual Tauri windows, complete a fresh testnet-only recovery and payment/receive cycle; verify the signed results against the node. Automated tests deliberately use synthetic IPC and do not prove native transaction execution.
- Check scrolling and chart updates on a low-powered device. No dropped-frame measurement is claimed.

Needs a human:

- Try the new visual direction and terminology. Existing verification, governance, provenance, expiry and revocation action paths were retained; the product-model review lists incomplete consumer flows. Further changes must preserve the protocol's intended behavior.
- The rebuilt native wallet is at `wallet/src-tauri/target/debug/burst-wallet-gui`; the rebuilt daemon is at `protocol/target/debug/burst-daemon`. The already-running wallet/daemon still use their old binaries. Reopen only after ensuring wallet recovery material is saved. No running session was killed.
- Receipts and config drafts are memory-only. They do not survive a full process restart. After an uncertain submission/restart, reconcile activity against the node before sending again.
- Test the real Tauri window-close path with an unsaved config draft. Browser beforeunload interception was tested; platform-native close handling was not.
- The updated constitutional-text RPC field has serializer coverage and frontend gating tests, but has not been deployed to the already-running release daemon.

## 4. Verification

Final Chromium commands (existing local Playwright installation):

```sh
# wallet/
env PLAYWRIGHT_MODULE=/home/nitesh/.npm/_npx/9833c18b2d85bc59/node_modules/playwright CHROMIUM_PATH=/home/nitesh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome node --test tests/dashboard.test.cjs tests/brn.test.mjs
# node-gui/
env PLAYWRIGHT_MODULE=/home/nitesh/.npm/_npx/9833c18b2d85bc59/node_modules/playwright CHROMIUM_PATH=/home/nitesh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome node --test tests/overview.test.cjs
```

Wallet result:

```text
ℹ tests 40
ℹ pass 40
ℹ fail 0
```

Node result:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

Both `npm run build` commands passed TypeScript and Vite. Final build output:

```text
wallet:   dist/assets/index-BczjRcCs.js   498.47 kB │ gzip: 151.33 kB
          ✓ built in 1.71s
node:     dist/assets/index-jiEtFTYy.js  384.85 kB │ gzip: 123.53 kB
          dist/assets/telemetry-chart-nTxiIzX0.js 397.65 kB │ gzip: 108.23 kB
          ✓ built in 2.60s
```

Both native `cargo check --offline` commands passed after configuring generated icons:

```text
wallet: Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.26s
node:   Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.54s
```

Additional native verification:

```sh
# protocol/
cargo test --offline -p burst-wallet-core -p burst-rpc --lib
cargo build --offline -p burst-daemon
# wallet/src-tauri/ and node-gui/src-tauri/
cargo build --offline
```

```text
RPC:         test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
Wallet core: test result: ok. 71 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.59s
Daemon:      Finished `dev` profile [unoptimized + debuginfo] target(s) in 8.08s
Wallet:      Finished `dev` profile [unoptimized + debuginfo] target(s) in 8.23s
Node GUI:    Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.89s
```

The new native submission tests use a synthetic localhost HTTP responder, not a real ledger or funded wallet. They cover malformed responses, explicit rejection and an unrelated returned hash.

`git diff --check`: passed in both app repositories and for the two touched protocol files. Builds retain the environment's Node `module.register()` deprecation warning; no build failure.

WebKit remains unverified. The original cache lacked its executable; the downloaded browser archive was integrity-tested and extracted successfully. Launch then stopped because this Arch host lacks the required `libicu74`, `libxml2` and `libflite1` compatibility dependencies. No WebKit app test executed successfully. No system packages were replaced to force compatibility.

Intermediate runs caught an obsolete copy expectation, a missing transfer fixture, a StrictMode initial-request count assumption, and a chart resize overflow. The first node run also found the development preview server stopped; it was restarted. After updating fixtures and fixing chart containment, the final browser runs passed 40 wallet and 9 node checks. No browser fixture result is presented as a native transaction test.

## Follow-up validation, 2026-10-11

The wallet now loads portfolio, activity, verification, governance and settings
when opened. Onboarding, balances and payment screens remain in the initial
bundle. Navigation, locking and network identity stay visible while a screen
loads. A failed screen has a keyboard-accessible route back to the wallet; it
does not reload the app or clear transaction receipts.

The initial JavaScript bundle fell from 501.14 kB to 449.63 kB, or from 152.05 kB
to 140.89 kB compressed. Both production frontend builds passed. The wallet's
50 browser/unit checks and the node dashboard's 18 browser checks passed.
New regressions cover deferred loading, slow loading without lost focus, and
failed chunk recovery. These use simulated IPC, not native ledger transactions.

Logs are in the sibling protocol repository's `target/validation-evidence`:
`continuation-wallet-split-build.log`, `continuation-wallet-split-ui.log`,
`continuation-node-build.log` and `continuation-node-ui.log`. An initial Vite
import-order failure was fixed; its failed log remains in
`continuation-wallet-split-import-error.log`.

The rebuilt desktop wallet also passed real Tauri/WebKit tests against a fresh
local Dev ledger, with a separate desktop profile and no mocked IPC:

- Mnemonic recovery, encrypted backup, overwrite refusal, wrong-password
  rejection, locking and rejection of an unfunded unverified spend.
- Onboarding's 24-word backup gate, default receive/merge settings and the live
  unverified dashboard.
- Signed payments, sender restrictions, unverified receiving, pre-admission
  representative choice, automatic merging and transfer of merged TRST.
- The actual payment form. Review and cancellation leave the account head
  unchanged. Confirming `0.000000000000000001` BRN produces a confirmed block
  and exactly one raw unit pending for the receiver. Receipt focus is preserved.

Run from `wallet/` after building the release daemon and native wallet, with
the Vite server running on port 1430:

```sh
TAURI_DRIVER=/home/nitesh/.cargo/bin/tauri-driver node tests/native-session.mjs
```

The runner owns its temporary node, desktop profile and WebDriver processes.
Its tests require a loopback Dev endpoint. It never reuses the user's wallet
profile or a configured Azure node. The test ledger, logs and non-secret
dashboard screenshot remain in `/tmp/burst-native-wallet-tSurEd/`; the summary
is `protocol/target/validation-evidence/continuation-native-wallet.log`.

The native node dashboard passed its RPC and rendered-navigation checks against
that disposable ledger too, including origin tracing, verification lookup,
the explorer dialog and focus restoration. Its isolated app evidence is in
`/tmp/burst-native-dashboard-frTOIb/`, with the summary in
`protocol/target/validation-evidence/continuation-native-node.log`.
These Linux WebKit checks do not establish macOS/iOS or packaged-release behavior.

## Stake preparation and activity follow-up

The wallet core distinguishes a failed account-preparation batch from a submitted
payment. Preparation can contain a signed, same-representative block that releases
previously returned stakes. Its pending hash is not a payment receipt. The form
keeps the reviewed fields and allows a deliberate retry when the requested action
was never submitted. Ambiguous payment submissions still block blind retry.

The activity list uses plain operation labels. An account-maintenance block is
"Account updated", not a received payment. Verification and governance operations
also have distinct labels and neutral category icons. Unknown operations retain
their raw type in the details and never get the incoming-payment arrow. Values
remain explicitly labeled TRST balances, not transfer amounts.

Scoped review: approve these changes. Emil's form guidance informed the preserved
input and explicit retry state. The design-foundations review corrected misleading
icon semantics without changing the page geometry or adding motion.

| Before | After | Why |
| --- | --- | --- |
| Preparation failure looked like an uncertain payment | Explicit not-submitted state; input retained | A maintenance-block hash cannot stand in for a payment receipt |
| Every unrecognized operation used the received arrow | Neutral activity icon with raw type in details | Unknown activity must not imply money arrived |
| Raw concatenated block names filled the list | Plain labels with technical names inside details | Consumer readability without removing ledger information |

The preparation regression failed before the change. The wallet build, 76 core
tests and the 51-test browser suite then passed. The additional activity regression
also failed before its change and now passes, together with pagination and outage
tests. Desktop and 320px screenshots were visually inspected. Logs are under
`protocol/target/validation-evidence/stake-preparation-*` and `stake-activity-*`.
Browser tests use synthetic data and mocked desktop commands; this is not a new
claim about macOS/iOS or native network validation.

The complete suite now passes all 52 tests (`stake-activity-wallet-all.log`).
An earlier run failed the capability-change check while waiting for a real
10-second polling interval. The isolated rerun passed. That test now installs
the browser clock before mounting verification and advances it by 11 seconds
for each eligibility change. It still requires the open review to show an alert,
disable signing and issue no endorsement or challenge command. No production
polling behavior or safety assertion was changed.

## Returning a pending payment

The receive review now offers "Return payment…" when automatic acceptance is
off. It opens a separate confirmation with the exact amount, sender and payment
ID. Back and Cancel do not sign. The confirmation explains that the sender must
claim the returned TRST and that the original BRN burn stays permanent.

An unopened wallet first signs an empty Open block, then RejectReceive. It never
receives the payment into its balance. An ambiguous Open is account preparation,
not a submitted return. An ambiguous return retains its receipt across navigation
and blocks blind retry. Native signing checks the reviewed wallet identity again
under the signing lock.

Scoped Emil UI review: Ship it for this return flow. The forms and accessibility
skills informed the explicit destructive confirmation, focus restoration and
disabled state during submission. The 320px review was visually inspected; it
keeps the full amount and identifiers readable without horizontal overflow.

| Before | After | Why |
| --- | --- | --- |
| Pending payments could only be accepted in the app | Separate return confirmation | The whitepaper gives the receiver both choices |
| Returning from a new wallet failed on a zero predecessor | Empty Open followed by RejectReceive | Returning must not require accepting first |
| Home activity used different labels from history | One shared operation map | Maintenance and returned payments must not look like incoming money |

The production build and all 54 browser tests pass, including unknown operation
names that match JavaScript object properties. Evidence is in
`wallet-return-ui-build-verified.log` and `wallet-return-ui-complete.log` under
`protocol/target/validation-evidence/`.

All five native wallet test groups pass (`wallet-return-native-stable.log`).
The new test uses an unopened unverified wallet, returns 17 raw units, checks
unchanged recipient balance and permanent BRN burn, rejects duplicate and
wrong-wallet attempts, and has the sender reclaim the exact amount. It also
checks the locked-wallet rejection. The disposable ledger and profile are in
`/tmp/burst-native-wallet-0GtsSk/`.

A further full native run also verifies that both the returned pending entry
and the reclaimed holding retain the original burn timestamp, and that the
reclaimed holding retains the original burn ID. It passes in
`wallet-return-native-provenance.log`, with its disposable fixture in
`/tmp/burst-native-wallet-gf5xhz/`.

The native node dashboard passed RPC and rendered navigation checks against a
separate disposable fixture (`return-node-native.log`). Its screenshot was
visually inspected. Both desktop runners now explicitly select X11 inside Xvfb;
otherwise an inherited Wayland session could bypass the isolated display.
One wallet run was interrupted by a page unload during a concurrent frontend
build. The passing rerun held the frontend steady. These are Linux WebKit tests,
not macOS/iOS or packaged-release certification.

## Portfolio origin accuracy and row cleanup

Scoped Emil review: Ship it for the origin labels, holding identity and disclosure
changes. The design-foundations and surfaces guidance informed the single list
with row dividers and removal of nested cards. Exact amounts and protocol dates
remain available. The full portfolio is not being signed off as a completed
group-trust experience.

| Before | After | Why |
| --- | --- | --- |
| Merging wallet labeled as the BRN creator | "Combined by" with original creators distinguished in the details | A merge does not create BRN or erase its creators |
| Missing origin type implicitly treated as a burn | Neutral "Origin account" | Older nodes cannot provide evidence they do not have |
| Holdings keyed by origin, which can repeat | Native holding IDs retained | Split holdings must keep separate UI state |
| Bordered cards nested inside a card | One list with visible dividers | More room for amounts and identifiers on phones |
| Repeated status, empty chain length and a progress percentage | Status badge and actual dates | Derived decoration should not crowd the useful data |

The final build and 55 browser tests pass. Light and dark 320px disclosures were
visually inspected. Both native adapter tests and all five real desktop flow
groups pass against the rebuilt daemon, including burn/merge classification,
holding IDs and preserved origin age after return and reclaim. Evidence is in
`protocol/target/validation-evidence/portfolio-origin-*`. These checks remain
scoped to Linux WebKit and synthetic browser fixtures, not macOS/iOS.

## Original-creator inspector

Before: a merged holding explained that creators were recorded in merge history,
but offered no way to inspect them. After: an explicit disclosure fetches the
original burn creators through the native typed reader, with ten entries per
page, payment IDs in secondary disclosures, and visible unconfirmed/revoked
flags. It says who supplies the report and does not imply independent proof or
an allocation of the holding's value.

Emil's performance guidance shaped the on-demand fetch and bounded DOM list.
The existing form/accessibility foundations shaped keyboard operation, retry
and context reset. All 56 browser tests, the production build and all five native
flow groups pass (`origin-inspector-*.log`). The 320px view was visually checked.
This is Linux WebKit plus synthetic browser coverage, not macOS/iOS sign-off.

The same disclosure is available while reviewing an incoming payment, including
returned payments. It keeps the immediate sender separate from original BRN
creators, preserves unconfirmed-history warnings, and is removed if the review's
wallet/node context changes. Inspection never signs or receives. The final pass
has 57 passing browser tests and all five native flow groups, including an
unopened wallet remaining unchanged after inspection. The 320px dialog was
visually reviewed; the creator list scrolls within the existing review area.
Evidence: `payment-origins-*.log` (the earlier failed UI log is retained separately).

## Receive-setting changes and in-flight work

Automatic maintenance now carries a native session token. Changing receive/merge
settings, changing the wallet/node, or leaving the session cancels the old pass.
A late start cannot launch maintenance after cancellation; a late result does
not display a stale success toast. Turning automatic acceptance off includes a
short note that a payment already being accepted may still finish. Cancellation
stops subsequent signed actions, not a transaction already in flight.

The final 58-test browser suite, production build, four native unit tests and
all six real desktop flow groups pass. The delayed native RPC fixture tests both
boundaries: cancellation before signing and completion of only the already-started
receive, leaving the next payment pending. Evidence is in
`protocol/target/validation-evidence/automation-session-*`; the earlier failed
browser log is not a pass. The existing Emil form/state guidance informed the
brief setting explanation and explicit handling of stale asynchronous work.

## Group rules and pending pages

Onboarding and Settings now expose group checks in one expandable section.
Loading a directory, selecting a group and saving rules are separate actions.
Selected endpoints are pinned; invalid saved rules pause automation. The form
states which creator addresses a group sees and offers a keep-pending alternative
to protocol fallback during outages. Unsaved onboarding rules prevent leaving
the setup step. There is no default published directory.

Automatic acceptance checks original BRN creators behind merged and returned
payments. Membership is queried live. Manual receiving stays available, and its
review states that the user's choice can override automatic group rules.
Recent failure explanations survive scan pages but never authorize a payment.

Receive now shows 20 payments per page with Previous/Next controls. A batch action
names the current page when the list has more payments. Dashboard counts use `+`
for incomplete pages. A receive or refresh returns to page one. Malformed node
responses show an error instead of an empty list. Sender labels truncate before
the Review button at narrow widths; the review still shows the full address.

The 62-test browser run, six native unit tests and seven desktop flow groups pass
through iteration 58. The native test creates 21 pending payments and uses the
actual desktop controls to receive the payment on page two, then checks the
remaining ledger entries. Evidence is in the sibling protocol repository under
`target/validation-evidence/pending-pages-*.log`; disposable native data is at
`/tmp/burst-native-wallet-Q888EN/`. The 320px layout was visually checked.
Emil's form, design-foundation and performance guidance informed the explicit
save boundary, compact disclosure and bounded list rendering.

Weighted origin rules, transitive group trust and directory discovery remain
open. These app tests do not open the protocol's certified-selection release gate.

The subsequent manual-priority pass cancels background read-only group checks
when the user starts a signed action. Already-started submissions still finish
under the signing lock. Normal cancellation stays quiet; genuine failures retain
the automation notice. All 63 browser tests, six native unit tests and seven
desktop flow groups pass (`manual-priority-*.log`). The stalled-group native test
confirms that explicit Receive proceeds without waiting for the group response,
while locking cancels without signing. Final native evidence is at
`/tmp/burst-native-wallet-7TudaY/`.

## Preview files

All previews use synthetic wallet/node data.

- [Wallet desktop](design/previews/burst-wallet-home.png)
- [Wallet dark](design/previews/burst-wallet-dark.png)
- [Wallet mobile](design/previews/burst-wallet-light-home-mobile.png)
- [Payment form](design/previews/burst-polished-pay.png)
- [Wallet onboarding](design/previews/burst-wallet-welcome.png)
- [Verification next step](design/previews/burst-wallet-verification-next-step.png)
- [Verified participant](design/previews/burst-wallet-verification-verified.png)
- [Proposal reader](design/previews/burst-wallet-proposal.png)
- [Receive review and partial-progress state](design/previews/burst-wallet-receive-review.png)
- Node previews are in the sibling node-gui repository at docs/design/previews/.
