/**
 * Unit tests for finality derivation (finality.ts)
 *
 * Covers:
 *  - observed, safe, finalized, reorged levels
 *  - Correct depth calculation
 *  - receiptStatus passthrough (revert does not block level derivation)
 *  - Missing safe / finalized head graceful fallback
 */

import { deriveFinalityLevel, type FinalityContext } from '@/app/types/finality';

const BASE: FinalityContext = {
  txHash: '0xdeadbeef00000000000000000000000000000000000000000000000000000001',
  chainId: 10,
  blockNumber: 100n,
  receiptStatus: '0x1',
  headBlockNumbers: {
    latest: 110n,
    safe: 105n,
    finalized: 100n,
  },
};

describe('deriveFinalityLevel', () => {
  // -------------------------------------------------------------------------
  // finalized
  // -------------------------------------------------------------------------
  describe('finalized', () => {
    it('returns finalized when blockNumber <= finalized head', () => {
      const result = deriveFinalityLevel(BASE);
      expect(result.level).toBe('finalized');
      expect(result.isFinalized).toBe(true);
      expect(result.isSafe).toBe(true);
      expect(result.isReorged).toBe(false);
    });

    it('calculates depth as finalized_head - tx_block', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 95n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('finalized');
      expect(result.depth).toBe(5); // 100 - 95
    });
  });

  // -------------------------------------------------------------------------
  // safe
  // -------------------------------------------------------------------------
  describe('safe', () => {
    it('returns safe when blockNumber is between safe and finalized heads', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 102n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('safe');
      expect(result.isSafe).toBe(true);
      expect(result.isFinalized).toBe(false);
      expect(result.isReorged).toBe(false);
    });

    it('calculates depth as safe_head - tx_block', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 103n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('safe');
      expect(result.depth).toBe(2); // 105 - 103
    });
  });

  // -------------------------------------------------------------------------
  // observed
  // -------------------------------------------------------------------------
  describe('observed', () => {
    it('returns observed when blockNumber is beyond safe head but within latest', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 108n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('observed');
      expect(result.isSafe).toBe(false);
      expect(result.isFinalized).toBe(false);
      expect(result.isReorged).toBe(false);
    });

    it('falls back to observed when safe and finalized heads are missing', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 108n,
        headBlockNumbers: { latest: 110n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('observed');
    });

    it('calculates depth as latest - tx_block', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 108n,
        headBlockNumbers: { latest: 110n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.depth).toBe(2); // 110 - 108
    });
  });

  // -------------------------------------------------------------------------
  // reorged
  // -------------------------------------------------------------------------
  describe('reorged', () => {
    it('returns observed when a block is ahead of the latest head without prior evidence', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 115n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('observed');
      expect(result.isReorged).toBe(false);
    });

    it('returns a negative depth when the previously observed receipt disappears', () => {
      const ctx: FinalityContext = {
        ...BASE,
        blockNumber: 100n,
        receiptPresent: false,
        previousObservation: { blockNumber: 100n, blockHash: '0xold' },
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('reorged');
      expect(result.depth).toBe(-10);
    });
  });

  // -------------------------------------------------------------------------
  // Reverted transactions still follow the same level derivation rules
  // -------------------------------------------------------------------------
  describe('reverted receipt (0x0)', () => {
    it('still returns finalized even if receipt is 0x0', () => {
      const ctx: FinalityContext = {
        ...BASE,
        receiptStatus: '0x0',
        blockNumber: 100n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      // Level is independent of receipt status — callers must check status
      expect(result.level).toBe('finalized');
    });

    it('still returns safe for a reverted tx in the safe range', () => {
      const ctx: FinalityContext = {
        ...BASE,
        receiptStatus: '0x0',
        blockNumber: 103n,
        headBlockNumbers: { latest: 110n, safe: 105n, finalized: 100n },
      };
      const result = deriveFinalityLevel(ctx);
      expect(result.level).toBe('safe');
    });
  });

  // -------------------------------------------------------------------------
  // isResolved is always true when called
  // -------------------------------------------------------------------------
  it('isResolved is always true for any returned result', () => {
    const cases: FinalityContext[] = [
      { ...BASE, blockNumber: 100n },
      { ...BASE, blockNumber: 103n },
      { ...BASE, blockNumber: 108n },
      { ...BASE, blockNumber: 115n },
    ];
    for (const ctx of cases) {
      const result = deriveFinalityLevel(ctx);
      expect(result.isResolved).toBe(true);
      expect(result.context).toBe(ctx);
    }
});
});
