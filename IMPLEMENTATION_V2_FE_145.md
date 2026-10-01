# V2-FE-145: Enforce Accessibility in CI — Implementation Summary

## Issue Reference

**V2-FE-145** — Enforce Accessibility in CI as an independently reviewable V2 frontend work item.

## Objective

TruthBounty’s frontend is a user-facing client for the canonical Optimism/EVM protocol. This task strengthens automated validation and production release assurance by enforcing strict accessibility gates in CI, integrating ESLint `jsx-a11y` recommended rules, verifying 100% accessible UI state coverage across 12 canonical states, and binding accessibility verification into build preflights.

---

## Canonical UI State Model

| # | State | Component / Boundary | ARIA Announcement | Role |
|---|---|---|---|---|
| 1 | `loading` | `ActiveClaimsTableSkeleton`, `MotionSafeStatus` | `aria-live="polite"` | `status` |
| 2 | `empty` | `TransactionsList` (empty state) | `aria-live="polite"` | `status` |
| 3 | `stale` | `ApiStaleBanner` | `aria-live="polite"` | `status` |
| 4 | `rejected` | `TransactionItem` (rejected) | `aria-live="polite"` | `status` |
| 5 | `failed` | `TransactionStatus` (error), `ReorgBanner` (unresolved) | `aria-live="assertive"` | `alert` |
| 6 | `pending` | `TransactionStatus` (pending), `MotionSafeStatus` | `aria-live="polite"` | `status` |
| 7 | `confirming` | `StatusCard` (confirming), `TransactionItem` | `aria-live="polite"` | `status` |
| 8 | `confirmed-not-safe` | `TransactionItem` (confirming/not safe) | `aria-live="polite"` | `status` |
| 9 | `finalized` | `StatusCard` (confirmed), `MotionSafeStatus` | `aria-live="polite"` | `status` |
| 10 | `reorged` | `ReorgBanner` (reorg-detected) | `aria-live="assertive"` | `alert` |
| 11 | `unsupported-chain` | `FallbackBoundary` (blocked) | `aria-live="assertive"` | `alert` |
| 12 | `degraded-rpc` | `FallbackBoundary` (degraded) | `aria-live="polite"` | `status` |

---

## Key Changes

### 1. Automated CI Gate Script (`scripts/verify-accessibility.mjs`)
- Scans `src/__tests__/accessibility` to ensure 0 concealed test skips (`.skip`, `xit`, `xdescribe`).
- Verifies active coverage of all 12 canonical UI accessibility states.
- Scans `src/components` for proper ARIA live region declarations (`role="status"`, `role="alert"`, `aria-live`).
- Fails closed with exit code 1 if accessibility rules are violated.

### 2. Script Unit Test Suite (`scripts/__tests__/verify-accessibility.test.mjs`)
- Node test suite using `node:test` validating clean workspace execution and failure modes.

### 3. Prebuild & Package Scripts (`package.json`)
- Added `"verify:accessibility": "node scripts/verify-accessibility.mjs"`.
- Updated `"prebuild"` to run `verify-accessibility.mjs` alongside `verify-artifacts.mjs` and `verify-production-boundaries.mjs`.

### 4. CI Workflow Integration (`.github/workflows/ci.yml`)
- Updated the `accessibility` CI job to execute `pnpm verify:accessibility` prior to `pnpm test:a11y`.

### 5. ESLint `jsx-a11y` Integration (`eslint.config.mjs`)
- Integrated `eslint-plugin-jsx-a11y` recommended rules across all JSX component sources.

### 6. Integration Test Suite (`src/__tests__/accessibility/ci-accessibility-gate.test.tsx`)
- Added integration test suite testing state transitions, live regions, and axe-core compliance.

### 7. Documentation (`docs/accessibility-ci.md`)
- Documented canonical state model, ARIA live region conventions, keyboard navigation rules, reduced motion guidelines, and CI enforcement steps.

---

## Verification Matrix

| Gate | Command | Result |
|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc --noEmit` | PASS (0 errors) |
| Lint | `npm run lint` | PASS |
| Accessibility Script Tests | `node --test scripts/__tests__/verify-accessibility.test.mjs` | PASS (3/3) |
| Accessibility Verification Gate | `node scripts/verify-accessibility.mjs` | PASS |
| Accessibility Jest Battery | `node node_modules/jest-cli/bin/jest.js --runInBand src/__tests__/accessibility` | PASS (16 suites, 161 tests) |
| Prebuild | `npm run prebuild` | PASS |

---

## Non-Goals & Security Compliance

- No Stellar, Soroban, Freighter, or alternate-chain runtime code added.
- Optimism/EVM contract authority strictly preserved.
- No calldata, gas, reputation, or settlement outcomes fabricated.
- Fail-closed behavior enforced on unsupported chains.
