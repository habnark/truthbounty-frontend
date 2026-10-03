/**
 * V2-FE-053 — Claim submission validation before signing
 *
 * Every check here must fail closed BEFORE the wallet is asked to sign
 * anything (approve or createClaim). Only wagmi and the release registry are
 * mocked; useClaimCreationTransaction runs for real.
 *
 * Regressions covered:
 *  - Insufficient asset balance was not checked, so the user could sign an
 *    approval (and a claim) that could only revert.
 *  - Without an approval config, allowance was never checked before signing.
 *  - The untrusted approval config could approve a different token, a
 *    different spender, or less than the claim amount.
 *  - A zero content digest and amounts above uint256 were accepted.
 *  - A second createClaim() while one was running started a second signing flow.
 */

import { renderHook, act } from '@testing-library/react';
import * as wagmi from 'wagmi';
import { maxUint256, type Hex } from 'viem';
import {
  useClaimCreationTransaction,
  ClaimCreationErrorCode,
  type ClaimCreationParams,
  type ClaimCreationResult,
} from '@/hooks/useClaimCreationTransaction';
import { CLAIM_ERROR_KEY_MAP } from '@/i18n/protocol-mapper';
import en from '../../../messages/en.json';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(),
  useChainId: jest.fn(),
  usePublicClient: jest.fn(),
  useWalletClient: jest.fn(),
  http: jest.fn(),
  createStorage: jest.fn(() => ({})),
  cookieStorage: {},
}));

jest.mock('@/lib/contracts/registry', () => {
  const address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const release = {
    manifest: {
      protocolVersion: 'v2.1.0',
      releaseId: 'v2.1.0-op-sepolia',
      gitCommit: '0000000000000000000000000000000000000000',
      compilerVersion: 'foundry-0.2.0',
      chainId: 11155420,
      deploymentBlock: 0,
      abiVersion: 'v2.1.0',
      eventSchemaVersion: 'v2.1.0',
      parameterSetVersion: 'v2.1.0',
      contracts: { TruthBountyWeighted: { proxy: address, implementation: address } },
    },
    addresses: { chainId: 11155420, TruthBountyWeighted: address },
    abis: { TruthBountyWeighted: [] },
    events: { version: 'v2.1.0', events: [] },
    parameters: {},
    roles: {},
    checksums: { version: '1', files: {} },
  };
  return {
    getContractAddress: jest.fn(() => address),
    getContractAbi: jest.fn(() => []),
    getProtocolVersion: jest.fn(() => 'v2.1.0'),
    getProtocolRelease: jest.fn(() => release),
    getReleaseChainId: jest.fn(() => 11155420),
    getProtocolDiagnostics: jest.fn(() => ({})),
  };
});

const CHAIN_ID = 11155420;
const USER = '0x1234567890123456789012345678901234567890' as const;
const CONTRACT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const ASSET = '0x4200000000000000000000000000000000000006' as const;
const OTHER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
const AMOUNT = 1_000_000n;
const CLAIM_HASH = `0x${'c1'.repeat(32)}` as const;
const APPROVE_HASH = `0x${'a1'.repeat(32)}` as const;

type ReadArgs = { functionName: string; args: readonly unknown[] };

interface ChainState {
  balance: unknown;
  allowance: unknown;
  balanceError?: Error;
}

let chain: ChainState;
let publicClient: {
  readContract: jest.Mock;
  simulateContract: jest.Mock;
  waitForTransactionReceipt: jest.Mock;
};
let walletWrite: jest.Mock;

