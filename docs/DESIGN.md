# DESIGN.md — FOREMAN Biet-Board Design-System (phase4.3)

Massstab: Linear / Vercel Dashboard / Stripe. Kein Framework, kein Build-Step — handgeschriebenes CSS
auf Custom Properties; CDN ausschliesslich Fonts (mit vollwertigem System-Stack-Fallback für Offline-Video).

## 1. Farb-Tokens (dunkel)

| Token | Wert | Verwendung |
|---|---|---|
| `--base` | `#0A0C10` | Seitenhintergrund (Aera) |
| `--surface-1` | `#0E1116` | Karten |
| `--surface-2` | `#12161D` | Erhöhte Ebenen (Tabellenzeilen, Hash-Boxen) |
| `--surface-3` | `#171C25` | Hover/Chips |
| `--hairline` | `rgba(255,255,255,.06)` | Alle Borders (einzige Border-Art) |
| `--hairline-strong` | `rgba(255,255,255,.10)` | Tabellenkopf-Trenner |
| `--text-1` | `#F2F4F8` | Primärtext |
| `--text-2` | `#9AA3B2` | Sekundärtext |
| `--text-3` | `#5C6472` | Labels, Deko |
| `--accent` | `#37D399` | **EINziges** Grün: Live, Erfolg, Gewinner |
| `--amber` | `#F2B84B` | **EINziges** Amber: Geld (Preise, Budget, Payout) + Countdown |
| `--danger` | `#E5695F` | Nur funktional: Refunded/Expired/Demo-Banner (kein Decor) |

Regeln: Keine weiteren Buntnuancen. Grün≠Geld, Amber=Geld. Farbflächen sparsam, Status über Punkt+Text, nicht über Vollton-Karten.

### 1a. Light-Variante (phase4.4, `data-theme="light"`)

 identische Token-Namen, nur Werte gedreht; Akzente bleiben exakt gleich (Grün≠Geld-Regel gilt in beiden Themes):

| Token | Wert | Anmerkung |
|---|---|---|
| `--base` | `#FAFAF8` | warmes Papier-Weiß |
| `--surface-1/2/3` | `#FFFFFF` / `#F3F2ED` / `#ECEBE4` | Karten bzw. Ebenen wie dunkel |
| `--hairline(-strong)` | `rgba(0,0,0,.08)` / `rgba(0,0,0,.14)` | Spiegelung der Dunkel-Hairlines |
| `--text-1/2/3` | `#14171C` / `#4A5262` / `#898F99` | Lesbarkeit ≥ 4,5:1 auf `--base` |
| `--cardsheen` | `rgba(0,0,0,.02)` | Karten-Glanz gedreht (war weiß .03) |
| `--glow-a/b` | `rgba(55,211,153,.07)` / `rgba(242,184,75,.06)` | Hintergrund-Glows auf Hell angehoben |

Umschaltung: Toggle oben rechts (Default **dunkel**), Auswahl in `localStorage foreman-theme`, Deep-Link `?theme=light` übersteuert (Screenshot-/Video-tauglich).

## 2. Typo-Skala

Font: Inter (CDN rsms.me) Fallback-Stack: `Inter, "Inter var", "SF Pro Text", "Segoe UI", system-ui, sans-serif`.
Zahlen immer `font-variant-numeric: tabular-nums`; Hashes/Accounts `ui-monospace, "SF Mono", Menlo, monospace`.

| Stufe | Größe/gewicht | Verwendung |
|---|---|---|
| display | clamp(26px, 2.2vw, 40px) / 650 | Job-Spec, Markenwort |
| number-lg | clamp(22px, 1.8vw, 32px) / 650 tabular | Budget, Preise, Payout, Countdown-Ring |
| body | clamp(14px, 1.05vw, 18px) / 400–500 | Tabellen, Texte |
| label | 11px / 600, ls .12em, uppercase | Panel-Titel, Feldlabels |

Keine Serifen, keine Fettkaskaden über 700, Zeilenhöhe 1.45 (Display 1.25).

## 3. Raster & Dichte

8px-Grid: alle Pads/Margins ∈ {8,16,24,32,40}. Karten: 24px Pad, radius 12px, 1px Hairline,
schwindender Top-Highlight `linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)`.
Grid 12 Spalten, 16px Gutter (2×8). Hierarchie: Job-Panel 7/12 (dominant, display-Spec),
Bid-Wand 7/12 darunter (zweitgewichtig, Tabellenhöhe), rechte Spalte 5/12: Counter → Receipt → Ergebnis, Betriebs-Fusszeile inline.

## 4. Motion

Transitions: 160ms ease-out (hover/focus/Polldaten-Fade). LIVE-Puls: 8px-Punkt + expanding Ring
(2s, ease-out, opacity 0.35→0, scale 1→2.4) — ruhig, kein Blinken. Countdown-Ring: stroke-dashoffset
linear, Sekundentick ohne Spring-Effekte.
`@media (prefers-reduced-motion: reduce)`: alle Animationen/Transitions aus (Puls → statischer Punkt).

## 5. Komponenten

- **Status-Pill**: surface-3-Pille, 6px Farb-Punkt + Label (text-2), hairline. States: Bidding/Open (accent), Awarded/Delivered (amber), Accepted (accent), Refunded/Expired (danger).
- **Countdown-Ring**: SVG 64px, 2px stroke surface-3 + amber progress, zentrierte mm:ss tabular; geschlossen → text-3 + `00:00`.
- **Bid-Zeile**: Rang text-3, Gewinner-Zeile: 2px accent-Linksborder + surface-2, Inline-SVG-Trophäe (14px, accent) statt Emoji.
- **Hash-Box**: surface-2, ui-monospace 13px, radius 8, break-all.
- **Icons**: ausschliesslich handgeschriebene Inline-SVGs (16px, stroke 1.5, currentColor, keine Icon-Library, keine externen Requests).
- **Links**: accent, underline only on hover.
