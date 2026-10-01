/**
 * Feature Flags Configuration — Typed, Fail-Closed (V2-FE-083)
 *
 * Every flag declares owner, environments, default, expiry, and safe fallback.
 * Evaluation is fail-closed: unknown, expired, wrong-environment, unsupported
 * chain/session/ABI/config, or protocol-invariant violations resolve to the
 * safe fallback (never invent enablement).
 *
 * Flags must never bypass protocol/security invariants. Wagmi/Viem + confirmed
 * Optimism/EVM receipts remain authoritative for protocol mutations.
 */

import { isSupportedChain } from '@/config/wagmi';

/** All available feature flags — add new flags here */
export type FeatureFlag =
  | 'CLAIM_SUBMISSION'
  | 'CLAIM_DISPUTES'
  | 'CLAIM_VERIFICATION'
  | 'WALLET_CONNECTION'
  | 'WORLDCOIN_VERIFICATION'
  | 'REALTIME_UPDATES'
  | 'LEADERBOARD'
  | 'ANALYTICS_DASHBOARD'
  | 'TRUST_SCORE_DISPLAY'
  | 'NOTIFICATION_BELL'
  | 'ADVANCED_FILTERS'
  | 'BETA_FEATURES'
  /** V2-FE-149: Privacy-safe error and incident telemetry. */
  | 'PRIVACY_SAFE_TELEMETRY';

export const FEATURE_FLAG_KEYS = [
  'CLAIM_SUBMISSION',
  'CLAIM_DISPUTES',
  'CLAIM_VERIFICATION',
  'WALLET_CONNECTION',
  'WORLDCOIN_VERIFICATION',
  'REALTIME_UPDATES',
  'LEADERBOARD',
  'ANALYTICS_DASHBOARD',
  'TRUST_SCORE_DISPLAY',
  'NOTIFICATION_BELL',
  'ADVANCED_FILTERS',
  'BETA_FEATURES',
] as const satisfies readonly FeatureFlag[];

export type FlagEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface FeatureFlagMeta {
  name: FeatureFlag;
  description: string;
  /** Production-safe default when no env override applies */
  defaultValue: boolean;
  category: 'core' | 'feature' | 'beta' | 'experimental';
  /** Accountable owner (team or individual) */
  owner: string;
  /** Environments where the flag may evaluate to true */
  environments: readonly FlagEnvironment[];
  /** ISO-8601 expiry; after this instant evaluation uses safeFallback */
  expiresAt: string | null;
  /** Fail-closed value used on expiry / guard failure (must be false for invariant-protected flags) */
  safeFallback: boolean;
  /**
   * When true, this flag must never be treated as authorizing a protocol or
   * security invariant bypass (chain, ABI, session, allowance, receipts).
   */
  protocolInvariantProtected: boolean;
}

export interface FlagEvaluationContext {
  environment?: FlagEnvironment;
  now?: Date;
  /** Active wallet chain; unsupported → fail closed for protocol-gated flags */
  chainId?: number;
  hasValidSession?: boolean;
  hasValidAllowance?: boolean;
  contractAddressConfigured?: boolean;
  abiConfigured?: boolean;
  /**
   * When true, caller is attempting to use a flag as a protocol/security bypass.
   * Always denied for protocolInvariantProtected flags.
   */
  protocolBypassAttempt?: boolean;
}

export type FlagDenialReason =
  | 'unknown_flag'
  | 'expired'
  | 'environment_mismatch'
  | 'unsupported_chain'
  | 'missing_session'
  | 'missing_allowance'
  | 'missing_contract'
  | 'missing_abi'
  | 'protocol_invariant'
  | 'disabled';

export interface FlagEvaluationResult {
  enabled: boolean;
  reason: FlagDenialReason | 'enabled';
  usedFallback: boolean;
  meta: FeatureFlagMeta | null;
}

const ALL_ENVS: readonly FlagEnvironment[] = [
  'development',
  'test',
  'staging',
  'production',
] as const;

const NON_PROD: readonly FlagEnvironment[] = [
  'development',
  'test',
  'staging',
] as const;

