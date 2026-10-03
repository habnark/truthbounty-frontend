'use client';

import { useCallback, useRef, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi';
import {
  type Address,
  type Hash,
  type Hex,
  isAddress,
  isAddressEqual,
  getAddress,
  maxUint256,
  parseAbi,
} from 'viem';
import { evaluateWriteTarget } from '@/lib/contracts/write-gate';
import { validateAllowance, validateSufficientBalance } from '@/lib/claim-submission/validation';

// ---------------------------------------------------------------------------
// Constants

// ---------------------------------------------------------------------------

/**
 * Canonical artifact version supported by this hook.
 */
export const SUPPORTED_ARTIFACT_VERSION = '0.1.0';
export const SUPORTED_ARTIFACT_VERSION = SUPPORTED_ARTIFACT_VERSION;

/**
 * Default chain id for the reviewed release (Optimism Sepolia in the pinned
 * manifest). Consumers should pass the correct expected chain when not defaulting.
 */
export const DEFAULT_EXPECTED_CHAIN_ID = 11155420;

/**
 * Max byte length for content digest (32 bytes).
 */
export const CONTENT_MIGEST_BYTE_LENGTH = 32;

/**
 * Max byte length for freeform frozen configuration.
 */
export const MAX_FROZEN_CONFIG_BYTE_LENGTH = 1024;

// ---------------------------------------------------------------------------
// ABI definitions

// ---------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/**
 * Canonical claim creation ABI expected by the TruthBounty V2 contract.
 * The function must be `createClaim(bytes32 contentDigest, address asset, uint256 amount, bytes frozenConfig)`.
 */
const CLAIM_CREATION_ABI = parseAbi([
  'function createClaim(bytes32 contentDigest, address asset, uint256 amount, bytes frozenConfig) returns (uint256)',
]);

// ---------------------------------------------------------------------------
// Error types

// ---------------------------------------------------------------------------

export const ClaimCreationErrorCode = {
  INVALID_CHAIN: 'INVALID_CHAIN',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  INVALID_CONTENT_DIGEST: 'INVALID_CONTENT_DIGEST',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_ARTIFACT_VERSION: 'INVALID_ARTIFACT_VERSION',
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  USER_REJECTED: 'USER_REJECTED',
  SIMULATION_REVERTED: 'SIMULATION_REVERTED',
  TRANSACTION_REVERTED: 'TRANSACTION_REVERTED',
  TX_NOT_FOUND: 'TX_NOT_FOUND',
  ALLOWANCE_INSUFFICIENT: 'ALLOWANCE_INSUFFICIENT',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SUBMISSION_IN_PROGRESS: 'SUBMISSION_IN_PROGRESS',
  APPROVAL_FAILED: 'APPROVAL_FAILED',
  CLAIM_NOT_INDEXED: 'CLAIM_NOT_INDEXED',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export type ClaimCreationErrorCode =
  (typeof ClaimCreationErrorCode)[keyof typeof ClaimCreationErrorCode];

const {
  INVALID_CHAIN,
  INVALID_ADDRESS,
  INVALID_CONTENT_DIGEST,
  INVALID_AMOUNT,
  INVALID_CONFIG,
  INVALID_ARTIFACT_VERSION,
} = ClaimCreationErrorCode;

export class ClaimCreationError extends Error {
  readonly code: ClaimCreationErrorCode;

  constructor(code: ClaimCreationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ClaimCreationError';
    this.code = code;
  }
}

// --------------------------------------------------------------------------$
// Input/Output types

// --------------------------------------------------------------------------$

export type ClaimCreationParams = {
  /** 32-byte content digest of the claim (untrusted). */
  contentDigest: Hex;
  /** Address of the bounty asset. */
  asset: Address;
  /** Exact integer amount of the bounty asset. */
  amount: bigint;
  /** Frozen configuration bytes, used to hard-code claim parameters on-chain. */
  frozenConfig: Hex;
  /** Address of the canonical claim contract. */
  claimContractAddress: Address;
  /** Supported contract artifact version, e.g. "0.1.0". */
  artifactVersion: string;
  /** Expected network chain id; defaults to Optimism mainnet. */
  expectedChainId?: number;
  /**
   * Optional approval requirement. If the wallet's current allowance is below
   * `requiredAmount`, the hook will submit an `approve` transaction before
   * attempting to create the claim.
   */
  approval?: {
    token: Address;
    spender: Address;
    requiredAmount: bigint;
  };
  /**
   * Required reconciliation callback. Invoked after a successful claim
   * transaction to verify the indexed claim exists in the protocol indexer.
   */
  getIndexedClaim: (params: {
    contentDigest: Hex;
    txHash: Hash;
    chainId: number;
  }) => Promise<unknown>;
};

export type ClaimCreationResult =
  | {
      status: 'success';
      txHash: Hash;
      indexedClaim: unknown;
    }
  | {
      status: 'error';
      error: ClaimCreationError;
    };

export type ClaimCreationStatus =
  | 'idle'
  | 'validating'
  | 'approving'
  | 'simulating'
  | 'submitting'
  | 'confirming'
  | 'reconciling'
  | 'success'
  | 'error';

// ---------------------------------------------------------------------------
// Validation helpers

// ---------------------------------------------------------------------------

function isHex(value: string): value is Hex {
  return /^0x[a-fA-F0-9]+$/.test(value);
}

function isBytes32Hex(value: string): value is Hex {
  // 0x + 64 hex chars = 66 chars
  return isHex(value) && value.length === 66;
}

function validateFrozenConfig(frozenConfig: Hex) {
  if (!isHex(frozenConfig) || frozenConfig.replace(/^0x/, '').length % 2 !== 0) {
    throw new ClaimCreationError(
      INVALID_CONFIG,
      'frozenConfig must be valid hx bytes (even length).'
    );
  }

  // Enforce a reasonable upper bound to avoid unbounded on-chain data.
  const configBytes = (frozenConfig.length - 2) / 2;
  if (configBytes > MAX_FROZEN_CONFIG_BYTE_LENGTH) {
    throw new ClaimCreationError(
      INVALID_CONFIG,
      `frozenConfig exceeds max size of ${MAX_FROZEN_CONFIG_BYTE_LENGTH} bytes.`
    );
  }
}

function validateApproval(params: ClaimCreationParams) {
  const { approval } = params;
  if (!approval) return;
  const { token, spender, requiredAmount } = approval;
  if (!isAddress(token)) {
    throw new ClaimCreationError(
      INVALID_ADDRESS,
      `Invalid approval token address: ${token}`
    );
  }
  if (!isAddress(spender)) {
    throw new ClaimCreationError(
      INVALID_ADDRESS,
      `Invalid approval spender address: ${spender}`
    );
  }
  if (requiredAmount <= 0n || requiredAmount > maxUint256) {
    throw new ClaimCreationError(INVALID_AMOUNT, 'approval.requiredAmount must be a positive uint256.');
  }

  // The approval config is untrusted input: it must authorize exactly the
  // claim's asset for the claim contract, and cover the claim amount.
  if (!isAddressEqual(token, params.asset)) {
    throw new ClaimCreationError(INVALID_CONFIG, 'Approval token does not match the claim asset.');
  }
  if (!isAddressEqual(spender, params.claimContractAddress)) {
    throw new ClaimCreationError(INVALID_CONFIG, 'Approval spender does not match the claim contract.');
  }
  if (requiredAmount < params.amount) {
    throw new ClaimCreationError(INVALID_AMOUNT, 'Approval amount is below the claim amount.');
  }
}

function validateParams(
  params: ClaimCreationParams,
  expectedChainId: number,
) {
  // check chain id parameter is valid if provided
  if (params.expectedChainId !== undefined && !Number.isInteger(params.expectedChainId)) {
    throw new ClaimCreationError(INVALID_CHAIN,
      'expectedChainId must be a positive integer network id.');
  }

  if (params.artifactVersion !== SUPPORTED_ARTIFACT_VERSION) {
    throw new ClaimCreationError(
      INVALID_ARTIFACT_VERSION,
      `Unsupported artifact version. Expected "${SUPPORTED_ARTIFACT_VERSION}", received "${params.artifactVersion}".`
    );
  }

  if (!isBytes32Hex(params.contentDigest)) {
    throw new ClaimCreationError(
      INVALID_CONTENT_DIGEST,
      'contentDigest must be a 32-byte hex string (0x + 64 hex chars).'
    );
  }

  if (/^0x0{64}$/.test(params.contentDigest)) {
    throw new ClaimCreationError(
      INVALID_CONTENT_DIGEST,
      'contentDigest must not be the zero digest.'
    );
  }

  if (!isAddress(params.asset)) {
    throw new ClaimCreationError(
      INVALID_ADDRESS,`Invalid asset address: ${params.asset}`
    );
  }

  if (typeof params.amount !== 'bigint' || params.amount <= 0n || params.amount > maxUint256) {
    throw new ClaimCreationError(
      INVALID_AMOUNT,
      'amount must be a positive uint256 integer (bigint).'
    );
  }

  validateFrozenConfig(params.frozenConfig);

  if (!isAddress(params.claimContractAddress)) {
    throw new ClaimCreationError(
      INVALID_ADDRESS,
      `Invalid claim contract address: ${params.claimContractAddress}`
    );
  }

  const writeTarget = evaluateWriteTarget({
    activeChainId: expectedChainId,
    contractAddress: params.claimContractAddress,
  });
  if (!writeTarget.ok) {
    const code = writeTarget.code === 'STALE_ARTIFACT' ? INVALID_ARTIFACT_VERSION : INVALID_ADDRESS;
    throw new ClaimCreationError(code, writeTarget.errors.join('; '));
  }

  validateApproval(params);

  if (!Number.isInteger(expectedChainId) || expectedChainId <= 0) {
    throw new ClaimCreationError(INVALID_CHAIN, 'expectedChainId must be a positive integer network id.');
  }
}

function toErrorCode(error: unknown): ClaimCreationError {
  // Map common error names to protocol error codes.
  if (error instanceof ClaimCreationError) {
    return error;
  }

  const name = (error as { name?: string } | null)?.name;

  if (name === 'UserRejectedRequestError') {
    return new ClaimCreationError(
      ClaimCreationErrorCode.USER_REJECTED,
      'Transaction rejected by user.',
      { cause: error },
    );
  }

  if (name === 'TransactionNotFoundError') {
    return new ClaimCreationError(
      ClaimCreationErrorCode.TX_NOT_FOUND,
      error instanceof Error ? error.message : 'Transaction not found.',
      { cause: error },
    );
  }

  if (name === 'SimulationError' || name === 'CallExecutionError') {
    return new ClaimCreationError(
      ClaimCreationErrorCode.SIMULATION_REVERTED,
      error instanceof Error ? error.message : 'Simulation reverted.',
      { cause: error },
    );
  }

  if (name === 'TransactionExecutionError') {
    return new ClaimCreationError(
      ClaimCreationErrorCode.TRANSACTION_REVERTED,
      error instanceof Error ? error.message : 'Transaction reverted.',
      { cause: error },
    );
  }

  return new ClaimCreationError(
    ClaimCreationErrorCode.UNEXPECTED_ERROR,
    error instanceof Error ? error.message : 'Unknown error',
    { cause: error },
  );
}

// ---------------------------------------------------------------------------
// The hook

// ---------------------------------------------------------------------------

export function useClaimCreationTransaction() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const walletClient = useWalletClient();
  const connectedChainId = useChainId();

  const [status, setStatus] = useState<ClaimCreationStatus>('idle');
  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<ClaimCreationError | null>(null);
  // Blocks a second createClaim() (e.g. double click) from starting another signing flow.
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }, []);

  const runCreateClaim = useCallback(
    async (params: ClaimCreationParams): Promise<ClaimCreationResult> => {
      reset();

      const expectedChainId = params.expectedChainId ?? DEFAULT_EXPECTED_CHAIN_ID;

      // Validate parameters before touching any network.
      try {
        setStatus('validating');
        validateParams(params, expectedChainId);
      } catch (validationError) {
        const typedError = toErrorCode(validationError);
        setError(typedError);
        setStatus('error');
        return { status: 'error', error: typedError };
      }

      // Ensure wallet is connected and we have a public/wallet client.
      if (!isConnected || !address || !publicClient || !walletClient?.data) {
        const noWalletError = new ClaimCreationError(
          ClaimCreationErrorCode.WALLET_NOT_CONNECTED,
          'Wallet not connected. Connect a wallet before creating a claim.',
        );
        setError(noWalletError);
        setStatus('error');
        return { status: 'error', error: noWalletError };
      }

      // Validate chain.
      if (connectedChainId !== expectedChainId) {
        const chainError = new ClaimCreationError(
          ClaimCreationErrorCode.INVALID_CHAIN,
          `Wrong network. Connected to chain ${connectedChainId}, expected ${expectedChainId}.`,
        );
        setError(chainError);
        setStatus('error');
        return { status: 'error', error: chainError };
      }

      // Normalize addresses.
      const asset = getAddress(params.asset);
      const claimContract = getAddress(params.claimContractAddress);

      try {
        const account = address;

        // 0. Pre-signing chain checks. Nothing is signed unless the wallet can
        //    fund the claim and, without an approval step, is already approved.
        const balance = await publicClient.readContract({
          address: asset,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [account],
        });
        const balanceCheck = validateSufficientBalance(balance, params.amount);
        if (!balanceCheck.valid) {
          throw new ClaimCreationError(
            ClaimCreationErrorCode.INSUFFICIENT_BALANCE,
            'Insufficient balance of the claim asset to fund this claim.',
          );
        }

        if (!params.approval) {
          const currentAllowance = await publicClient.readContract({
            address: asset,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account, claimContract],
          });
          const allowanceCheck = validateAllowance(currentAllowance, params.amount);
          if (!allowanceCheck.valid) {
            throw new ClaimCreationError(
              ClaimCreationErrorCode.ALLOWANCE_INSUFFICIENT,
              'The claim contract is not approved to transfer the claim amount.',
            );
          }
        }

        // 1. Optional allowance handling.
        if (params.approval) {
          const { token, spender, requiredAmount } = params.approval;
          const approvedToken = getAddress(token);
          const approvedSpender = getAddress(spender);

          setStatus('simulating');
          const allowance = await publicClient.readContract({
            address: approvedToken,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account, approvedSpender],
          });

          if (allowance < requiredAmount) {
            setStatus('approving');
            // Approve only the missing amount; this keeps approval amounts exact.
            const approvalHash = await walletClient.data.writeContract({
              address: approvedToken,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [approvedSpender, requiredAmount],
              account,
              chain: walletClient.data.chain,
            });

            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            if (approvalReceipt.status !== 'success') {
              throw new ClaimCreationError(
                ClaimCreationErrorCode.APPROVAL_FAILED,
                `Approval transaction ${approvalHash} has status "${approvalReceipt.status}".`,
              );
            }
          }
        }

        // 2. Simulate the canonical claim creation call.
        setStatus('simulating');
        const simulationArgs = [
          params.contentDigest,
          asset,
          params.amount,
          params.frozenConfig,
        ] as const;

        const simulation = await publicClient.simulateContract({
          address: claimContract,
          abi: CLAIM_CREATION_ABI,
          functionName: 'createClaim',
          args: simulationArgs,
          account,
        });

        // 3. Submit the transaction.
        setStatus('submitting');
        const writeHash = await walletClient.data.writeContract(simulation.request);

        setTxHash(writeHash);
        setStatus('confirming');

        const receipt = await publicClient.waitForTransactionReceipt({ hash: writeHash });
        if (receipt.status !== 'success') {
          throw new ClaimCreationError(
            ClaimCreationErrorCode.TRANSACTION_REVERTED,
            `Claim creation transaction ${writeHash} reverted.`,
          );
        }

        // 4. Reconcile the indexed claim.
        setStatus('reconciling');
        let indexedClaim: unknown;
        try {
          indexedClaim = await params.getIndexedClaim({
            contentDigest: params.contentDigest,
            txHash: writeHash,
            chainId: expectedChainId,
          });
        } catch (indexError) {
          throw new ClaimCreationError(
            ClaimCreationErrorCode.CLAIM_NOT_INDEXED,
            'Claim transaction confirmed but indexed claim could not be reconciled.',
            { cause: indexError },
          );
        }

        setStatus('success');
        return { status: 'success', txHash: writeHash, indexedClaim };
      } catch (caughtError) {
        const typedError = toErrorCode(caughtError);
        setError(typedError);
        setStatus('error');
        return { status: 'error', error: typedError };
      }
    },
    [isConnected, address, publicClient, walletClient, connectedChainId, reset],
  );

  const createClaim = useCallback(
    async (params: ClaimCreationParams): Promise<ClaimCreationResult> => {
      if (inFlight.current) {
        // Leave the running attempt's state untouched.
        return {
          status: 'error',
          error: new ClaimCreationError(
            ClaimCreationErrorCode.SUBMISSION_IN_PROGRESS,
            'A claim submission is already in progress.',
          ),
        };
      }
      inFlight.current = true;
      try {
        return await runCreateClaim(params);
      } finally {
        inFlight.current = false;
      }
    },
    [runCreateClaim],
  );

  return {
    createClaim,
    reset,
    status,
    txHash,
    error,
  };
}
