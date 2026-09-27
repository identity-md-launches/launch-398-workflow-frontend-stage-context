# DESIGN.md — Daemon Sponsor (lab-daemon-sponsor)

Design system of the frontend in `web/`, extracted from the final source (`web/src/styles.css`,
`web/src/components/ui.tsx`) and confirmed in a headless Chromium review of the built export
(`docs/frontend-validation.md`). This file lives in `docs/` because the frontend assignment's
write scope is `web/**`, `dist/**` and `docs/**`; a repository-root copy was not permitted.

## Overview

Audience: a Sepolia tester holding SPON who wants to bond a worker, check in daily, sponsor, and
claim. The page is a single-column-on-mobile, auto-fit grid of white cards on a cool near-white
page, with one calm blue accent, sentence-case copy and tabular numerals for every amount. The
hierarchy is: page title → card title → caption label → large numeric value → small hint. Density is
moderate (16 px body, 20 px card padding, 16 px gaps). Composition rule: every contract action is a
numbered step inside its card with the reason it is unavailable written beside the control; one
filled primary button per step, secondary bordered buttons for everything else, and a single
danger-outlined button for the one destructive action (deregister), which asks for inline
confirmation.

System-wide rules: tokens in `:root`, semantic tokens only in components, native elements
(`button`, `a`, `label`/`input`, `table`, `dl`), one live region for transaction progress. The
three-column arrangement at 1280 px is a consequence of the auto-fit grid, not a fixed layout.

## Colors

Notation: `oklch()`, light scheme only (`color-scheme: light`; no dark theme exists). Primitives
are named by hue, semantics by role; components reference only semantic tokens. Source:
`web/src/styles.css` lines 1–70.

| Role token | Value (primitive) | Use |
| --- | --- | --- |
| `--color-bg-page` | `--slate-50` = `oklch(0.985 0.004 250)` | body background |
| `--color-bg-surface` | `oklch(1 0 0)` | cards, buttons, inputs |
| `--color-bg-subtle` | `--slate-100` = `oklch(0.962 0.006 250)` | step panels, empty states, neutral badges, secondary hover |
| `--color-border` | `--slate-200` = `oklch(0.905 0.01 250)` | card and table hairlines |
| `--color-border-strong` | `--slate-300` = `oklch(0.82 0.014 250)` | button and input borders |
| `--color-text-primary` / `--color-text-heading` | `--slate-900` = `oklch(0.2 0.02 250)` | body, headings, values |
| `--color-text-secondary` | `--slate-500` = `oklch(0.52 0.02 250)` | captions, hints, reasons, descriptions |
| `--color-accent-solid` / `--color-accent-text` | `--blue-600` = `oklch(0.45 0.17 255)` | primary button fill, links |
| `--color-accent-hover` | `--blue-700` = `oklch(0.4 0.16 255)` | primary hover, link hover |
| `--color-on-accent` | `oklch(1 0 0)` | text on primary buttons |
| `--color-focus-ring` | `--blue-500` = `oklch(0.52 0.17 255)` | 2 px `:focus-visible` outline, 2 px offset |
| `--color-success-*` | green 100/300/700 | Registered, Checked in, Open, Claimed, chain pill, confirmed notice |
| `--color-warning-*` | amber 100/300/800 | Deregistered, Not checked in, wallet-rejection notice |
| `--color-danger-*`, `--color-danger-solid` | red 100/300/700, red 600 | errors, deregister button and confirmation, invalid input border |
| `--color-info-*` | sky 100/300 + `--slate-700` text | in-progress notice, "Current" badge |

Measured contrast (rendered, headless Chromium, `docs/frontend-validation.md`): the lowest
non-disabled pair is secondary text on the subtle panel at 4.94:1; secondary text on white 5.51:1;
white on the primary button 7.49:1; link blue on white 7.49:1; success text on its tint 7.13:1;
warning text on its tint 7.82:1; danger button text on white 8.48:1. Every measured pair meets
WCAG AA. Status is never color-only: badges carry words, notices carry a glyph and a title.

