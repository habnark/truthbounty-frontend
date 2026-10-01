'use client';

import React, { type ReactNode } from 'react';

import { useSiweSession } from '@/context/SiweAuthProvider';
import { useWalletIdentityInvalidation } from '@/hooks/useWalletIdentityInvalidation';
import { WalletStateRecoveryNotice } from '@/components/ui/WalletStateRecoveryNotice';

export interface WalletStateGuardProps {
  children: ReactNode;
}

/**
 * V2-FE-046 — App-level wallet identity guard.
 *
 * Mounts the identity invalidation hook (cancels incompatible queries, clears
 * wallet-scoped caches and unsigned transaction intents, revalidates auth) and
 * renders an accessible recovery notice when the account/chain changes.
 *
 * No visual redesign: the notice only appears while recovery is required.
 */
export function WalletStateGuard({ children }: WalletStateGuardProps) {
  const { setSession } = useSiweSession();
  const { requiresRecovery, lastTransition, acknowledge } =
    useWalletIdentityInvalidation({
      onRevalidateAuth: () => {
        // Drop the SIWE session; the user must sign in again.
        setSession(null);
      },
    });

  return (
    <>
      {requiresRecovery && (
        <WalletStateRecoveryNotice
          transition={lastTransition}
          onAcknowledge={acknowledge}
        />
      )}
      {children}
    </>
  );
}

export default WalletStateGuard;
