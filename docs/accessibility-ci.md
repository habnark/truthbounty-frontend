# Accessibility Standards & CI Enforcement Guide

## Overview

TruthBounty is a canonical client for the Optimism/EVM protocol. Because users interact with blockchain states, cryptographic transactions, and financial commitments, total clarity and accessibility across all UI states is a strict requirement.

This document defines the UI state model, ARIA live region conventions, keyboard navigation rules, reduced motion adaptations, and automated CI enforcement gates.

---

## Canonical UI State Model

The frontend manages 12 canonical UI states. Every status component and page flow must declare and render these states accessibly without ambiguity or concealed fallbacks:

| # | State | Description | ARIA Role | Live Region |
|---|---|---|---|---|
| 1 | `loading` | Data or transaction receipt is being fetched | `role="status"` | `polite` |
| 2 | `empty` | No items or transactions found | `role="status"` | `polite` |
| 3 | `stale` | Data projection age exceeds freshness limit | `role="status"` | `polite` |
| 4 | `rejected` | Transaction or claim rejected before submission | `role="status"` | `polite` |
| 5 | `failed` | Transaction reverted on-chain | `role="alert"` | `assertive` |
| 6 | `pending` | Transaction submitted, awaiting block inclusion | `role="status"` | `polite` |
| 7 | `confirming` | Included in block, awaiting required block confirmations | `role="status"` | `polite` |
| 8 | `confirmed-not-safe` | Confirmed in block but not yet finality-safe | `role="status"` | `polite` |
| 9 | `finalized` | Finalized on-chain and safe in canonical state | `role="status"` | `polite` |
| 10 | `reorged` | Chain reorg detected; reconciliation required | `role="alert"` | `assertive` |
| 11 | `unsupported-chain` | Connected wallet is on an unsupported EVM chain | `role="alert"` | `assertive` |
| 12 | `degraded-rpc` | Primary RPC endpoint unreachable; fallback active | `role="status"` | `polite` |

---

## Accessibility Principles & Requirements

### 1. Live Region & Screen Reader Announcements
- Use `role="status"` and `aria-live="polite"` for non-disruptive status changes (loading, pending, stale, empty, confirmed).
- Use `role="alert"` and `aria-live="assertive"` for critical failures (transaction revert, chain reorg, unsupported chain).
- Include descriptive hidden helper text (`<span class="sr-only">`) to explain state details when visual icons are used.

### 2. Keyboard & Focus Management
- Interactive action buttons (Retry, Reload, Acknowledge, Connect Wallet) must be focusable via `Tab` (`tabIndex={0}` or standard `<button>`).
- Disabled controls must explicitly communicate why they are disabled via `aria-disabled="true"` and `aria-describedby`.

### 3. Contrast Compliance
- All text and banner content must maintain at least WCAG AA 4.5:1 contrast ratio in both Light and Dark themes.

### 4. Reduced Motion Adaptations
- Animated indicators (spinners, pulse effects, shimmer skeletons) must respect `prefers-reduced-motion: reduce`.
- Use Tailwind CSS `motion-reduce:animate-none` or custom reduced motion wrappers (`MotionSafeStatus`) to disable active animations when requested by the user's OS settings.

---

## Automated CI Enforcement

Accessibility validation is enforced automatically at three levels in CI:

1. **Prebuild Gate (`npm run prebuild`)**:
   Runs `node scripts/verify-accessibility.mjs` before every production build. Fails the build if any concealed test skips exist or if canonical UI states lack coverage.

2. **Linter Gate (`npm run lint`)**:
   ESLint is configured with `eslint-plugin-jsx-a11y` recommended rules across all JSX files.

3. **CI Accessibility Job (`.github/workflows/ci.yml`)**:
   Executes `pnpm verify:accessibility` and `pnpm test:a11y` (axe-core WCAG AA battery) on every pull request and push to `main`.
