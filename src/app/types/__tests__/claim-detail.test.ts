import { parseClaimDetailEnvelope } from '@/app/types/claim-detail';

const claim = {
  id: 'claim-1',
  title: 'Canonical claim',
  description: 'A validated projection',
  claimantAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  status: 'OPEN' as const,
  bountyAmount: 1,
  totalStaked: 0,
  evidence: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('claim detail projection parser', () => {
  it('accepts a complete fresh envelope', () => {
    expect(parseClaimDetailEnvelope({
      claim,
      projection: { freshness: 'fresh', generatedAt: claim.updatedAt },
    }).claim.id).toBe('claim-1');
  });

  it('fails closed when the response is a legacy bare claim', () => {
    expect(() => parseClaimDetailEnvelope(claim)).toThrow('malformed');
  });

  it('fails closed for invalid freshness metadata', () => {
    expect(() => parseClaimDetailEnvelope({
      claim,
      projection: { freshness: 'fresh', generatedAt: 'not-a-date' },
    })).toThrow('freshness');
  });
});