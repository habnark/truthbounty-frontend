/**
 * V2-FE-050 — EIP-2612 permit helpers (pure, no React / wagmi).
 *
 * Security invariants:
 *  - Permit is only offered when the canonical release ABI exposes a
 *    `...WithPermit(..., uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
 *    entrypoint. Without one, callers must use the standard approval flow.
 *  - The EIP-712 domain comes from a maintainer-reviewed asset entry and is
 *    verified against the token's on-chain DOMAIN_SEPARATOR().
 *  - Deadlines are derived from the latest block timestamp, never the
 *    client clock, and are bounded to a short window.
 *  - A signed permit is only submittable while its nonce is still the
 *    token's current nonce and its deadline has not passed on-chain.
 */

import {
  type Address,
  domainSeparator,
  formatUnits,
  isAddress,
  isAddressEqual,
  maxUint256,
  parseAbi,
} from 'viem';
import type { ReviewedPermitAsset } from '@/config/protocol/permit-assets';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EIP2612_ABI = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]);

export const PERMIT_TYPES = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

/** Default validity window for a permit, in seconds of chain time. */
export const DEFAULT_PERMIT_WINDOW_SECONDS = 15 * 60;
/** Longest window a caller may request, in seconds of chain time. */
export const MAX_PERMIT_WINDOW_SECONDS = 30 * 60;
/** Shortest window a caller may request, in seconds of chain time. */
export const MIN_PERMIT_WINDOW_SECONDS = 2 * 60;
/**
 * A permit with less than this much validity left is not submitted: the
 * transaction could be mined after the deadline and revert.
 */
export const MIN_REMAINING_VALIDITY_SECONDS = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermitUnavailableReason =
  | 'no-entrypoint'
  | 'asset-not-reviewed'
  | 'unsupported-chain'
  | 'spender-not-canonical'
  | 'invalid-params'
  | 'wallet-not-connected'
  | 'domain-mismatch';

export interface PermitDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
}

export interface PermitMessage {
  readonly owner: Address;
  readonly spender: Address;
  readonly value: bigint;
  readonly nonce: bigint;
  readonly deadline: bigint;
}

export interface PermitTypedData {
  readonly domain: PermitDomain;
  readonly types: typeof PERMIT_TYPES;
  readonly primaryType: 'Permit';
  readonly message: PermitMessage;
}

