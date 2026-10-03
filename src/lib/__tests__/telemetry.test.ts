/**
 * Unit tests for src/lib/telemetry.ts
 *
 * V2-FE-149 — Privacy-Safe Error and Incident Telemetry
 *
 * Coverage:
 *  - redactString: EVM addresses, private keys, signatures, JWTs, emails, secrets
 *  - sanitiseValue: primitives, objects, arrays, Error objects, circular refs, depth limit
 *  - buildEvent: correct shape, all fields redacted
 *  - TelemetryClient: captureError, captureIncident, disabled no-op, transport call
 *  - Singleton: initialiseTelemetry / getTelemetryClient
 */

import {
  redactString,
  sanitiseValue,
  buildEvent,
  TelemetryClient,
  initialiseTelemetry,
  getTelemetryClient,
  _resetTelemetryClient,
  REDACTION_RULES,
  type TelemetryEvent,
} from '@/lib/telemetry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTransport(): { fn: jest.Mock; events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = []
  const fn = jest.fn((e: TelemetryEvent) => {
    events.push(e)
  })
  return { fn, events }
}

// ---------------------------------------------------------------------------
// redactString
// ---------------------------------------------------------------------------

describe('redactString', () => {
  afterEach(() => {
    // reset lastIndex on all global patterns
    REDACTION_RULES.forEach((r) => { r.pattern.lastIndex = 0 })
  })

  it('redacts an EVM wallet address', () => {
    const input = 'Sender: 0x1234567890123456789012345678901234567890'
    const result = redactString(input)
    expect(result).not.toContain('0x1234567890123456789012345678901234567890')
    expect(result).toContain('[REDACTED_')
  })

  it('redacts a 64-char hex private key', () => {
    const key = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    const result = redactString(`key=${key}`)
    expect(result).not.toContain(key)
  })

  it('redacts a JWT bearer token', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const result = redactString(`Authorization: Bearer ${jwt}`)
    expect(result).not.toContain(jwt)
    expect(result).toContain('[REDACTED_TOKEN]')
  })

  it('redacts an email address', () => {
    const result = redactString('contact user@example.com now')
    expect(result).not.toContain('user@example.com')
    expect(result).toContain('[REDACTED_EMAIL]')
  })

  it('redacts password= pattern', () => {
    const result = redactString('password=supersecret123')
    expect(result).not.toContain('supersecret123')
    expect(result).toContain('[REDACTED_SECRET]')
  })

  it('redacts apikey= pattern', () => {
    const result = redactString('apikey=abc-123-xyz')
    expect(result).not.toContain('abc-123-xyz')
  })

  it('truncates strings longer than 512 chars after redaction', () => {
    const long = 'x'.repeat(600)
    const result = redactString(long)
    expect(result.length).toBeLessThanOrEqual(512 + '[truncated]'.length + 1)
    expect(result).toContain('[truncated]')
  })

  it('passes through safe strings unchanged', () => {
    const safe = 'Transaction submitted successfully'
    expect(redactString(safe)).toBe(safe)
  })

  it('applies extra redaction rules', () => {
    const result = redactString('claimId=abc123', [
      { label: '[REDACTED_CLAIM]', pattern: /claimId=[^\s]+/gi },
    ])
    expect(result).not.toContain('abc123')
    expect(result).toContain('[REDACTED_CLAIM]')
  })
})

// ---------------------------------------------------------------------------
// sanitiseValue
// ---------------------------------------------------------------------------

describe('sanitiseValue', () => {
  it('handles null and undefined', () => {
    expect(sanitiseValue(null)).toBeNull()
    expect(sanitiseValue(undefined)).toBe('[undefined]')
  })

  it('handles numbers and booleans', () => {
    expect(sanitiseValue(42)).toBe(42)
    expect(sanitiseValue(true)).toBe(true)
    expect(sanitiseValue(false)).toBe(false)
  })

  it('converts bigint to string with n suffix', () => {
    expect(sanitiseValue(BigInt(100))).toBe('100n')
  })

  it('replaces functions and symbols with type label', () => {
    expect(sanitiseValue(() => {})).toBe('[function]')
    expect(sanitiseValue(Symbol('test'))).toBe('[symbol]')
  })

  it('redacts strings inside objects', () => {
    const obj = { from: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', action: 'submit' }
    const result = sanitiseValue(obj) as Record<string, unknown>
    expect(result.from).toContain('[REDACTED_')
    expect(result.action).toBe('submit')
  })

  it('handles nested objects up to MAX_DEPTH', () => {
    // Build a deeply nested object
    let deep: Record<string, unknown> = { value: 'bottom' }
    for (let i = 0; i < 8; i++) {
      deep = { nested: deep }
    }
    const result = sanitiseValue(deep)
    // Should not throw and should contain the depth exceeded sentinel somewhere
    expect(JSON.stringify(result)).toContain('MaxDepthExceeded')
  })

  it('caps arrays at 20 items', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i)
    const result = sanitiseValue(arr) as number[]
    expect(result).toHaveLength(20)
  })

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    expect(() => sanitiseValue(obj)).not.toThrow()
    const result = JSON.stringify(sanitiseValue(obj))
    expect(result).toContain('[Circular]')
  })

  it('sanitises Error objects without leaking stack in production', () => {
    const originalEnv = process.env.NODE_ENV
    // @ts-expect-error override for test
    process.env.NODE_ENV = 'production'
    try {
      const err = new Error('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef leaked in error')
      const result = sanitiseValue(err) as Record<string, unknown>
      expect(result.message).toContain('[REDACTED_')
      expect(result.stack).toBeUndefined()
    } finally {
      // @ts-expect-error override for test
      process.env.NODE_ENV = originalEnv
    }
  })
})