/** Default flag values — production defaults before env overrides */
export const DEFAULT_FLAGS: Record<FeatureFlag, boolean> = {
  CLAIM_SUBMISSION: true,
  CLAIM_DISPUTES: true,
  CLAIM_VERIFICATION: true,
  WALLET_CONNECTION: true,
  WORLDCOIN_VERIFICATION: true,
  REALTIME_UPDATES: true,
  LEADERBOARD: true,
  ANALYTICS_DASHBOARD: true,
  TRUST_SCORE_DISPLAY: true,
  NOTIFICATION_BELL: true,
  ADVANCED_FILTERS: true,
  PERFORMANCE_BUDGETS: true,
  
  // Beta/Experimental
  BETA_FEATURES: false,
  // V2-FE-149: Privacy-safe telemetry — disabled by default; enabled via env var or runtime toggle
  PRIVACY_SAFE_TELEMETRY: process.env.NEXT_PUBLIC_FEATURE_PRIVACY_SAFE_TELEMETRY === 'true',
};

/** Metadata for each flag (owner, env, expiry, safe fallback, invariant protection) */
export const FLAG_METADATA: Record<FeatureFlag, FeatureFlagMeta> = {
  CLAIM_SUBMISSION: {
    name: 'CLAIM_SUBMISSION',
    description: 'Enable claim submission functionality',
    defaultValue: true,
    category: 'core',
    owner: 'protocol-frontend',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  CLAIM_DISPUTES: {
    name: 'CLAIM_DISPUTES',
    description: 'Enable dispute creation and voting',
    defaultValue: true,
    category: 'core',
    owner: 'protocol-frontend',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  CLAIM_VERIFICATION: {
    name: 'CLAIM_VERIFICATION',
    description: 'Enable claim verification and staking',
    defaultValue: true,
    category: 'core',
    owner: 'protocol-frontend',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  WALLET_CONNECTION: {
    name: 'WALLET_CONNECTION',
    description: 'Enable wallet connection functionality',
    defaultValue: true,
    category: 'core',
    owner: 'wallet-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  WORLDCOIN_VERIFICATION: {
    name: 'WORLDCOIN_VERIFICATION',
    description: 'Enable Worldcoin identity verification',
    defaultValue: true,
    category: 'core',
    owner: 'identity-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  REALTIME_UPDATES: {
    name: 'REALTIME_UPDATES',
    description: 'Enable real-time WebSocket updates',
    defaultValue: true,
    category: 'feature',
    owner: 'realtime-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  LEADERBOARD: {
    name: 'LEADERBOARD',
    description: 'Show leaderboard and rankings',
    defaultValue: true,
    category: 'feature',
    owner: 'growth-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  ANALYTICS_DASHBOARD: {
    name: 'ANALYTICS_DASHBOARD',
    description: 'Enable analytics dashboard',
    defaultValue: true,
    category: 'feature',
    owner: 'growth-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  TRUST_SCORE_DISPLAY: {
    name: 'TRUST_SCORE_DISPLAY',
    description: 'Display trust score indicators',
    defaultValue: true,
    category: 'feature',
    owner: 'protocol-frontend',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  NOTIFICATION_BELL: {
    name: 'NOTIFICATION_BELL',
    description: 'Show notification bell in header',
    defaultValue: true,
    category: 'feature',
    owner: 'ux-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  ADVANCED_FILTERS: {
    name: 'ADVANCED_FILTERS',
    description: 'Enable advanced filtering options',
    defaultValue: true,
    category: 'feature',
    owner: 'ux-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  PERFORMANCE_BUDGETS: {
    name: 'PERFORMANCE_BUDGETS',
    description: 'Show the frontend performance budget indicator',
    defaultValue: true,
    category: 'feature',
    owner: 'platform-team',
    environments: ALL_ENVS,
    expiresAt: null,
    safeFallback: false,
    protocolInvariantProtected: false,
  },
  BETA_FEATURES: {
    name: 'BETA_FEATURES',
    description: 'Enable all beta/experimental features',
    defaultValue: false,
    category: 'beta',
    owner: 'platform-team',
    environments: NON_PROD,
    expiresAt: '2027-12-31T23:59:59.000Z',
    safeFallback: false,
    protocolInvariantProtected: true,
  },
  PRIVACY_SAFE_TELEMETRY: {
    name: 'PRIVACY_SAFE_TELEMETRY',
    description: 'Enable privacy-safe error and incident telemetry (V2-FE-149). All events are redacted before transport.',
    defaultValue: false,
    category: 'experimental',
  },
};

/** Runtime type guard for untrusted flag names (API / storage / query) */
export function isFeatureFlag(value: unknown): value is FeatureFlag {
  return (
    typeof value === 'string' &&
    (FEATURE_FLAG_KEYS as readonly string[]).includes(value)
  );
}

/** Resolve current app environment (fail closed to production semantics) */
export function resolveFlagEnvironment(
  override?: FlagEnvironment
): FlagEnvironment {
  if (override) return override;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'development') return 'development';
  if (nodeEnv === 'test') return 'test';
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  if (appEnv === 'staging') return 'staging';
  if (appEnv === 'development') return 'development';
  if (appEnv === 'test') return 'test';
  return 'production';
}

function deny(
  meta: FeatureFlagMeta | null,
  reason: FlagDenialReason,
  fallback: boolean
): FlagEvaluationResult {
  return {
    enabled: fallback,
    reason,
    usedFallback: true,
    meta,
  };
}

/**
 * Canonical fail-closed evaluation.
 * Never returns true for unknown flags, expired flags, wrong environments,
 * protocol-bypass attempts, or unsupported chain / session / ABI / config.
 */
export function evaluateFlag(
  flag: string,
  rawEnabled: boolean | undefined,
  context: FlagEvaluationContext = {}
): FlagEvaluationResult {
  if (!isFeatureFlag(flag)) {
    return deny(null, 'unknown_flag', false);
  }

  const meta = FLAG_METADATA[flag];
  const fallback = meta.safeFallback;
  const environment = resolveFlagEnvironment(context.environment);
  const now = context.now ?? new Date();

  if (meta.protocolInvariantProtected && context.protocolBypassAttempt) {
    return deny(meta, 'protocol_invariant', fallback);
  }

  if (meta.expiresAt) {
    const expiry = Date.parse(meta.expiresAt);
    if (!Number.isFinite(expiry) || now.getTime() > expiry) {
      return deny(meta, 'expired', fallback);
    }
  }

  if (!meta.environments.includes(environment)) {
    return deny(meta, 'environment_mismatch', fallback);
  }

  // Protocol-gated flags require supported Optimism/EVM configuration when
  // callers supply chain / session / ABI context.
  if (meta.protocolInvariantProtected) {
    if (context.chainId !== undefined && !isSupportedChain(context.chainId)) {
      return deny(meta, 'unsupported_chain', fallback);
    }
    if (context.hasValidSession === false) {
      return deny(meta, 'missing_session', fallback);
    }
    if (context.hasValidAllowance === false) {
      return deny(meta, 'missing_allowance', fallback);
    }
    if (context.contractAddressConfigured === false) {
      return deny(meta, 'missing_contract', fallback);
    }
    if (context.abiConfigured === false) {
      return deny(meta, 'missing_abi', fallback);
    }
  }

  const enabled = rawEnabled ?? meta.defaultValue;
  if (!enabled) {
    return {
      enabled: false,
      reason: 'disabled',
      usedFallback: false,
      meta,
    };
  }

  return {
    enabled: true,
    reason: 'enabled',
    usedFallback: false,
    meta,
  };
}

/** Convenience boolean wrapper around evaluateFlag (fail closed). */
export function isFlagEnabled(
  flag: string,
  rawEnabled: boolean | undefined,
  context: FlagEvaluationContext = {}
): boolean {
  return evaluateFlag(flag, rawEnabled, context).enabled;
}

/**
 * Get feature flags from environment variables.
 * Prefix: NEXT_PUBLIC_FEATURE_ (e.g. NEXT_PUBLIC_FEATURE_CLAIM_SUBMISSION=false)
 * Malformed values fail closed (false).
 */
function getEnvFlags(): Partial<Record<FeatureFlag, boolean>> {
  const envFlags: Partial<Record<FeatureFlag, boolean>> = {};
  
  // Check for environment variable overrides
  const envOverrides: Array<{ key: FeatureFlag; envKey: string }> = [
    { key: 'CLAIM_SUBMISSION', envKey: 'NEXT_PUBLIC_FEATURE_CLAIM_SUBMISSION' },
    { key: 'CLAIM_DISPUTES', envKey: 'NEXT_PUBLIC_FEATURE_CLAIM_DISPUTES' },
    { key: 'CLAIM_VERIFICATION', envKey: 'NEXT_PUBLIC_FEATURE_CLAIM_VERIFICATION' },
    { key: 'WALLET_CONNECTION', envKey: 'NEXT_PUBLIC_FEATURE_WALLET_CONNECTION' },
    { key: 'WORLDCOIN_VERIFICATION', envKey: 'NEXT_PUBLIC_FEATURE_WORLDCOIN_VERIFICATION' },
    { key: 'REALTIME_UPDATES', envKey: 'NEXT_PUBLIC_FEATURE_REALTIME_UPDATES' },
    { key: 'LEADERBOARD', envKey: 'NEXT_PUBLIC_FEATURE_LEADERBOARD' },
    { key: 'ANALYTICS_DASHBOARD', envKey: 'NEXT_PUBLIC_FEATURE_ANALYTICS_DASHBOARD' },
    { key: 'TRUST_SCORE_DISPLAY', envKey: 'NEXT_PUBLIC_FEATURE_TRUST_SCORE_DISPLAY' },
    { key: 'NOTIFICATION_BELL', envKey: 'NEXT_PUBLIC_FEATURE_NOTIFICATION_BELL' },
    { key: 'ADVANCED_FILTERS', envKey: 'NEXT_PUBLIC_FEATURE_ADVANCED_FILTERS' },
    { key: 'BETA_FEATURES', envKey: 'NEXT_PUBLIC_FEATURE_BETA_FEATURES' },
    { key: 'PRIVACY_SAFE_TELEMETRY', envKey: 'NEXT_PUBLIC_FEATURE_PRIVACY_SAFE_TELEMETRY' },
  ];
  
  for (const { key, envKey } of envOverrides) {
    const envValue = process.env[envKey];
    if (envValue === undefined) continue;
    if (envValue === 'true' || envValue === '1') {
      envFlags[key] = true;
    } else if (envValue === 'false' || envValue === '0') {
      envFlags[key] = false;
    } else {
      // Untrusted / malformed → fail closed
      envFlags[key] = FLAG_METADATA[key].safeFallback;
    }
  }

  return envFlags;
}

/**
 * Initial flags: defaults + env overrides, then fail-closed evaluation
 * (expiry / environment) so expired or wrong-env flags never start enabled.
 */
export function getInitialFlags(
  context: FlagEvaluationContext = {}
): Record<FeatureFlag, boolean> {
  const envFlags = getEnvFlags();
  const merged: Record<FeatureFlag, boolean> = {
    ...DEFAULT_FLAGS,
    ...envFlags,
  };

  const result = {} as Record<FeatureFlag, boolean>;
  for (const key of FEATURE_FLAG_KEYS) {
    result[key] = evaluateFlag(key, merged[key], context).enabled;
  }
  return result;
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function getAllFlagMetadata(): FeatureFlagMeta[] {
  return Object.values(FLAG_METADATA);
}

export function getFlagsByCategory(
  category: FeatureFlagMeta['category']
): FeatureFlag[] {
  return Object.entries(FLAG_METADATA)
    .filter(([, meta]) => meta.category === category)
    .map(([key]) => key as FeatureFlag);
}

/** Invariant: protocol-protected flags must never declare a true safeFallback */
export function assertFailClosedInvariants(): void {
  for (const key of FEATURE_FLAG_KEYS) {
    const meta = FLAG_METADATA[key];
    if (meta.protocolInvariantProtected && meta.safeFallback !== false) {
      throw new Error(
        `Flag ${key} is protocolInvariantProtected but safeFallback is not false`
      );
    }
    if (meta.defaultValue !== DEFAULT_FLAGS[key]) {
      throw new Error(
        `Flag ${key} metadata.defaultValue disagrees with DEFAULT_FLAGS`
      );
    }
  }
}
