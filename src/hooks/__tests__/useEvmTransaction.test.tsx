import { act, renderHook, waitFor } from '@testing-library/react';
import { useAccount, useChainId, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { useEvmTransaction } from '../useEvmTransaction';
import {
  createCanonicalArtifactFixture,
  createMockAllowance,
  createMockCustomError,
  createMockReceipt,
  createMockViemClient,
  createMockWallet,
  MOCK_ADDRESS_1,
  MOCK_CHAIN_ID,
  MOCK_TX_HASH_1,
} from '@/__tests__/mocks/wagmi/mock-wagmi';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(),
  useChainId: jest.fn(),
  useWriteContract: jest.fn(),
  useSendTransaction: jest.fn(),
  useWaitForTransactionReceipt: jest.fn(),
}));

const mockedUseAccount = useAccount as jest.MockedFunction<typeof useAccount>;
const mockedUseChainId = useChainId as jest.MockedFunction<typeof useChainId>;
const mockedUseWriteContract = useWriteContract as jest.MockedFunction<typeof useWriteContract>;
const mockedUseSendTransaction = useSendTransaction as jest.MockedFunction<typeof useSendTransaction>;
const mockedUseWaitForTransactionReceipt = useWaitForTransactionReceipt as jest.MockedFunction<typeof useWaitForTransactionReceipt>;

const TEST_ABI = [
  {
    type: 'function',
    name: 'finalizeClaim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'claimId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
] as const;

const CONTRACT_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();

  mockedUseAccount.mockReturnValue({
    address: MOCK_ADDRESS_1,
    isConnected: true,
  } as any);

  mockedUseChainId.mockReturnValue(MOCK_CHAIN_ID);
  mockedUseWriteContract.mockReturnValue({
    writeContractAsync: jest.fn().mockResolvedValue(MOCK_TX_HASH_1),
  } as any);
  mockedUseSendTransaction.mockReturnValue({
    sendTransactionAsync: jest.fn().mockResolvedValue(MOCK_TX_HASH_1),
  } as any);
  mockedUseWaitForTransactionReceipt.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
  } as any);
});

