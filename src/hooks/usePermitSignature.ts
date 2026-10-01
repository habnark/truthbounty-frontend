'use client';

/**
 * V2-FE-050 — Optional EIP-2612 permit signing
 *
 * Offers a gasless permit signature as an OPTIONAL alternative to `approve()`.
 * Whenever permit cannot be used safely the hook reports `status:
 * 'unavailable'` with a reason, and callers must use the standard approval
 * flow (useERC20Approval / ApprovalButton) instead.
 *
 * Permit is available only when ALL of these hold:
 *  - the canonical release ABI exposes a `...WithPermit` entrypoint;
 *  - a wallet is connected on the release chain;
 *  - the spender is the canonical protocol contract;
 *  - the token is a maintainer-reviewed permit asset, and its on-chain
 *    DOMAIN_SEPARATOR() matches the reviewed EIP-712 domain.
 *
 * Replay safety:
 *  - nonce and deadline come from fresh chain reads (deadline from the latest
 *    block timestamp, never the client clock);
 *  - the signature is recovered and must match the connected account;
 *  - the signature lives in memory only and is discarded on account, chain,
 *    token, spender or amount change;
 *  - `getSubmittablePermit()` re-reads the nonce and latest block right before
 *    submission and refuses a consumed, replaced or near-expiry permit;
 *  - `markConsumed()` discards it after the entrypoint's confirmed receipt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSignTypedData } from 'wagmi';
import {
  type Address,
  type Hex,
  isAddress,
  isAddressEqual,
  parseSignature,
  recoverTypedDataAddress,
} from 'viem';
import { isSupportedChain } from '@/config/wagmi';
import { REVIEWED_PERMIT_ASSETS, type ReviewedPermitAsset } from '@/config/protocol/permit-assets';
import { getContractAbi, getContractAddress, getReleaseChainId } from '@/lib/contracts/registry';
import {
  EIP2612_ABI,
  type PermitDisplayRow,
  type PermitTypedData,
  type PermitUnavailableReason,
  buildPermitDomain,
  buildPermitTypedData,
  checkPermitSubmittable,
  computePermitDeadline,
  describePermit,
  domainMatchesOnChain,
  findPermitEntrypoint,
  findReviewedAsset,
  isValidPermitValue,
} from '@/lib/permit/permit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermitStatus =
  | 'unavailable'        // permit cannot be used — use the approval flow
  | 'idle'               // available, nothing prepared yet
  | 'preparing'          // reading nonce, domain separator and latest block
  | 'ready'              // typed data built and shown for review
  | 'awaiting-signature' // wallet signature request is open
  | 'signed'             // signature held in memory, ready for submission
  | 'rejected'           // user declined the signature
  | 'expired'            // deadline too close on-chain; must re-sign
  | 'error';             // read, signature or replay check failed

export type PermitErrorReason =
  | 'READ_FAILED'
  | 'SIGNATURE_FAILED'
  | 'SIGNER_MISMATCH'
  | 'NONCE_CONSUMED';

export interface SubmittablePermit {
  /** Name of the canonical `...WithPermit` entrypoint to call. */
  readonly entrypoint: string;
  readonly value: bigint;
  readonly deadline: bigint;
  readonly v: number;
  readonly r: Hex;
  readonly s: Hex;
}

export interface UsePermitSignatureParams {
  /** ERC-20 token that would be permitted. */
  token: Address | undefined;
  /** Spender — must be the canonical protocol contract. */
  spender: Address | undefined;
  /** Exact amount to permit. */
  value: bigint | undefined;
  /** Requested validity window in seconds of chain time (clamped). */
  windowSeconds?: number;
  /** Reviewed assets. Defaults to the maintained allowlist. */
  reviewedAssets?: readonly ReviewedPermitAsset[];
  /** Release ABI to search for a permit entrypoint. Defaults to the canonical ABI. */
  releaseAbi?: unknown;
}

