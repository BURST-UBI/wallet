# Whitepaper-derived icons

The icon family lives in `src/components/burst-icons.tsx`. It uses a shared
24-unit grid: orange token diamonds with a green BRN center or blue TRST center,
a two-center orange wallet, and a one-center purple node. Source artwork is
retained in `src/assets/burst-docs/`.

The generic Burst mark combines both centers. App launchers use the wallet or
node silhouette. Action icons use Lucide; brand colors do not indicate success,
warning or connection state. Keep visible token labels because color alone does
not distinguish BRN and TRST for every reader.

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

The preview script checks four icons' forced-color fills and writes comparison
images. It does not test native launcher installation, every rendered size or
ledger behavior. Inspect the output at the sizes used by the app, then follow
[interface validation](../interface-validation.md) for broader checks.
