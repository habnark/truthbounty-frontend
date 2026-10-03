/**
 * V2-FE-070 — Protocol Operation Mapper
 * 
 * Maps protocol error codes and transaction states to translation keys.
 * Ensures type-safe mapping between internal identifiers and i18n keys.
 * 
 * Security: This module ONLY maps keys; it never fabricates data.
 */

import type {
  TransactionMachineErrorReason,
  TransactionStatus,
} from '@/lib/transaction-machine/transaction-machine.types';

import type { ClaimCreationErrorCode } from '@/hooks/useClaimCreationTransaction';

/**
 * Map TransactionMachineError reason codes to translation keys.
 * 
 * These are error CODES from the transaction machine, not user messages.
 * The translation system converts them to localized user-facing messages.
 */
export const TRANSACTION_ERROR_KEY_MAP: Record<
  TransactionMachineErrorReason,
  string
> = {
  USER_REJECTED: 'transaction.errors.USER_REJECTED',
  WRONG_NETWORK: 'transaction.errors.WRONG_NETWORK',
  REVERT: 'transaction.errors.REVERT',
  DROPPED: 'transaction.errors.DROPPED',
  REPLACED: 'transaction.errors.REPLACED',
  STALE_RECEIPT: 'transaction.errors.STALE_RECEIPT',
  INVALID_TRANSITION: 'transaction.errors.INVALID_TRANSITION',
  INVALID_PERSISTED_STATE: 'transaction.errors.INVALID_PERSISTED_STATE',
};

/**
 * Map transaction machine states to translation keys.
 * 
 * These map the internal state machine status to user-visible labels.
 */
export const TRANSACTION_STATE_KEY_MAP: Record<TransactionStatus, string> = {
  idle: 'transaction.states.idle',
  preparing: 'transaction.states.preparing',
  'signature-requested': 'transaction.states.signatureRequested',
  submitted: 'transaction.states.submitted',
  confirming: 'transaction.states.confirming',
  safe: 'transaction.states.safe',
  indexing: 'transaction.states.indexing',
  finalized: 'transaction.states.finalized',
  dropped: 'transaction.states.dropped',
  replaced: 'transaction.states.replaced',
  reverted: 'transaction.states.reverted',
};

/**
 * Map transaction machine states to description keys.
 */
export const TRANSACTION_STATE_DESCRIPTION_MAP: Record<TransactionStatus, string> = {
  idle: 'transaction.stateDescriptions.idle',
  preparing: 'transaction.stateDescriptions.preparing',
  'signature-requested': 'transaction.stateDescriptions.signatureRequested',
  submitted: 'transaction.stateDescriptions.submitted',
  confirming: 'transaction.stateDescriptions.confirming',
  safe: 'transaction.stateDescriptions.safe',
  indexing: 'transaction.stateDescriptions.indexing',
  finalized: 'transaction.stateDescriptions.finalized',
  dropped: 'transaction.stateDescriptions.dropped',
  replaced: 'transaction.stateDescriptions.replaced',
  reverted: 'transaction.stateDescriptions.reverted',
};

/**
 * Map ClaimCreationError codes to translation keys.
 */
export const CLAIM_ERROR_KEY_MAP: Record<ClaimCreationErrorCode, string> = {
  INVALID_CHAIN: 'claim.errors.INVALID_CHAIN',
  INVALID_ADDRESS: 'claim.errors.INVALID_ADDRESS',
  INVALID_CONTENT_DIGEST: 'claim.errors.INVALID_CONTENT_DIGEST',
  INVALID_AMOUNT: 'claim.errors.INVALID_AMOUNT',
  INVALID_CONFIG: 'claim.errors.INVALID_CONFIG',
  INVALID_ARTIFACT_VERSION: 'claim.errors.INVALID_ARTIFACT_VERSION',
  WALLET_NOT_CONNECTED: 'claim.errors.WALLET_NOT_CONNECTED',
  USER_REJECTED: 'claim.errors.USER_REJECTED',
  SIMULATION_REVERTED: 'claim.errors.SIMULATION_REVERTED',
  TRANSACTION_REVERTED: 'claim.errors.TRANSACTION_REVERTED',
  TX_NOT_FOUND: 'claim.errors.TX_NOT_FOUND',
  ALLOWANCE_INSUFFICIENT: 'claim.errors.ALLOWANCE_INSUFFICIENT',
  INSUFFICIENT_BALANCE: 'claim.errors.INSUFFICIENT_BALANCE',
  SUBMISSION_IN_PROGRESS: 'claim.errors.SUBMISSION_IN_PROGRESS',
  APPROVAL_FAILED: 'claim.errors.APPROVAL_FAILED',
  CLAIM_NOT_INDEXED: 'claim.errors.CLAIM_NOT_INDEXED',
  UNEXPECTED_ERROR: 'claim.errors.UNEXPECTED_ERROR',
};

