# V2-FE-140 — Frontend Threat Model

> **Scope:** TruthBounty frontend (Next.js 16, React 19, wagmi/viem, RainbowKit) on Optimism / EVM.
> **Authority model:** Smart contracts are authoritative for protocol mutation. The API is a projection/read layer. The frontend **never fabricates** protocol outcomes.
> **Status:** Published for independent maintainer review. See [§9 Review & Sign-off](#9-review--sign-off).

---

## 1. Purpose & Scope

This document publishes the TruthBounty **frontend** threat model as an independently reviewable V2 artifact. It defines:

- The trust boundaries between browser, wallet, chain, API, and contract.
- The threats considered in scope and the mitigations already implemented in this repo.
- The threats explicitly **out of scope** (protocol authority, alternate chains).
- The UI state model required for honest degradation (see [UI_STATE_MODEL.md](./UI_STATE_MODEL.md)).
- The telemetry redaction rules and where they live in code.
- The conditions under which the UI must **fail closed**.

**In scope:** browser-side integrity, wallet/provider interaction, transaction construction and lifecycle, projection accuracy, degraded-state behavior, telemetry hygiene.

**Out of scope (by design, per issue #408):**
- Smart contract logic, ABI, or deployment.
- Backend protocol authority or indexer correctness.
- Stellar / Soroban / Freighter / alternate-chain runtime support. **None shall be added.**
- Product redesign or unrelated feature work.

---

## 2. Assets & Trust Invariants

### 2.1 Assets the frontend must protect

| Asset | Description |
|---|---|
| **Calldata integrity** | The exact bytes the user signs must be what the user was shown. |
| **Wallet authority** | The connected account is the only signer; no shadow keys, no delegated signing. |
| **Chain identity** | Optimism mainnet or Optimism Sepolia; no silent chain substitution. |
| **Contract addresses** | Canonical addresses only; no placeholder or environment-injected overrides in production. |
| **Transaction lifecycle truth** | pending → submitted → confirmed → finalized → reorged must be reported truthfully. |
| **Settlement & reward truth** | Rewards, reputation, and settlement are shown only when the chain says so. |
| **Session material** | SIWE session material is short-lived, rotatable, and never logged. |
| **Evidence content** | IPFS evidence is untrusted content; rendered through the sanitizer only. |

### 2.2 Invariants (must always hold)

1. **INV-1:** The UI never displays a transaction as succeeded, settled, finalized, rewarded, or reputed unless the chain has confirmed it.
2. **INV-2:** The UI never constructs calldata that differs from what the canonical ABI would produce for the shown intent.
3. **INV-3:** The UI never signs or sends on an unsupported chain.
4. **INV-4:** The UI never renders untrusted HTML or evidence content without sanitization.
5. **INV-5:** The UI never emits secrets, private keys, signatures, long calldata, or bearer tokens into telemetry, logs, or DOM fallbacks.
6. **INV-6:** The UI never ships production mocks, placeholder addresses, secrets, or hidden admin bypasses.
7. **INV-7:** Missing critical configuration, missing CSP nonce, or unsupported chain results in a fail-closed UI, not degraded silent behavior.

---

## 3. Trust Boundaries
────┐
│ Browser │
│ ┌────────────┐ ┌────────────────┐ ┌─────────────────────────┐ │
│ │ App (React)│──▶│ Security boundary│──▶│ Contract reads (viem) │ │
│ └────────────┘ │ IntegrityBoundary│ └─────────────────────────┘ │
│ │ └────────────────┘ │ │
│ ▼ ▼ │
│ ┌────────────┐ ┌────────────────┐ ┌─────────────────────────┐ │
│ │ API client │ │ Wallet (wagmi) │ │ Telemetry (redacted) │ │
│ └────────────┘ └────────────────┘ └─────────────────────────┘ │
└─────────┬──────────────────┬──────────────────┬────────────────────┘
│ │ │
▼ ▼ ▼
┌────────┐ ┌─────────┐ ┌──────────────┐
│ API │ │ Wallet │ │ Optimism RPC │
│(project)│ │(signer) │ │ + Contracts │
└────────┘ └─────────┘ └──────────────┘


### 3.1 Boundaries and what crosses them

| # | Boundary | What crosses | Trust |
|---|---|---|---|
| TB-1 | App ↔ Wallet | tx request, signing intent, account, chainId | Wallet is authoritative signer; app must never fabricate |
| TB-2 | App ↔ Chain (RPC) | reads, simulations, receipts, logs | RPC may lie or lag; app must reconcile & show uncertainty |
| TB-3 | App ↔ API | projections (claims, rewards, reputation) | API is a **projection**, never authoritative for mutation |
| TB-4 | App ↔ IPFS | evidence content | Untrusted content; sanitize before render |
| TB-5 | App ↔ Browser storage | SIWE session material | Approved boundary only (`session-store.ts`); rotatable |
| TB-6 | App ↔ Telemetry | errors, diagnostics | Redaction is mandatory before emit |
| TB-7 | App ↔ Build/CI | env vars, build flags | Fail closed on missing critical config |

---

## 4. Threat Actors

| Actor | Capability | Motivated by |
|---|---|---|
| **Malicious RPC** | Return stale, reordered, or fabricated reads/receipts | Trick user into false success |
| **Malicious API** | Return stale or fabricated projections | Reputation/reward confusion |
| **Compromised browser extension** | Observe keystrokes, session storage, DOM | Session theft, UI manipulation |
| **Malicious evidence uploader** | Submit IPFS content with script or phishing | XSS, redirect, wallet drain |
| **Network attacker (MITM)** | Downgrade, replay, inject responses | Signature/calldata substitution |
| **Sybil / low-trust user** | Repeated low-quality actions | Reputation/reward farming |
| **Compromised dependency** | Postinstall scripts, runtime tampering | Supply-chain injection |
| **Insider / accidental** | Ship placeholder address, mock, secret | Production integrity loss |

---

## 5. Threats & Mitigations

| ID | Threat | Mitigation | Where |
|---|---|---|---|
| T-01 | Fabricated success (UI shows success without chain confirmation) | Transaction machine requires confirmed/finalized receipt before success | `useTransactionMachine.ts`, `useReceiptProjection.ts`, `useSettlementDetection.ts`, `useFinalizationDetection.ts` |
| T-02 | Reorged state shown as final | Reorg reconciliation reconciles logs/receipts with reorg detection | `useReorgReconciliation.ts`, `useStateReconciliation.ts` |
| T-03 | Calldata substitution between display and signing | Canonical ABI/address artifacts only; simulation before submit | `docs/CONTRACT_ARTIFACTS.md`, `useWriteReadiness.ts`, `useEvmTransaction.ts` |
| T-04 | Unsupported chain accepted silently | `isSupportedChain` gate; fail-closed boundary | `src/config/wagmi.ts`, `IntegrityBoundary.tsx` |
| T-05 | Missing critical config in production | Fail-closed UI with `role="alert"` | `IntegrityBoundary.tsx` |
| T-06 | XSS via untrusted evidence content | Evidence sanitizer; SafeExternalLink; CSP nonce | `src/lib/security/evidence-sanitizer.ts`, `SafeExternalLink.tsx`, `src/middleware.ts` |
| T-07 | Secret / signature / calldata leak into telemetry | Redaction module drops or masks sensitive keys, hex, bearer tokens | `src/lib/security/redaction.ts` |
| T-08 | SIWE replay / wrong account / wrong chain | Full SIWE error taxonomy; challenge vs wallet validation; session rotation | `docs/SIWE_AUTH.md`, `src/hooks/useSiweAuth.ts`, `src/lib/auth/siwe-client.ts` |
| T-09 | Sybil / low-trust account acting as high-trust | Trust indicators + Worldcoin ID gate | `src/components/security/*`, `useWorldcoinVerification.ts` |
| T-10 | CSP bypass via missing nonce | `buildContentSecurityPolicy` throws; middleware fail-closed | `docs/SECURITY_HEADERS.md`, `src/lib/security/headers.ts` |
| T-11 | Session storage leak | Approved boundary (`session-store.ts`); rotation; redaction of `session`-named keys | `src/lib/auth/session-store.ts`, `src/lib/security/redaction.ts` |
| T-12 | Shipping mocks / placeholders to production | Sensitive-path policy; PR security review; CI gates | `src/lib/security/sensitive-paths.ts`, `.github/workflows/pr-security-review.yml` |
| T-13 | Unsafe HTML in fallback error UI | No `dangerouslySetInnerHTML` on untrusted content; `SafeExternalLink` for outbound | `src/components/security/*` |
| T-14 | Stale critical data presented as fresh | React Query `staleTime` + explicit stale UI states | `src/app/queries/queryClient.ts`, `docs/UI_STATE_MODEL.md` |
| T-15 | Silent failure to reach chain | Network status hook + degraded UI | `useNetworkStatus.ts`, `useRpcFallback.ts` |

---

## 6. UI State Model (summary)

The **full state model** lives in [UI_STATE_MODEL.md](./UI_STATE_MODEL.md). The frontend must render **distinct, accessible, deterministic** UI for each of these:

| State | Meaning | Example surface |
|---|---|---|
| `loading` | Fetch or tx in flight, no data yet | Skeletons, spinners |
| `empty` | Fetch succeeded, no records | Empty state |
| `stale` | Data exists but is past its freshness bound | "Last updated" + refresh |
| `rejected` | User rejected in wallet | Non-error info banner |
| `failed` | Chain/API error, no fabrication | Error boundary / inline |
| `pending` | Submitted, awaiting inclusion | Tx status panel |
| `confirmed` | Included in a block, not yet final | "Confirming…" |
| `finalized` | Finalized per chain finality rules | "Settled" |
| `reorged` | Previously confirmed block reorged out | Reorg banner, state reconciled |

**Rule:** any surface that shows a transaction, reward, settlement, reputation, or protocol state **must** be able to render every state that applies to it, and never jump directly from `pending` to `finalized`.

---

## 7. Fail-Closed Posture

The frontend must **fail closed** (block the action, show a clear reason) when any of the following is true:

| Condition | Behavior |
|---|---|
| Missing `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in production | `IntegrityBoundary` renders `role="alert"` and blocks children |
| Connected chain not in `isSupportedChain` | `IntegrityBoundary` renders unsupported-network alert |
| Missing CSP nonce | `buildContentSecurityPolicy` throws; middleware aborts |
| Canonical artifact not resolved | Read/write surfaces disable; never substitute placeholders |
| Critical API data stale beyond threshold | Stale UI state; write actions gated |
| Wallet not connected / disconnected mid-flow | Tx surfaces disabled; recovery path shown |
| Simulation/receipt mismatch | Reject; do not show success |

---

## 8. Telemetry & Redaction Rules

Redaction is enforced by [`src/lib/security/redaction.ts`](../src/lib/security/redaction.ts). Rules:

- Optional analytics is disabled until the user explicitly grants consent. A missing, invalid, or unreadable choice fails closed; consent can be revoked and is synchronized across tabs.
- The only analytics event is a coarse page view. It excludes route identifiers, query strings, account and wallet data, evidence, API payloads, and transaction data.
- The event is dispatched locally only. There is no configured network sink or third-party analytics SDK; do not add one until the canonical `V2-FE-133` interface is available.
- **Sensitive keys** (case/format-insensitive, contains `token`, `secret`, `authorization`, `password`, `privatekey`, `apikey`, `cookie`, `session`) → `[REDACTED]`.
- **`*signature*` keys** with string value >10 chars → `[REDACTED]`.
- **`calldata` / `data` / `input` keys** with long `0x…` hex → `[REDACTED]`.
- **Standalone hex strings** `0x` + 64+ hex chars → `[REDACTED]`.
- **Bearer tokens** in error messages → `Bearer [REDACTED]`.
- **Non-plain objects** (RegExp, unknown prototypes) → `[REDACTED]`.
- **Depth > 50** → `[REDACTED]`.
- **Fail closed:** unknown shapes are redacted, not passed through.

**Rule:** every telemetry/error-reporter call site must use `redactForTelemetry` / `redactError` / `redactForErrorReporter`. No raw `console.error` of payloads in production.


The consent UI, state model, and local-only page-view contract are documented in [ANALYTICS_CONSENT.md](./ANALYTICS_CONSENT.md).


---

## 9. Review & Sign-off

This document is the authoritative frontend threat model for V2. Changes to wallet, signature, transaction, settlement, security, or CI-sensitive code require approval by an independent human maintainer on the exact head SHA, per `.github/workflows/pr-security-review.yml`.

| Role | Reviewer | SHA | Date |
|---|---|---|---|
| Frontend maintainer | _pending_ | _pending_ | _pending_ |
| Security reviewer | _pending_ | _pending_ | _pending_ |
| Accessibility reviewer (where relevant) | _pending_ | _pending_ | _pending_ |
| Protocol reviewer (where relevant) | _pending_ | _pending_ | _pending_ |

---

## 10. Non-Goals (explicit)

- No smart-contract or backend protocol authority changes.
- No alternate-chain runtime support (Stellar, Soroban, Freighter, etc.).
- No unrelated product redesign.
- No contributor activation before maintainers apply Stellar Wave.

---

## 11. References

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [UI_STATE_MODEL.md](./UI_STATE_MODEL.md)
- [SECURITY_HEADERS.md](./SECURITY_HEADERS.md)
- [SIWE_AUTH.md](./SIWE_AUTH.md)
- [CONTRACT_ARTIFACTS.md](./CONTRACT_ARTIFACTS.md)
- [`src/lib/security/redaction.ts`](../src/lib/security/redaction.ts)
- [`src/lib/security/sensitive-paths.ts`](../src/lib/security/sensitive-paths.ts)
- [`src/components/security/IntegrityBoundary.tsx`](../src/components/security/IntegrityBoundary.tsx)
- [`.github/workflows/pr-security-review.yml`](../.github/workflows/pr-security-review.yml)

