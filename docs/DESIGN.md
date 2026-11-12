# DESIGN.md — Foreman Bid-Board Design System (phase4.3)

Benchmark: Linear / Vercel Dashboard / Stripe. No framework, no build step — hand-written CSS
on custom properties; CDN used only for fonts (with a full system-stack fallback for offline video).

## 1. Color tokens (dark)

| Token | Value | Usage |
|---|---|---|
| `--base` | `#0A0C10` | Page background |
| `--surface-1` | `#0E1116` | Cards |
| `--surface-2` | `#12161D` | Raised layers (table rows, hash boxes) |
| `--surface-3` | `#171C25` | Hover / chips |
| `--hairline` | `rgba(255,255,255,.06)` | All borders (the only border style) |
| `--hairline-strong` | `rgba(255,255,255,.10)` | Table header separator |
| `--text-1` | `#F2F4F8` | Primary text |
| `--text-2` | `#9AA3B2` | Secondary text |
| `--text-3` | `#5C6472` | Labels, decoration |
| `--accent` | `#37D399` | The **only** green: live, success, winner |
| `--amber` | `#F2B84B` | The **only** amber: money (prices, budget, payout) + countdown |
| `--danger` | `#E5695F` | Functional only: Refunded/Expired/demo banner (no decoration) |

Rules: no further color hues. Green ≠ money, amber = money. Use color areas sparingly; status is
communicated via dot + text, not full-color cards.

### 1a. Light variant (phase4.4, `data-theme="light"`)

Identical token names, values rotated; accents stay exactly the same (the green ≠ money rule holds
in both themes):

| Token | Value | Note |
|---|---|---|
| `--base` | `#FAFAF8` | Warm paper white |
| `--surface-1/2/3` | `#FFFFFF` / `#F3F2ED` / `#ECEBE4` | Cards and layers as in dark |
| `--hairline(-strong)` | `rgba(0,0,0,.08)` / `rgba(0,0,0,.14)` | Mirror of the dark hairlines |
| `--text-1/2/3` | `#14171C` / `#4A5262` / `#898F99` | Readability ≥ 4.5:1 on `--base` |
| `--cardsheen` | `rgba(0,0,0,.02)` | Card sheen rotated (was white .03) |
| `--glow-a/b` | `rgba(55,211,153,.07)` / `rgba(242,184,75,.06)` | Background glows raised for light |

Switching: toggle top right (default **dark**), choice persisted in `localStorage foreman-theme`,
deep link `?theme=light` overrides (screenshot/video friendly).

## 2. Type scale

Font: Inter (CDN rsms.me). Fallback stack: `Inter, "Inter var", "SF Pro Text", "Segoe UI", system-ui, sans-serif`.
Numbers always `font-variant-numeric: tabular-nums`; hashes/accounts `ui-monospace, "SF Mono", Menlo, monospace`.

| Step | Size / weight | Usage |
|---|---|---|
| display | clamp(26px, 2.2vw, 40px) / 650 | Job spec, brand word |
| number-lg | clamp(22px, 1.8vw, 32px) / 650 tabular | Budget, prices, payout, countdown ring |
| body | clamp(14px, 1.05vw, 18px) / 400–500 | Tables, text |
| label | 11px / 600, ls .12em, uppercase | Panel titles, field labels |

No serifs, no weight cascades above 700, line-height 1.45 (display 1.25).

## 3. Grid & density

8px grid: all pads/margins ∈ {8,16,24,32,40}. Cards: 24px pad, radius 12px, 1px hairline,
fading top highlight `linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)`.
Grid 12 columns, 16px gutter (2×8). Hierarchy: job panel 7/12 (dominant, display spec),
bid wall 7/12 below it (second weight, table height), right column 5/12: counter → receipt → result;
operations footer inline.

## 4. Motion

Transitions: 160ms ease-out (hover/focus/poll-data fade). LIVE pulse: 8px dot + expanding ring
(2s, ease-out, opacity 0.35→0, scale 1→2.4) — calm, no blinking. Countdown ring: stroke-dashoffset
linear, second tick without spring effects.
`@media (prefers-reduced-motion: reduce)`: all animations/transitions off (pulse → static dot).

## 5. Components

- **Status pill**: surface-3 pill, 6px color dot + label (text-2), hairline. States: Bidding/Open (accent), Awarded/Delivered (amber), Accepted (accent), Refunded/Expired (danger).
- **Countdown ring**: SVG 64px, 2px stroke surface-3 + amber progress, centered mm:ss tabular; closed → text-3 + `00:00`.
- **Bid row**: rank text-3; winner row: 2px accent left border + surface-2, inline SVG trophy (14px, accent) instead of emoji.
- **Hash box**: surface-2, ui-monospace 13px, radius 8, break-all.
- **Icons**: exclusively hand-written inline SVGs (16px, stroke 1.5, currentColor, no icon library, no external requests).
- **Links**: accent, underline only on hover.