// ---------------------------------------------------------------------------
// buildEvent
// ---------------------------------------------------------------------------

describe('buildEvent', () => {
  it('returns a well-formed TelemetryEvent', () => {
    const event = buildEvent({
      severity: 'error',
      category: 'ui_error',
      message: 'Something broke',
    })

    expect(event.id).toMatch(/^tel-/)
    expect(event.severity).toBe('error')
    expect(event.category).toBe('ui_error')
    expect(event.message).toBe('Something broke')
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(event.context).toEqual({})
  })

  it('redacts message content', () => {
    const event = buildEvent({
      severity: 'error',
      category: 'wallet_error',
      message: 'Error for address 0x1234567890123456789012345678901234567890',
    })
    expect(event.message).not.toContain('0x1234567890123456789012345678901234567890')
  })

  it('includes errorName from Error object', () => {
    const err = new TypeError('bad type')
    const event = buildEvent({ severity: 'error', category: 'ui_error', message: err.message, error: err })
    expect(event.errorName).toBe('TypeError')
  })

  it('includes chainId and errorCode', () => {
    const event = buildEvent({
      severity: 'warning',
      category: 'chain_error',
      message: 'Wrong chain',
      chainId: 10,
      errorCode: 'WRONG_CHAIN',
    })
    expect(event.chainId).toBe(10)
    expect(event.errorCode).toBe('WRONG_CHAIN')
  })

  it('generates unique IDs for successive events', () => {
    const ids = Array.from({ length: 5 }, () =>
      buildEvent({ severity: 'info', category: 'custom', message: 'ping' }).id
    )
    const unique = new Set(ids)
    expect(unique.size).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// TelemetryClient
// ---------------------------------------------------------------------------

describe('TelemetryClient', () => {
  it('calls transport when enabled', () => {
    const { fn, events } = makeTransport()
    const client = new TelemetryClient({ enabled: true, transport: fn })
    client.captureError(new Error('boom'))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(events[0].severity).toBe('error')
    expect(events[0].category).toBe('ui_error')
  })

  it('does NOT call transport when disabled', () => {
    const { fn } = makeTransport()
    const client = new TelemetryClient({ enabled: false, transport: fn })
    client.captureError(new Error('boom'))
    client.captureIncident('something happened')
    expect(fn).not.toHaveBeenCalled()
  })

  it('captureIncident sends correct default category and severity', () => {
    const { fn, events } = makeTransport()
    const client = new TelemetryClient({ enabled: true, transport: fn })
    client.captureIncident('stale data detected')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(events[0].category).toBe('incident')
    expect(events[0].severity).toBe('warning')
  })

  it('captureError redacts wallet address from context', () => {
    const { fn, events } = makeTransport()
    const client = new TelemetryClient({ enabled: true, transport: fn })
    client.captureError(new Error('failed'), {
      context: { user: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12' },
    })
    const ctx = events[0].context as Record<string, unknown>
    expect(String(ctx.user)).not.toContain('0xAbCdEf')
  })

  it('never throws when transport throws', () => {
    const client = new TelemetryClient({
      enabled: true,
      transport: () => { throw new Error('transport failed') },
    })
    expect(() => client.captureError(new Error('test'))).not.toThrow()
    expect(() => client.captureIncident('test')).not.toThrow()
  })

  it('never throws when given a non-Error error shape', () => {
    const { fn } = makeTransport()
    const client = new TelemetryClient({ enabled: true, transport: fn })
    // Calling with wrong type at runtime should not throw
    expect(() => client.captureError('not-an-error' as unknown as Error)).not.toThrow()
  })

  it('isEnabled reflects config', () => {
    expect(new TelemetryClient({ enabled: true }).isEnabled).toBe(true)
    expect(new TelemetryClient({ enabled: false }).isEnabled).toBe(false)
  })

  it('flush resolves without error', async () => {
    const client = new TelemetryClient({ enabled: true })
    await expect(client.flush()).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('Singleton: initialiseTelemetry / getTelemetryClient', () => {
  beforeEach(() => {
    _resetTelemetryClient()
  })

  it('getTelemetryClient returns a disabled client when not initialised', () => {
    const client = getTelemetryClient()
    expect(client.isEnabled).toBe(false)
  })

  it('initialiseTelemetry sets the singleton', () => {
    const { fn } = makeTransport()
    initialiseTelemetry({ enabled: true, transport: fn })
    const client = getTelemetryClient()
    expect(client.isEnabled).toBe(true)
    client.captureError(new Error('hi'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('initialiseTelemetry replaces a previous singleton', () => {
    const { fn: fn1 } = makeTransport()
    const { fn: fn2 } = makeTransport()
    initialiseTelemetry({ enabled: true, transport: fn1 })
    initialiseTelemetry({ enabled: true, transport: fn2 })
    getTelemetryClient().captureError(new Error('test'))
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).toHaveBeenCalledTimes(1)
  })
})
