import type { Claim } from './claim';
import type { ProjectionFreshness } from './claim-list';

export interface ClaimDetailEnvelope {
  claim: Claim;
  projection: {
    freshness: ProjectionFreshness;
    generatedAt: string;
    reason?: string;
  };
}

export type ClaimDetailErrorCode =
  | 'CLAIM_NOT_FOUND'
  | 'PROJECTION_UNAVAILABLE'
  | 'PROJECTION_STALE'
  | 'PROJECTION_MALFORMED';

export interface ClaimDetailError extends Error {
  code: ClaimDetailErrorCode;
}

export type ClaimDetailViewState =
  | 'loading'
  | 'ready'
  | 'ready-stale'
  | 'not-found'
  | 'error';

export function createClaimDetailError(
  code: ClaimDetailErrorCode,
  message: string,
): ClaimDetailError {
  const error = new Error(message) as ClaimDetailError;
  error.name = 'ClaimDetailError';
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isClaim(value: unknown): value is Claim {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.claimantAddress === 'string' &&
    typeof value.status === 'string' &&
    ['OPEN', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'DISPUTED'].includes(value.status) &&
    typeof value.bountyAmount === 'number' &&
    Number.isFinite(value.bountyAmount) &&
    typeof value.totalStaked === 'number' &&
    Number.isFinite(value.totalStaked) &&
    Array.isArray(value.evidence) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

export function parseClaimDetailEnvelope(payload: unknown): ClaimDetailEnvelope {
  if (!isRecord(payload) || !isClaim(payload.claim) || !isRecord(payload.projection)) {
    throw createClaimDetailError(
      'PROJECTION_MALFORMED',
      'Claim detail projection is malformed',
    );
  }

  const { projection } = payload;
  if (
    (projection.freshness !== 'fresh' &&
      projection.freshness !== 'stale' &&
      projection.freshness !== 'degraded') ||
    typeof projection.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(projection.generatedAt)) ||
    (projection.reason !== undefined && typeof projection.reason !== 'string')
  ) {
    throw createClaimDetailError(
      'PROJECTION_MALFORMED',
      'Claim detail projection freshness metadata is malformed',
    );
  }

  return payload as ClaimDetailEnvelope;
}