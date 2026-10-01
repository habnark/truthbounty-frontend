'use client';

import React from 'react';
import type { WalletIdentityTransition } from '@/lib/wallet/identity';

export interface WalletStateRecoveryNoticeProps {
  /** The provider change that triggered recovery. */
  transition: WalletIdentityTransition;
  /** Clear the recovery requirement (user must then reconnect/sign in). */
  onAcknowledge: () => void;
}

function describeTransition(transition: WalletIdentityTransition): string {
  switch (transition) {
    case 'chain-change':
      return 'Your wallet network changed.';
    case 'account-change':
      return 'Your wallet account changed.';
    default:
      return 'Your wallet connection changed.';
  }
}

/**
 * Accessible, explicit recovery notice shown after the wallet account or chain
 * changes. Wallet-scoped data has already been cleared; the user must
 * acknowledge and sign in again before continuing.
 */
export function WalletStateRecoveryNotice({
  transition,
  onAcknowledge,
}: WalletStateRecoveryNoticeProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="wallet-state-recovery"
      className="bg-amber-500 text-black px-4 sm:px-8 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm">
        {describeTransition(transition)} For your security, wallet-specific data
        was cleared. Reconnect and sign in again before continuing.
      </p>
      <button
        type="button"
        onClick={onAcknowledge}
        className="underline text-sm self-start sm:self-auto"
        aria-label="Dismiss wallet change notice"
      >
        Dismiss
      </button>
    </div>
  );
}

export default WalletStateRecoveryNotice;