function baseParams(overrides: Partial<ClaimCreationParams> = {}): ClaimCreationParams {
  return {
    contentDigest: `0x${'ab'.repeat(32)}`,
    asset: ASSET,
    amount: AMOUNT,
    frozenConfig: '0x00',
    claimContractAddress: CONTRACT,
    artifactVersion: '0.1.0',
    expectedChainId: CHAIN_ID,
    getIndexedClaim: async () => ({ id: 'indexed-1' }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  chain = { balance: AMOUNT * 10n, allowance: AMOUNT * 10n };

  publicClient = {
    readContract: jest.fn(async ({ functionName }: ReadArgs) => {
      if (functionName === 'balanceOf') {
        if (chain.balanceError) throw chain.balanceError;
        return chain.balance;
      }
      if (functionName === 'allowance') return chain.allowance;
      throw new Error(`unexpected read ${functionName}`);
    }),
    simulateContract: jest.fn().mockResolvedValue({
      request: { address: CONTRACT, functionName: 'createClaim' },
    }),
    waitForTransactionReceipt: jest.fn().mockResolvedValue({ status: 'success' }),
  };
  walletWrite = jest.fn(async (req: { functionName: string }) =>
    req.functionName === 'approve' ? APPROVE_HASH : CLAIM_HASH,
  );

  (wagmi.useAccount as jest.Mock).mockReturnValue({ address: USER, isConnected: true });
  (wagmi.useChainId as jest.Mock).mockReturnValue(CHAIN_ID);
  (wagmi.usePublicClient as jest.Mock).mockReturnValue(publicClient);
  (wagmi.useWalletClient as jest.Mock).mockReturnValue({
    data: { writeContract: walletWrite, chain: { id: CHAIN_ID } },
  });
});

async function submit(params: ClaimCreationParams) {
  const hook = renderHook(() => useClaimCreationTransaction());
  let outcome!: ClaimCreationResult;
  await act(async () => {
    outcome = await hook.result.current.createClaim(params);
  });
  return { hook, outcome };
}

function expectFailedBeforeSigning(outcome: ClaimCreationResult, code: string) {
  expect(outcome.status).toBe('error');
  if (outcome.status === 'error') expect(outcome.error.code).toBe(code);
  expect(walletWrite).not.toHaveBeenCalled();
  expect(publicClient.simulateContract).not.toHaveBeenCalled();
}

function readsOf(name: string) {
  return publicClient.readContract.mock.calls.filter(([a]) => (a as ReadArgs).functionName === name);
}

// ===========================================================================
// Success
// ===========================================================================

describe('valid submission', () => {
  it('checks balance and allowance on-chain, then signs exactly one claim', async () => {
    const { hook, outcome } = await submit(baseParams());

    expect(outcome).toMatchObject({ status: 'success', txHash: CLAIM_HASH });
    expect(readsOf('balanceOf')[0][0]).toMatchObject({ address: ASSET, args: [USER] });
    expect(readsOf('allowance')[0][0]).toMatchObject({ address: ASSET, args: [USER, CONTRACT] });
    expect(walletWrite).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe('success');
    expect(hook.result.current.txHash).toBe(CLAIM_HASH);
  });

  it('approves exactly the claim asset for the claim contract when allowance is low', async () => {
    chain.allowance = 0n;
    const { outcome } = await submit(
      baseParams({ approval: { token: ASSET, spender: CONTRACT, requiredAmount: AMOUNT } }),
    );

    expect(outcome.status).toBe('success');
    expect(walletWrite).toHaveBeenCalledTimes(2);
    expect(walletWrite.mock.calls[0][0]).toMatchObject({
      address: ASSET,
      functionName: 'approve',
      args: [CONTRACT, AMOUNT],
    });
  });

  it('accepts an exact balance and the uint256 maximum boundary', async () => {
    chain.balance = maxUint256;
    chain.allowance = maxUint256;
    const { outcome } = await submit(baseParams({ amount: maxUint256 }));
    expect(outcome.status).toBe('success');
  });
});

// ===========================================================================
// Balance (regression: signing with an unfundable claim)
// ===========================================================================

describe('balance', () => {
  it('fails closed on insufficient balance without asking the wallet to sign', async () => {
    chain.balance = AMOUNT - 1n;
    const { hook, outcome } = await submit(baseParams());

    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INSUFFICIENT_BALANCE);
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.txHash).toBeNull();
  });

  it('never signs an approval when the balance cannot fund the claim', async () => {
    chain.balance = 0n;
    chain.allowance = 0n;
    const { outcome } = await submit(
      baseParams({ approval: { token: ASSET, spender: CONTRACT, requiredAmount: AMOUNT } }),
    );
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INSUFFICIENT_BALANCE);
  });

  it('treats a malformed RPC balance as untrusted and fails closed', async () => {
    chain.balance = '999999999999';
    const { outcome } = await submit(baseParams());
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INSUFFICIENT_BALANCE);
  });

  it('fails closed when the balance read errors', async () => {
    chain.balanceError = new Error('RPC unavailable');
    const { outcome } = await submit(baseParams());
    expect(outcome.status).toBe('error');
    expect(walletWrite).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Allowance
// ===========================================================================

describe('allowance', () => {
  it('fails closed without an approval step when allowance is below the amount', async () => {
    chain.allowance = AMOUNT - 1n;
    const { outcome } = await submit(baseParams());
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.ALLOWANCE_INSUFFICIENT);
  });

  it('treats a malformed RPC allowance as untrusted and fails closed', async () => {
    chain.allowance = null;
    const { outcome } = await submit(baseParams());
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.ALLOWANCE_INSUFFICIENT);
  });
});

// ===========================================================================
// Approval config (untrusted)
// ===========================================================================

describe('approval configuration', () => {
  it.each([
    ['token is not the claim asset', { token: OTHER, spender: CONTRACT, requiredAmount: AMOUNT }, 'INVALID_CONFIG'],
    ['spender is not the claim contract', { token: ASSET, spender: OTHER, requiredAmount: AMOUNT }, 'INVALID_CONFIG'],
    ['amount is below the claim amount', { token: ASSET, spender: CONTRACT, requiredAmount: AMOUNT - 1n }, 'INVALID_AMOUNT'],
    ['amount exceeds uint256', { token: ASSET, spender: CONTRACT, requiredAmount: maxUint256 + 1n }, 'INVALID_AMOUNT'],
  ] as const)('rejects when the %s, before any chain read', async (_label, approval, code) => {
    const { outcome } = await submit(baseParams({ approval }));
    expectFailedBeforeSigning(outcome, code);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it('accepts a differently-cased (checksummed) but identical token and spender', async () => {
    const { outcome } = await submit(
      baseParams({
        approval: {
          token: ASSET.toLowerCase() as `0x${string}`,
          spender: CONTRACT.toLowerCase() as `0x${string}`,
          requiredAmount: AMOUNT,
        },
      }),
    );
    expect(outcome.status).toBe('success');
  });
});

// ===========================================================================
// Content and amount
// ===========================================================================

describe('content and amount', () => {
  it('rejects the zero content digest', async () => {
    const { outcome } = await submit(baseParams({ contentDigest: `0x${'0'.repeat(64)}` as Hex }));
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INVALID_CONTENT_DIGEST);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 0n],
    ['negative', -1n],
    ['above uint256', maxUint256 + 1n],
  ])('rejects a %s amount', async (_label, amount) => {
    const { outcome } = await submit(baseParams({ amount }));
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INVALID_AMOUNT);
  });

  it('rejects a non-bigint amount from untrusted input', async () => {
    const { outcome } = await submit(baseParams({ amount: 5 as unknown as bigint }));
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INVALID_AMOUNT);
  });
});

