/**
 * Dispute API functions.
 *
 * Authoritative source: on-chain DisputeCreated / DisputeResolved events
 * indexed into the projection layer.
 *
 * Security rules:
 *  - Never fabricate dispute IDs, outcome verdicts, vote counts, or stake amounts.
 *  - Amounts returned by the API are exact integer strings (wei precision); do
 *    not convert them locally without explicit bigint handling.
 */

import type { Dispute, CreateDisputePayload } from '@/app/types/dispute';

export type { Dispute, CreateDisputePayload };

export async function fetchDisputesByClaim(claimId: string): Promise<Dispute[]> {
  const res = await fetch(
    `/api/claims/${encodeURIComponent(claimId)}/disputes`,
  );
  if (!res.ok) throw new Error('Failed to fetch disputes for claim');
  return res.json();
}

export async function fetchDisputeDetail(disputeId: string): Promise<Dispute> {
  const res = await fetch(`/api/disputes/${encodeURIComponent(disputeId)}`);
  if (!res.ok) throw new Error('Failed to fetch dispute detail');
  return res.json();
}

export async function createDispute(
  payload: CreateDisputePayload,
): Promise<Dispute> {
  const res = await fetch('/api/disputes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create dispute');
  return res.json();
}
