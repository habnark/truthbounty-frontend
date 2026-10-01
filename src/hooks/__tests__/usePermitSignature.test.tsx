/**
 * V2-FE-050 — usePermitSignature + PermitSigningPanel integration tests.
 *
 * Only wagmi is mocked. Signatures are produced by real viem accounts (public
 * Anvil test keys), so signer recovery, domain hashing and replay checks run
 * against real cryptography.
 */

import React from 'react';
import { renderHook, render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAccount, useChainId, usePublicClient, useSignTypedData } from 'wagmi';
import { domainSeparator, recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { usePermitSignature, type UsePermitSignatureParams } from '@/hooks/usePermitSignature';
import { PermitSigningPanel } from '@/components/ui/PermitSigningPanel';
import type { ReviewedPermitAsset } from '@/config/protocol/permit-assets';
import { DEFAULT_PERMIT_WINDOW_SECONDS, MAX_PERMIT_WINDOW_SECONDS } from '@/lib/permit/permit';
import { assertAccessible } from '@/__tests__/utils/axe';

jest.mock('wagmi', () => ({
  useAccount: jest.fn(),
  useChainId: jest.fn(),
  usePublicClient: jest.fn(),
  useSignTypedData: jest.fn(),
  http: jest.fn(() => ({})),
  createStorage: jest.fn(() => ({})),
  cookieStorage: {},
}));

jest.mock('@rainbow-me/rainbowkit', () => ({
  getDefaultConfig: jest.fn(() => ({ chains: [{ id: 10 }, { id: 11155420 }], transports: {} })),
}));

const mockedUseAccount = useAccount as jest.MockedFunction<typeof useAccount>;
const mockedUseChainId = useChainId as jest.MockedFunction<typeof useChainId>;
const mockedUsePublicClient = usePublicClient as jest.MockedFunction<typeof usePublicClient>;
const mockedUseSignTypedData = useSignTypedData as jest.MockedFunction<typeof useSignTypedData>;

// Public Anvil development keys — test-only, never funded on real networks.
const OWNER_ACCOUNT = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const OTHER_ACCOUNT = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

const RELEASE_CHAIN_ID = 11155420;
const CANONICAL_SPENDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const VALUE = 2_500_000n;
// Deliberately far from Date.now(): deadlines must come from chain time.
const BLOCK_TS = 2_000_000_000n;

const ASSET: ReviewedPermitAsset = {
  chainId: RELEASE_CHAIN_ID,
  address: TOKEN,
  symbol: 'TST',
  decimals: 6,
  domainName: 'Test Token',
  domainVersion: '1',
};

const PERMIT_ABI = [
  {
    type: 'function',
    name: 'createClaimWithPermit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contentDigest', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
];

const REVIEWED_DOMAIN = {
  name: ASSET.domainName,
  version: ASSET.domainVersion,
  chainId: RELEASE_CHAIN_ID,
  verifyingContract: TOKEN,
};

interface Chain {
  chainId: number;
  owner: `0x${string}` | undefined;
  nonce: unknown;
  timestamp: bigint;
  separator: unknown;
  readError?: Error;
}

let chain: Chain;
let signTypedDataAsync: jest.Mock;
let publicClient: { readContract: jest.Mock; getBlock: jest.Mock };

function signWith(account: typeof OWNER_ACCOUNT) {
  return async (args: Parameters<typeof OWNER_ACCOUNT.signTypedData>[0] & { account?: unknown }) => {
    const { account: _ignored, ...typed } = args;
    return account.signTypedData(typed);
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  chain = {
    chainId: RELEASE_CHAIN_ID,
    owner: OWNER_ACCOUNT.address,
    nonce: 4n,
    timestamp: BLOCK_TS,
    separator: domainSeparator({ domain: REVIEWED_DOMAIN }),
  };
  publicClient = {
    readContract: jest.fn(async ({ functionName }: { functionName: string }) => {
      if (chain.readError) throw chain.readError;
      if (functionName === 'DOMAIN_SEPARATOR') return chain.separator;
      if (functionName === 'nonces') return chain.nonce;
      throw new Error(`unexpected read ${functionName}`);
    }),
    getBlock: jest.fn(async () => ({ timestamp: chain.timestamp })),
  };
  signTypedDataAsync = jest.fn(signWith(OWNER_ACCOUNT));

  mockedUseAccount.mockImplementation(
    () => ({ address: chain.owner, isConnected: !!chain.owner }) as unknown as ReturnType<typeof useAccount>,
  );
  mockedUseChainId.mockImplementation(() => chain.chainId);
  mockedUsePublicClient.mockImplementation(() => publicClient as unknown as ReturnType<typeof usePublicClient>);
  mockedUseSignTypedData.mockImplementation(
    () => ({ signTypedDataAsync }) as unknown as ReturnType<typeof useSignTypedData>,
  );
});

function params(overrides: Partial<UsePermitSignatureParams> = {}): UsePermitSignatureParams {
  return {
    token: TOKEN,
    spender: CANONICAL_SPENDER,
    value: VALUE,
    reviewedAssets: [ASSET],
    releaseAbi: PERMIT_ABI,
    ...overrides,
  };
}

function renderPermit(overrides: Partial<UsePermitSignatureParams> = {}) {
  return renderHook((p: UsePermitSignatureParams) => usePermitSignature(p), {
    initialProps: params(overrides),
  });
}

type Hook = ReturnType<typeof renderPermit>;

async function prepareAndSign(hook: Hook) {
  await act(async () => {
    await hook.result.current.prepare();
  });
  expect(hook.result.current.status).toBe('ready');
  await act(async () => {
    await hook.result.current.sign();
  });
}

// ===========================================================================
// Availability — fail closed to the approval flow
// ===========================================================================

describe('availability', () => {
  it('is unavailable with the canonical release ABI (no permit entrypoint yet)', () => {
    const { result } = renderPermit({ releaseAbi: undefined });
    expect(result.current.status).toBe('unavailable');
    expect(result.current.unavailableReason).toBe('no-entrypoint');
    expect(result.current.entrypoint).toBeNull();
  });

  it('is unavailable for a token that has not been reviewed (the shipped allowlist)', () => {
    const { result } = renderPermit({ reviewedAssets: undefined });
    expect(result.current.unavailableReason).toBe('asset-not-reviewed');
  });

  it('is unavailable on a chain other than the release chain', () => {
    chain.chainId = 10;
    const { result } = renderPermit();
    expect(result.current.unavailableReason).toBe('unsupported-chain');
  });

  it('is unavailable when the spender is not the canonical protocol contract', () => {
    const { result } = renderPermit({ spender: OTHER_ACCOUNT.address });
    expect(result.current.unavailableReason).toBe('spender-not-canonical');
  });

  it.each([
    ['zero value', { value: 0n }],
    ['value above uint256', { value: 2n ** 256n }],
    ['malformed token', { token: '0x1234' as `0x${string}` }],
  ])('is unavailable for invalid params: %s', (_label, overrides) => {
    const { result } = renderPermit(overrides);
    expect(result.current.unavailableReason).toBe('invalid-params');
  });

  it('is unavailable without a connected wallet', () => {
    chain.owner = undefined;
    const { result } = renderPermit();
    expect(result.current.unavailableReason).toBe('wallet-not-connected');
  });

  it('never reads chain state or signs while unavailable', async () => {
    const { result } = renderPermit({ releaseAbi: undefined });
    await act(async () => {
      await result.current.prepare();
      await result.current.sign();
    });
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(signTypedDataAsync).not.toHaveBeenCalled();
    await expect(result.current.getSubmittablePermit()).resolves.toBeNull();
  });

  it('becomes unavailable (never signs) when the on-chain domain does not match the review', async () => {
    chain.separator = domainSeparator({ domain: { ...REVIEWED_DOMAIN, version: '2' } });
    const hook = renderPermit();
    await act(async () => {
      await hook.result.current.prepare();
    });
    expect(hook.result.current.status).toBe('unavailable');
    expect(hook.result.current.unavailableReason).toBe('domain-mismatch');
    expect(signTypedDataAsync).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Success path
// ===========================================================================

describe('prepare, sign and submit', () => {
  it('builds typed data from chain nonce and chain time, and describes it', async () => {
    const hook = renderPermit();
    expect(hook.result.current.status).toBe('idle');

    await act(async () => {
      await hook.result.current.prepare();
    });

    const typed = hook.result.current.typedData!;
    expect(typed.domain).toEqual(REVIEWED_DOMAIN);
    expect(typed.message).toEqual({
      owner: OWNER_ACCOUNT.address,
      spender: CANONICAL_SPENDER,
      value: VALUE,
      nonce: 4n,
      deadline: BLOCK_TS + BigInt(DEFAULT_PERMIT_WINDOW_SECONDS),
    });
    const labels = hook.result.current.displayRows.map((row) => row.label);
    expect(labels).toEqual(['Token', 'Spender', 'Amount', 'Nonce', 'Expires', 'Network', 'Signer']);
  });

  it('clamps an excessive requested window', async () => {
    const hook = renderPermit({ windowSeconds: 7 * 24 * 3600 });
    await act(async () => {
      await hook.result.current.prepare();
    });
    expect(hook.result.current.typedData!.message.deadline).toBe(BLOCK_TS + BigInt(MAX_PERMIT_WINDOW_SECONDS));
  });

  it('signs exactly the displayed typed data and returns verified submission components', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    expect(hook.result.current.status).toBe('signed');
    const typed = hook.result.current.typedData!;
    expect(signTypedDataAsync).toHaveBeenCalledWith(
      expect.objectContaining({ domain: typed.domain, message: typed.message, primaryType: 'Permit' }),
    );

    let permit: Awaited<ReturnType<typeof hook.result.current.getSubmittablePermit>> = null;
    await act(async () => {
      permit = await hook.result.current.getSubmittablePermit();
    });
    expect(permit).toMatchObject({
      entrypoint: 'createClaimWithPermit',
      value: VALUE,
      deadline: typed.message.deadline,
    });
    const { v, r, s } = permit!;
    expect([27, 28]).toContain(v);
    const signature = `${r}${s.slice(2)}${v.toString(16)}` as Hex;
    await expect(recoverTypedDataAddress({ ...typed, signature })).resolves.toBe(OWNER_ACCOUNT.address);
  });

  it('discards the signature after markConsumed (single use)', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);
    act(() => hook.result.current.markConsumed());

    expect(hook.result.current.status).toBe('idle');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();
  });
});

// ===========================================================================
// Replay safety and expiry
// ===========================================================================

describe('replay safety', () => {
  it('refuses a permit whose nonce was consumed after signing', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    chain.nonce = 5n;
    let permit: unknown = 'unset';
    await act(async () => {
      permit = await hook.result.current.getSubmittablePermit();
    });
    expect(permit).toBeNull();
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorReason).toBe('NONCE_CONSUMED');
  });

  it('refuses a permit that is too close to its on-chain deadline', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    chain.timestamp = hook.result.current.typedData!.message.deadline - 30n;
    let permit: unknown = 'unset';
    await act(async () => {
      permit = await hook.result.current.getSubmittablePermit();
    });
    expect(permit).toBeNull();
    expect(hook.result.current.status).toBe('expired');
  });

  it('fails closed when chain state cannot be re-read before submission', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    chain.readError = new Error('RPC down');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();
    await waitFor(() => expect(hook.result.current.errorReason).toBe('READ_FAILED'));
  });

  it('discards a signed permit when the account changes', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    chain.owner = OTHER_ACCOUNT.address;
    hook.rerender(params());

    expect(hook.result.current.status).toBe('idle');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();
  });

  it('discards a signed permit when the amount changes', async () => {
    const hook = renderPermit();
    await prepareAndSign(hook);

    hook.rerender(params({ value: VALUE + 1n }));

    expect(hook.result.current.status).toBe('idle');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();
  });
});