export interface PermitDisplayRow {
  readonly label: string;
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Entrypoint detection
// ---------------------------------------------------------------------------

const PERMIT_TAIL = ['uint256', 'uint8', 'bytes32', 'bytes32'] as const;

/**
 * Return the name of the first non-view function in `abi` that accepts an
 * EIP-2612 permit (`...WithPermit` with trailing deadline, v, r, s), or null.
 * `abi` is treated as untrusted and may be any shape.
 */
export function findPermitEntrypoint(abi: unknown): string | null {
  if (!Array.isArray(abi)) return null;
  for (const item of abi) {
    if (!item || typeof item !== 'object') continue;
    const fragment = item as {
      type?: unknown;
      name?: unknown;
      stateMutability?: unknown;
      inputs?: unknown;
    };
    if (fragment.type !== 'function' || typeof fragment.name !== 'string') continue;
    if (!/WithPermit$/.test(fragment.name)) continue;
    if (fragment.stateMutability === 'view' || fragment.stateMutability === 'pure') continue;
    if (!Array.isArray(fragment.inputs) || fragment.inputs.length < PERMIT_TAIL.length) continue;
    const tail = fragment.inputs.slice(-PERMIT_TAIL.length) as Array<{ type?: unknown }>;
    if (tail.every((input, i) => input?.type === PERMIT_TAIL[i])) return fragment.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reviewed assets and domain
// ---------------------------------------------------------------------------

export function findReviewedAsset(
  assets: readonly ReviewedPermitAsset[],
  chainId: number,
  token: Address,
): ReviewedPermitAsset | null {
  if (!isAddress(token)) return null;
  return (
    assets.find(
      (asset) =>
        asset.chainId === chainId && isAddress(asset.address) && isAddressEqual(asset.address, token),
    ) ?? null
  );
}

export function buildPermitDomain(asset: ReviewedPermitAsset): PermitDomain {
  return {
    name: asset.domainName,
    version: asset.domainVersion,
    chainId: asset.chainId,
    verifyingContract: asset.address,
  };
}

/** True when the reviewed domain hashes to the token's on-chain DOMAIN_SEPARATOR(). */
export function domainMatchesOnChain(domain: PermitDomain, onChainSeparator: unknown): boolean {
  if (typeof onChainSeparator !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(onChainSeparator)) {
    return false;
  }
  return domainSeparator({ domain }).toLowerCase() === onChainSeparator.toLowerCase();
}

// ---------------------------------------------------------------------------
// Deadline and typed data
// ---------------------------------------------------------------------------

/** Clamp a requested window to the allowed range. */
export function clampPermitWindow(windowSeconds: number | undefined): number {
  const requested =
    typeof windowSeconds === 'number' && Number.isFinite(windowSeconds)
      ? Math.floor(windowSeconds)
      : DEFAULT_PERMIT_WINDOW_SECONDS;
  return Math.min(MAX_PERMIT_WINDOW_SECONDS, Math.max(MIN_PERMIT_WINDOW_SECONDS, requested));
}

/** Deadline from the latest block timestamp (chain time), never the client clock. */
export function computePermitDeadline(blockTimestamp: bigint, windowSeconds?: number): bigint {
  return blockTimestamp + BigInt(clampPermitWindow(windowSeconds));
}

export function isValidPermitValue(value: unknown): value is bigint {
  return typeof value === 'bigint' && value > 0n && value <= maxUint256;
}

export function buildPermitTypedData(domain: PermitDomain, message: PermitMessage): PermitTypedData {
  return { domain, types: PERMIT_TYPES, primaryType: 'Permit', message };
}

// ---------------------------------------------------------------------------
// Replay / expiry gate before submission
// ---------------------------------------------------------------------------

export type PermitSubmissionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'nonce-consumed' | 'expired' | 'unreadable' };

/**
 * Decide from fresh chain reads whether a signed permit may be submitted.
 * The signature is single-use: once the token nonce moves past the signed
 * nonce, or the deadline is too close, it must be discarded.
 */
export function checkPermitSubmittable(input: {
  signedNonce: bigint;
  deadline: bigint;
  currentNonce: unknown;
  latestBlockTimestamp: unknown;
}): PermitSubmissionCheck {
  if (typeof input.currentNonce !== 'bigint' || typeof input.latestBlockTimestamp !== 'bigint') {
    return { ok: false, reason: 'unreadable' };
  }
  if (input.currentNonce !== input.signedNonce) return { ok: false, reason: 'nonce-consumed' };
  if (input.deadline - input.latestBlockTimestamp < BigInt(MIN_REMAINING_VALIDITY_SECONDS)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function formatChainTime(seconds: bigint): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return `${seconds.toString()} (unix seconds)`;
  return `${new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`;
}

/**
 * Human-readable rows describing exactly what the wallet will be asked to
 * sign. Values come from the typed data itself, so the preview cannot drift
 * from the signed payload.
 */
export function describePermit(
  typedData: PermitTypedData,
  asset: Pick<ReviewedPermitAsset, 'symbol' | 'decimals'>,
): PermitDisplayRow[] {
  const { domain, message } = typedData;
  return [
    { label: 'Token', value: `${asset.symbol} (${domain.verifyingContract})` },
    { label: 'Spender', value: message.spender },
    { label: 'Amount', value: `${formatUnits(message.value, asset.decimals)} ${asset.symbol}` },
    { label: 'Nonce', value: message.nonce.toString() },
    { label: 'Expires', value: formatChainTime(message.deadline) },
    { label: 'Network', value: `Chain ${domain.chainId}` },
    { label: 'Signer', value: message.owner },
  ];
}

