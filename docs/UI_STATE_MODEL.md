# V2-FE-140 — Frontend UI State Model

> **Companion to:** [THREAT_MODEL.md](./THREAT_MODEL.md)
> **Rule:** Every surface that shows a transaction, reward, settlement, reputation, or protocol state must render every applicable state below. **No surface may jump directly from `pending` to `finalized`.**

---

## 1. Purpose

This document defines the canonical, deterministic UI state model for the TruthBounty frontend. It exists so that:

- Uncertainty is **visible**, never hidden.
- Degraded states are **accessible**, **responsive**, and **recoverable**.
- The frontend **never fabricates** transaction success, settlement, rewards, reputation, or protocol state.

The state model is derived from the actual hooks in this repo (`useTransactionMachine`, `useReceiptProjection`, `useFinalizationDetection`, `useReorgReconciliation`, `useSettlementDetection`, `useStateReconciliation`) — it is not aspirational.

---

## 2. Canonical States

| # | State | Definition | User-visible meaning |
|---|---|---|---|
| 1 | `loading` | Fetch or transaction in flight; no result yet. | "Loading…" |
| 2 | `empty` | Fetch succeeded; no records. | "Nothing here yet." |
| 3 | `stale` | Data exists but is beyond its freshness bound. | "Last updated …" |
| 4 | `rejected` | User rejected in the wallet. | "You rejected the request." |
| 5 | `failed` | Chain/API error; no fabrication permitted. | "Something went wrong." |
| 6 | `pending` | Submitted to the mempool, awaiting inclusion. | "Pending confirmation…" |
| 7 | `confirmed` | Included in a block; not yet final. | "Confirming…" |
| 8 | `finalized` | Finalized per chain finality rules. | "Settled." |
| 9 | `reorged` | Previously confirmed block was reorged out. | "Chain reorganized; refreshing…" |

### 2.1 State transitions (transaction surfaces)

──────────┐
│ loading │
└────┬─────┘
│ (user submits)
▼
┌──────────▶ rejected (user rejected in wallet)
│
│ ┌──────────┐
└───────────│ pending │
└────┬─────┘
│ (included in block)
▼
┌───────────┐
│ confirmed │
└────┬──────┘
│ (finality reached)
▼
┌───────────┐
│ finalized │
└───────────┘
▲
│ (reorg detected)
│
┌───────────┐
│ reorged │ ──▶ (reconcile → back to pending/confirmed or failed)
└───────────┘

**Forbidden transitions:**
- `pending` → `finalized` (must go through `confirmed`)
- `failed` → `finalized`
- `reorged` → `finalized` without re-confirmation
- Any state → success without a receipt

### 2.2 State transitions (read surfaces)
loading → empty | data | stale | failed
data → stale | failed
stale → data (on successful refetch) | failed
failed → loading (on retry) | data (on recover)


---

## 3. State × Surface Matrix

Every user-facing surface that touches protocol state must support the applicable states.

| Surface | loading | empty | stale | rejected | failed | pending | confirmed | finalized | reorged |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Claim submission | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Claim list | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| Claim detail | ✅ | — | ✅ | — | ✅ | — | — | — | — |
| Verification submission | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dispute submission | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reward claim | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reputation | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| Leaderboard | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| Settlement | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wallet connect | ✅ | — | — | ✅ | ✅ | — | — | — | — |
| SIWE auth | ✅ | — | — | ✅ | ✅ | ✅ | ✅ | — | — |

**Legend:** ✅ required • — not applicable

### Canonical claim detail projection

The route-backed claim detail surface reads `GET /api/claims/:id` only through
the validated `ClaimDetailEnvelope` parser. A bare legacy claim response is
malformed and is never rendered as protocol state. The detail view exposes:

- `loading`: skeleton while the projection is requested;
- `ready`: validated claim and evidence with fresh projection metadata;
- `ready-stale`: validated content with an amber freshness warning and refresh
	action when the server reports `stale` or `degraded`;
- `not-found`: the canonical `404` state;
- `failed`: unavailable, malformed, or rebuilding projections with a retry;
- empty evidence: an honest “No evidence available” state. The client never
	inserts sample links, images, or testimony.

---

## 4. State Contract (per state)

Each state must satisfy:

