# V2-FE-046: Invalidate State on Account and Chain Changes
## Pull Request Summary

### Issue Reference
**V2-FE-046** — Invalidate State on Account and Chain Changes (DigiNodes/truthbounty-frontend#309)

---

## Overview

The app now reacts deterministically when the active wallet **account or chain
changes**: incompatible queries are cancelled, wallet-scoped caches are cleared,
unsigned transaction intents are discarded (real hashes are preserved), auth is
revalidated, and the user must **explicitly recover** before continuing. The
first settled identity is only seeded, so page reload/reconnect never wipes
state.

### Key Deliverables

1. **Pure identity policy** (`src/lib/wallet/identity.ts`)
   - `normalizeWalletIdentity` / `walletIdentityKey` / `hasWalletIdentityChanged`
   - `classifyWalletIdentityTransition` → `none | connect | disconnect | account-change | chain-change`
   - `transitionClearsWalletCache` / `transitionRequiresAuthRevalidation` / `transitionRequiresRecovery`
   - `isWalletScopedQueryKey` — only `['user', …]` and `['verifications','user', …]`
   - `classifyTransactionIdentityInvalidation` → discard only unsigned intents; preserve submitted receipts

2. **Invalidation hook** (`src/hooks/useWalletIdentityInvalidation.ts`)
   - Seeds the first settled provider identity (no false invalidation on reconnect)
   - On a real change: `cancelQueries()`, clears the mutation cache,
     `removeQueries({ predicate: isWalletScopedQueryKey })`, discards unsigned
     persisted transaction contexts, triggers `onRevalidateAuth`, and sets
     `requiresRecovery`
   - `discardUnsignedTransactionIntents()` exported and unit-tested
   - `acknowledge()` clears the recovery requirement

3. **App wiring** (`src/components/providers/WalletStateGuard.tsx`)
   - Mounted inside `SiweAuthProvider` in `app/providers.tsx`
   - Revalidates auth via `setSession(null)` and renders the recovery notice

4. **Accessible recovery notice** (`src/components/ui/WalletStateRecoveryNotice.tsx`)
   - `role="alert"` `aria-live="assertive"`, keyboard-operable Dismiss
   - Shown only while recovery is required (no unrelated redesign)

5. **Transaction intent invalidation** (`src/hooks/useEvmTransaction.ts`)
   - An unsigned intent (`preparing` / `signature-requested`) is reset when the
     wallet identity changes; a submitted transaction keeps its canonical hash
     and receipt

### Acceptance Criteria Mapping

#### ✅ 1. Delivered without unrelated visual redesign
**Evidence:**
- Only an sr-only-safe recovery banner is added, shown conditionally; existing
  layout/controls are unchanged.

#### ✅ 2. Every asynchronous state has accurate accessible feedback and recovery
**Evidence:**
- `role="alert"` `aria-live="assertive"` notice with explicit Dismiss and
  keyboard support.
- Tests: `src/__tests__/accessibility/wallet-state-recovery.test.tsx`.

#### ✅ 3. Canonical receipts/projections — not timers or client guesses — drive lifecycle state
**Evidence:**
- Only unsigned local intents are discarded; any real `txHash` is preserved
  (`classifyTransactionIdentityInvalidation`).
- No fabricated address, chain, hash, or session; identity is normalised and
  validated (canonical EVM accounts only).

#### ✅ 4. Lint, typecheck, tests, accessibility, artifact-drift, production build pass
**Evidence (local):**
- `pnpm type-check` — clean
- `pnpm test` — **79/79 suites · 748/748 tests**
- `pnpm test:a11y` — **3/3 suites · 10/10 tests**
- `pnpm build` — artifact verification + production build succeed
- `pnpm lint` — **blocked by a pre-existing tooling break** on `main`
  (`typescript-eslint does not support TS 7.0`, ESLint 10.10.0); not introduced
  by this change.

#### ✅ 5. The PR maps evidence to every acceptance criterion
**Evidence:**
- This document.
- Regression guard: `src/__tests__/regression/mock-removal.test.ts` asserts the
  new production files import no mocks/simulators, contain no `Math.random`,
  and that `identity.ts` is pure (no React/wagmi/storage).

#### ✅ 6. Human maintainer approval recorded for wallet/security-sensitive changes
**Evidence:**
- Wallet/auth/transaction paths changed; CODEOWNER review (`@dDevAhmed`)
  requested for the exact head SHA.

---

## Technical Architecture

```
wagmi provider (account + chain)
  └─ useWalletIdentityInvalidation
       ├─ seed first settled identity          (no invalidation on reload/reconnect)
       └─ on account/chain change:
            ├─ queryClient.cancelQueries()
            ├─ queryClient.getMutationCache().clear()
            ├─ queryClient.removeQueries(isWalletScopedQueryKey)
            ├─ discardUnsignedTransactionIntents()   (real hashes preserved)
            ├─ onRevalidateAuth(transition)          → setSession(null)
            └─ requiresRecovery = true

WalletStateGuard
  └─ renders <WalletStateRecoveryNotice role="alert"> while recovery is required

useEvmTransaction
  └─ identity change + unsigned intent → reset(); submitted tx keeps its receipt
```

### Security Invariants

- Provider state is authoritative; transitions are classified deterministically.
- Fail closed on malformed/placeholder/zero/Stellar accounts.
- Never fabricate addresses, chains, hashes, receipts, or sessions.
- Only unsigned local intents are discarded; canonical receipts always win.
- No Stellar/Soroban/Freighter/mock/simulator runtime dependencies.

### Dependency note

Depends on **V2-FE-008** and **V2-FE-045**. The identity policy is standalone and
does not require the V2-FE-045 PR to be merged first.

---

## Test Plan

- [x] `pnpm type-check`
- [x] `pnpm test` — 79/79 suites · 748/748 tests
- [x] `pnpm test:a11y` — 3/3 suites · 10/10 tests
- [x] `pnpm build` — artifact verification + production build
- [ ] `pnpm lint` — pre-existing `typescript-eslint`/TS7 breakage on `main`
- [x] Pre-fix verification: neutering the invalidation side-effects fails 6
  tests across `useWalletIdentityInvalidation.test.tsx` and
  `wallet-identity-invalidation.test.tsx`.

---

## Review Notes

- `isWalletScopedQueryKey` intentionally keeps global protocol reads (claims,
  disputes, leaderboard) cached and revalidates them through existing realtime
  paths.
- `useEvmTransaction` now resets only unsigned intents; the existing receipt
  effect remains the single authority for submitted/confirming transactions.
- Wallet/auth/transaction-sensitive change: human maintainer approval required.