/**
 * Map claim creation status to translation keys.
 */
export const CLAIM_STATUS_KEY_MAP: Record<string, string> = {
  idle: 'claim.status.idle',
  validating: 'claim.status.validating',
  approving: 'claim.status.approving',
  simulating: 'claim.status.simulating',
  submitting: 'claim.status.submitting',
  confirming: 'claim.status.confirming',
  reconciling: 'claim.status.reconciling',
  success: 'claim.status.success',
  error: 'claim.status.error',
};

/**
 * Get translation key for a transaction error.
 * Falls back to generic error if code is unknown.
 */
export function getTransactionErrorKey(
  errorReason: TransactionMachineErrorReason
): string {
  return TRANSACTION_ERROR_KEY_MAP[errorReason] ?? 'transaction.errors.unknownError';
}

/**
 * Get translation key for a transaction state.
 */
export function getTransactionStateKey(status: TransactionStatus): string {
  return TRANSACTION_STATE_KEY_MAP[status] ?? 'transaction.states.idle';
}

/**
 * Get translation key for a transaction state description.
 */
export function getTransactionStateDescriptionKey(status: TransactionStatus): string {
  return TRANSACTION_STATE_DESCRIPTION_MAP[status] ?? 'transaction.stateDescriptions.idle';
}

/**
 * Get translation key for a claim creation error.
 */
export function getClaimErrorKey(errorCode: ClaimCreationErrorCode): string {
  return CLAIM_ERROR_KEY_MAP[errorCode] ?? 'claim.errors.unexpectedError';
}

/**
 * Get translation key for a claim creation status.
 */
export function getClaimStatusKey(status: string): string {
  return CLAIM_STATUS_KEY_MAP[status] ?? 'claim.status.idle';
}

/**
 * Extract parameters from an error object for translation interpolation.
 * 
 * SECURITY: This function ONLY extracts parameters for display.
 * It does NOT fabricate or modify any protocol data.
 */
export function extractErrorParams(error: unknown): Record<string, string | number> {
  const params: Record<string, string | number> = {};

  if (typeof error !== 'object' || error === null) {
    return params;
  }

  // Extract common error properties safely
  const errorObj = error as Record<string, unknown>;

  if (typeof errorObj.chainId === 'number') {
    params.chainId = errorObj.chainId;
  }

  if (typeof errorObj.expectedChainId === 'number') {
    params.expectedChain = errorObj.expectedChainId;
  }

  if (typeof errorObj.connectedChainId === 'number') {
    params.connectedChain = errorObj.connectedChainId;
  }

  if (typeof errorObj.receiptChainId === 'number') {
    params.receiptChain = errorObj.receiptChainId;
  }

  if (typeof errorObj.address === 'string') {
    params.address = errorObj.address;
  }

  if (typeof errorObj.expected === 'string') {
    params.expected = errorObj.expected;
  }

  if (typeof errorObj.received === 'string') {
    params.received = errorObj.received;
  }

  if (typeof errorObj.reason === 'string') {
    params.reason = errorObj.reason;
  }

  if (typeof errorObj.message === 'string') {
    params.message = errorObj.message;
  }

  if (typeof errorObj.replacedByHash === 'string') {
    params.replacedByHash = errorObj.replacedByHash;
  }

  return params;
}

/**
 * Check if a state represents a terminal failure.
 */
export function isFailureState(status: TransactionStatus): boolean {
  return status === 'dropped' || status === 'replaced' || status === 'reverted';
}

/**
 * Check if a state represents success.
 */
export function isSuccessState(status: TransactionStatus): boolean {
  return status === 'finalized';
}

/**
 * Check if a state is in progress.
 */
export function isInProgressState(status: TransactionStatus): boolean {
  return (
    status === 'preparing' ||
    status === 'signature-requested' ||
    status === 'submitted' ||
    status === 'confirming' ||
    status === 'safe' ||
    status === 'indexing'
  );
}

/**
 * Get appropriate semantic color for a transaction state.
 * Returns Tailwind color class names.
 */
export function getStateColor(status: TransactionStatus): string {
  if (isSuccessState(status)) return 'green';
  if (isFailureState(status)) return 'red';
  if (isInProgressState(status)) return 'blue';
  return 'gray';
}

/**
 * Get appropriate icon identifier for a transaction state.
 */
export function getStateIcon(status: TransactionStatus): string {
  if (isSuccessState(status)) return 'check-circle';
  if (isFailureState(status)) return 'x-circle';
  if (status === 'signature-requested') return 'edit';
  if (isInProgressState(status)) return 'loader';
  return 'circle';
}
