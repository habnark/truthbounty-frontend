/**
 * V2-FE-050 — Unit tests for pure EIP-2612 permit helpers.
 */

import { domainSeparator, isAddress, zeroAddress } from 'viem';
import canonicalAbi from '../../../../release/abi/TruthBountyWeighted.json';
import { REVIEWED_PERMIT_ASSETS, type ReviewedPermitAsset } from '@/config/protocol/permit-assets';
import {
  DEFAULT_PERMIT_WINDOW_SECONDS,
  MAX_PERMIT_WINDOW_SECONDS,
  MIN_PERMIT_WINDOW_SECONDS,
  MIN_REMAINING_VALIDITY_SECONDS,
  buildPermitDomain,
  buildPermitTypedData,
  checkPermitSubmittable,
  clampPermitWindow,
  computePermitDeadline,
  describePermit,
  domainMatchesOnChain,
  findPermitEntrypoint,
  findReviewedAsset,
  isValidPermitValue,
} from '@/lib/permit/permit';

const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as const;
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const SPENDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

const ASSET: ReviewedPermitAsset = {
  chainId: 11155420,
  address: TOKEN,
  symbol: 'TST',
  decimals: 6,
  domainName: 'Test Token',
  domainVersion: '1',
};

const PERMIT_FRAGMENT = {
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
};

describe('findPermitEntrypoint', () => {
  it('finds no permit entrypoint in the canonical release ABI (permit stays disabled)', () => {
    expect(findPermitEntrypoint(canonicalAbi)).toBeNull();
  });

  it('detects a ...WithPermit function with a trailing deadline, v, r, s', () => {
    expect(findPermitEntrypoint([PERMIT_FRAGMENT])).toBe('createClaimWithPermit');
  });

  it.each([
    ['a view function', { ...PERMIT_FRAGMENT, stateMutability: 'view' }],
    ['a function without the WithPermit suffix', { ...PERMIT_FRAGMENT, name: 'createClaim' }],
    ['a wrong signature tail', { ...PERMIT_FRAGMENT, inputs: PERMIT_FRAGMENT.inputs.slice(0, 5) }],
    ['an event', { ...PERMIT_FRAGMENT, type: 'event' }],
  ])('ignores %s', (_label, fragment) => {
    expect(findPermitEntrypoint([fragment])).toBeNull();
  });

  it.each([null, undefined, 'abi', 42, {}, [null, 1, 'x', { type: 'function' }]])(
    'treats a malformed ABI (%p) as having no entrypoint',
    (abi) => {
      expect(findPermitEntrypoint(abi)).toBeNull();
    },
  );
});

describe('reviewed permit assets', () => {
  it('ships no unreviewed or placeholder entries', () => {
    for (const asset of REVIEWED_PERMIT_ASSETS) {
      expect(isAddress(asset.address)).toBe(true);
      expect(asset.address.toLowerCase()).not.toBe(zeroAddress);
      expect([10, 11155420]).toContain(asset.chainId);
      expect(Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 36).toBe(true);
      expect(asset.domainName.trim()).not.toBe('');
      expect(asset.domainVersion.trim()).not.toBe('');
    }
    expect(Object.isFrozen(REVIEWED_PERMIT_ASSETS)).toBe(true);
  });

  it('matches a reviewed asset by chain and case-insensitive address only', () => {
    expect(findReviewedAsset([ASSET], 11155420, TOKEN.toLowerCase() as `0x${string}`)).toBe(ASSET);
    expect(findReviewedAsset([ASSET], 10, TOKEN)).toBeNull();
    expect(findReviewedAsset([ASSET], 11155420, SPENDER)).toBeNull();
    expect(findReviewedAsset([ASSET], 11155420, 'not-an-address' as `0x${string}`)).toBeNull();
  });
});