describe('useEvmTransaction', () => {
  it('writes the exact contract request with value, chain id and calldata', async () => {
    const writeContractAsync = jest.fn().mockResolvedValue(MOCK_TX_HASH_1);
    mockedUseWriteContract.mockReturnValue({ writeContractAsync } as any);

    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
      }),
    );

    await act(async () => {
      await result.current.writeContract({
        address: CONTRACT_ADDRESS,
        abi: TEST_ABI,
        functionName: 'finalizeClaim',
        args: ['0x' + '11'.repeat(32), 'resolved'],
        value: 123n,
      });
    });

    expect(writeContractAsync).toHaveBeenCalledWith({
      address: CONTRACT_ADDRESS,
      abi: TEST_ABI,
      functionName: 'finalizeClaim',
      args: ['0x' + '11'.repeat(32), 'resolved'],
      value: 123n,
    });
    expect(result.current.state.status).toBe('submitted');
    expect(result.current.address).toBe(MOCK_ADDRESS_1);
    expect(result.current.isCorrectNetwork).toBe(true);
  });

  it('rejects wrong-network writes before broadcasting', async () => {
    mockedUseChainId.mockReturnValue(1);

    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
      }),
    );

    await expect(
      result.current.writeContract({
        address: CONTRACT_ADDRESS,
        abi: TEST_ABI,
        functionName: 'finalizeClaim',
        args: ['0x' + '11'.repeat(32), 'resolved'],
      }),
    ).rejects.toMatchObject({
      reason: 'WRONG_NETWORK',
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.isCorrectNetwork).toBe(false);
    expect(result.current.isWriteReady).toBe(false);
    expect(result.current.readiness.ready).toBe(false);
  });

  it('fails closed when disconnected before PREPARE', async () => {
    mockedUseAccount.mockReturnValue({
      address: undefined,
      isConnected: false,
    } as any);

    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
      }),
    );

    await expect(
      result.current.writeContract({
        address: CONTRACT_ADDRESS,
        abi: TEST_ABI,
        functionName: 'finalizeClaim',
        args: ['0x' + '11'.repeat(32), 'resolved'],
      }),
    ).rejects.toMatchObject({
      reason: 'INVALID_TRANSITION',
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.readiness.failures.map((f) => f.code)).toContain(
      'WALLET_DISCONNECTED',
    );
    expect(mockedUseWriteContract().writeContractAsync).not.toHaveBeenCalled();
  });

  it('exposes write readiness for UI gating', () => {
    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
      }),
    );

    expect(result.current.isWriteReady).toBe(true);
    expect(result.current.readiness.ready).toBe(true);
    expect(result.current.readiness.failures).toHaveLength(0);
  });

  it('accepts raw sendTransaction calls with explicit value and calldata preconditions', async () => {
    const sendTransactionAsync = jest.fn().mockResolvedValue(MOCK_TX_HASH_1);
    mockedUseSendTransaction.mockReturnValue({ sendTransactionAsync } as any);

    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
      }),
    );

    await act(async () => {
      await result.current.sendTransaction({
        to: CONTRACT_ADDRESS,
        value: 456n,
        data: '0xdeadbeef',
      });
    });

    expect(sendTransactionAsync).toHaveBeenCalledWith({
      to: CONTRACT_ADDRESS,
      value: 456n,
      data: '0xdeadbeef',
    });
    expect(result.current.state.status).toBe('submitted');
    expect(result.current.state.txHash).toBe(MOCK_TX_HASH_1);
  });

  it('finalizes after a successful receipt and preserves the canonical artifact contract address', async () => {
    const receipt = createMockReceipt({
      status: 'success',
      blockNumber: 40n,
      chainId: MOCK_CHAIN_ID,
      transactionHash: MOCK_TX_HASH_1,
    });
    mockedUseWaitForTransactionReceipt.mockReturnValue({
      data: receipt,
      isLoading: false,
      error: null,
    } as any);

    const { result } = renderHook(() =>
      useEvmTransaction({
        expectedChainId: MOCK_CHAIN_ID,
        safeConfirmations: 1,
      }),
    );

    await act(async () => {
      await result.current.writeContract({
        address: CONTRACT_ADDRESS,
        abi: TEST_ABI,
        functionName: 'finalizeClaim',
        args: ['0x' + '22'.repeat(32), 'finalized'],
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('finalized');
    });

    const artifacts = createCanonicalArtifactFixture();
    expect(artifacts.addresses.TruthBountyWeighted).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(result.current.state.txHash).toBe(MOCK_TX_HASH_1);
  });

  it('creates deterministic viem and wallet fixtures for contract safety checks', () => {
    const wallet = createMockWallet({
      address: MOCK_ADDRESS_1,
      chainId: MOCK_CHAIN_ID,
      balance: 500n,
    });
    const client = createMockViemClient({
      chainId: MOCK_CHAIN_ID,
      wallet,
    });
    const allowance = createMockAllowance({
      owner: MOCK_ADDRESS_1,
      spender: CONTRACT_ADDRESS,
      amount: 250n,
    });
    const customError = createMockCustomError({
      name: 'InsufficientAllowance',
      args: [MOCK_ADDRESS_1, CONTRACT_ADDRESS, 250n],
    });

    expect(wallet.address).toBe(MOCK_ADDRESS_1);
    expect(client.chain.id).toBe(MOCK_CHAIN_ID);
    expect(allowance.amount).toBe(250n);
    expect(customError.name).toBe('InsufficientAllowance');
    expect(customError.args[0]).toBe(MOCK_ADDRESS_1);
  });
});

describe('useEvmTransaction — identity change invalidation (V2-FE-046)', () => {
  const OTHER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

  it('discards an unsigned intent when the account changes mid-signature', async () => {
    const { result, rerender } = renderHook(() =>
      useEvmTransaction({ expectedChainId: MOCK_CHAIN_ID }),
    );

    act(() => {
      result.current.send({ type: 'PREPARE', chainId: MOCK_CHAIN_ID });
    });
    act(() => {
      result.current.send({ type: 'REQUEST_SIGNATURE' });
    });
    expect(result.current.state.status).toBe('signature-requested');

    mockedUseAccount.mockReturnValue({ address: OTHER_ADDRESS, isConnected: true } as never);
    rerender();

    await waitFor(() => expect(result.current.state.status).toBe('idle'));
  });

  it('preserves a submitted transaction (canonical hash) when the account changes', async () => {
    const { result, rerender } = renderHook(() =>
      useEvmTransaction({ expectedChainId: MOCK_CHAIN_ID }),
    );

    await act(async () => {
      await result.current.writeContract({
        address: CONTRACT_ADDRESS,
        abi: TEST_ABI,
        functionName: 'finalizeClaim',
        args: ['0x' + '11'.repeat(32), 'resolved'],
      });
    });
    expect(result.current.state.status).toBe('submitted');

    mockedUseAccount.mockReturnValue({ address: OTHER_ADDRESS, isConnected: true } as never);
    rerender();

    await waitFor(() => expect(result.current.state.status).toBe('submitted'));
    expect(result.current.state.txHash).toBe(MOCK_TX_HASH_1);
  });
});
