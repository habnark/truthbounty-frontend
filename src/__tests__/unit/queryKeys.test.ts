/**
 * Unit tests for canonical query key factories (V2-FE-020 & V2-FE-063).
 * Covers chain, wallet, claim, evidence, rounds, disputes, verifications,
 * rewards, reputation, projection watermark, filters, finality,
 * collision resistance, and fail-closed wallet scope normalization.
 */

import {
  chainKeys,
  claimKeys,
  claimsKeys,
  evidenceKeys,
  roundsKeys,
  disputesKeys,
  verificationsKeys,
  rewardsKeys,
  reputationKeys,
  projectionWatermarkKeys,
  filterKeys,
  finalityKeys,
  userKeys,
  leaderboardKeys,
  normalizeAddress,
  queryKeys,
  walletKeys,
  walletScope,
} from '@/app/queries/queryKeys';

describe('normalizeAddress / walletScope', () => {
  it('normalizes valid addresses to lowercase', () => {
    expect(normalizeAddress('0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD')).toBe(
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    );
  });

  it('fails closed on malformed addresses', () => {
    expect(normalizeAddress(undefined)).toBeNull();
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('not-an-address')).toBeNull();
    expect(normalizeAddress('0x123')).toBeNull();
  });

  it('fails closed on unsupported chain ids', () => {
    expect(walletScope('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 0)).toBeNull();
    expect(walletScope('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', -1)).toBeNull();
    expect(walletScope('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 1.5)).toBeNull();
    expect(walletScope('bad', 10)).toBeNull();
  });

  it('returns normalized scope for valid inputs', () => {
    expect(walletScope('0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD', 10)).toEqual({
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      chainId: 10,
    });
  });
});

describe('chainKeys', () => {
  it('exposes a stable root', () => {
    expect(chainKeys.all).toEqual(['chain']);
  });

  it('scopes config/status/block by chainId and tag', () => {
    expect(chainKeys.config(10)).toEqual(['chain', 'config', 10]);
    expect(chainKeys.status(11155420)).toEqual(['chain', 'status', 11155420]);
    expect(chainKeys.block(10, 'finalized')).toEqual(['chain', 'block', 10, 'finalized']);
  });

  it('does not collide across tags for the same chain', () => {
    expect(JSON.stringify(chainKeys.block(10, 'safe'))).not.toBe(
      JSON.stringify(chainKeys.block(10, 'finalized')),
    );
  });
});

describe('walletKeys', () => {
  const addr = '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD';
  const normalized = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

  it('scopes balance by normalized address + chainId', () => {
    expect(walletKeys.balance(addr, 10)).toEqual(['wallet', 'balance', normalized, 10]);
  });

  it('isolates the same address across chains', () => {
    expect(JSON.stringify(walletKeys.balance(addr, 10))).not.toBe(
      JSON.stringify(walletKeys.balance(addr, 11155420)),
    );
  });

  it('isolates different addresses on the same chain', () => {
    const other = '0x0000000000000000000000000000000000000001';
    expect(JSON.stringify(walletKeys.scope(addr, 10))).not.toBe(
      JSON.stringify(walletKeys.scope(other, 10)),
    );
  });

  it('fail-closed invalid scope does not look like a real address key', () => {
    expect(walletKeys.balance('nope', 10)).toEqual(['wallet', 'balance', 'invalid']);
  });

  it('tokenBalance and allowance include token/spender discriminants', () => {
    const token = '0x1111111111111111111111111111111111111111';
    const spender = '0x2222222222222222222222222222222222222222';
    expect(walletKeys.tokenBalance(addr, token, 10)).toEqual([
      'wallet',
      'token',
      normalized,
      token,
      10,
    ]);
    expect(walletKeys.allowance(addr, spender, token, 10)[0]).toBe('wallet');
    expect(walletKeys.allowance(addr, spender, token, 10)).toContain(normalized);
  });
});

describe('claimKeys', () => {
  it('preserves legacy detail shape', () => {
    expect(claimKeys.detail('claim-1')).toEqual(['claims', 'claim-1']);
  });

  it('lists() returns a stable lists key', () => {
    expect(claimKeys.lists()).toEqual(['claims', 'list']);
  });

  it('encodes list filters to prevent filter collisions', () => {
    const a = claimKeys.list({ status: 'OPEN' });
    const b = claimKeys.list({ status: 'CLOSED' });
    expect(a).toEqual(['claims', 'list', { status: 'OPEN' }]);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('byStatus scopes to status', () => {
    expect(claimKeys.byStatus('OPEN')).toEqual(['claims', 'status', 'OPEN']);
  });

  it('lifecycle and timeline keys are claim-scoped', () => {
    expect(claimKeys.lifecycle('claim-1')).toEqual(['claims', 'claim-1', 'lifecycle']);
    expect(claimKeys.timeline('claim-1')).toEqual(['claims', 'claim-1', 'timeline']);
  });

  it('wallet-scoped index is chain aware', () => {
    const addr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(claimKeys.byWallet(addr, 10)).toEqual(['claims', 'wallet', addr, 10]);
    expect(JSON.stringify(claimKeys.byWallet(addr, 10))).not.toBe(
      JSON.stringify(claimKeys.byWallet(addr, 11155420)),
    );
  });

  it('finality key supports both chain-scoped and un-scoped forms', () => {
    expect(claimKeys.finality('claim-1', 10)).toEqual(['claims', 'finality', 'claim-1', 10]);
    expect(claimKeys.finality('claim-1')).toEqual(['claims', 'finality', 'claim-1']);
    expect(JSON.stringify(claimKeys.finality('claim-1', 10))).not.toBe(
      JSON.stringify(claimKeys.detail('claim-1')),
    );
  });

  it('claimsKeys is an alias for claimKeys', () => {
    expect(claimsKeys).toBe(claimKeys);
  });
});

describe('evidenceKeys', () => {
  it('all is the root key', () => {
    expect(evidenceKeys.all).toEqual(['evidence']);
  });

  it('byClaim(claimId) scopes to the claim', () => {
    expect(evidenceKeys.byClaim('claim-2')).toEqual(['evidence', 'claim', 'claim-2']);
  });

  it('detail(evidenceId) is claim-independent', () => {
    expect(evidenceKeys.detail('ev-1')).toEqual(['evidence', 'detail', 'ev-1']);
  });
});

describe('roundsKeys', () => {
  it('all is the root key', () => {
    expect(roundsKeys.all).toEqual(['rounds']);
  });

  it('byClaim(claimId) scopes correctly', () => {
    expect(roundsKeys.byClaim('claim-3')).toEqual(['rounds', 'claim', 'claim-3']);
  });

  it('detail(roundId) is distinct from byClaim', () => {
    const byClaim = JSON.stringify(roundsKeys.byClaim('r1'));
    const detail = JSON.stringify(roundsKeys.detail('r1'));
    expect(byClaim).not.toBe(detail);
  });
});

describe('disputesKeys', () => {
  it('all is the root key', () => {
    expect(disputesKeys.all).toEqual(['disputes']);
  });

  it('byClaim(claimId) scopes to the claim', () => {
    expect(disputesKeys.byClaim('claim-4')).toEqual(['disputes', 'claim', 'claim-4']);
  });

  it('detail(disputeId) is included', () => {
    expect(disputesKeys.detail('d-1')).toEqual(['disputes', 'd-1']);
  });

  it('finality(disputeId) is isolated', () => {
    expect(disputesKeys.finality('d-1')).toEqual(['disputes', 'finality', 'd-1']);
  });
});

describe('verificationsKeys', () => {
  it('all is the root key', () => {
    expect(verificationsKeys.all).toEqual(['verifications']);
  });

  it('byClaim scopes to claim', () => {
    expect(verificationsKeys.byClaim('claim-5')).toEqual([
      'verifications',
      'claim',
      'claim-5',
    ]);
  });

  it('byUser scopes to user', () => {
    expect(verificationsKeys.byUser('user-1')).toEqual([
      'verifications',
      'user',
      'user-1',
    ]);
  });
});

describe('rewardsKeys', () => {
  it('all is the root key', () => {
    expect(rewardsKeys.all).toEqual(['rewards']);
  });

  it('claimable(address) includes the address', () => {
    const addr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(rewardsKeys.claimable(addr)).toEqual(['rewards', 'claimable', addr]);
  });

  it('history(address) is distinct from claimable(address)', () => {
    const addr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(rewardsKeys.claimable(addr)).not.toEqual(rewardsKeys.history(addr));
  });

  it('byClaim(claimId) is claim-scoped', () => {
    expect(rewardsKeys.byClaim('claim-6')).toEqual(['rewards', 'claim', 'claim-6']);
  });
});

describe('reputationKeys', () => {
  it('all is the root key', () => {
    expect(reputationKeys.all).toEqual(['reputation']);
  });

  it('byUser(userId) includes the userId', () => {
    expect(reputationKeys.byUser('user-1')).toEqual(['reputation', 'user', 'user-1']);
  });

  it('leaderboard is stable', () => {
    expect(reputationKeys.leaderboard).toEqual(['reputation', 'leaderboard']);
  });
});

describe('projectionWatermarkKeys', () => {
  it('scopes by chain and namespace', () => {
    expect(projectionWatermarkKeys.byChain(10)).toEqual([
      'projectionWatermark',
      'chain',
      10,
    ]);
    expect(projectionWatermarkKeys.byNamespace('claims', 10)).toEqual([
      'projectionWatermark',
      'claims',
      10,
    ]);
    expect(projectionWatermarkKeys.entity('claims', 'c1', 10)).toEqual([
      'projectionWatermark',
      'claims',
      'c1',
      10,
    ]);
  });

  it('entity keys do not collide with namespace keys', () => {
    expect(
      JSON.stringify(projectionWatermarkKeys.entity('claims', 'c1', 10)),
    ).not.toBe(JSON.stringify(projectionWatermarkKeys.byNamespace('claims', 10)));
  });
});

describe('filterKeys', () => {
  it('keeps claim filter keys distinct by filter object', () => {
    expect(JSON.stringify(filterKeys.claims({ status: 'OPEN' }))).not.toBe(
      JSON.stringify(filterKeys.claims({ status: 'CLOSED' })),
    );
  });

  it('activity filters are wallet scoped', () => {
    const addr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    expect(filterKeys.activity(addr, { page: 1 })).toEqual([
      'filters',
      'activity',
      addr,
      { page: 1 },
    ]);
  });
});

describe('finalityKeys', () => {
  it('scopes tx finality by hash + chain', () => {
    expect(finalityKeys.byTx('0xAbC', 10)).toEqual(['finality', 'tx', '0xabc', 10]);
  });

  it('entity and level keys are distinct', () => {
    expect(JSON.stringify(finalityKeys.byEntity('claim', 'c1', 10))).not.toBe(
      JSON.stringify(finalityKeys.level('claim', 'c1', 10)),
    );
  });
});

describe('userKeys', () => {
  it('profile(userId) includes the userId', () => {
    expect(userKeys.profile('u1')).toEqual(['user', 'u1']);
  });

  it('reputation(userId) nests under profile', () => {
    expect(userKeys.reputation('u1')).toEqual(['user', 'u1', 'reputation']);
  });

  it('rewards(userId) does not collide with reputation', () => {
    expect(userKeys.reputation('u1')).not.toEqual(userKeys.rewards('u1'));
  });
});

describe('queryKeys unified export', () => {
  it('exposes all domain factories', () => {
    expect(queryKeys.chain).toBe(chainKeys);
    expect(queryKeys.wallet).toBe(walletKeys);
    expect(queryKeys.claims).toBe(claimKeys);
    expect(queryKeys.claim).toBe(claimKeys);
    expect(queryKeys.evidence).toBe(evidenceKeys);
    expect(queryKeys.rounds).toBe(roundsKeys);
    expect(queryKeys.disputes).toBe(disputesKeys);
    expect(queryKeys.verifications).toBe(verificationsKeys);
    expect(queryKeys.rewards).toBe(rewardsKeys);
    expect(queryKeys.reputation).toBe(reputationKeys);
    expect(queryKeys.projectionWatermark).toBe(projectionWatermarkKeys);
    expect(queryKeys.filters).toBe(filterKeys);
    expect(queryKeys.finality).toBe(finalityKeys);
  });

  it('preserves legacy leaderboard + user roots', () => {
    expect(queryKeys.leaderboard).toEqual(['leaderboard']);
    expect(queryKeys.user.profile('u1')).toEqual(['user', 'u1']);
  });
});
