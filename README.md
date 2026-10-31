# BURST Wallet

Desktop wallet for BURST: manage accounts, send and receive payments, and take
part in verification and governance. Built with React and Tauri; wallet logic
lives in the [protocol repository](https://github.com/BURST-UBI/protocol).

## Development

Install Node.js, Rust and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/).
Clone `protocol` and `wallet` into the same parent directory; Rust dependencies
use relative paths to `../protocol`.

From `wallet`:

```sh
npm ci
npm run tauri dev
```

Connect to a running BURST node through the wallet settings. `npm run dev` starts
only the web interface; native wallet commands require the Tauri app.

`src/` contains the interface, `src-tauri/` the desktop integration, and `tests/`
the app checks, including native WebView journeys.

[MIT license](LICENSE).