export interface UsePermitSignatureResult {
  status: PermitStatus;
  /** Why permit is unavailable, when `status === 'unavailable'`. */
  unavailableReason: PermitUnavailableReason | null;
  errorReason: PermitErrorReason | null;
  /** Canonical permit entrypoint, if the release exposes one. */
  entrypoint: string | null;
  asset: ReviewedPermitAsset | null;
  /** Exactly what the wallet is asked to sign. */
  typedData: PermitTypedData | null;
  /** Human-readable rows derived from `typedData`. */
  displayRows: PermitDisplayRow[];
  /** Read nonce/domain/block and build the typed data for review. */
  prepare: () => Promise<void>;
  /** Ask the wallet to sign the prepared typed data. */
  sign: () => Promise<void>;
  /**
   * Re-verify the held signature against fresh chain state and return the
   * submission components, or null if it must not be submitted.
   */
  getSubmittablePermit: () => Promise<SubmittablePermit | null>;
  /** Discard the signature after the entrypoint's confirmed receipt. */
  markConsumed: () => void;
  /** Discard any prepared/signed permit and return to idle. */
  reset: () => void;
}

interface SignedPermit {
  readonly typedData: PermitTypedData;
  readonly v: number;
  readonly r: Hex;
  readonly s: Hex;
}

