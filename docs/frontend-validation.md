# Frontend validation and Better Interface review

Worker-side evidence for the `lab-daemon-sponsor` frontend (`web/`, export in `dist/`). This is the
worker's report, not an independent certification. Run on 2026-09-27 on the assignment worker
(Linux, Node 24.9.0, npm 11.6.0).

## 1. Scope and assumptions

- Product: one static page for `DaemonSponsorPool` (`0x6113b02eefeea3feffb1d3ede7ad2020d5b4d0bd`)
  and `LaunchToken` SPON (`0xacdd5b18610efdff1db8745f9a1c6f4afc377900`) on Sepolia (11155111),
  launch `3e90cff7-f2f1-4277-a32a-ed0765d86433`, source commit `bb5f06ad…`, attestation
  `7a199bee…`. Flows: connect / switch chain, approve + register, check in, approve + sponsor,
  list past epochs and claim, deregister with confirmation, withdraw bond, read-only launch-pool
  quote, contract links.
- Export: `dist/index.html`, `dist/assets/*` (one JS chunk of 611 KB, one CCIP chunk, one CSS
  file), `dist/abi/*.json`, `dist/imd-deployment.json`. Relative base, no routing, no fonts or
  images. Total assets 644,649 bytes.
- Inferred choices: light theme only; system font stack (nothing to download from a gateway);
  approvals for the exact amount rather than unlimited; deregistration confirmed inline rather
  than with a modal; the "Past epochs" table lists the latest 40 opened epochs; no in-page swap
  (per the approved workflow) but a live quote and pool details from the network's Uniswap v4
  addresses.
- Out of scope: swap or liquidity actions, WalletConnect (no project ID supplied; injected and
  EIP-6963 wallets only), dark mode, localisation.
- `DESIGN.md` is at `docs/DESIGN.md` because the assignment's write scope excludes the repository
  root.

## 2. Coverage (six domains)

