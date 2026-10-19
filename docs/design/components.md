# Components and interaction

Sources: `src/components/ui`, `src/components/help-label.tsx`, `src/components/burst-icons.tsx`.

## Button

Use for actions; use NavLink for navigation, or Button asChild around a link. Existing programmatic route buttons on the wallet home are retained.

Variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `link`. Nothing else exists. Sizes: `default`, `sm`, `lg`, `icon`. All remain at least 44px tall; small does not mean a smaller touch target.

- Irreversible/dangerous? → destructive, with confirmation.
- Primary action? → default (the component default); one per task region.
- Secondary action beside a primary action or on a card? → outline.
- Selected option in a mutually exclusive button group? → secondary.
- Low-emphasis utility? → ghost.
- Inline drill-down? → link.

Correct existing pattern: `<Button variant="outline">Cancel</Button>`.
Incorrect: changing that secondary Cancel action to another filled primary button.

Icon-only buttons require an action name, such as `aria-label="Copy address"`. Disable submission while pending and guard repeated invocation. Preserve the request's outcome instead of claiming success when merely submitted.

## Input and forms

Use Input for text; native select for short enumerations and textarea for multiline content. There are no Input variants. Input and native multiline/select controls use `form-control`: 8px corners, visible input-token borders, 16px text, and a neutral outside focus outline. Single-line controls are 44px tall. Use `form-field` for an 8px label/control/help rhythm, `field-action` for a field with an adjacent button, and `field-actions` for standalone actions. Never pad a text field by wrapping it in another card. Labels use htmlFor/id, or an explicit accessible name when a visible field context already exists.

Correct existing pattern: `<label htmlFor="provider">Provider address</label>` with `<Input id="provider" />`.
Incorrect legacy pattern: a standalone label with no association and only `placeholder="brst_..."`.

Payment forms submit to review on Enter, never directly to signing. Keep decimal amounts as strings and use the existing exact parser. Do not introduce floating-point balance calculations. Configuration and security actions keep their explicit buttons. The node file editor also supports Cmd/Ctrl+Enter to save, with the same pending and loaded-path guards. Use a native checkbox for boolean preferences; wrap it in an associated label with a 44px minimum hit area. Use a switch only if a shared switch primitive is added through a separate design decision.

## Settings

Settings use flat, divided sections with a 168px section-label column and a shared control alignment rail; stack below 560px of available content width. Keep the content within 800px. Sender restrictions have a visible summary and an expandable editor; keep manual-review restrictions visible when configured. Merge expiry/revocation semantics and private-key warnings stay visible. Connection and sender validation appear beside their fields. Retain the export-dialog session guard and explicit representative action.

## Dialog

Use the existing Radix Dialog for focused confirmation or connection changes. Use native details for low-risk inline drill-downs; do not create another modal implementation.

Dialog has no appearance variants. Compose DialogHeader, DialogTitle, DialogDescription, and DialogFooter. DialogTrigger restores focus automatically; controlled dialogs without it must use onCloseAutoFocus with a saved trigger ref.

Correct existing pattern: payment DialogContent returns focus to its review button.
Incorrect legacy pattern: a controlled confirmation with no trigger and no focus restoration.

Allow internal scrolling in short windows. Private-key export clears password and result and invalidates pending responses on every close path, including Cancel.

## HelpLabel

Use only for supplemental definitions. Use visible text for errors, irreversible actions, recovery, and network warnings. Props are label and explanation; no visual variants.

Correct existing pattern: `<HelpLabel label="Active TRST" explanation="Transferable trust that has not expired or been revoked." />`.
Incorrect: hiding the warning that paying permanently burns BRN behind that tooltip.

## Cards, details, and tabs

Card has no variants. Use for one coherent group; use simple separated rows for activity and secondary summaries. Card and Surface share one CSS surface: 16px corners, 24px content padding, a subtle stacked shadow in light mode and a single low-opacity ring in dark mode. Node metric cards use 20px padding. Surface is a compatibility wrapper around Card, not a separate SVG/ResizeObserver geometry system. Keep focus and expanded content unclipped. Use real borders for inputs and row dividers, not to outline every card. Flat nested forms can still opt out with `bg-transparent shadow-none`. Summary/disclosure controls must be keyboard-operable. Tabs use Radix TabsList/TabsTrigger/TabsContent, without size variants; keep their 44px targets and stack long labels on phones.

Correct current pattern: native details for the wallet's TRST breakdown.
Incorrect removed pattern: a clickable div that cannot be opened with Enter or Space.

## Icons and brand

Show the colored app identity once: in the compact sidebar lockup on desktop, or in the header on mobile. Navigation uses neutral action/destination icons; token icons remain appropriate for token-specific destinations. Generic icon CSS must not set `display` and override responsive visibility. Desktop page titles belong in the content, not beside another app logo in the header.

Use Lucide at 1.5px stroke, usually 16–20px, for ordinary actions. Use the whitepaper-derived BrnIcon, TrstIcon, WalletIcon and NodeIcon for their named concepts; do not substitute Flame, Layers or Server. BRN has a solid green center; TRST has a solid blue center, matching the whitepaper. Keep visible token labels to distinguish them without color. Keep labels alongside decorative, aria-hidden icons. `tone="monochrome"` inherits currentColor; forced-colors mode preserves cutouts and center shapes. Wallet and node favicons and native launchers derive from their distinct `public/icons/wallet.svg` and `public/icons/node.svg` assets. Old artwork is retained. See [icon system](icons.md) for sources and regeneration.
