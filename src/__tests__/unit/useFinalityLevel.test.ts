/**
 * Unit tests for useFinalityLevel
 *
 * Covers V2-FE-020 required paths:
 *  - Successful: observed → safe → finalized progression
 *  - Rejected (chain mismatch / wrong network)
 *  - Reverted receipt (status 0x0) — level still derived correctly
 *  - Stale: hook disabled when txHash is absent
 *  - Wrong-network: public client chain ID does not match expectedChainId
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFinalityLevel, useClaimFinalityCache } from '@/hooks/useFinalityLevel';

// ---------------------------------------------------------------------------
// Wagmi mock — provide getTransactionReceipt and getBlock
// ---------------------------------------------------------------------------

const mockGetTransactionReceipt = jest.fn();
const mockGetBlock = jest.fn();
const mockGetBlockNumber = jest.fn();

// Default: publicClient.chain.id matches expectedChainId
let mockChainId = 10;

jest.mock('wagmi', () => ({
  usePublicClient: jest.fn(() => ({
    getTransactionReceipt: mockGetTransactionReceipt,
    getBlock: mockGetBlock,
    getBlockNumber: mockGetBlockNumber,
    chain: { id: mockChainId },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

const VALID_TX = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as const;
const EXPECTED_CHAIN = 10; // Optimism

// A receipt in viem format (no chainId field on TransactionReceipt).
function makeReceipt(overrides: Partial<{
  blockNumber: bigint;
  status: 'success' | 'reverted';
}> = {}) {
  return {
    transactionHash: VALID_TX,
    blockNumber: overrides.blockNumber ?? 100n,
    status: overrides.status ?? 'success',
  };
}

// Mock a getBlock call returning a block with a specific `number`.
function makeBlock(number: bigint) {
  return { number, hash: '0xblockhash', timestamp: 1000n };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFinalityLevel', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    jest.clearAllMocks();
    // Reset to matching chain ID (Optimism).
    mockChainId = EXPECTED_CHAIN;
    // Refresh the wagmi mock so the new mockChainId is picked up.
    const wagmi = require('wagmi');
    wagmi.usePublicClient.mockImplementation(() => ({
      getTransactionReceipt: mockGetTransactionReceipt,
      getBlock: mockGetBlock,
      getBlockNumber: mockGetBlockNumber,
      chain: { id: mockChainId },
    }));
  });

  afterEach(() => {
    qc.clear();
  });

  // -------------------------------------------------------------------------
  // Disabled (no txHash)  — stale path
  // -------------------------------------------------------------------------
  describe('disabled / stale (no txHash)', () => {
    it('returns all nulls/false and does not call the RPC', () => {
      const { result } = renderHook(
        () => useFinalityLevel({ txHash: undefined, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      expect(result.current.level).toBeNull();
      expect(result.current.depth).toBeNull();
      expect(result.current.isFinalized).toBe(false);
      expect(result.current.isSafe).toBe(false);
      expect(result.current.isReorged).toBe(false);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();

      expect(mockGetTransactionReceipt).not.toHaveBeenCalled();
      expect(mockGetBlock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Successful — finalized path
  // -------------------------------------------------------------------------
  describe('successful — finalized', () => {
    it('resolves to finalized when blockNumber <= finalized head', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 100n }));
      mockGetBlockNumber.mockResolvedValue(120n); // latest
      // getBlock called with 'safe' and 'finalized' blockTags
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))  // safe
        .mockResolvedValueOnce(makeBlock(110n)); // finalized

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.level).toBe('finalized');
      expect(result.current.isFinalized).toBe(true);
      expect(result.current.isSafe).toBe(true);
      expect(result.current.isReorged).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Successful — safe path
  // -------------------------------------------------------------------------
  describe('successful — safe', () => {
    it('resolves to safe when blockNumber is between finalized and safe heads', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 112n }));
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))  // safe
        .mockResolvedValueOnce(makeBlock(110n)); // finalized

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.level).toBe('safe');
      expect(result.current.isSafe).toBe(true);
      expect(result.current.isFinalized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Successful — observed path
  // -------------------------------------------------------------------------
  describe('successful — observed', () => {
    it('resolves to observed when blockNumber is beyond safe head', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 118n }));
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.level).toBe('observed');
      expect(result.current.isSafe).toBe(false);
      expect(result.current.isFinalized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reorged path
  // -------------------------------------------------------------------------
  describe('reorged', () => {
    it('resolves to reorged when a previously observed receipt disappears', async () => {
      mockGetTransactionReceipt.mockResolvedValue(null);
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n))
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      qc.setQueryData(['tx-finality', VALID_TX, EXPECTED_CHAIN], {
        level: 'observed',
        depth: 0,
        isFinalized: false,
        isSafe: false,
        isReorged: false,
        isResolved: true,
        context: {
          txHash: VALID_TX,
          chainId: EXPECTED_CHAIN,
          blockNumber: 125n,
          blockHash: '0xprevious',
          receiptPresent: true,
          receiptStatus: '0x1',
          headBlockNumbers: { latest: 120n },
        },
      });

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await qc.invalidateQueries({ queryKey: ['tx-finality', VALID_TX, EXPECTED_CHAIN] });
      await waitFor(() => expect(result.current.level).toBe('reorged'));
      expect(result.current.isReorged).toBe(true);
      expect(result.current.isSafe).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reverted receipt (status 'reverted')
  // -------------------------------------------------------------------------
  describe('reverted receipt', () => {
    it('still derives the correct finality level for a reverted tx', async () => {
      mockGetTransactionReceipt.mockResolvedValue(
        makeReceipt({ blockNumber: 100n, status: 'reverted' }),
      );
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // A reverted tx can still be finalized — callers must check receiptStatus.
      expect(result.current.level).toBe('finalized');
      expect(result.current.isFinalized).toBe(true);
      // No error is thrown — revert status is a normal protocol outcome.
      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Wrong network (chain mismatch)
  // -------------------------------------------------------------------------
  describe('wrong network', () => {
    it('surfaces a chain-mismatch error when public client chain does not match expectedChainId', async () => {
      // Override mockChainId so the publicClient reports a different chain.
      mockChainId = 1; // mainnet, not Optimism (10)
      const wagmi = require('wagmi');
      wagmi.usePublicClient.mockImplementation(() => ({
        getTransactionReceipt: mockGetTransactionReceipt,
        getBlock: mockGetBlock,
        getBlockNumber: mockGetBlockNumber,
        chain: { id: 1 }, // wrong chain
      }));

      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 100n }));
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      const { result } = renderHook(
        () =>
          useFinalityLevel({
            txHash: VALID_TX,
            expectedChainId: EXPECTED_CHAIN, // 10 (Optimism)
          }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() => result.current.error !== null, { timeout: 3000 });

      expect(result.current.error).not.toBeNull();
      expect((result.current.error as Error).message).toMatch(/chain mismatch/i);
      expect(result.current.level).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Rejected receipt (null receipt — tx not found or dropped)
  // -------------------------------------------------------------------------
  describe('rejected receipt', () => {
    it('returns null level when receipt is not found', async () => {
      mockGetTransactionReceipt.mockResolvedValue(null);
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // No receipt means we cannot derive a level.
      expect(result.current.level).toBeNull();
      expect(result.current.isFinalized).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cache population — claimId
  // -------------------------------------------------------------------------
  describe('cache population', () => {
    it('populates the claims.finality cache entry for the given claimId', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 100n }));
      mockGetBlockNumber.mockResolvedValue(120n);
      mockGetBlock
        .mockResolvedValueOnce(makeBlock(115n))
        .mockResolvedValueOnce(makeBlock(110n));

      const { result: finalityResult } = renderHook(
        () =>
          useFinalityLevel({
            txHash: VALID_TX,
            expectedChainId: EXPECTED_CHAIN,
            claimId: 'claim-cache-test',
          }),
        { wrapper: createWrapper(qc) },
      );

      // Wait for the query to succeed so the cache entry is populated.
      await waitFor(() => expect(finalityResult.current.level).toBe('finalized'));

      // Read the cached entry directly from the query client.
      const { result: cacheResult } = renderHook(
        () => useClaimFinalityCache('claim-cache-test'),
        { wrapper: createWrapper(qc) },
      );

      expect(cacheResult.current?.level).toBe('finalized');
      expect(cacheResult.current?.txHash).toBe(VALID_TX);
      expect(cacheResult.current?.chainId).toBe(EXPECTED_CHAIN);
    });
  });

  // -------------------------------------------------------------------------
  // Missing safe/finalized RPC support — graceful fallback to observed
  // -------------------------------------------------------------------------
  describe('RPC without safe/finalized support', () => {
    it('falls back to observed when provider does not expose safe/finalized block tags', async () => {
      mockGetTransactionReceipt.mockResolvedValue(makeReceipt({ blockNumber: 118n }));
      mockGetBlockNumber.mockResolvedValue(120n);
      // Both getBlock('safe') and getBlock('finalized') fail.
      mockGetBlock
        .mockRejectedValueOnce(new Error('unsupported block tag'))
        .mockRejectedValueOnce(new Error('unsupported block tag'));

      const { result } = renderHook(
        () => useFinalityLevel({ txHash: VALID_TX, expectedChainId: EXPECTED_CHAIN }),
        { wrapper: createWrapper(qc) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.level).toBe('observed');
      expect(result.current.error).toBeNull();
    });
  });
});