// ===========================================================================
// Rejection, errors and recovery
// ===========================================================================

describe('rejection, errors and recovery', () => {
  it('handles a wallet rejection and recovers by reviewing again', async () => {
    signTypedDataAsync.mockRejectedValueOnce(
      Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError', code: 4001 }),
    );
    const hook = renderPermit();
    await prepareAndSign(hook);

    expect(hook.result.current.status).toBe('rejected');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();

    await prepareAndSign(hook);
    expect(hook.result.current.status).toBe('signed');
  });

  it('rejects a signature that does not recover to the connected account', async () => {
    signTypedDataAsync.mockImplementationOnce(signWith(OTHER_ACCOUNT));
    const hook = renderPermit();
    await prepareAndSign(hook);

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorReason).toBe('SIGNER_MISMATCH');
    await expect(hook.result.current.getSubmittablePermit()).resolves.toBeNull();
  });

  it('rejects a malformed signature from the wallet', async () => {
    signTypedDataAsync.mockResolvedValueOnce('0xdeadbeef');
    const hook = renderPermit();
    await prepareAndSign(hook);

    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorReason).toBe('SIGNATURE_FAILED');
  });

  it('reports a read failure while preparing and recovers on retry', async () => {
    chain.readError = new Error('timeout');
    const hook = renderPermit();
    await act(async () => {
      await hook.result.current.prepare();
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorReason).toBe('READ_FAILED');

    chain.readError = undefined;
    await act(async () => {
      await hook.result.current.prepare();
    });
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.errorReason).toBeNull();
  });

  it('fails closed on a malformed nonce from the RPC', async () => {
    chain.nonce = '4';
    const hook = renderPermit();
    await act(async () => {
      await hook.result.current.prepare();
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.typedData).toBeNull();
  });
});

