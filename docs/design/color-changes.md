# Neutral palette changes

Applied to both apps' `src/app.css`. These are intentional palette changes, not color-equivalent conversions. Existing semantic success/warning/destructive scales remain. Input lightness was adjusted after contrast checks; typography and borders use semantic roles.

| Previous value | Final value |
| --- | --- |
| `#f5f5f7` | `oklch(0.985 0.002 260)` |
| `#1d1d1f` | `oklch(0.22 0.006 260)` |
| `#ffffff` | `oklch(1 0 0)` |
| `#0066cc` | `oklch(0.26 0.008 260)` |
| `#eeeef1` | `oklch(0.95 0.003 260)` |
| `#343438` | `oklch(0.32 0.006 260)` |
| `#68686f` | `oklch(0.49 0.008 260)` |
| `#e8e8ed` | `oklch(0.93 0.004 260)` |
| `#e4e4e9` | `oklch(0.91 0.004 260)` |
| `#d5d5dc` | `oklch(0.62 0.006 260)` |
| `#efeff2` | `oklch(0.97 0.002 260)` |
| `#45454c` | `oklch(0.4 0.008 260)` |
| `#dedee5` | `oklch(0.91 0.004 260)` |
| `#151517` | `oklch(0.18 0.004 260)` |
| `#222225` | `oklch(0.22 0.005 260)` |
| `#29292d` | `oklch(0.25 0.006 260)` |
| `#78b9ff` | `oklch(0.92 0.004 260)` |
| `#082341` | `oklch(0.22 0.006 260)` |
| `#303035` | `oklch(0.28 0.006 260)` |
| `#ededf2` | `oklch(0.93 0.004 260)` |
| `#2d2d32` | `oklch(0.27 0.006 260)` |
| `#aaaab3` | `oklch(0.74 0.008 260)` |
| `#36363c` | `oklch(0.3 0.006 260)` |
| `#37373d` | `oklch(0.32 0.006 260)` |
| `#48484f` | `oklch(0.56 0.008 260)` |
| `#1c1c1f` | `oklch(0.2 0.004 260)` |
| `#c6c6cf` | `oklch(0.82 0.007 260)` |
| `#333339` | `oklch(0.3 0.006 260)` |

Verified normal-text pairs at ≥4.5:1 in light and dark: foreground/background, muted/background, muted/secondary, primary-foreground/primary, destructive/card, warning/card, success/card. Input/background is ≥3:1. The test also checks the actual input border uses this token; decorative separators intentionally remain subtler.
