# Privacy-Safe Error and Incident Telemetry

> V2-FE-149 — TruthBounty Frontend

---

## Overview

TruthBounty ships a first-party telemetry layer that captures frontend errors and incidents for operational observability.  The system is built around a single non-negotiable constraint: **no personally-identifiable information (PII), wallet credentials, or secrets ever leave the client unredacted**.

Telemetry is **disabled by default**.  It must be explicitly opted-in via the `PRIVACY_SAFE_TELEMETRY` feature flag.

---

## Architecture

```
Application code
     │
     ▼
useTelemetry hook         ← component-level capture API
     │
     ▼
TelemetryProvider         ← React context, reads feature flag, initialises client
     │
     ▼
TelemetryClient           ← sanitises every event before dispatch
     │
     ▼
Redaction pipeline        ← applies REDACTION_RULES to all string fields
     │
     ▼
Transport function        ← user-supplied (default: console.debug in dev / no-op in prod)
```

### Files

| Path | Purpose |
|------|---------|
| `src/lib/telemetry.ts` | Core library: redaction engine, event schema, client, singleton |
| `src/hooks/useTelemetry.ts` | React hook for component-level capture |
| `src/components/providers/TelemetryProvider.tsx` | React context provider |
| `src/components/common/ErrorBoundary.tsx` | Global error boundary (calls `captureError`) |
| `src/config/feature-flags.ts` | `PRIVACY_SAFE_TELEMETRY` flag declaration |

---

## Redaction Rules

Redaction is applied to **every string field** in every event before the transport is called.  Rules are applied in order:

| Rule | Pattern | Replacement |
|------|---------|-------------|
| EVM private key | 64-char hex string | `[REDACTED_PRIVATE_KEY]` |
| EVM wallet address | `0x` + 40-char hex | `[REDACTED_ADDRESS]` |
| Ethereum signature | `0x` + 130-char hex | `[REDACTED_SIGNATURE]` |
| BIP39 mnemonic | Common seed-phrase words | `[REDACTED_MNEMONIC]` |
| JWT / Bearer token | `eyJ...` three-part token | `[REDACTED_TOKEN]` |
| Email address | `user@domain.tld` | `[REDACTED_EMAIL]` |
| Secret key-value | `password=`, `apikey=`, `secret=`, etc. | `[REDACTED_SECRET]` |
| String truncation | Strings > 512 chars after redaction | Truncated with `…[truncated]` |

Stack traces are **never** included in production events.  In development they are included but also redacted.

---

## Enabling Telemetry

### Via environment variable (recommended for production)

Set the following in your `.env.local` or deployment environment:

```sh
NEXT_PUBLIC_FEATURE_PRIVACY_SAFE_TELEMETRY=true
```

### Via runtime feature flag toggle (development)

Open the feature flag panel (bottom-right of screen in development) and toggle `PRIVACY_SAFE_TELEMETRY`.

---

## Usage in Components

```tsx
import { useTelemetry } from '@/hooks/useTelemetry';

function ClaimSubmitButton() {
  const { captureError, captureIncident } = useTelemetry();

  async function handleSubmit() {
    try {
      await submitClaim(claimData);
    } catch (err) {
      captureError(err instanceof Error ? err : new Error(String(err)), {
        category: 'network_error',
        context: { action: 'submit_claim', claimId: claimData.id },
        chainId: 10,           // Canonical Optimism mainnet
        errorCode: 'SUBMIT_FAILED',
      });
    }
  }

  // Capture operational incidents (non-error events)
  function handleStaleData() {
    captureIncident('Stale claim data detected after reconciliation', {
      category: 'incident',
      severity: 'warning',
      context: { claimId: '…', staleSince: Date.now() },
    });
  }
  // …
}
```

Both functions are **safe to call unconditionally** — they silently no-op when telemetry is disabled, and they never throw.

---

## Event Schema

```ts
interface TelemetryEvent {
  id: string;           // 'tel-{timestamp}-{counter}'
  timestamp: string;    // ISO-8601
  severity: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  category:
    | 'ui_error' | 'boundary_error' | 'network_error'
    | 'chain_error' | 'wallet_error' | 'incident'
    | 'performance' | 'custom';
  message: string;      // Redacted
  context: Record<string, unknown>; // Redacted recursively
  errorName?: string;   // Error.name, redacted
  errorCode?: string;   // Application-level code (safe)
  release?: string;     // NEXT_PUBLIC_PROTOCOL_RELEASE (safe)
  chainId?: number;     // Canonical chain ID (safe)
}
```

---

## Custom Transport (e.g. Sentry)

Pass a `transport` prop to `TelemetryProvider` to forward redacted events to a third-party service:

```tsx
// src/app/providers.tsx
import * as Sentry from '@sentry/nextjs';

<TelemetryProvider
  transport={(event) =>
    Sentry.captureEvent({
      message: event.message,
      level: event.severity as Sentry.SeverityLevel,
      tags: { category: event.category, errorCode: event.errorCode ?? '' },
      extra: event.context,
    })
  }
>
  {children}
</TelemetryProvider>
```

The transport receives an **already-redacted** event.  It is called asynchronously and transport errors are silently swallowed to prevent telemetry from disrupting the user experience.

---

## Adding Custom Redaction Rules

For domain-specific data that should never appear in telemetry, pass `customRedactionRules`:

```tsx
<TelemetryProvider
  customRedactionRules={[
    { label: '[REDACTED_CLAIM_ID]', pattern: /claim-[a-f0-9]{32}/gi },
  ]}
>
  {children}
</TelemetryProvider>
```

---

## Error Boundary Integration

`ErrorBoundary` automatically calls `getTelemetryClient().captureError(...)` in `componentDidCatch`.  No additional configuration is required.  When the `PRIVACY_SAFE_TELEMETRY` flag is disabled the call is a no-op.

---

## Security Guarantees

1. **No secrets in transit** — all string fields pass through the redaction pipeline before reaching the transport.
2. **No stack traces in production** — `Error.stack` is omitted from production events.
3. **No fabricated data** — telemetry only records what the application actually observed; it never generates synthetic hashes, addresses, or amounts.
4. **Opt-in only** — the client is initialised in disabled state; the feature flag must be explicitly activated.
5. **Transport isolation** — transport errors are caught and silently discarded; telemetry failures never propagate to users.
6. **Optimism/EVM only** — the library contains no Stellar, Soroana, or alternate-chain references.

---

## Tests

| File | What it covers |
|------|---------------|
| `src/lib/__tests__/telemetry.test.ts` | Redaction rules, sanitisation, event building, client, singleton |
| `src/hooks/__tests__/useTelemetry.test.ts` | Hook API, disabled state, PII redaction, stable references |
| `src/components/__tests__/TelemetryProvider.test.tsx` | Context provision, flag integration, transport wiring, axe a11y |

Run all telemetry tests:

```sh
pnpm test -- --testPathPattern=telemetry
```

---

## Privacy Commitment

This telemetry system is designed to comply with the principle of data minimisation:

- Only **operational** data (error names, categories, severity, non-identifying context) is transmitted.
- Wallet addresses, private keys, signatures, tokens, and email addresses are **structurally excluded** by the redaction pipeline.
- The feature is **off by default** and requires an affirmative configuration decision.

If you identify a case where PII could leak through the current redaction rules, please open a security issue with the label `security`.
