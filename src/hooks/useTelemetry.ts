/**
 * useTelemetry — React hook for privacy-safe error and incident reporting.
 *
 * V2-FE-149 — TruthBounty Frontend
 *
 * Usage:
 * ```tsx
 * const { captureError, captureIncident, isEnabled } = useTelemetry();
 *
 * try {
 *   await someOperation();
 * } catch (err) {
 *   captureError(err instanceof Error ? err : new Error(String(err)), {
 *     category: 'network_error',
 *     context: { action: 'submit_claim', chainId: 10 },
 *   });
 * }
 * ```
 *
 * The hook:
 *  - Sources the TelemetryClient from TelemetryContext (falls back to singleton).
 *  - Respects the PRIVACY_SAFE_TELEMETRY feature flag — both the context-level
 *    check (from TelemetryProvider) and the flag itself must be enabled for
 *    events to be sent.
 *  - Never throws.
 */

'use client';

import { useCallback, useContext } from 'react';
import { TelemetryContext } from '@/components/providers/TelemetryProvider';
import { getTelemetryClient } from '@/lib/telemetry';
import type { TelemetryCategory, TelemetrySeverity } from '@/lib/telemetry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CaptureErrorOptions {
  /** Broad category for routing/grouping. Defaults to 'ui_error'. */
  category?: TelemetryCategory;
  /** Severity override. Defaults to 'error'. */
  severity?: TelemetrySeverity;
  /** Additional sanitised context (e.g. action, component). */
  context?: Record<string, unknown>;
  /** Optional application-level error code. */
  errorCode?: string;
  /** Chain ID if the error is chain-specific. Must be canonical, never fabricated. */
  chainId?: number;
}

export interface CaptureIncidentOptions {
  /** Broad category for routing/grouping. Defaults to 'incident'. */
  category?: TelemetryCategory;
  /** Severity override. Defaults to 'warning'. */
  severity?: TelemetrySeverity;
  /** Additional sanitised context. */
  context?: Record<string, unknown>;
  /** Optional application-level error code. */
  errorCode?: string;
  /** Chain ID if the incident is chain-specific. */
  chainId?: number;
}

export interface UseTelemetryReturn {
  /**
   * Capture an Error object (e.g. from a catch block or error boundary).
   * Safe to call unconditionally — silently no-ops when telemetry is disabled.
   */
  captureError: (error: Error, options?: CaptureErrorOptions) => void;
  /**
   * Capture an ad-hoc incident message without an Error object.
   * Safe to call unconditionally — silently no-ops when telemetry is disabled.
   */
  captureIncident: (message: string, options?: CaptureIncidentOptions) => void;
  /** Whether telemetry is currently active (i.e. events will be forwarded). */
  isEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useTelemetry — provides `captureError` and `captureIncident` to any
 * component or hook.  Both functions are stable references (wrapped in
 * useCallback) so they are safe to include in dependency arrays.
 */
export function useTelemetry(): UseTelemetryReturn {
  // Prefer the client vended by TelemetryProvider; fall back to singleton.
  const ctx = useContext(TelemetryContext);
  const client = ctx?.client ?? getTelemetryClient();
  const isEnabled = ctx?.isEnabled ?? client.isEnabled;

  const captureError = useCallback(
    (error: Error, options: CaptureErrorOptions = {}) => {
      try {
        client.captureError(error, options);
      } catch {
        // useTelemetry must never throw
      }
    },
    [client]
  );

  const captureIncident = useCallback(
    (message: string, options: CaptureIncidentOptions = {}) => {
      try {
        client.captureIncident(message, options);
      } catch {
        // useTelemetry must never throw
      }
    },
    [client]
  );

  return { captureError, captureIncident, isEnabled };
}
