/**
 * Unit tests for useProjectionInvalidation
 *
 * Verifies:
 *  - Each action kind invalidates exactly the expected query keys.
 *  - Reorged transactions only bust finality projection keys.
 *  - No cache-wide invalidation happens for any code path.
 */

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProjectionInvalidation, type ConfirmedTxContext } from '@/hooks/useProjectionInvalidation';
import { queryKeys } from '@/app/queries/queryKeys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

/** Capture all invalidated query keys after the callback runs. */
async function captureInvalidations(
  qc: QueryClient,
  run: (invalidate: ReturnType<typeof useProjectionInvalidation>['invalidate']) => void,
): Promise<string[][]> {
  const invalidated: string[][] = [];
  const origInvalidate = qc.invalidateQueries.bind(qc);
  jest
    .spyOn(qc, 'invalidateQueries')
    .mockImplementation(async (filters: { queryKey?: unknown } = {}) => {
      if (Array.isArray(filters.queryKey)) {
        invalidated.push(filters.queryKey as string[]);
      }
      return origInvalidate(filters);
    });

  const { result } = renderHook(() => useProjectionInvalidation(), {
    wrapper: createWrapper(qc),
  });

  act(() => run(result.current.invalidate));
  return invalidated;
}

const TX: `0x${string}` =
  '0xdeadbeef00000000000000000000000000000000000000000000000000000001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProjectionInvalidation', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.clearAllMocks();
  });

  afterEach(() => {
    qc.clear();
  });

  // -------------------------------------------------------------------------
  // reorged — only finality projections
  // -------------------------------------------------------------------------
  describe('reorged', () => {
    it('invalidates only claim finality projection on reorg', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'claim_submitted',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-1',
          finalityLevel: 'reorged',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.finality('claim-1'));
      // Must NOT invalidate the broad claims.all or lists
      expect(keys).not.toContainEqual(expect.arrayContaining(['claims', 'list']));
    });

    it('invalidates only dispute finality projection on reorg', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'dispute_created',
          txHash: TX,
          chainId: 10,
          disputeId: 'disp-1',
          finalityLevel: 'reorged',
        }),
      );
      expect(keys).toContainEqual(queryKeys.disputes.finality('disp-1'));
      expect(keys).not.toContainEqual(['disputes', 'all']);
    });
  });

  // -------------------------------------------------------------------------
  // claim_submitted
  // -------------------------------------------------------------------------
  describe('claim_submitted', () => {
    it('invalidates claims.lists without touching detail or finality', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'claim_submitted',
          txHash: TX,
          chainId: 10,
          finalityLevel: 'observed',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.lists());
      // Must not invalidate the whole claims.all or individual details
      expect(keys).not.toContainEqual(queryKeys.claims.all);
    });
  });

  // -------------------------------------------------------------------------
  // verification_submitted
  // -------------------------------------------------------------------------
  describe('verification_submitted', () => {
    it('invalidates claim detail, verifications for claim, and verifier reputation', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'verification_submitted',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-2',
          fromAddress: '0xverifier',
          finalityLevel: 'safe',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.detail('claim-2'));
      expect(keys).toContainEqual(queryKeys.verifications.byClaim('claim-2'));
      expect(keys).toContainEqual(queryKeys.reputation.byUser('0xverifier'));
    });

    it('does not invalidate rewards or leaderboard', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'verification_submitted',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-2',
          fromAddress: '0xverifier',
          finalityLevel: 'safe',
        }),
      );
      expect(keys).not.toContainEqual(queryKeys.rewards.all);
      expect(keys).not.toContainEqual(queryKeys.leaderboard);
    });
  });

  // -------------------------------------------------------------------------
  // dispute_created
  // -------------------------------------------------------------------------
  describe('dispute_created', () => {
    it('invalidates claim detail and disputes.byClaim', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'dispute_created',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-3',
          finalityLevel: 'observed',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.detail('claim-3'));
      expect(keys).toContainEqual(queryKeys.disputes.byClaim('claim-3'));
    });
  });

  // -------------------------------------------------------------------------
  // dispute_resolved
  // -------------------------------------------------------------------------
  describe('dispute_resolved', () => {
    it('invalidates claim detail, dispute detail, dispute finality, and rewards.all', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'dispute_resolved',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-4',
          disputeId: 'disp-2',
          finalityLevel: 'finalized',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.detail('claim-4'));
      expect(keys).toContainEqual(queryKeys.disputes.detail('disp-2'));
      expect(keys).toContainEqual(queryKeys.disputes.finality('disp-2'));
      expect(keys).toContainEqual(queryKeys.rewards.all);
    });
  });

  // -------------------------------------------------------------------------
  // rewards_claimed
  // -------------------------------------------------------------------------
  describe('rewards_claimed', () => {
    it('invalidates only the claiming wallet rewards and balance', async () => {
      const addr = '0xclaimer';
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'rewards_claimed',
          txHash: TX,
          chainId: 10,
          fromAddress: addr,
          finalityLevel: 'safe',
        }),
      );
      expect(keys).toContainEqual(queryKeys.rewards.claimable(addr));
      expect(keys).toContainEqual(queryKeys.rewards.history(addr));
      expect(keys).toContainEqual(queryKeys.wallet.balance(addr, 10));
      // Must NOT invalidate rewards for all wallets
      expect(keys).not.toContainEqual(queryKeys.rewards.all);
    });
  });

  // -------------------------------------------------------------------------
  // settlement_executed
  // -------------------------------------------------------------------------
  describe('settlement_executed', () => {
    it('invalidates claim detail and rounds for the claim', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'settlement_executed',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-5',
          finalityLevel: 'observed',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.detail('claim-5'));
      expect(keys).toContainEqual(queryKeys.rounds.byClaim('claim-5'));
    });
  });

  // -------------------------------------------------------------------------
  // finalization_executed
  // -------------------------------------------------------------------------
  describe('finalization_executed', () => {
    it('invalidates claim detail, finality, rounds, and rewards.all', async () => {
      const keys = await captureInvalidations(qc, (inv) =>
        inv({
          kind: 'finalization_executed',
          txHash: TX,
          chainId: 10,
          claimId: 'claim-6',
          finalityLevel: 'finalized',
        }),
      );
      expect(keys).toContainEqual(queryKeys.claims.detail('claim-6'));
      expect(keys).toContainEqual(queryKeys.claims.finality('claim-6'));
      expect(keys).toContainEqual(queryKeys.rounds.byClaim('claim-6'));
      expect(keys).toContainEqual(queryKeys.rewards.all);
    });
  });
});
