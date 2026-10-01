/**
 * V2-FE-046 — Accessible recovery notice + guard.
 *
 * Asserts the wallet-change recovery surface announces the change, is
 * keyboard operable, and has no axe violations.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { assertAccessible } from '../utils/axe';
import { WalletStateRecoveryNotice } from '@/components/ui/WalletStateRecoveryNotice';

const mockAcknowledge = jest.fn();

jest.mock('@/hooks/useWalletIdentityInvalidation', () => ({
  useWalletIdentityInvalidation: () => ({
    requiresRecovery: true,
    lastTransition: 'account-change',
    acknowledge: mockAcknowledge,
  }),
  discardUnsignedTransactionIntents: jest.fn(() => 0),
}));

jest.mock('@/context/SiweAuthProvider', () => ({
  useSiweSession: () => ({ setSession: jest.fn() }),
}));

beforeEach(() => {
  mockAcknowledge.mockClear();
});

describe('Accessibility: wallet state recovery', () => {
  it('announces an account change with no axe violations', async () => {
    const { container } = render(
      <WalletStateRecoveryNotice transition="account-change" onAcknowledge={jest.fn()} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/wallet account changed/i);
    await assertAccessible(container);
  });

  it('announces a network change', () => {
    render(
      <WalletStateRecoveryNotice transition="chain-change" onAcknowledge={jest.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/wallet network changed/i);
  });

  it('is dismissible from the keyboard', async () => {
    render(
      <WalletStateRecoveryNotice transition="account-change" onAcknowledge={mockAcknowledge} />,
    );

    await userEvent.tab();
    const dismiss = screen.getByRole('button', { name: /dismiss wallet change notice/i });
    expect(dismiss).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('WalletStateGuard renders the accessible notice with no axe violations', async () => {
    const { WalletStateGuard } = await import('@/components/providers/WalletStateGuard');
    const { container } = render(
      <WalletStateGuard>
        <p>app content</p>
      </WalletStateGuard>,
    );

    expect(screen.getByTestId('wallet-state-recovery')).toBeInTheDocument();
    expect(screen.getByText('app content')).toBeInTheDocument();
    await assertAccessible(container);
  });
});