describe('domainMatchesOnChain', () => {
  const domain = buildPermitDomain(ASSET);

  it('accepts the separator the token computes for the reviewed domain', () => {
    expect(domainMatchesOnChain(domain, domainSeparator({ domain }))).toBe(true);
  });

  it('rejects a token whose domain differs (e.g. version)', () => {
    const deployed = domainSeparator({ domain: { ...domain, version: '2' } });
    expect(domainMatchesOnChain(domain, deployed)).toBe(false);
  });

  it('rejects a separator for another chain or token', () => {
    expect(domainMatchesOnChain(domain, domainSeparator({ domain: { ...domain, chainId: 10 } }))).toBe(false);
    expect(
      domainMatchesOnChain(domain, domainSeparator({ domain: { ...domain, verifyingContract: SPENDER } })),
    ).toBe(false);
  });

  it.each([undefined, null, 1n, '0x1234', `0x${'zz'.repeat(32)}`])('rejects malformed RPC data %p', (value) => {
    expect(domainMatchesOnChain(domain, value)).toBe(false);
  });
});

describe('deadline', () => {
  it('derives the deadline from the block timestamp, not the client clock', () => {
    const blockTs = 1_000n;
    expect(computePermitDeadline(blockTs)).toBe(blockTs + BigInt(DEFAULT_PERMIT_WINDOW_SECONDS));
  });

  it.each([
    [undefined, DEFAULT_PERMIT_WINDOW_SECONDS],
    [Number.NaN, DEFAULT_PERMIT_WINDOW_SECONDS],
    [1, MIN_PERMIT_WINDOW_SECONDS],
    [86_400, MAX_PERMIT_WINDOW_SECONDS],
    [600.9, 600],
  ])('clamps a requested window of %p to %p seconds', (requested, expected) => {
    expect(clampPermitWindow(requested)).toBe(expected);
  });
});

describe('isValidPermitValue', () => {
  it.each([
    [1n, true],
    [0n, false],
    [-1n, false],
    [2n ** 256n, false],
    [5, false],
  ])('%p -> %p', (value, expected) => {
    expect(isValidPermitValue(value)).toBe(expected);
  });
});

describe('checkPermitSubmittable', () => {
  const base = { signedNonce: 3n, deadline: 10_000n };

  it('allows an unused permit with enough validity left', () => {
    expect(checkPermitSubmittable({ ...base, currentNonce: 3n, latestBlockTimestamp: 9_000n })).toEqual({ ok: true });
  });

  it('refuses a permit whose nonce was consumed or replaced', () => {
    expect(checkPermitSubmittable({ ...base, currentNonce: 4n, latestBlockTimestamp: 9_000n })).toEqual({
      ok: false,
      reason: 'nonce-consumed',
    });
  });

  it('treats the minimum remaining validity as the boundary', () => {
    const boundary = base.deadline - BigInt(MIN_REMAINING_VALIDITY_SECONDS);
    expect(checkPermitSubmittable({ ...base, currentNonce: 3n, latestBlockTimestamp: boundary }).ok).toBe(true);
    expect(checkPermitSubmittable({ ...base, currentNonce: 3n, latestBlockTimestamp: boundary + 1n })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('fails closed on unreadable chain state', () => {
    expect(checkPermitSubmittable({ ...base, currentNonce: '3', latestBlockTimestamp: 9_000n })).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(checkPermitSubmittable({ ...base, currentNonce: 3n, latestBlockTimestamp: undefined })).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('describePermit', () => {
  it('describes exactly the fields that are signed', () => {
    const typedData = buildPermitTypedData(buildPermitDomain(ASSET), {
      owner: OWNER,
      spender: SPENDER,
      value: 1_500_000n,
      nonce: 7n,
      deadline: 1_700_000_000n,
    });
    const rows = Object.fromEntries(describePermit(typedData, ASSET).map((row) => [row.label, row.value]));

    expect(rows).toEqual({
      Token: `TST (${TOKEN})`,
      Spender: SPENDER,
      Amount: '1.5 TST',
      Nonce: '7',
      Expires: '2023-11-14 22:13:20 UTC',
      Network: 'Chain 11155420',
      Signer: OWNER,
    });
  });
});
