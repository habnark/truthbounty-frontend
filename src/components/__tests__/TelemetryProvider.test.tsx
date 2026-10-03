/**
 * Tests for src/components/providers/TelemetryProvider.tsx
 *
 * V2-FE-149 — Privacy-Safe Error and Incident Telemetry
 *
 * Coverage:
 *  - Renders children without error
 *  - Provides context with correct isEnabled when flag is on/off
 *  - useTelemetryContext returns a disabled client outside provider
 *  - Accessibility: no axe violations
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { TelemetryProvider, useTelemetryContext } from '@/components/providers/TelemetryProvider'
import type { TelemetryEvent } from '@/lib/telemetry'
import { _resetTelemetryClient } from '@/lib/telemetry'

expect.extend(toHaveNoViolations)

// ---------------------------------------------------------------------------
// Mock FeatureFlagProvider
// ---------------------------------------------------------------------------

// We control the flag value via this variable
let mockFlagEnabled = true

jest.mock('@/components/providers/FeatureFlagProvider', () => ({
  useFeatureFlags: () => ({
    isEnabled: (flag: string) => {
      if (flag === 'PRIVACY_SAFE_TELEMETRY') return mockFlagEnabled
      return false
    },
    flags: {},
    setFlag: jest.fn(),
    setFlags: jest.fn(),
    resetFlag: jest.fn(),
    resetAllFlags: jest.fn(),
    getFlagMetadata: jest.fn(),
    getAllFlags: jest.fn(() => []),
    hasOverrides: false,
  }),
  FeatureFlagProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FeatureFlagGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ---------------------------------------------------------------------------
// Helper wrapper
// ---------------------------------------------------------------------------

function Wrapper({
  children,
  transport,
}: {
  children: React.ReactNode
  transport?: (e: TelemetryEvent) => void
}) {
  return (
    <TelemetryProvider transport={transport}>
      {children}
    </TelemetryProvider>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelemetryProvider', () => {
  beforeEach(() => {
    _resetTelemetryClient()
    mockFlagEnabled = true
  })

  it('renders children', () => {
    render(
      <Wrapper>
        <span data-testid="child">Hello</span>
      </Wrapper>
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('provides an enabled client when PRIVACY_SAFE_TELEMETRY is true', () => {
    mockFlagEnabled = true
    const { result } = renderHook(() => useTelemetryContext(), {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    })
    expect(result.current.isEnabled).toBe(true)
    expect(result.current.client.isEnabled).toBe(true)
  })

  it('provides a disabled client when PRIVACY_SAFE_TELEMETRY is false', () => {
    mockFlagEnabled = false
    const { result } = renderHook(() => useTelemetryContext(), {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    })
    expect(result.current.isEnabled).toBe(false)
    expect(result.current.client.isEnabled).toBe(false)
  })

  it('forwards events to the provided transport when flag is enabled', () => {
    const events: TelemetryEvent[] = []
    const transport = jest.fn((e: TelemetryEvent) => events.push(e))

    const { result } = renderHook(() => useTelemetryContext(), {
      wrapper: ({ children }) => <Wrapper transport={transport}>{children}</Wrapper>,
    })

    result.current.client.captureError(new Error('test'))
    expect(transport).toHaveBeenCalledTimes(1)
    expect(events[0].category).toBe('ui_error')
  })

  it('does not call transport when flag is disabled', () => {
    mockFlagEnabled = false
    const transport = jest.fn()

    const { result } = renderHook(() => useTelemetryContext(), {
      wrapper: ({ children }) => <Wrapper transport={transport}>{children}</Wrapper>,
    })

    result.current.client.captureError(new Error('noop'))
    expect(transport).not.toHaveBeenCalled()
  })

  it('useTelemetryContext returns disabled client outside provider', () => {
    const { result } = renderHook(() => useTelemetryContext())
    expect(result.current.isEnabled).toBe(false)
    expect(result.current.client.isEnabled).toBe(false)
  })

  it('has no axe accessibility violations', async () => {
    const { container } = render(
      <Wrapper>
        <div>
          <h1>TruthBounty</h1>
          <p>Content under telemetry provider</p>
        </div>
      </Wrapper>
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('renders children correctly with multiple nested levels', () => {
    render(
      <Wrapper>
        <div>
          <div>
            <span data-testid="deep-child">Deep</span>
          </div>
        </div>
      </Wrapper>
    )
    expect(screen.getByTestId('deep-child')).toBeInTheDocument()
  })
})