function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.name === 'UserRejectedRequestError' || candidate.code === 4001) return true;
    if (typeof candidate.message === 'string' && /user (rejected|denied)/i.test(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePermitSignature({
  token,
  spender,
  value,
  windowSeconds,
  reviewedAssets = REVIEWED_PERMIT_ASSETS,
  releaseAbi,
}: UsePermitSignatureParams): UsePermitSignatureResult {
  const { address: owner, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const [phase, setPhase] = useState<Exclude<PermitStatus, 'unavailable'>>('idle');
  const [domainMismatch, setDomainMismatch] = useState(false);
  const [errorReason, setErrorReason] = useState<PermitErrorReason | null>(null);
  const [typedData, setTypedData] = useState<PermitTypedData | null>(null);
  const signedRef = useRef<SignedPermit | null>(null);
  // Incremented whenever the context changes so late async results are dropped.
  const generation = useRef(0);

  const entrypoint = useMemo(
    () => findPermitEntrypoint(releaseAbi ?? getContractAbi('TruthBountyWeighted')),
    [releaseAbi],
  );

  const asset = useMemo(
    () => (token && chainId !== undefined ? findReviewedAsset(reviewedAssets, chainId, token) : null),
    [reviewedAssets, chainId, token],
  );

  const unavailableReason: PermitUnavailableReason | null = useMemo(() => {
    if (!entrypoint) return 'no-entrypoint';
    if (!isConnected || !owner || !isAddress(owner)) return 'wallet-not-connected';
    if (chainId === undefined || !isSupportedChain(chainId) || chainId !== getReleaseChainId()) {
      return 'unsupported-chain';
    }
    if (!token || !spender || !isAddress(token) || !isAddress(spender) || !isValidPermitValue(value)) {
      return 'invalid-params';
    }
    if (!isAddressEqual(spender, getContractAddress('TruthBountyWeighted'))) return 'spender-not-canonical';
    if (!asset) return 'asset-not-reviewed';
    if (domainMismatch) return 'domain-mismatch';
    return null;
  }, [entrypoint, isConnected, owner, chainId, token, spender, value, asset, domainMismatch]);

  const clear = useCallback(() => {
    generation.current += 1;
    signedRef.current = null;
    setTypedData(null);
    setErrorReason(null);
    setPhase('idle');
  }, []);

  // Any context change invalidates a prepared or signed permit.
  const contextKey = `${owner ?? ''}|${chainId ?? ''}|${token ?? ''}|${spender ?? ''}|${value?.toString() ?? ''}`;
  useEffect(() => {
    clear();
    setDomainMismatch(false);
  }, [contextKey, clear]);

  const fail = useCallback((reason: PermitErrorReason) => {
    signedRef.current = null;
    setErrorReason(reason);
    setPhase('error');
  }, []);

  const prepare = useCallback(async () => {
    if (unavailableReason || !asset || !owner || !spender || value === undefined) return;
    const run = ++generation.current;
    signedRef.current = null;
    setTypedData(null);
    setErrorReason(null);
    setPhase('preparing');

    if (!publicClient) {
      fail('READ_FAILED');
      return;
    }

    let separator: unknown;
    let nonce: unknown;
    let timestamp: unknown;
    try {
      const [sep, n, block] = await Promise.all([
        publicClient.readContract({ address: asset.address, abi: EIP2612_ABI, functionName: 'DOMAIN_SEPARATOR' }),
        publicClient.readContract({ address: asset.address, abi: EIP2612_ABI, functionName: 'nonces', args: [owner] }),
        publicClient.getBlock({ blockTag: 'latest' }),
      ]);
      separator = sep;
      nonce = n;
      timestamp = block?.timestamp;
    } catch {
      if (run === generation.current) fail('READ_FAILED');
      return;
    }
    if (run !== generation.current) return;

    const domain = buildPermitDomain(asset);
    if (!domainMatchesOnChain(domain, separator)) {
      // Reviewed domain does not match the deployed token: never sign it.
      setDomainMismatch(true);
      setPhase('idle');
      return;
    }
    if (typeof nonce !== 'bigint' || typeof timestamp !== 'bigint') {
      fail('READ_FAILED');
      return;
    }

    setTypedData(
      buildPermitTypedData(domain, {
        owner,
        spender,
        value,
        nonce,
        deadline: computePermitDeadline(timestamp, windowSeconds),
      }),
    );
    setPhase('ready');
  }, [unavailableReason, asset, owner, spender, value, publicClient, windowSeconds, fail]);

  const sign = useCallback(async () => {
    if (unavailableReason || phase !== 'ready' || !typedData || !owner) return;
    const run = generation.current;
    setPhase('awaiting-signature');

    let signature: Hex;
    try {
      signature = await signTypedDataAsync({
        account: owner,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
    } catch (error) {
      if (run !== generation.current) return;
      if (isUserRejection(error)) {
        setPhase('rejected');
      } else {
        fail('SIGNATURE_FAILED');
      }
      return;
    }
    if (run !== generation.current) return;

    try {
      const recovered = await recoverTypedDataAddress({ ...typedData, signature });
      if (run !== generation.current) return;
      if (!isAddressEqual(recovered, typedData.message.owner)) {
        fail('SIGNER_MISMATCH');
        return;
      }
      const parsed = parseSignature(signature);
      const v = parsed.v !== undefined ? Number(parsed.v) : parsed.yParity + 27;
      signedRef.current = { typedData, v, r: parsed.r, s: parsed.s };
      setPhase('signed');
    } catch {
      if (run === generation.current) fail('SIGNATURE_FAILED');
    }
  }, [unavailableReason, phase, typedData, owner, signTypedDataAsync, fail]);

  const getSubmittablePermit = useCallback(async (): Promise<SubmittablePermit | null> => {
    const signed = signedRef.current;
    if (unavailableReason || !signed || !entrypoint || !publicClient) return null;
    const run = generation.current;
    const { message, domain } = signed.typedData;

    let currentNonce: unknown;
    let latestTimestamp: unknown;
    try {
      const [n, block] = await Promise.all([
        publicClient.readContract({
          address: domain.verifyingContract,
          abi: EIP2612_ABI,
          functionName: 'nonces',
          args: [message.owner],
        }),
        publicClient.getBlock({ blockTag: 'latest' }),
      ]);
      currentNonce = n;
      latestTimestamp = block?.timestamp;
    } catch {
      currentNonce = undefined;
      latestTimestamp = undefined;
    }
    if (run !== generation.current || signedRef.current !== signed) return null;

    const check = checkPermitSubmittable({
      signedNonce: message.nonce,
      deadline: message.deadline,
      currentNonce,
      latestBlockTimestamp: latestTimestamp,
    });
    if (!check.ok) {
      signedRef.current = null;
      if (check.reason === 'expired') {
        setErrorReason(null);
        setPhase('expired');
      } else {
        fail(check.reason === 'nonce-consumed' ? 'NONCE_CONSUMED' : 'READ_FAILED');
      }
      return null;
    }

    return {
      entrypoint,
      value: message.value,
      deadline: message.deadline,
      v: signed.v,
      r: signed.r,
      s: signed.s,
    };
  }, [unavailableReason, entrypoint, publicClient, fail]);

  const displayRows = useMemo(
    () => (typedData && asset ? describePermit(typedData, asset) : []),
    [typedData, asset],
  );

  return {
    status: unavailableReason ? 'unavailable' : phase,
    unavailableReason,
    errorReason: unavailableReason ? null : errorReason,
    entrypoint,
    asset,
    typedData: unavailableReason ? null : typedData,
    displayRows: unavailableReason ? [] : displayRows,
    prepare,
    sign,
    getSubmittablePermit,
    markConsumed: clear,
    reset: clear,
  };
}
