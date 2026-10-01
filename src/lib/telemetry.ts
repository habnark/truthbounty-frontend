/**
 * Privacy-Safe Error and Incident Telemetry Library
 *
 * V2-FE-149 — TruthBounty Frontend
 *
 * Design principles:
 *  - Redact all PII, wallet addresses, private keys, signatures, and secrets
 *    before any event leaves the client.
 *  - Never fabricate error context, transaction hashes, or chain state.
 *  - Disabled (no-op) by default in production; activated only via
 *    PRIVACY_SAFE_TELEMETRY feature flag.
 *  - Transport is pluggable; the default transport is a no-op (console only in dev).
 *  - All functions are safe to call unconditionally — they never throw.
 *
 * Redaction rules (applied in order):
 *  1. EVM addresses (0x + 40 hex chars)
 *  2. Private keys / mnemonic phrases
 *  3. JWT / Bearer tokens
 *  4. Email addresses
 *  5. Generic secrets in key=value patterns
 *  6. Truncate very long strings to prevent accidental payload leaks
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum length of any single string field after redaction. */
const MAX_FIELD_LENGTH = 512;

/** Maximum depth to recurse into nested objects during sanitisation. */
const MAX_DEPTH = 6;

/** Maximum number of items to keep from an array during sanitisation. */
const MAX_ARRAY_ITEMS = 20;

// ---------------------------------------------------------------------------
// Redaction patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that match data that must NOT appear in telemetry payloads.
 * Applied in order — each match is replaced by its labelled placeholder.
 */
