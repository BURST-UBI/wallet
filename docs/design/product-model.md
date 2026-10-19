# Wallet and node product model

Reviewed 2026-10-10 against the local whitepaper, the user's implementation answers, the deck's actual slide content, and the published whitepaper repository.

## The consumer promise

BURST separates what a person is given from money received from others. BRN is the birthright counter. Spending it creates the same amount of TRST for someone else. TRST can then change hands. The community controls the income rate and expiry period, including zero income and no expiry.

The deck's bread-and-bakery example is a useful wallet design test: can someone check what they have, pay another person, receive a payment, and understand what changed? They should not have to understand a block lattice or optimize token merges first.

BRN and TRST must stay distinct. Do not show a combined net worth, invent a fiat exchange rate, turn BRN into a transferable token, or describe all TRST held as proof of work personally performed by the current holder. TRST may have been transferred to them.

## What belongs where

| Surface | Show first | Available on demand | Never conceal |
| --- | --- | --- | --- |
| Wallet home | Separate available BRN and TRST, pay, transfer, receive, current income state | Exact balances, BRN spent/staked, history records, origins | Verification restrictions, failures, revoked funds, test-network identity |
| Receiving | Address, QR, pending payments, acceptance status | Sender rules and origin information where supported | Acceptance-policy limitations and payment failures |
| Verification | Current status and the next step for this person | Vouching and reporting for verified participants, verifier records | Permanent endorsement cost; challenge stake and fraud/inactivity consequences |
| TRST | Spendable amount, reputation, revoked amount, expiry | Origin identifiers, raw units, chain metadata | Expired is not revoked; neither belongs in available funds |
| Governance | What a proposal changes, voting, optional delegation | Identifiers and technical voting records | Actual proposal text, eligibility, irreversible actions and failures |
| Node | Connection health, peers, synchronization, ledger and consensus diagnostics | Detailed blocks, origins, logs, parameters | Isolation, errors, stale or unavailable readings |

The wallet now browses proposals, reads changes and amendment text, shows real phases/deadlines, and reviews votes before signing. Native proposal adapters and the node’s additive amendment-text response require updated native binaries. On older nodes, constitutional voting stays disabled when the full text is unavailable.

## Source differences that matter

| Topic | Evidence | UI consequence |
| --- | --- | --- |
| Income defaults | Whitepaper Part 6/roadmap describes launching with `r=0`; implementation answer 5.3 chooses 1 BRN/hour; deck uses 1/hour as an example. | Read the connected network's rate history. Distinguish active, paused, zero-rate, and unavailable income. Do not hardcode a daily promise. |
| Expiry | Implementation answer 6.9 explicitly recalculates from inception using the governance-defined period, including making expired TRST transferable again. The whitepaper describes a permanent *record*, not a license to delete it. | Preserve expired holdings. Do not say expiry can never change or that a transfer renews TRST. Keep fraud revocation separate. |
| Governance phases | Whitepaper Part 5 describes Proposal → Voting → Cooldown → Activation. Deck slides describe Propose → Explore → Cooldown → Promote. `protocol/governance/src/proposal.rs` implements two votes and a subsequent activation phase. | Removed the wallet's hardcoded four-stage claim. A proposal reader must display actual network state. This pass does not choose new protocol rules. |
| Humanity guarantees | Deck calls identity mathematically enforced and unbreakable. Whitepaper's Sybil Tolerance section explicitly says prevention is imperfect and needs economic/security validation. | Never imply verified TRST is risk-free or fraud impossible. Verification is a state, not an absolute security guarantee. |
| Endorsement cost | Published website's Verification Process talks about endorsers' stakes and rewards. Its Types of Validators page, local whitepaper and current requirements distinguish permanent endorsement burns from verifier stakes. | Endorsement review must say the BRN cannot be recovered. Do not relabel this as a refundable deposit. |
| Anti-spam | Deck infrastructure says no proof of work. Whitepaper Part 5 requires lightweight per-transaction proof of work, distinct from mining. | Consumers need payment progress, not a mining explanation. Node diagnostics can expose work generation. Do not claim PoW does not exist. |
| Readiness | Deck says complete protocol/live five-node testnet; whitepaper roadmap still describes major engineering as future work. | Neither document proves current deployment health. Report checks performed and distinguish synthetic UI contracts from native ledger tests. |

## Remaining consumer work

- Governance now has proposal browsing, readable changes, deadlines, review/confirmation and a phase recheck before voting. Broader governance authoring and scoped delegation still need a separate capability audit; the current wallet delegate is global.
- Group trust now has explicit onboarding/Settings choices, public-directory loading and live original-creator checks during automatic acceptance. Immediate-sender rules remain separate. Weighted origin rules, transitive group trust and directory publication/discovery are still open; node-reported origins are not independent proofs. Protocol verification/challenge release gates remain unchanged.
- Consumer transaction history with reliable payment amounts and counterparties. The native account-history `amount` is a post-block TRST balance and `account` is the owner. Do not manufacture signed deltas from those fields. The home event list now omits those technical balances; the activity details retain the labeled records.
- Verification evidence coordination and an end-to-end re-verification path. A status page and sharing instructions do not themselves prove this workflow complete.
- Requirements 32.5–32.8 include payment-request URIs, configurable freshness display, and local contacts. These need their own implementation/coverage audit; the present address QR and raw address inputs are not a substitute.
- Native testnet payment/recovery checks, device accessibility testing and testing across governance changes remain distinct from automated browser fixtures.

## Consumer-flow safeguards

- A transfer is backed by one origin group; the combined active balance is not advertised as a single-send maximum. Provenance and expiry rules are unchanged.
- Payment/endorsement/challenge receipts distinguish confirmed, rejected and uncertain outcomes. Memory-only receipts survive route changes, not an app restart; reconcile activity after an interrupted session before submitting again.
- Native submission errors after `process` retain the locally signed hash. A mismatched response hash cannot confirm an unrelated transaction. This changes client reporting, not ledger acceptance rules.
- Appeals review the latest certified challenge judgment, not a new endorsement attempt. Show the judgment and exact governed stake before confirmation. Native signing rechecks both; disabled nodes and active reviews cannot submit. A revoked owner needs a verified sponsor. Node-reported outcome details are not independently verified proofs.
- Receiving exposes full sender, exact amount and payment ID. Batch acceptance is explicitly sequential, stops on the first error, and keeps partial progress visible. Automation remains governed by the existing settings.

## References read

- [`protocol/BURST_WHITEPAPER.md`](../../../protocol/BURST_WHITEPAPER.md), full document. Sections on the two-token distinction, lifecycle, verification, wallet/node design, economic flexibility and limitations.
- [`protocol/IMPLEMENTATION_DECISIONS.md`](../../../protocol/IMPLEMENTATION_DECISIONS.md), relevant explicit answers including 5.3, 6.2, 6.9, 20.7–20.11, 22, 31–33. User-written answers take precedence over bold suggested defaults in that document.
- [`deck/src/BURST_Deck.jsx`](../../../deck/src/BURST_Deck.jsx), actual slides, repository HEAD `79ab17c`, plus [`PITCH_DECK.md`](../../../PITCH_DECK.md). Local working files may differ from HEAD.
- [Published whitepaper repository](https://github.com/BURST-UBI/whitepaper), checked out at `a73b0d5`. Read the home page and all 17 documentation pages, including BRN, TRST, wallet, node, humanity verification, legitimacy, transactions, valuation, token operations, funding, and comparisons. This is a built Docusaurus site; a separate `BURST-UBI/website` repository was not found.

This document records product interpretation and gaps. It does not certify the economics, security, protocol implementation, or live network.