| Domain | Status | Checked | Not verified |
| --- | --- | --- | --- |
| Accessibility | Checked | Native elements everywhere; landmarks (`header`, `main`, `footer`, labelled `section`s); one `h1` + `h2`s in order; every button/link/input has an accessible name (audit: 0 unnamed); label bound to the amount input, `aria-describedby` hint/error, `aria-invalid`; always-mounted `role="status"` region, errors as `role="alert"`; skip link first in tab order; 10 tab stops on the disconnected page, all with a visible 2 px ring (computed and screenshot); disabled reasons in visible text; spinner has no animation under `prefers-reduced-motion: reduce` (computed `animationName: none`); no targets under 24 px after the fix (audit at 320/768/1280 and connected) | Screen-reader session (VoiceOver/NVDA); automated axe/Lighthouse audit; native 200 % browser zoom (320 px reflow used only as the reflow proxy); forced-colors rendering; physical touch device |
| Layout | Checked | Auto-fit grid: 3 columns at 1280, 2 at 768, 1 at 320; no horizontal overflow at any width (`scrollWidth` check) and no element past the viewport except inside the intended table scroller; logical properties for inline spacing; buttons inset inside margins; 2× inter-/intra-group gaps | RTL mirror; widths other than 320/768/1280; 200 % zoom |
| Writing | Checked (source) | Verb-first labels (Approve…, Register worker, Check in to epoch #n, Sponsor…, Claim n SPON, Deregister…, Withdraw bond, Switch to Sepolia); confirmation repeats the consequence; errors say what to do next (`web/src/errors.ts`); sentence case throughout; empty states point forward; placeholder is an example, label is visible | — |
| Typography | Checked | Descending scale h1 24 px → h2 18 px → body 16 px → UI 14/13 px; unitless line-heights; tabular numerals on countdown, amounts and numeric columns; `overflow-wrap: anywhere` verified on 320 px with full addresses; inputs 16 px; `text-wrap: balance/pretty` | Rendering with the intended system font on macOS/Windows (review ran on Linux) |
| Colors | Checked | oklch primitives → semantic tokens; single accent; status ramps only where rendered; every rendered text/background pair measured in Chromium via a painted-pixel conversion (no estimates): minimum non-disabled 4.94:1, all ≥ 4.5:1 (large text ≥ 3:1); no color-only status | Pairs on states not reached in the walk (e.g. `.btn-danger:hover`); dark mode (none exists) |
| UI | Checked | Button states (default, hover under `@media (hover: hover)`, active scale 0.96, disabled, busy with spinner and label); transitions name exact properties, ≤ 150 ms; concentric radii; one filled action per step; icons are text glyphs with `aria-hidden` | Motion replay at 10 % speed in DevTools |

## 3. Findings and fixes

| # | Severity | Location | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | HIGH (misleading state after a consequential action) | `web/src/reads.ts` `readHistory` | In the browser walk, after a confirmed check-in that opened epoch 1, "Past epochs" still listed only epoch 0 and the epoch card said "Not opened yet": viem memoises `getBlockNumber` for the polling interval (12 s), so the post-transaction log scan stopped one block short | `getBlockNumber({ cacheTime: 0 })` | Re-run: all three epochs listed and the card shows "Open" immediately after the transaction (`desktop-history-claim.png`) |
| 2 | MEDIUM | `web/src/components/EpochCard.tsx` | Countdown compared the device clock with chain time; with the mock chain's clock it showed "Boundary reached" while the epoch had 23 h left | Snapshot now carries the latest block timestamp; countdown = chain time + elapsed since fetch | Re-run shows `23:00:00` for the mock epoch; live page shows the real remaining time |
| 3 | MEDIUM (writing: describe the action before confirming) | `web/src/components/HistoryCard.tsx` | Claim control read just "Claim" | Label is now "Claim 1,000 SPON" (amount from `claimable`) | Verified in the re-run (`claimLabel`) |
| 4 | LOW (hit area) | `web/src/styles.css` `.kv a` etc. | Standalone address links were 83×14 px (spacing exception applied, but small) | `inline-block` with 5 px vertical padding and negative margin | Audit reports 0 targets under 24 px |
| 5 | LOW (alignment) | `web/src/styles.css` `.kv > div` | After fix 4 the baseline alignment pushed labels below the first line of multi-line links | `align-items: start` | Verified in final screenshot |

No open findings remain in the reviewed states.

## 4. Verification

Commands (all run from `web/` unless noted; outputs abbreviated but real):

```text
npm install                       -> added 149 packages (lockfile committed; jsdom pinned to 26.x for Node 24.9)
npm run build                     -> gen ABI types (hashes match handoff) -> tsc (src+test, node config) OK
                                     -> vite build: index.html 0.66 kB, css 13.92 kB, js 611.08 kB (gzip 183 kB)
                                     -> wrote dist/imd-deployment.json: 2 contracts, 6 assets, 644,649 bytes
node scripts/verify-dist.mjs      -> verify-dist: OK (6 assets, 2 contracts)
npx vitest run                    -> Test Files 4 passed, Tests 27 passed
```

Vitest suites (`web/test/`): `deployment.test.ts` (manifest/ABI loading, tampered ABI rejected,
`wallet_addEthereumChain` parameters identical to `network.json.walletAddChain`, generated types in
sync); `units.test.ts` (formatting/parsing, epoch math incl. the README's 70/10/3 example,
switch→4902→add→switch sequence, chunked logs halving on RPC errors, error descriptions);
`manifest.test.ts` (committed `dist/` hashes, ABI canonical hashes, relative base);
`app.test.tsx` (mock EIP-1193 wallet + in-memory contract model: disconnected state with every
action disabled and reasons shown, invalid manifest refuses to start, cancelled connection,
wrong network with one switch control and exact add-chain params, approve→register→check in→second
check-in blocked→approve→sponsor, decoded `BondLocked` revert with no `eth_sendTransaction`, wallet
rejection, past-epoch listing from events, claim, deregister confirmation/cancel, withdraw after
unlock).

Browser review: one bounded foreground script (`test/scratch/review/review.ts`, bundled with Vite
and run with Node; Playwright 1.64.0-alpha from `/opt/pwmcp`, headless Chromium 154 revision 1246)
that served `dist/` under `http://127.0.0.1:<random>/preview/` for its own lifetime only. It was
run after the final build; screenshots describe the committed bytes.

- Live scenario (real Sepolia public RPCs, no wallet): viewports 1280×900, 768×900, 320×720.
  Console errors/warnings: 0. Failed requests or HTTP ≥ 400: 0. Horizontal overflow: none at any
  width. Contrast failures: 0 (minimum 4.94:1). Unnamed controls: 0. Tab walk: 10 stops, every stop
  with a visible 2 px ring. Live quote rendered (0.01 ETH ≈ 495,993 SPON; bond ≈ 0.00201 ETH).
  Screenshots: `docs/validation/desktop-1280-live.png`, `tablet-768-live.png`,
  `mobile-320-live.png`, `focus-ring.png`.
- Mock scenario (EIP-6963-announced mock wallet in the page, RPC intercepted and answered by the
  same TypeScript contract model as the unit tests; wallet starts on chain 1 without Sepolia):
  connect → single "Switch to Sepolia" → `wallet_switchEthereumChain` (4902) →
  `wallet_addEthereumChain` with exactly the vetted parameters → `wallet_switchEthereumChain`
  again → approve bond (busy state captured, spinner static under reduced motion) → register →
  check in → sponsor 7,000 → next epoch check in → claim 1,000 SPON → deregister (confirmation
  shown, cancel works) → locked withdraw reason → forced `BondLocked` revert shown without
  sending → wallet rejection shown → withdraw → register controls return → disconnect. Console
  errors: 0. Failed requests: 0. Contrast failures at 1280 and 320 connected: 0. Screenshots:
  `desktop-wrong-network.png`, `desktop-busy-wallet.png`, `desktop-history-claim.png`,
  `desktop-deregister-confirm.png`, `desktop-error-revert.png`, `mobile-320-connected.png`.

Live-chain reads performed during development (not transactions): `eth_chainId` on all three
RPCs = `0xaa36a7`; pool code non-empty; `genesis()` = 1790492508, `currentEpoch()` = 0,
`token()` = the handoff token address, `pool()` = 0; quoter `quoteExactInputSingle` and
`quoteExactOutputSingle` succeed against the launch pool (`0xad4a4641…`).

## 5. Completion

`Complete for the stated scope`, with these limitations, none of which was substituted by another
check:

- No real transaction was broadcast and no funded wallet was used; every write path was exercised
  only against the in-memory contract model (unit tests and browser walk). Live behaviour of
  MetaMask/Rabby prompts, gas estimation by the wallet, and Sepolia block timing are untested.
- The Vitest assertion for the connected state's quote is not applicable: the mock chain has no
  quoter, so the "Get SPON" card shows "Quote unavailable" in the mock screenshots; the live
  screenshot shows the real quote.
- Not performed: screen-reader session, automated axe/Lighthouse scan, native 200 % zoom, RTL,
  forced-colors rendering, physical touch device, DevTools motion replay, hover-state contrast on
  the danger button.
- The export was inspected under a `/preview/` subpath on a local server; IPFS gateway and ENS
  hosting were not exercised (publication is a later stage).
- The Vite 8 chunk-size warning (611 KB main chunk) is accepted: one page, one load, 183 KB
  gzipped, far below the checker budget.