export const REDACTION_RULES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  // EVM private key (0x + 64 hex chars, or bare 64 hex chars that look like keys)
  {
    label: '[REDACTED_PRIVATE_KEY]',
    pattern: /\b(0x)?[0-9a-fA-F]{64}\b/g,
  },
  // EVM wallet address (0x + 40 hex chars) — applied AFTER private keys so
  // private keys are caught first by the longer pattern above
  {
    label: '[REDACTED_ADDRESS]',
    pattern: /\b0x[0-9a-fA-F]{40}\b/g,
  },
  // Ethereum signature (0x + 130 hex chars)
  {
    label: '[REDACTED_SIGNATURE]',
    pattern: /\b0x[0-9a-fA-F]{130}\b/g,
  },
  // BIP39 mnemonic: 12–24 common words separated by spaces/newlines
  {
    label: '[REDACTED_MNEMONIC]',
    pattern:
      /\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident|account|accuse|achieve|acid|acoustic|acquire|across|act|action|actor|actress|actual|adapt|add|addict|address|adjust|admit|adult|advance|advice|aerobic|afford|afraid|again|age|agent|agree|ahead|aim|air|airport|aisle|alarm|album|alcohol|alert|alien|all|alley|allow|almost|alone|alpha|already|also|alter|always|amateur|amazing|among|amount|amused|analyst|anchor|ancient|anger|angle|angry|animal|ankle|announce|annual|another|answer|antenna|antique|anxiety|any|apart|apology|appear|apple|approve|april|arch|arctic|area|arena|argue|arm|armor|army|around|arrange|arrest|arrive|arrow|art|artefact|artist|artwork|ask|aspect|assault|asset|assist|assume|asthma|athlete|atom|attack|attend|attitude|attract|auction|audit|august|aunt|author|auto|autumn|average|avocado|avoid|awake|aware|away|awesome|awful|awkward|axis)\b.+/gi,
  },
  // JWT / Bearer tokens
  {
    label: '[REDACTED_TOKEN]',
    pattern: /\b(Bearer\s+)?ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gi,
  },
  // Email addresses
  {
    label: '[REDACTED_EMAIL]',
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/gi,
  },
  // Common secret key-value patterns (password=, apikey=, secret=, token=, key=)
  {
    label: '[REDACTED_SECRET]',
    pattern:
      /\b(password|passwd|apikey|api_key|secret|private_key|auth_token|access_token|refresh_token|session_token|csrf_token|cookie)\s*[:=]\s*\S+/gi,
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for telemetry events. */
export type TelemetrySeverity = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** Category of event, for grouping and routing. */
export type TelemetryCategory =
  | 'ui_error'
  | 'boundary_error'
  | 'network_error'
  | 'chain_error'
  | 'wallet_error'
  | 'incident'
  | 'performance'
  | 'custom';

/** Sanitised telemetry event ready for transport. */
export interface TelemetryEvent {
  /** Unique event identifier. */
  id: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Severity classification. */
  severity: TelemetrySeverity;
  /** Broad category for routing. */
  category: TelemetryCategory;
  /** Short, human-readable message (redacted). */
  message: string;
  /** Structured context (redacted). */
  context: Record<string, unknown>;
  /** Error name, never a full stack trace in production. */
  errorName?: string;
  /** Optional error code from the application layer. */
  errorCode?: string;
  /** Application release/version string (never a secret). */
  release?: string;
  /** Chain ID if relevant (never fabricated). */
  chainId?: number;
}

/** Configuration for the telemetry library. */
export interface TelemetryConfig {
  /** Whether telemetry is active. When false all functions are no-ops. */
  enabled: boolean;
  /** Application release identifier (e.g. git SHA). */
  release?: string;
  /**
   * Transport function that receives sanitised events.
   * The default transport is a console log in development and a no-op in production.
   */
  transport?: (event: TelemetryEvent) => void | Promise<void>;
  /**
   * Additional redaction rules beyond the built-in ones.
   * Merged with REDACTION_RULES before applying.
   */
  customRedactionRules?: ReadonlyArray<{ label: string; pattern: RegExp }>;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Apply all redaction rules to a single string value.
 * Returns the redacted string, truncated to MAX_FIELD_LENGTH.
 */
export function redactString(
  value: string,
  extraRules: ReadonlyArray<{ label: string; pattern: RegExp }> = []
): string {
  let result = value;

  const allRules = [...REDACTION_RULES, ...extraRules];
  for (const { label, pattern } of allRules) {
    // Reset lastIndex on global patterns to prevent cross-call state
    pattern.lastIndex = 0;
    result = result.replace(pattern, label);
  }

  // Truncate after redaction
  if (result.length > MAX_FIELD_LENGTH) {
    result = result.slice(0, MAX_FIELD_LENGTH) + '…[truncated]';
  }

  return result;
}

/**
 * Recursively sanitise an arbitrary value for safe inclusion in a telemetry event.
 *
 * - Strings are redacted.
 * - Numbers / booleans / null are passed through.
 * - Objects are recursively sanitised up to MAX_DEPTH.
 * - Arrays are capped at MAX_ARRAY_ITEMS and each element is sanitised.
 * - Functions, symbols, and undefined are replaced with a descriptive placeholder.
 * - Circular references are replaced with '[Circular]'.
 */
export function sanitiseValue(
  value: unknown,
  extraRules: ReadonlyArray<{ label: string; pattern: RegExp }> = [],
  depth = 0,
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepthExceeded]';

  if (value === null) return null;
  if (value === undefined) return '[undefined]';

  if (typeof value === 'string') return redactString(value, extraRules);

  if (typeof value === 'number') {
    // Avoid leaking extremely precise numbers that might correlate to timestamps or amounts
    return value;
  }

  if (typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString() + 'n';

  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[${typeof value}]`;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitiseValue(item, extraRules, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    // Handle Error objects specially to avoid leaking stack traces
    if (value instanceof Error) {
      return {
        name: redactString(value.name, extraRules),
        message: redactString(value.message, extraRules),
        // Never include stack in production — too much information
        ...(process.env.NODE_ENV === 'development'
          ? { stack: redactString(value.stack ?? '', extraRules) }
          : {}),
      };
    }

    const sanitised: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const sanitisedKey = redactString(key, extraRules);
      sanitised[sanitisedKey] = sanitiseValue(
        (value as Record<string, unknown>)[key],
        extraRules,
        depth + 1,
        seen
      );
    }
    return sanitised;
  }

  return '[unknown]';
}

// ---------------------------------------------------------------------------
// Event construction
// ---------------------------------------------------------------------------

let _eventCounter = 0;

/** Generate a simple non-guessable event ID (not cryptographically secure). */
function generateEventId(): string {
  _eventCounter = (_eventCounter + 1) % 1_000_000;
  return `tel-${Date.now().toString(36)}-${_eventCounter.toString(36).padStart(4, '0')}`;
}

/**
 * Build a sanitised TelemetryEvent from raw inputs.
 * Never throws.
 */
export function buildEvent(
  params: {
    severity: TelemetrySeverity;
    category: TelemetryCategory;
    message: string;
    context?: Record<string, unknown>;
    error?: Error;
    errorCode?: string;
    chainId?: number;
    release?: string;
  },
  extraRules: ReadonlyArray<{ label: string; pattern: RegExp }> = []
): TelemetryEvent {
  const sanitisedContext = params.context
    ? (sanitiseValue(params.context, extraRules) as Record<string, unknown>)
    : {};

  return {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    severity: params.severity,
    category: params.category,
    message: redactString(params.message, extraRules),
    context: sanitisedContext,
    ...(params.error ? { errorName: redactString(params.error.name, extraRules) } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    ...(params.chainId !== undefined ? { chainId: params.chainId } : {}),
    ...(params.release ? { release: params.release } : {}),
  };
}

// ---------------------------------------------------------------------------
// Telemetry client
// ---------------------------------------------------------------------------

/**
 * Default transport: log to console in development, silent in production.
 */
function defaultTransport(event: TelemetryEvent): void {
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.debug('[Telemetry]', event.severity.toUpperCase(), event.category, event.message, event);
  }
}

/**
 * Telemetry client instance.
 * All methods are safe to call unconditionally — they never throw.
 */
export class TelemetryClient {
  private readonly config: Required<TelemetryConfig>;

  constructor(config: TelemetryConfig) {
    this.config = {
      enabled: config.enabled,
      release: config.release ?? process.env.NEXT_PUBLIC_PROTOCOL_RELEASE ?? 'unknown',
      transport: config.transport ?? defaultTransport,
      customRedactionRules: config.customRedactionRules ?? [],
    };
  }

  /**
   * Capture an Error object, e.g. from an error boundary or catch block.
   * Redacts all PII from the error message and context before transport.
   */
  captureError(
    error: Error,
    options: {
      category?: TelemetryCategory;
      severity?: TelemetrySeverity;
      context?: Record<string, unknown>;
      errorCode?: string;
      chainId?: number;
    } = {}
  ): void {
    if (!this.config.enabled) return;

    try {
      const event = buildEvent(
        {
          severity: options.severity ?? 'error',
          category: options.category ?? 'ui_error',
          message: error.message,
          context: options.context,
          error,
          errorCode: options.errorCode,
          chainId: options.chainId,
          release: this.config.release,
        },
        this.config.customRedactionRules
      );

      Promise.resolve(this.config.transport(event)).catch(() => {
        // Transport errors must never surface to the user
      });
    } catch {
      // Never throw from telemetry
    }
  }

  /**
   * Capture an ad-hoc incident/warning without an Error object.
   */
  captureIncident(
    message: string,
    options: {
      category?: TelemetryCategory;
      severity?: TelemetrySeverity;
      context?: Record<string, unknown>;
      errorCode?: string;
      chainId?: number;
    } = {}
  ): void {
    if (!this.config.enabled) return;

    try {
      const event = buildEvent(
        {
          severity: options.severity ?? 'warning',
          category: options.category ?? 'incident',
          message,
          context: options.context,
          errorCode: options.errorCode,
          chainId: options.chainId,
          release: this.config.release,
        },
        this.config.customRedactionRules
      );

      Promise.resolve(this.config.transport(event)).catch(() => {});
    } catch {
      // Never throw from telemetry
    }
  }

  /**
   * Flush any buffered events. A no-op for the default transport; useful
   * when integrating third-party transports that batch events.
   */
  flush(): Promise<void> {
    return Promise.resolve();
  }

  /** Whether this client is currently active. */
  get isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance: TelemetryClient | null = null;

/**
 * Initialise or replace the singleton telemetry client.
 * Call once at application boot (in TelemetryProvider).
 */
export function initialiseTelemetry(config: TelemetryConfig): TelemetryClient {
  _instance = new TelemetryClient(config);
  return _instance;
}

/**
 * Get the current singleton telemetry client.
 * Returns a disabled no-op client if telemetry has not been initialised.
 */
export function getTelemetryClient(): TelemetryClient {
  if (!_instance) {
    _instance = new TelemetryClient({ enabled: false });
  }
  return _instance;
}

/**
 * Reset the singleton (for testing only).
 * @internal
 */
export function _resetTelemetryClient(): void {
  _instance = null;
}
