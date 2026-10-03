/**
 * V2-FE-145 — CI Accessibility Gate Integration Test
 *
 * Verifies that canonical Optimism/EVM UI component state transitions maintain
 * valid ARIA roles, announcements, focusability, and 0 axe-core WCAG AA violations
 * without concealed skips.
 */

import React from 'react';
import { render, screen } from '../utils/test-utils';
import { assertAccessible } from '../utils/axe';
import { MotionSafeStatus } from '@/components/ui/MotionSafeStatus';
import { FallbackBoundary } from '@/components/common/FallbackBoundary';
import { TransactionStatus } from '@/components/features/claim-verification/TransactionStatus';

describe('CI Accessibility Gate: State Transitions & Boundary Validation', () => {
  it('loading state renders accessible live region with polite announcement', async () => {
    const { container } = render(
      <MotionSafeStatus
        label="Loading canonical state"
        detail="Polling RPC projection for Optimism block finality."
        tone="pending"
        pulse
      />
    );

    const statusEl = screen.getByRole('status');
    expect(statusEl).toBeInTheDocument();
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
    await assertAccessible(container);
  });

  it('unsupported-chain failure state renders assertive alert live region', async () => {
    const { container } = render(
      <FallbackBoundary
        status="blocked"
        reason="Chain 1 is unsupported. TruthBounty operates strictly on Optimism / Optimism Sepolia."
        blockActions
      >
        <button type="button">Submit Transaction</button>
      </FallbackBoundary>
    );

    const alertEl = screen.getByRole('alert');
    expect(alertEl).toBeInTheDocument();
    expect(alertEl).toHaveAttribute('aria-live', 'assertive');
    await assertAccessible(container);
  });

  it('finalized state transition renders accessible success status', async () => {
    const { container } = render(
      <div>
        <TransactionStatus status="success" />
        <MotionSafeStatus
          label="Finalized"
          detail="Transaction confirmed on Optimism Sepolia. Safe and indexed."
          tone="success"
        />
      </div>
    );

    const statusEls = screen.getAllByRole('status');
    expect(statusEls.length).toBeGreaterThan(0);
    await assertAccessible(container);
  });
});
