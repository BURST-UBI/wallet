# Wallet and node product model

The wallet helps a person understand their balances, review payments and manage
participation. The node dashboard helps an operator inspect connectivity, ledger
state and protocol activity. They share visual components but serve different tasks.

## Explain the balances

BRN is a personal allowance accrued while eligible. Burning it for a payment
creates TRST for a recipient. Existing TRST can then change hands. Read the
connected network's rate and expiry settings; do not hardcode an income promise.

Keep BRN and TRST separate. Show spendable, expired and revoked TRST distinctly.
Neither an expired holding nor a payment proves that its holder performed useful
work. A transfer preserves age, and a merge uses the oldest input time. Governance
can extend the expiry period and make expired holdings active again; this does
not clear fraud revocation.

Use [the economic rules](../../../protocol/docs/introduction/ECONOMICS.md) for the accounting
and [protocol parameters](../../../protocol/docs/protocol/PARAMETERS.md) for defaults.

## Information hierarchy

| Surface | Show first | Keep available |
| --- | --- | --- |
| Home | Separate BRN and TRST, payment actions, income eligibility | Exact amounts, spent and staked BRN, activity, errors and network identity |
| Receive | Pending payments and acceptance state | Full sender, payment ID, exact amount, original creators and return consequences |
| Verification | Current status and the person's next step | Endorsement burn, challenge stake, judgment, appeal eligibility and restrictions |
| Portfolio | Spendable, expired and revoked holdings | Holding IDs, origin type, creators, age and provenance warnings |
| Governance | Proposal changes, phase, deadline and voting eligibility | Full text, identifiers, delegation scope and signing review |
| Node dashboard | Connection, peers, synchronization and failures | Blocks, origins, parameters, consensus diagnostics and logs |

Errors, uncertain submissions, irreversible actions and network identity belong
in visible content. Supplemental definitions can use disclosures or help labels.

## Payments and signing

Review the destination, amount and operation before signing. Enter submits a form
to review; it must not bypass confirmation. Cancellation before signing must leave
the account unchanged. Disable repeated submission while an action is pending.

A transfer may need several holdings from one origin. The combined active balance
is not necessarily the maximum for one send. Explain the selected origin and
available amount rather than silently changing the payment.

Distinguish account preparation from the requested payment. A maintenance-block
hash is not a payment receipt. If the payment may have been submitted, retain its
locally signed hash and reconcile the outcome before offering another send.

The UI receipt store in [use-transaction.ts](../../src/hooks/use-transaction.ts)
is memory-only and survives route changes. Durable signing and recovery records
are a separate native responsibility; do not infer restart recovery from that
React store. See [offline actions](../../../protocol/docs/wallet/WALLETS.md#offline-actions).

## Receiving and returns

Review full identifiers and exact amounts. Batch receiving is sequential: retain
completed results and stop on failure. Page-level batch actions must say which
payments they include. A failed read must not appear as an empty pending list.

A recipient rejection creates a pending return for the sender to claim. It does
not undo the original BRN burn. An expiry return credit is different: the ledger
has already returned the holdings, and the later claim acknowledges that delivery.
See [payment settlement](../../../protocol/docs/wallet/PAYMENTS.md).

Automatic acceptance and manual receiving are separate choices. Explain when a
manual decision can override automatic group rules. Group lookups disclose origin
accounts to the selected service; they are not independent proofs of provenance.
Changing settings or locking should stop subsequent automatic actions, while an
already-started submission may still finish. Keep that boundary visible.

## Identity and governance

Verification is a protocol judgment, not a guarantee that fraud is impossible.
Endorsement burns are permanent; verifier and challenge stakes have separate
settlement rules. An appeal reviews a prior judgment, rather than starting a new
enrollment. Show the relevant judgment, stake and current admission restrictions.

Ordinary governance has one voting window, followed by cooldown and scheduled
activation. `Exploration` is its stored phase name; retained `Promotion` fields
do not imply a second vote. Display current proposal state and recheck eligibility
before signing. Missing constitutional text must not be treated as an empty or
approved amendment. See [governance](../../../protocol/docs/protocol/GOVERNANCE.md).

Representatives, verifier panels and governance delegates have different roles.
Do not format consensus weight as a token amount or imply that choosing a
representative grants spending authority.

## History and provenance

Account-history `amount` is a post-block TRST balance, not a payment delta, and
`account` identifies the chain owner. Do not invent a counterparty or signed
payment amount from those fields. Keep unknown operation types visible in details
with a neutral label rather than an incoming-payment icon.

A merge account combined holdings; it did not necessarily create their BRN.
Distinguish immediate sender, merge account and original burn creators. Use each
holding's ID for UI identity because multiple holdings can share an origin.
Origin inspection must not sign, receive or imply that node-supplied history has
been independently verified.

## Scope of evidence

A visible control does not establish that its native or network path is available.
Use [implementation limits](../../../protocol/docs/introduction/LIMITATIONS.md) for protocol
availability and [interface validation](../interface-validation.md) for review
boundaries. Keep release evidence separate from product guidance.