Do not add a second accent, a dark palette, or raw `oklch()` values inside components; add a role
token instead.

## Typography

Families (`--font-sans`, `--font-mono`): system stacks only, no font files are shipped —
`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
and `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`. The review
machine rendered the sans stack with its system font; the exact face varies by platform.

| Token | Size | Role | Weight / leading |
| --- | --- | --- | --- |
| `--text-title` | 1.5 rem | `h1` page title | 650, 1.2, letter-spacing −0.01em, `text-wrap: balance` |
| `--text-stat` | 1.375 rem | `.stat-value` amounts, epoch number, countdown | 600, 1.2, tabular numerals |
| `--text-heading` | 1.125 rem | `h2` card titles | 600, 1.2 |
| `--text-body` | 1 rem | body copy, inputs (stays 16 px on mobile) | 400, 1.5 |
| `--text-small` | 0.875 rem | buttons (600), descriptions, table cells, key-value lists, step titles (600) | 400–600, 1.5 |
| `--text-caption` | 0.8125 rem | stat labels (500, +0.01em), hints, reasons, badges (600), table headers (600) | 1.5 |

Rules in source: `font-variant-numeric: tabular-nums` on `.num`, numeric table columns, `time`
and the amount input; `overflow-wrap: anywhere` on `body` so addresses and hashes never overflow;
`text-wrap: pretty` on descriptions/hints; `white-space: nowrap` on badges and table cells (the
table scrolls inside `.table-wrap`); antialiasing set once on `html`; `-webkit-text-size-adjust:
100%`. Amounts are formatted from minor units without floating point (`web/src/format.ts`), up to
four decimals with a trailing `…` when truncated.

## Layout

- Content width `min(100% - 2rem, 68rem)` centred (`--content-max`), used by header, main and
  footer; backgrounds bleed, controls stay inside the margins.
- Spacing scale in 4 px steps: `--space-1` 0.25 rem … `--space-8` 2 rem. Intra-group gap 8 px
  (`.stat`, `.field`, `.step`), inter-group 16 px (`.card`, `.grid`, `.steps`), card padding 20 px
  (16 px under 40 rem).
- Card grid: `repeat(auto-fit, minmax(min(100%, 21rem), 1fr))`; the "Past epochs" card spans all
  columns (`.grid-full`). Observed: three columns at 1280 px, two at 768 px, one at 320 px, no
  horizontal overflow at any of them.
- Stats grid inside cards: `repeat(auto-fill, minmax(min(100%, 12rem), 1fr))`.
- Key-value lists (`.kv`): two columns `minmax(7rem, 9rem) 1fr`, collapsing to one column under
  40 rem; items aligned to the top.
- Single breakpoint `@media (max-width: 40rem)`: header padding tightens, wallet bar stretches
  full width and left-aligns, buttons and inputs grow to 2.75 rem (44 px) targets.
- Logical properties are used for direction-dependent spacing (`inset-inline-start`,
  `padding-inline`, `border-inline-end-color`); `text-align: start/end` in tables. RTL was not
  rendered.
- Skip link targets `#main`; cards have `scroll-margin-top` for the in-page `#get-spon` anchor.

## Elevation & Depth

Mostly flat. Cards use a 1 px `--color-border` plus one soft layered shadow `--shadow-card`
(`0 1px 2px oklch(0 0 0 / 0.04), 0 1px 3px oklch(0 0 0 / 0.06)`). Nothing else casts a shadow;
grouping inside cards is done with the subtle background (`.step`, `.empty`, `.confirm`) and
hairline separators only in the table and between action rows. No overlays or modals exist; the
deregister confirmation is inline.

## Shapes

`--radius-sm` 6 px (badges, inputs), `--radius-md` 8 px (buttons, notices, steps, empty states,
confirmation panel), `--radius-lg` 12 px (cards). Nested radii follow the outer = inner + padding
rule loosely (12 px card, 8 px panels inside 20 px padding). Borders are 1 px; the spinner is a 2 px
ring; the chain pill uses a filled dot as its status glyph.