// ===========================================================================
// Panel wired to the real hook — keyboard + accessibility
// ===========================================================================

function PermitHarness(props: { overrides?: Partial<UsePermitSignatureParams> }) {
  const permit = usePermitSignature(params(props.overrides));
  return <PermitSigningPanel permit={permit} fallback={<button type="button">Approve TST</button>} />;
}

describe('PermitSigningPanel with the real hook', () => {
  it('renders only the standard approval when permit is unavailable (no visual change)', () => {
    render(<PermitHarness overrides={{ releaseAbi: undefined }} />);
    expect(screen.getByRole('button', { name: 'Approve TST' })).toBeInTheDocument();
    expect(screen.queryByTestId('permit-signing-panel')).not.toBeInTheDocument();
  });

  it('reviews and signs a permit using only the keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(<PermitHarness />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Review permit' })).toHaveFocus();
    await user.keyboard('{Enter}');

    const dl = await screen.findByLabelText(/permit details/i);
    expect(dl).toHaveTextContent(OWNER_ACCOUNT.address);
    expect(dl).toHaveTextContent('2.5 TST');
    expect(screen.getByRole('status')).toHaveTextContent(/review the permit details/i);
    await assertAccessible(container);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Sign permit' })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('permit-signing-panel')).toHaveAttribute('data-permit-status', 'signed'),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/permit signed/i);
    await assertAccessible(container);
  });

  it('lets the user switch to the standard approval and back', async () => {
    const user = userEvent.setup();
    render(<PermitHarness />);

    await user.click(screen.getByRole('button', { name: 'Use standard approval instead' }));
    expect(screen.getByRole('button', { name: 'Approve TST' })).toBeInTheDocument();
    expect(screen.queryByTestId('permit-signing-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign a permit instead' }));
    expect(screen.getByTestId('permit-signing-panel')).toBeInTheDocument();
  });
});
