/**
 * V2-FE-046 — useWalletIdentityInvalidation unit tests.
 *
 * Verifies deterministic invalidation on provider identity changes:
 *  - initial hydration/reconnect is seeded, never treated as a change
 *  - account/chain changes cancel queries, clear wallet-scoped caches,
 *    revalidate auth, and require explicit recovery
 *  - disconnect clears state without requiring recovery
 *  - only unsigned transaction intents are discarded
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAccount, useChainId } from 'wagmi';

import {
  discardUnsignedTransactionIntents,
  useWalletIdentityInvalidation,
} from '../useWalletIdentityInvalidation';
import {
  createTxContext,
  hydrateTxState,
  persistTxState,
  updateTxContext,
} from '@/lib/transaction-machine/transaction-persistence';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(),
  useChainId: jest.fn(),
}));

const mockedUseAccount = useAccount as jest.MockedFunction<typeof useAccount>;
const mockedUseChainId = useChainId as jest.MockedFunction<typeof useChainId>;

const ADDR_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADDR_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const HASH = `0x${'a'.repeat(64)}` as const;

function accountFor(address?: string, opts: { isConnecting?: boolean; isReconnecting?: boolean } = {}) {
  return {
    address,
    isConnected: Boolean(address),
    isConnecting: Boolean(opts.isConnecting),
    isReconnecting: Boolean(opts.isReconnecting),
  } as never;
}

let qc: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockedUseChainId.mockReturnValue(10);
  mockedUseAccount.mockReturnValue(accountFor(undefined));
});

function renderInvalidation(options: Parameters<typeof useWalletIdentityInvalidation>[0] = {}) {
  return renderHook(() => useWalletIdentityInvalidation(options), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
}

describe('useWalletIdentityInvalidation', () => {
  it('does not invalidate on initial hydration/reconnect', async () => {
    const cancelSpy = jest.spyOn(qc, 'cancelQueries');
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));

    const { result } = renderInvalidation();

    await waitFor(() => expect(result.current.lastTransition).toBe('none'));
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(result.current.requiresRecovery).toBe(false);
  });

  it('cancels queries and clears wallet-scoped cache on account change', async () => {
    const cancelSpy = jest.spyOn(qc, 'cancelQueries');
    qc.setQueryData(['user', ADDR_A], { id: ADDR_A });
    qc.setQueryData(['claims'], [{ id: 'c1' }]);
    const onRevalidateAuth = jest.fn();
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));

    const { result, rerender } = renderInvalidation({ onRevalidateAuth });
    await waitFor(() => expect(result.current.lastTransition).toBe('none'));

    mockedUseAccount.mockReturnValue(accountFor(ADDR_B));
    rerender();

    await waitFor(() => expect(result.current.lastTransition).toBe('account-change'));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['user', ADDR_A])).toBeUndefined();
    expect(qc.getQueryData(['claims'])).toEqual([{ id: 'c1' }]);
    expect(onRevalidateAuth).toHaveBeenCalledWith('account-change');
    expect(result.current.requiresRecovery).toBe(true);
  });

  it('revalidates auth on connect without requiring recovery', async () => {
    const onRevalidateAuth = jest.fn();
    mockedUseAccount.mockReturnValue(accountFor(undefined));

    const { result, rerender } = renderInvalidation({ onRevalidateAuth });
    await waitFor(() => expect(result.current.lastTransition).toBe('none'));

    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));
    rerender();

    await waitFor(() => expect(result.current.lastTransition).toBe('connect'));
    expect(onRevalidateAuth).toHaveBeenCalledWith('connect');
    expect(result.current.requiresRecovery).toBe(false);
  });

  it('clears state on disconnect without requiring recovery', async () => {
    const onRevalidateAuth = jest.fn();
    qc.setQueryData(['user', ADDR_A], { id: ADDR_A });
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));

    const { result, rerender } = renderInvalidation({ onRevalidateAuth });
    await waitFor(() => expect(result.current.lastTransition).toBe('none'));

    mockedUseAccount.mockReturnValue(accountFor(undefined));
    rerender();

    await waitFor(() => expect(result.current.lastTransition).toBe('disconnect'));
    expect(onRevalidateAuth).toHaveBeenCalledWith('disconnect');
    expect(qc.getQueryData(['user', ADDR_A])).toBeUndefined();
    expect(result.current.requiresRecovery).toBe(false);
  });

  it('requires recovery on chain change', async () => {
    const onRevalidateAuth = jest.fn();
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));
    mockedUseChainId.mockReturnValue(10);

    const { result, rerender } = renderInvalidation({ onRevalidateAuth });
    await waitFor(() => expect(result.current.lastTransition).toBe('none'));

    mockedUseChainId.mockReturnValue(11155420);
    rerender();

    await waitFor(() => expect(result.current.lastTransition).toBe('chain-change'));
    expect(onRevalidateAuth).toHaveBeenCalledWith('chain-change');
    expect(result.current.requiresRecovery).toBe(true);
  });

  it('acknowledge clears the recovery requirement', async () => {
    mockedUseAccount.mockReturnValue(accountFor(ADDR_A));
    const { result, rerender } = renderInvalidation();
    await waitFor(() => expect(result.current.lastTransition).toBe('none'));

    mockedUseAccount.mockReturnValue(accountFor(ADDR_B));
    rerender();
    await waitFor(() => expect(result.current.requiresRecovery).toBe(true));

    result.current.acknowledge();
    await waitFor(() => expect(result.current.requiresRecovery).toBe(false));
  });
});

describe('discardUnsignedTransactionIntents', () => {
  it('discards unsigned intents but preserves submitted transactions', () => {
    persistTxState(
      updateTxContext(createTxContext('unsigned', 'Unsigned'), {
        status: 'signature-requested',
        txHash: null,
        chainId: 10,
      } as never),
    );
    persistTxState(
      updateTxContext(createTxContext('submitted', 'Submitted'), {
        status: 'submitted',
        txHash: HASH,
        chainId: 10,
      } as never),
    );

    expect(discardUnsignedTransactionIntents()).toBe(1);
    expect(hydrateTxState('unsigned')).toBeNull();
    expect(hydrateTxState('submitted')).not.toBeNull();
  });
});
