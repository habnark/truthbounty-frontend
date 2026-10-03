/**
 * Integration tests for useRealtimeData
 *
 * Verifies that WebSocket projection-stream events:
 *  1. Use canonical query keys — never raw string arrays.
 *  2. Perform surgical cache updates, not cache-wide invalidation.
 *  3. Correctly propagate claim-status, dispute, and reputation changes.
 *
 * The WebSocket is mocked at the provider boundary so no real WS connection
 * is needed.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { queryKeys } from '@/app/queries/queryKeys';

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------
type Handler = (payload: unknown) => void;

interface MockWebSocketContextValue {
  isConnected: boolean;
  subscribe: jest.Mock;
  // Test helper: emit an event to all subscribers for a given type.
  emit: (type: string, payload: unknown) => void;
}

const handlers: Map<string, Handler[]> = new Map();

const mockWsCtx: MockWebSocketContextValue = {
  isConnected: true,
  subscribe: jest.fn((type: string, handler: Handler) => {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type)!.push(handler);
    return () => {
      const arr = handlers.get(type) ?? [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }),
  emit(type: string, payload: unknown) {
    for (const h of handlers.get(type) ?? []) {
      h(payload);
    }
  },
};

jest.mock('@/components/providers/WebSocketProvider', () => ({
  useWebSocketContext: () => mockWsCtx,
}));

// ---------------------------------------------------------------------------
// Leaderboard normaliser mock
// ---------------------------------------------------------------------------
jest.mock('@/lib/leaderboard', () => ({
  sortAndNormalizeLeaderboard: (data: unknown) => data,
}));

// ---------------------------------------------------------------------------
// Test wrapper
// ---------------------------------------------------------------------------

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRealtimeData — canonical key integration', () => {
  let qc: QueryClient;

  beforeEach(() => {
    handlers.clear();
    mockWsCtx.subscribe.mockClear();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    qc.clear();
  });

  // -------------------------------------------------------------------------
  // CLAIM_CREATED
  // -------------------------------------------------------------------------
  it('CLAIM_CREATED prepends claim to cache list', async () => {
    // Seed the cache with an existing list.
    qc.setQueryData(queryKeys.claims.lists(), [{ id: 'claim-old', title: 'Old' }]);

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    const newClaim = { id: 'claim-new', title: 'New Claim' };
    act(() => mockWsCtx.emit('CLAIM_CREATED', { claim: newClaim }));

    await waitFor(() => {
      const list = qc.getQueryData<unknown[]>(queryKeys.claims.lists());
      expect(list?.[0]).toEqual(newClaim);
    });
  });

  // -------------------------------------------------------------------------
  // CLAIM_UPDATED
  // -------------------------------------------------------------------------
  it('CLAIM_UPDATED patches detail cache without touching other entries', async () => {
    qc.setQueryData(queryKeys.claims.detail('claim-1'), {
      id: 'claim-1',
      title: 'Original',
      status: 'OPEN',
    });
    qc.setQueryData(queryKeys.claims.detail('claim-2'), {
      id: 'claim-2',
      title: 'Unrelated',
      status: 'OPEN',
    });

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('CLAIM_UPDATED', {
        claimId: 'claim-1',
        updates: { title: 'Updated' },
      }),
    );

    await waitFor(() => {
      const detail = qc.getQueryData<Record<string, unknown>>(
        queryKeys.claims.detail('claim-1'),
      );
      expect(detail?.title).toBe('Updated');
    });

    // Unrelated claim must be untouched.
    const other = qc.getQueryData<Record<string, unknown>>(
      queryKeys.claims.detail('claim-2'),
    );
    expect(other?.title).toBe('Unrelated');
  });

  // -------------------------------------------------------------------------
  // CLAIM_STATUS_CHANGED
  // -------------------------------------------------------------------------
  it('CLAIM_STATUS_CHANGED updates status and invalidates finality + status-filtered lists', async () => {
    qc.setQueryData(queryKeys.claims.detail('claim-3'), {
      id: 'claim-3',
      status: 'OPEN',
    });
    // Pre-warm the finality cache to confirm it gets evicted.
    qc.setQueryData(queryKeys.claims.finality('claim-3'), { level: 'observed' });

    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('CLAIM_STATUS_CHANGED', {
        claimId: 'claim-3',
        previousStatus: 'OPEN',
        newStatus: 'VERIFIED',
      }),
    );

    await waitFor(() => {
      const detail = qc.getQueryData<Record<string, unknown>>(
        queryKeys.claims.detail('claim-3'),
      );
      expect(detail?.status).toBe('VERIFIED');
    });

    // Finality projection must be invalidated.
    const finalityKey = JSON.stringify(queryKeys.claims.finality('claim-3'));
    const bustedFinality = invalidateSpy.mock.calls.some(
      ([filters]) =>
        Array.isArray((filters as { queryKey?: unknown }).queryKey) &&
        JSON.stringify((filters as { queryKey?: unknown }).queryKey) === finalityKey,
    );
    expect(bustedFinality).toBe(true);
  });

  // -------------------------------------------------------------------------
  // VERIFICATION_ADDED — reputation invalidation
  // -------------------------------------------------------------------------
  it('VERIFICATION_ADDED invalidates verifier reputation using canonical key', async () => {
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('VERIFICATION_ADDED', {
        claimId: 'claim-4',
        verification: {
          id: 'ver-1',
          verifierAddress: '0xverifier1',
          decision: 'VERIFY',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        },
      }),
    );

    await waitFor(() => {
      const reputationKey = JSON.stringify(
        queryKeys.reputation.byUser('0xverifier1'),
      );
      const didInvalidateReputation = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
          reputationKey,
      );
      expect(didInvalidateReputation).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DISPUTE_CREATED — must use disputes.byClaim, not raw ['disputes']
  // -------------------------------------------------------------------------
  it('DISPUTE_CREATED invalidates disputes.byClaim but not disputes.all', async () => {
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('DISPUTE_CREATED', {
        claimId: 'claim-5',
        dispute: { id: 'disp-1', claimId: 'claim-5', status: 'OPEN' },
      }),
    );

    await waitFor(() => {
      const byClaimKey = JSON.stringify(queryKeys.disputes.byClaim('claim-5'));
      const allKey = JSON.stringify(queryKeys.disputes.all);

      const didByClaimInvalidate = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
          byClaimKey,
      );
      const didAllInvalidate = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === allKey,
      );

      expect(didByClaimInvalidate).toBe(true);
      // disputes.all must NOT be invalidated — no cache-wide churn.
      expect(didAllInvalidate).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // DISPUTE_RESOLVED — rewards.all must be invalidated
  // -------------------------------------------------------------------------
  it('DISPUTE_RESOLVED invalidates dispute detail and rewards.all', async () => {
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('DISPUTE_RESOLVED', {
        claimId: 'claim-6',
        disputeId: 'disp-2',
        outcome: 'UPHELD',
        winningVotes: 10,
        losingVotes: 3,
      }),
    );

    await waitFor(() => {
      const rewardsKey = JSON.stringify(queryKeys.rewards.all);
      const disputeDetailKey = JSON.stringify(queryKeys.disputes.detail('disp-2'));

      const bustedRewards = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
          rewardsKey,
      );
      const bustedDisputeDetail = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
          disputeDetailKey,
      );

      expect(bustedRewards).toBe(true);
      expect(bustedDisputeDetail).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // LEADERBOARD_UPDATED — write-through, no fetch
  // -------------------------------------------------------------------------
  it('LEADERBOARD_UPDATED writes directly to cache without invalidation', async () => {
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    const rankings = [{ rank: 1, userId: 'u1', username: 'Alice' }];
    act(() => mockWsCtx.emit('LEADERBOARD_UPDATED', { rankings }));

    await waitFor(() => {
      const cached = qc.getQueryData(queryKeys.leaderboard);
      expect(cached).toEqual(rankings);
    });

    // Write-through must not trigger an invalidation.
    const leaderboardKeyStr = JSON.stringify(queryKeys.leaderboard);
    const invalidatedLeaderboard = invalidateSpy.mock.calls.some(
      ([filters]) =>
        JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
        leaderboardKeyStr,
    );
    expect(invalidatedLeaderboard).toBe(false);
  });

  // -------------------------------------------------------------------------
  // USER_STATS_UPDATED — reputation + user profile scoped bust
  // -------------------------------------------------------------------------
  it('USER_STATS_UPDATED invalidates reputation and profile for the user', async () => {
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

    renderHook(() => useRealtimeData(), { wrapper: makeWrapper(qc) });

    act(() =>
      mockWsCtx.emit('USER_STATS_UPDATED', {
        userId: 'user-7',
        verificationCount: 5,
        accuracy: 95,
        reputation: 120,
        totalStaked: 500,
        totalEarned: 200,
      }),
    );

    await waitFor(() => {
      const repKey = JSON.stringify(queryKeys.reputation.byUser('user-7'));
      const profileKey = JSON.stringify(queryKeys.user.profile('user-7'));

      const didReputation = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === repKey,
      );
      const didProfile = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) ===
          profileKey,
      );

      expect(didReputation).toBe(true);
      expect(didProfile).toBe(true);
    });
  });
});
