'use client';

/**
 * V2-FE-050 — PermitSigningPanel
 *
 * Optional permit authorization with the standard approval as fallback.
 *
 *  - When permit is unavailable (no canonical entrypoint, unreviewed token,
 *    wrong chain, domain mismatch, ...) only `fallback` is rendered, so the
 *    existing approval UI is unchanged.
 *  - Otherwise the exact typed data to be signed is shown before signing
 *    (token, spender, amount, nonce, expiry, network, signer), and the user
 *    can switch to the standard approval at every step.
 *
 * Accessibility: a polite live region announces each state, in-flight
 * buttons set aria-busy, and every action is a native button (keyboard
 * operable with Tab / Enter / Space).
 */

import React, { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermitErrorReason, UsePermitSignatureResult } from '@/hooks/usePermitSignature';

export interface PermitSigningPanelProps {
  /** Result of usePermitSignature(). */
  permit: UsePermitSignatureResult;
  /** Standard approval UI (e.g. <ApprovalButton />) used whenever permit is not. */
  fallback: React.ReactNode;
  className?: string;
}

const ERROR_MESSAGES: Record<PermitErrorReason, string> = {
  READ_FAILED: 'Could not read permit details from the network.',
  SIGNATURE_FAILED: 'The wallet could not produce a permit signature.',
  SIGNER_MISMATCH: 'The signature does not belong to the connected account and was discarded.',
  NONCE_CONSUMED: 'This permit was already used or replaced and was discarded.',
};

function announcementFor(permit: UsePermitSignatureResult): string | null {
  switch (permit.status) {
    case 'preparing':
      return 'Reading permit details from the network.';
    case 'ready':
      return 'Review the permit details, then sign in your wallet.';
    case 'awaiting-signature':
      return 'Waiting for your wallet to sign the permit.';
    case 'signed':
      return 'Permit signed. It is checked again on-chain before submission.';
    case 'rejected':
      return 'You declined the permit signature. You can review it again or use the standard approval.';
    case 'expired':
      return 'The permit expired before submission. Review and sign a new one, or use the standard approval.';
    case 'error':
      return permit.errorReason ? ERROR_MESSAGES[permit.errorReason] : 'The permit could not be used.';
    default:
      return null;
  }
}

export function PermitSigningPanel({ permit, fallback, className }: PermitSigningPanelProps) {
  const headingId = useId();
  const liveId = useId();
  const [useApproval, setUseApproval] = useState(false);

  if (permit.status === 'unavailable') {
    return <>{fallback}</>;
  }

  if (useApproval) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {fallback}
        <Button type="button" variant="ghost" size="sm" onClick={() => setUseApproval(false)}>
          Sign a permit instead
        </Button>
      </div>
    );
  }

  const chooseApproval = () => {
    permit.reset();
    setUseApproval(true);
  };

  const announcement = announcementFor(permit);
  const showDetails =
    permit.displayRows.length > 0 &&
    (permit.status === 'ready' || permit.status === 'awaiting-signature' || permit.status === 'signed');
  const canReview =
    permit.status === 'idle' ||
    permit.status === 'rejected' ||
    permit.status === 'expired' ||
    permit.status === 'error';

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-3 rounded-md border p-4', className)}
      data-testid="permit-signing-panel"
      data-permit-status={permit.status}
    >
      <h3 id={headingId} className="text-sm font-semibold">
        Authorize with a permit signature
      </h3>

      <div id={liveId} role="status" aria-live="polite" aria-atomic="true" className="text-sm">
        {announcement}
      </div>

      {showDetails && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm" aria-label="Permit details">
          {permit.displayRows.map((row) => (
            <React.Fragment key={row.label}>
              <dt className="font-medium">{row.label}</dt>
              <dd className="break-all font-mono">{row.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        {canReview && (
          <Button type="button" onClick={() => void permit.prepare()} aria-describedby={announcement ? liveId : undefined}>
            {permit.status === 'idle' ? 'Review permit' : 'Review permit again'}
          </Button>
        )}

        {permit.status === 'preparing' && (
          <Button type="button" disabled aria-busy="true">
            Reading permit details…
          </Button>
        )}

        {permit.status === 'ready' && (
          <Button type="button" onClick={() => void permit.sign()}>
            Sign permit
          </Button>
        )}

        {permit.status === 'awaiting-signature' && (
          <Button type="button" disabled aria-busy="true">
            Waiting for wallet…
          </Button>
        )}

        {permit.status !== 'signed' && permit.status !== 'awaiting-signature' && (
          <Button type="button" variant="outline" onClick={chooseApproval}>
            Use standard approval instead
          </Button>
        )}
      </div>
    </section>
  );
}

export default PermitSigningPanel;
