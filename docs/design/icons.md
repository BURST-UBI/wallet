# Whitepaper-derived icons

The source identity is the whitepaper website's BRN, TRST, wallet and node artwork, retained in `src/assets/burst-docs/`. Reference snapshot: whitepaper website commit `a73b0d5`. The site's Docusaurus placeholder logo is not Burst branding.

The new vectors preserve orange rounded token diamonds, green BRN, blue TRST, the two-center orange wallet and the one-center purple node. Rounded geometry, optical spacing and a shared 24-unit grid replace raster scaling. Both token centers remain solid, matching the original identity. Visible BRN/TRST labels distinguish them in monochrome; do not rely on icon color alone. The generic Burst mark pairs both centers inside the token diamond; app launchers use their own silhouettes.

Emil's iconography guidance informed the consistent proportions, restrained detail, small-size review and accessible labeling. Normal action icons remain Lucide; brand colors do not indicate success, warning or connection state.

## Usage

Import from `src/components/burst-icons.tsx`. Default tone is color; `tone="monochrome"` inherits currentColor. App CSS preserves the holes and center shapes in forced-colors mode. Use 16–24px for adjacent labels and larger sizes only for identity/onboarding. Icons are decorative and aria-hidden: label their containing button or link, and never rely on color alone to identify a token.

## Regeneration

Both repositories keep identical React components, checked by the export script and tests. From the wallet repository:

```sh
node scripts/export-icons.mjs
npm run tauri -- icon public/icons/wallet.svg --output src-tauri/icons-whitepaper
```

Then from node-gui:

```sh
npm run tauri -- icon public/icons/node.svg --output src-tauri/icons-whitepaper
```

The exporter updates both apps' five `public/icons/*.svg` files and generic `public/burst-mark.svg`. Never hand-edit generated assets. Tauri configurations reference `icons-whitepaper`; previous icon directories remain available. Native launchers update with a rebuilt/reinstalled app, not by hot reload.

## Verification

[Original-to-new preview](previews/whitepaper-icon-family.png) shows the four symbols at 16, 24 and 32px and on a dark surface. [High-contrast preview](previews/whitepaper-icon-family-forced-colors.png) checks center contrast without brand color.

`scripts/preview-icons.mjs` regenerates these previews from the exported SVGs and built application CSS. Set `PLAYWRIGHT_MODULE` to the installed package directory and optionally `CHROMIUM_PATH` to its browser executable; build the wallet first.

The wallet's 44 tests (including four icon-specific tests) and the node's nine UI tests pass. These use synthetic IPC and do not certify real ledger transactions. Production frontend builds and offline native `cargo check` pass for both apps. The icon-only pass does not restart running native sessions or change wallet data.