// ===========================================================================
// Chain, wallet, rejection, recovery
// ===========================================================================

describe('chain, wallet, rejection and recovery', () => {
  it('fails closed on the wrong chain before any chain read', async () => {
    (wagmi.useChainId as jest.Mock).mockReturnValue(1);
    const { outcome } = await submit(baseParams());
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.INVALID_CHAIN);
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it('fails closed when the wallet is disconnected', async () => {
    (wagmi.useAccount as jest.Mock).mockReturnValue({ address: undefined, isConnected: false });
    const { outcome } = await submit(baseParams());
    expectFailedBeforeSigning(outcome, ClaimCreationErrorCode.WALLET_NOT_CONNECTED);
  });

  it('maps a wallet rejection to USER_REJECTED with no hash, then recovers on retry', async () => {
    walletWrite.mockRejectedValueOnce(
      Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError' }),
    );
    const hook = renderHook(() => useClaimCreationTransaction());

    let first!: ClaimCreationResult;
    await act(async () => {
      first = await hook.result.current.createClaim(baseParams());
    });
    expect(first.status === 'error' && first.error.code).toBe(ClaimCreationErrorCode.USER_REJECTED);
    expect(hook.result.current.txHash).toBeNull();

    let second!: ClaimCreationResult;
    await act(async () => {
      second = await hook.result.current.createClaim(baseParams());
    });
    expect(second).toMatchObject({ status: 'success', txHash: CLAIM_HASH });
    expect(hook.result.current.error).toBeNull();
  });

  it('recovers after an insufficient-balance failure once the wallet is funded', async () => {
    chain.balance = 0n;
    const hook = renderHook(() => useClaimCreationTransaction());
    await act(async () => {
      await hook.result.current.createClaim(baseParams());
    });
    expect(hook.result.current.error?.code).toBe(ClaimCreationErrorCode.INSUFFICIENT_BALANCE);

    chain.balance = AMOUNT;
    await act(async () => {
      await hook.result.current.createClaim(baseParams());
    });
    expect(hook.result.current.status).toBe('success');
    expect(hook.result.current.error).toBeNull();
  });
});

// ===========================================================================
// Duplicate submission (regression: double click signs twice)
// ===========================================================================

describe('duplicate submission', () => {
  it('rejects a second createClaim while one is in flight, without disturbing it', async () => {
    let releaseReceipt!: (value: unknown) => void;
    publicClient.waitForTransactionReceipt.mockImplementationOnce(
      () => new Promise((resolve) => (releaseReceipt = resolve)),
    );
    const hook = renderHook(() => useClaimCreationTransaction());

    let firstPromise!: Promise<ClaimCreationResult>;
    await act(async () => {
      firstPromise = hook.result.current.createClaim(baseParams());
      await Promise.resolve();
    });
    await act(async () => {
      while (!releaseReceipt) await Promise.resolve();
    });
    expect(hook.result.current.status).toBe('confirming');

    let second!: ClaimCreationResult;
    await act(async () => {
      second = await hook.result.current.createClaim(baseParams());
    });
    expect(second.status === 'error' && second.error.code).toBe(ClaimCreationErrorCode.SUBMISSION_IN_PROGRESS);
    expect(hook.result.current.status).toBe('confirming');
    expect(walletWrite).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseReceipt({ status: 'success' });
      await firstPromise;
    });
    expect(hook.result.current.status).toBe('success');

    // A fresh submission is allowed once the first one settled.
    let third!: ClaimCreationResult;
    await act(async () => {
      third = await hook.result.current.createClaim(baseParams());
    });
    expect(third.status).toBe('success');
  });
});

// ===========================================================================
// Accessible, translated feedback for new failure codes
// ===========================================================================

describe('user-facing messages', () => {
  it.each(['INSUFFICIENT_BALANCE', 'SUBMISSION_IN_PROGRESS'] as const)(
    'maps %s to a translated message',
    (code) => {
      const key = CLAIM_ERROR_KEY_MAP[code];
      expect(key).toBe(`claim.errors.${code}`);
      const message = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
      expect(typeof message).toBe('string');
      expect((message as string).length).toBeGreaterThan(0);
    },
  );
});
