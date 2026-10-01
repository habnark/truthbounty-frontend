// src/app/api/user.api.ts

export interface UserProfile {
  id: string;
  address: string;
  username: string;
  reputation: number;
  verificationCount: number;
  accuracy: number;
  totalStaked: number;
  totalEarned: number;
  joinedAt: string;
}

export interface UserReputation {
  score: number;
  rank: number;
  totalVerifications: number;
  successfulVerifications: number;
  accuracy: number;
}

// ---------------------------------------------------------------------------
// Reward types
// ---------------------------------------------------------------------------

/**
 * A single pending/claimable reward entry returned by the indexer.
 * `amount` is a string to preserve exact integer precision (wei units).
 */
export interface ClaimableRewardEntry {
  claimId: string;
  title: string;
  /** Exact reward amount in token base units (e.g. wei for ETH-denominated rewards). */
  amount: string;
  tokenAddress: string;
  /** On-chain epoch / round in which the reward was earned. */
  earnedInRound: number;
}

export interface RewardHistoryEntry {
  claimId: string;
  title: string;
  amount: string;
  tokenAddress: string;
  txHash: string;
  claimedAt: string;
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Failed to fetch user profile');
  return res.json();
}

export async function fetchUserReputation(userId: string): Promise<UserReputation> {
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/reputation`);
  if (!res.ok) throw new Error('Failed to fetch user reputation');
  return res.json();
}

export async function fetchClaimableRewards(address: string): Promise<ClaimableRewardEntry[]> {
  const res = await fetch(`/api/rewards/claimable?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error('Failed to fetch claimable rewards');
  return res.json();
}

export async function fetchRewardHistory(address: string): Promise<RewardHistoryEntry[]> {
  const res = await fetch(`/api/rewards/history?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error('Failed to fetch reward history');
  return res.json();
}
