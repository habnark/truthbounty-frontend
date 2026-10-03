/**
 * Tests for src/hooks/useTelemetry.ts
 *
 * V2-FE-149 — Privacy-Safe Error and Incident Telemetry
 *
 * Coverage:
 *  - captureError and captureIncident forward to TelemetryClient
 *  - Disabled state produces no transport calls
 *  - PII in context/message never reaches transport
 *  - Hook functions are stable references
 *  - Falls back gracefully when rendered outside TelemetryProvider
 */

import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { useTelemetry } from '@/hooks/useTelemetry'
import {
  TelemetryClient,
  initialiseTelemetry,
  _resetTelemetryClient,
  type TelemetryEvent,
} from '@/lib/telemetry'
import { TelemetryContext } from '@/components/providers/TelemetryProvider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTransport(): { fn: jest.Mock; events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = []
  const fn = jest.fn((e: TelemetryEvent) => events.push(e))
  return { fn, events }
}

function makeContextWrapper(client: TelemetryClient, isEnabled: boolean) {
  return ({ children }: { children: React.ReactNode }) => (
    <TelemetryContext.Provider value={{ client, isEnabled }}>
      {children}
    </TelemetryContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTelemetry', () => {
  beforeEach(() => {
    _resetTelemetryClient()
  })

  describe('when telemetry is enabled (via context)', () => {
    it('captureError forwards to the client transport', () => {
      const { fn, events } = makeTransport()
      const client = new TelemetryClient({ enabled: true, transport: fn })
      const wrapper = makeContextWrapper(client, true)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureError(new Error('render failed'))
      })

      expect(fn).toHaveBeenCalledTimes(1)
      expect(events[0].category).toBe('ui_error')
      expect(events[0].severity).toBe('error')
    })

    it('captureIncident forwards to the client transport', () => {
      const { fn, events } = makeTransport()
      const client = new TelemetryClient({ enabled: true, transport: fn })
      const wrapper = makeContextWrapper(client, true)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureIncident('stale claim data detected')
      })

      expect(fn).toHaveBeenCalledTimes(1)
      expect(events[0].category).toBe('incident')
      expect(events[0].severity).toBe('warning')
    })

    it('isEnabled is true', () => {
      const client = new TelemetryClient({ enabled: true })
      const wrapper = makeContextWrapper(client, true)
      const { result } = renderHook(() => useTelemetry(), { wrapper })
      expect(result.current.isEnabled).toBe(true)
    })

    it('captureError accepts category and context overrides', () => {
      const { fn, events } = makeTransport()
      const client = new TelemetryClient({ enabled: true, transport: fn })
      const wrapper = makeContextWrapper(client, true)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureError(new Error('wallet rejected'), {
          category: 'wallet_error',
          severity: 'fatal',
          context: { action: 'submit_claim', chainId: 10 },
          errorCode: 'USER_REJECTED',
          chainId: 10,
        })
      })

      expect(events[0].category).toBe('wallet_error')
      expect(events[0].severity).toBe('fatal')
      expect(events[0].errorCode).toBe('USER_REJECTED')
      expect(events[0].chainId).toBe(10)
    })

    it('PII in context is redacted before transport', () => {
      const { fn, events } = makeTransport()
      const client = new TelemetryClient({ enabled: true, transport: fn })
      const wrapper = makeContextWrapper(client, true)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureError(new Error('error'), {
          context: {
            userAddress: '0xAbCd1234567890AbCd1234567890AbCd12345678',
            email: 'test@example.com',
          },
        })
      })

      const ctx = events[0].context as Record<string, unknown>
      expect(String(ctx.userAddress)).not.toContain('0xAbCd')
      expect(String(ctx.email)).not.toContain('test@example.com')
    })

    it('PII in incident message is redacted before transport', () => {
      const { fn, events } = makeTransport()
      const client = new TelemetryClient({ enabled: true, transport: fn })
      const wrapper = makeContextWrapper(client, true)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureIncident(
          'Address 0x1234567890123456789012345678901234567890 caused stale state'
        )
      })

      expect(events[0].message).not.toContain('0x1234567890123456789012345678901234567890')
    })
  })

  describe('when telemetry is disabled (via context)', () => {
    it('captureError does not call transport', () => {
      const { fn } = makeTransport()
      const client = new TelemetryClient({ enabled: false, transport: fn })
      const wrapper = makeContextWrapper(client, false)

      const { result } = renderHook(() => useTelemetry(), { wrapper })

      act(() => {
        result.current.captureError(new Error('ignored'))
        result.current.captureIncident('also ignored')
      })

      expect(fn).not.toHaveBeenCalled()
    })

    it('isEnabled is false', () => {
      const client = new TelemetryClient({ enabled: false })
      const wrapper = makeContextWrapper(client, false)
      const { result } = renderHook(() => useTelemetry(), { wrapper })
      expect(result.current.isEnabled).toBe(false)
    })
  })

  describe('fallback — no TelemetryProvider', () => {
    it('uses the singleton client and does not throw', () => {
      // No wrapper — falls back to singleton (disabled by default after reset)
      const { result } = renderHook(() => useTelemetry())
      expect(() => {
        act(() => {
          result.current.captureError(new Error('no provider'))
          result.current.captureIncident('no provider incident')
        })
      }).not.toThrow()
    })

    it('isEnabled reflects disabled singleton', () => {
      const { result } = renderHook(() => useTelemetry())
      expect(result.current.isEnabled).toBe(false)
    })

    it('uses an enabled singleton when one is initialised', () => {
      const { fn } = makeTransport()
      initialiseTelemetry({ enabled: true, transport: fn })

      const { result } = renderHook(() => useTelemetry())

      act(() => {
        result.current.captureError(new Error('from singleton'))
      })

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('hook stability', () => {
    it('captureError and captureIncident are stable references across renders', () => {
      const client = new TelemetryClient({ enabled: true })
      const wrapper = makeContextWrapper(client, true)

      const { result, rerender } = renderHook(() => useTelemetry(), { wrapper })

      const { captureError: ce1, captureIncident: ci1 } = result.current
      rerender()
      const { captureError: ce2, captureIncident: ci2 } = result.current

      expect(ce1).toBe(ce2)
      expect(ci1).toBe(ci2)
    })
  })
})
