/**
 * Integration tests for disputes.queries.ts
 *
 * Covers V2-FE-020 integration boundaries:
 *  - API boundary: fetch → query cache using canonical keys
 *  - Mutation boundary: createDispute → surgical projection invalidation
 *  - Wrong-network / error paths: API errors do not corrupt unrelated cache entries
 *  - WebSocket boundary: DISPUTE_CREATED and DISPUTE_RESOLVED events drive
 *    correct cache invalidation via useRealtimeData (already covered in
 *    query-key-invalidation.test.tsx; this file tests the query layer itself)
 *
 * No fabricated hashes, dispute IDs, or verdict outcomes.
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useDisputesByClaim,
  useDisputeDetail,
  useCreateDispute,
} from '@/app/queries/disputes.queries';
import { queryKeys } from '@/app/queries/queryKeys';

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();

// jest.setup.js sets global.fetch = jest.fn() and clears it in afterEach.
// We override it in beforeEach so our mock persists across each test.
beforeEach(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

function makeDisputeList(claimId = 'claim-1') {
  return [
    {
      id: 'disp-1',
      claimId,
      reason: 'Incorrect source cited',
      status: 'OPEN' as const,
      proVotes: 5,
      conVotes: 2,
      totalStaked: 100,
      createdAt: '2024-01-01T00:00:00Z',
    },
  ];
}

function makeDispute(id = 'disp-1', claimId = 'claim-1') {
  return {
    id,
    claimId,
    reason: 'Incorrect source cited',
    status: 'OPEN' as const,
    proVotes: 5,
    conVotes: 2,
    totalStaked: 100,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function mockJsonOk(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockJsonError(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('disputes.queries — API integration', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    qc.clear();
  });

  // -------------------------------------------------------------------------
  // useDisputesByClaim — successful path
  // -------------------------------------------------------------------------
  describe('useDisputesByClaim', () => {
    it('fetches disputes for a claim and stores under the canonical key', async () => {
      const disputes = makeDisputeList('claim-10');
      mockFetch.mockReturnValueOnce(mockJsonOk(disputes));

      const { result } = renderHook(
        () => useDisputesByClaim('claim-10'),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(disputes);

      // Confirm stored under the canonical key.
      const cached = qc.getQueryData(queryKeys.disputes.byClaim('claim-10'));
      expect(cached).toEqual(disputes);
    });

    it('is disabled and does not fetch when claimId is empty', () => {
      const { result } = renderHook(
        () => useDisputesByClaim(''),
        { wrapper: createWrapper(qc) },
      );

      expect(result.current.isFetching).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces API error without corrupting unrelated cache entries', async () => {
      // Pre-warm an unrelated entry.
      qc.setQueryData(queryKeys.disputes.byClaim('claim-unrelated'), [
        makeDispute('disp-unrelated', 'claim-unrelated'),
      ]);

      mockFetch.mockReturnValueOnce(mockJsonError(500, { error: 'Server error' }));

      const { result } = renderHook(
        () => useDisputesByClaim('claim-error'),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      // Unrelated entry must be untouched.
      const unrelated = qc.getQueryData(queryKeys.disputes.byClaim('claim-unrelated'));
      expect(unrelated).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // useDisputeDetail — successful path
  // -------------------------------------------------------------------------
  describe('useDisputeDetail', () => {
    it('fetches a single dispute and stores under the canonical detail key', async () => {
      const dispute = makeDispute('disp-detail-1', 'claim-20');
      mockFetch.mockReturnValueOnce(mockJsonOk(dispute));

      const { result } = renderHook(
        () => useDisputeDetail('disp-detail-1'),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(dispute);
      expect(qc.getQueryData(queryKeys.disputes.detail('disp-detail-1'))).toEqual(dispute);
    });

    it('is disabled when disputeId is empty', () => {
      const { result } = renderHook(
        () => useDisputeDetail(''),
        { wrapper: createWrapper(qc) },
      );
      expect(result.current.isFetching).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // useCreateDispute — mutation with surgical invalidation
  // -------------------------------------------------------------------------
  describe('useCreateDispute', () => {
    it('creates a dispute and invalidates only the scoped projection keys', async () => {
      const newDispute = makeDispute('new-disp', 'claim-30');
      mockFetch.mockReturnValueOnce(mockJsonOk(newDispute));

      // Seed a disputes.byClaim and a claims.detail entry that should be busted.
      qc.setQueryData(queryKeys.disputes.byClaim('claim-30'), []);
      qc.setQueryData(queryKeys.claims.detail('claim-30'), {
        id: 'claim-30',
        status: 'OPEN',
      });
      // Seed an unrelated entry that must NOT be busted.
      qc.setQueryData(queryKeys.disputes.byClaim('claim-other'), [
        makeDispute('d-other', 'claim-other'),
      ]);

      const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

      const { result } = renderHook(() => useCreateDispute(), {
        wrapper: createWrapper(qc),
      });

      await act(async () => {
        await result.current.mutateAsync({
          claimId: 'claim-30',
          reason: 'Incorrect source',
          initialStake: 50,
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Scoped keys must be invalidated.
      const byClaimKey = JSON.stringify(queryKeys.disputes.byClaim('claim-30'));
      const claimDetailKey = JSON.stringify(queryKeys.claims.detail('claim-30'));

      const invalidatedByClaim = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === byClaimKey,
      );
      const invalidatedClaimDetail = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === claimDetailKey,
      );

      expect(invalidatedByClaim).toBe(true);
      expect(invalidatedClaimDetail).toBe(true);

      // disputes.all must NOT be invalidated — no cache-wide churn.
      const allKey = JSON.stringify(queryKeys.disputes.all);
      const invalidatedAll = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === allKey,
      );
      expect(invalidatedAll).toBe(false);

      // Unrelated byClaim entry must not be touched.
      const otherKey = JSON.stringify(queryKeys.disputes.byClaim('claim-other'));
      const invalidatedOther = invalidateSpy.mock.calls.some(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown }).queryKey) === otherKey,
      );
      expect(invalidatedOther).toBe(false);
    });

    it('does not invalidate on mutation error', async () => {
      mockFetch.mockReturnValueOnce(mockJsonError(400, { error: 'Bad request' }));

      const invalidateSpy = jest.spyOn(qc, 'invalidateQueries');

      const { result } = renderHook(() => useCreateDispute(), {
        wrapper: createWrapper(qc),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            claimId: 'claim-fail',
            reason: 'Invalid',
            initialStake: 0,
          });
        } catch {
          // Expected — mutation failed.
        }
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      // No invalidation should have happened.
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Key isolation — disputesKeys.byClaim and disputesKeys.detail never collide
  // -------------------------------------------------------------------------
  describe('key isolation', () => {
    it('byClaim and detail keys for the same ID are distinct', () => {
      const byClaim = JSON.stringify(queryKeys.disputes.byClaim('disp-x'));
      const detail = JSON.stringify(queryKeys.disputes.detail('disp-x'));
      expect(byClaim).not.toBe(detail);
    });

    it('finality key is distinct from both byClaim and detail', () => {
      const finality = JSON.stringify(queryKeys.disputes.finality('disp-x'));
      const byClaim = JSON.stringify(queryKeys.disputes.byClaim('disp-x'));
      const detail = JSON.stringify(queryKeys.disputes.detail('disp-x'));
      expect(finality).not.toBe(byClaim);
      expect(finality).not.toBe(detail);
    });
  });
});
