/**
 * V2-FE-046 — Integration: provider identity changes invalidate app state.
 *
 * Wires the real WalletStateGuard + SiweAuthProvider over a real QueryClient
 * and asserts that an account change:
 *   - removes wallet-scoped query caches while retaining global reads,
 *   - clears the SIWE session (auth revalidation),
 *   - surfaces an accessible recovery notice, and
 *   - stops requiring recovery once acknowledged.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAccount, useChainId } from 'wagmi';

import { WalletStateGuard } from '@/components/providers/WalletStateGuard';
import { SiweAuthProvider, useSiweSession } from '@/context/SiweAuthProvider';
import { createMemorySessionStore } from '@/lib/auth/session-store';
import type { SiweSession } from '@/lib/auth/siwe-types';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(),
  useChainId: jest.fn(),
}));

const mockedUseAccount = useAccount as jest.MockedFunction<typeof useAccount>;
const mockedUseChainId = useChainId as jest.MockedFunction<typeof useChainId>;

const ADDR_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADDR_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function accountFor(address?: string) {
  return {
    address,
    isConnected: Boolean(address),
    isConnecting: false,
    isReconnecting: false,
  } as never;
}

function Consumer() {
  const { isAuthenticated } = useSiweSession();
  return <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>;
}

function sessionFor(address: string): SiweSession {
  const now = Date.now();
  return {
    address,
    chainId: 10,
    token: 'session-token',
    expiresAt: now + 60_000,
    issuedAt: now,
  };
}

describe('Wallet identity change integration', () => {
  it('invalidates wallet state, clears auth and requires recovery on account change', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['user', ADDR_A], { id: ADDR_A });
    qc.setQueryData(['claims'], [{ id: 'c1' }]);

    const store = createMemorySessionStore(() => Date.now());
    store.set(sessionFor(ADDR_A));

    mockedUseChainId.mockReturnValue(10);
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));

    const tree = (children: React.ReactNode) => (
      <QueryClientProvider client={qc}>
        <SiweAuthProvider sessionStore={store}>{children}</SiweAuthProvider>
      </QueryClientProvider>
    );

    const { rerender } = render(
      tree(
        <WalletStateGuard>
          <Consumer />
        </WalletStateGuard>,
      ),
    );

    // Hydrated session is authenticated and the identity is only seeded.
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('yes'));
    expect(screen.queryByTestId('wallet-state-recovery')).not.toBeInTheDocument();

    // Provider account changes A → B.
    mockedUseAccount.mockReturnValue(accountFor(ADDR_B));
    rerender(
      tree(
        <WalletStateGuard>
          <Consumer />
        </WalletStateGuard>,
      ),
    );

    await waitFor(() =>
      expect(screen.getByTestId('wallet-state-recovery')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('auth')).toHaveTextContent('no');
    expect(store.get()).toBeNull();
    expect(qc.getQueryData(['user', ADDR_A])).toBeUndefined();
    expect(qc.getQueryData(['claims'])).toEqual([{ id: 'c1' }]);

    // Explicit recovery: acknowledging dismisses the notice.
    await userEvent.click(screen.getByRole('button', { name: /dismiss wallet change notice/i }));
    await waitFor(() =>
      expect(screen.queryByTestId('wallet-state-recovery')).not.toBeInTheDocument(),
    );
  });
});
