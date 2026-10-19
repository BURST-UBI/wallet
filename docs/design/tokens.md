# Tokens and layout

Source: [app.css](../../src/app.css). Both apps share these semantic roles.

## Type

System font stack; weight 400. Named rem scale: `text-caption` 13px, `text-ui` 14px, `text-heading` 18px, `text-title` 24px, `text-balance` 36px at the default root size. Inputs, selects, and textareas are 16px in both desktop and touch layouts; single-line fields are 44px tall with 8px corners. Never shrink text to fit; wrap or restructure.

Use tabular numerals for balances and metrics. Use monospace only for addresses, hashes, code, and exact raw units. Truncated identifiers need full selectable content in a details view, not only a hover title.

## Color

Use semantic `--color-*` tokens. The neutral palette is OKLCH; success, warning, and destructive colors retain their established semantic scales. Dark mode overrides roles, not individual screen values.

Background choice:

- App canvas → `background`.
- Content group or dialog → `card` / `popover`.
- Secondary grouping → `secondary` / `muted`.
- Selected or hovered navigation → `accent`.

Text choice:

- Essential information → `foreground`.
- Supporting copy → `muted-foreground`.
- Risk/failure → `warning` / `destructive`, with explicit wording.
- Confirmed success → `success`, with explicit wording.

Decorative separators use `border`. Inputs use `input`, tested at 3:1 against the canvas. Text pairs need 4.5:1 in each theme. Keep default border styling in the base cascade layer so semantic utility colors can override it.

## Layout

Use 4px spacing increments, primarily 8/12/16/24/32. Desktop sidebar is 208px, 184px on narrower desktops; below 760px use the four-item labeled bottom navigation and More dialog. Main content scrolls independently, with safe-area padding and a 100dvh shell.

Cards and balance panels share `--radius-card` (16px) and `--shadow-card`; both wallet balances have the same surface. Use 24px padding for content cards and 20px for node metrics. Do not add a solid border or hover lift to a static card. Group with space before adding another card. Expanded balance details must not stretch the adjacent panel. Use one alignment rail for headings, form labels, and content.

## Motion

No decorative entry animations, scrolling reveals, pulsing metrics, or theme tweening. State changes are immediate. Keep essential spinner feedback; reduced motion pauses rotation. Never animate width/height, and never add `transition-all`. Logs only jump on explicit request. Do not pause protocol clocks or wallet automation as an animation optimization.