## Components

All in `web/src/components/ui.tsx` unless noted; they are plain React components, not a
published library.

- **Button** (`.btn`, variants `btn-primary`, `btn-secondary`, `btn-danger`, prop `busy`): 40 px
  min height (44 px mobile), 14 px semibold label, `touch-action: manipulation`, 120 ms color
  transition, `scale(0.96)` on press (disabled under reduced motion), native `disabled` with
  0.55 opacity. `busy` renders a spinner beside the original label and sets `aria-busy`. The
  spinner only animates under `prefers-reduced-motion: no-preference`.
- **Card** (`.card`): `section` with `aria-labelledby` its `h2`, optional description.
- **Stat / StatList** (`dl.stats`, `.stat-label`, `.stat-value`, `.stat-hint`): caption, tabular
  value, small hint.
- **Badge** (`.badge-{success|warning|danger|info|neutral}`): word-carrying status chips.
- **Notice** (`.notice-{info|success|warning|danger}`, optional `role`): glyph, title, body; used
  for config errors, RPC errors and the token-address alert.
- **ActivityStatus** (`components/ActivityStatus.tsx`, `.activity`): always-mounted
  `role="status"` region for transaction phases (checking, confirm in wallet, sent, confirmed);
  errors render inside it with `role="alert"`; explorer link when a hash exists; Dismiss button.
- **Steps / Step** (`ol.steps`, `.step`, `.step-done`): numbered two-step approve → act pattern
  with a "Done" badge once the approval is sufficient.
- **Reason** (`.reason`): 13 px secondary text placed beside a disabled control explaining why.
- **Field** (`.field`, in `SponsorCard.tsx`): visible `label`, `inputmode="decimal"`,
  `aria-describedby` hint that turns into the error text with `aria-invalid` on blur.
- **WalletBar** (`components/WalletBar.tsx`): connect buttons per detected wallet, address link,
  `.chain-pill` or the single "Switch to Sepolia" primary button, Disconnect.
- **Table** (`.table-wrap > table.table`, in `HistoryCard.tsx`): `caption` (visually hidden),
  column and row headers, numeric columns end-aligned, horizontal scroll inside its wrapper.
- **Empty state** (`.empty`): title plus one sentence pointing to the next action.
- **Confirm** (`.confirm`): inline destructive confirmation with the consequence spelled out and
  "Deregister worker" / "Cancel".

Keyboard: every control is native; `:focus-visible` shows the 2 px accent ring with 2 px offset
(verified visible on the page and card backgrounds; on the primary button it reads as a ring
separated by the offset gap). Forced-colors mode swaps the ring to `Highlight`.

## Do's and Don'ts

- Do start a new surface as a `Card` inside `.grid`, with copy in sentence case and a verb-first
  button label.
- Do gate any new transaction control on the shared `Gate` (connected + right chain) and on the
  contract state, and write the reason in a `Reason` beside it; never rely on a tooltip on a
  disabled control.
- Do route every write through `useAction` so it is simulated, reported in `ActivityStatus`, and
  followed by a snapshot/history refetch.
- Do format amounts with `formatSpon`/`formatAmount` (bigint in, string out) and put them in
  `.num` or `.stat-value` for tabular digits.
- Don't add addresses, chain IDs, RPC URLs or ABIs anywhere except the generated
  `dist/imd-deployment.json`; read them from the `Deployment` object.
- Don't introduce a second accent hue, hex colors, a dark theme, or a modal; the system is
  single-accent, light-only and inline.
- Don't animate anything beyond opacity/color/scale on interaction, and keep it inside the
  reduced-motion guards already in `styles.css`.

Recipe for one more page or card: copy the `Card` + `StatList` skeleton from `EpochCard.tsx`,
read data through a `useQuery` in `hooks.ts` that takes the `PublicClient` from wagmi, add tokens
only in `:root`, and rerun `npm run build` so `dist/` and its manifest are regenerated.