| State | ARIA | Focus | Keyboard | Screen reader | Visual |
|---|---|---|---|---|---|
| `loading` | `role="status"` `aria-busy="true"` | Not stolen | No traps | "Loading…" announced | Skeleton / spinner |
| `empty` | `role="status"` | None | No traps | "No items" announced | Neutral illustration + CTA |
| `stale` | `role="status"` | Refresh control focusable | Refresh reachable | "Stale data" announced | Yellow banner + timestamp |
| `rejected` | `role="status"` (not `alert`) | Return focus to trigger | Esc to dismiss | "Rejected in wallet" | Non-error info banner |
| `failed` | `role="alert"` `aria-live="assertive"` | Move focus to error heading | Retry reachable | Error announced | Red banner + retry |
| `pending` | `role="status"` `aria-busy="true"` | Do not steal | Cancel reachable if supported | "Pending" announced | Progress indicator + tx hash |
| `confirmed` | `role="status"` | — | — | "Confirming" announced | Progress + confirmations |
| `finalized` | `role="status"` | — | — | "Settled" announced | Success state + explorer link |
| `reorged` | `role="alert"` | Move focus | Dismiss reachable | "Reorganized" announced | Amber banner + refresh |

**Reduced motion:** all non-essential animations disabled when `prefers-reduced-motion: reduce` (see `useReducedMotion.ts`).

---

## 5. Fail-Closed Triggers

A surface must **fail closed** (show `failed` or block action) when any of the following is true:

| Trigger | Resulting state | Evidence |
|---|---|---|
| Missing critical config in production | Fail-closed UI (`IntegrityBoundary`) | `IntegrityBoundary.tsx` |
| Unsupported chain | Fail-closed UI (`IntegrityBoundary`) | `IntegrityBoundary.tsx`, `config/wagmi.ts` |
| Missing CSP nonce | Build/middleware abort | `docs/SECURITY_HEADERS.md` |
| Canonical artifact unresolved | `failed` (no placeholder fallback) | `docs/CONTRACT_ARTIFACTS.md` |
| Simulation disagrees with receipt | `failed` | `useReceiptProjection.ts` |
| Reorg detected on previously confirmed tx | `reorged` | `useReorgReconciliation.ts` |
| Critical API data stale beyond threshold | `stale`, write actions gated | `useApiWithFallback.ts`, `useNetworkStatus.ts` |
| Wallet disconnected mid-flow | `rejected` / `failed` | `useCanonicalWallet.ts`, `useWallet.ts` |
| SIWE nonce expired / replayed | `rejected` (classified by `SiweFailureKind`) | `docs/SIWE_AUTH.md`, `useSiweAuth.ts` |

---

## 6. Recovery & Determinism

Every non-terminal state must be **recoverable** without a page reload:

| State | Recovery path |
|---|---|
| `loading` | Timeout → `failed` with retry |
| `stale` | Manual refresh; auto-refresh if enabled |
| `rejected` | Retry the action |
| `failed` | Retry; or navigate to safe surface |
| `pending` | Observe; support replacement/cancel where the chain allows |
| `confirmed` | Observe until `finalized` |
| `reorged` | Automatic reconciliation via `useReorgReconciliation` |

**Determinism:** given the same chain state and inputs, the UI must render the same state. Non-determinism (timers, animations) must not affect the state label.

---

## 7. Mapping to Code

| State | Primary source |
|---|---|
| `loading` | React Query `isLoading` / `isFetching` |
| `empty` | React Query result length === 0 |
| `stale` | React Query `isStale` / `dataUpdatedAt` vs freshness bound |
| `rejected` | wagmi `UserRejectedRequestError`; `SiweFailureKind.USER_REJECTED` |
| `failed` | Error boundary; hook error channels |
| `pending` | `useTransactionMachine.ts` |
| `confirmed` | `useReceiptProjection.ts`, `useFinalizationDetection.ts` |
| `finalized` | `useFinalizationDetection.ts` |
| `reorged` | `useReorgReconciliation.ts`, `useStateReconciliation.ts` |

---

## 8. Test Requirements

Per issue #408, the following must be covered in CI with no concealed skips:

- **Unit / component:** every state above renders its required ARIA, focus, and announcement contract.
- **Wallet/provider integration:** rejection, disconnect, account change, chain change, replacement, revert, finality.
- **Accessibility:** keyboard, focus, labels, announcements, contrast, reduced motion (see `docs/pr-a11y-wcag-aa.md`).
- **E2E:** against canonical mocks or staging that cannot leak into production bundles.

---

## 9. References

- [THREAT_MODEL.md](./THREAT_MODEL.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [SECURITY_HEADERS.md](./SECURITY_HEADERS.md)
- [SIWE_AUTH.md](./SIWE_AUTH.md)
- [pr-a11y-wcag-aa.md](./pr-a11y-wcag-aa.md)

