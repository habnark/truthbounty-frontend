// src/app/api/claims.api.ts

import { Claim } from '@/app/types/claim';
import {
  CLAIMS_LIST_MAX_PAGE_SIZE,
  CLAIMS_LIST_MIN_PAGE_SIZE,
  createClaimsListError,
  isClaimListItem,
  type ClaimListItem,
  type ClaimsListEnvelope,
  type ClaimsListParams,
} from '@/app/types/claim-list';

type EvidenceItem = Record<string, unknown>;
type RoundItem = Record<string, unknown>;

export interface ClaimSubmissionData {
  title: string;
  description: string;
  category?: string;
  impact?: string;
  source?: string;
  evidence?: Array<{ type: string; value: string }>;
}

export async function fetchClaims(): Promise<Claim[]> {
  const res = await fetch('/api/claims');
  if (!res.ok) throw new Error('Failed to fetch claims');
  return res.json();
}

export async function fetchClaimDetail(claimId: string): Promise<Claim> {
  const res = await fetch(`/api/claims/${claimId}`);
  if (!res.ok) throw new Error('Failed to fetch claim detail');
  return res.json();
}

export async function submitClaim(payload: ClaimSubmissionData): Promise<Claim> {
  const res = await fetch('/api/claims', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to submit claim');
  return res.json();
}

export async function fetchClaimsByStatus(status: string): Promise<Claim[]> {
  const res = await fetch(`/api/claims?status=${encodeURIComponent(status)}`);
  if (!res.ok) throw new Error('Failed to fetch claims by status');
  return res.json();
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export async function fetchEvidence(claimId: string): Promise<EvidenceItem[]> {
  const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}/evidence`);
  if (!res.ok) throw new Error('Failed to fetch evidence');
  return res.json();
}

export async function fetchEvidenceDetail(evidenceId: string): Promise<EvidenceItem> {
  const res = await fetch(`/api/evidence/${encodeURIComponent(evidenceId)}`);
  if (!res.ok) throw new Error('Failed to fetch evidence detail');
  return res.json();
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export async function fetchRoundsByClaim(claimId: string): Promise<RoundItem[]> {
  const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}/rounds`);
  if (!res.ok) throw new Error('Failed to fetch rounds');
  return res.json();
}

export async function fetchRoundDetail(roundId: string): Promise<RoundItem> {
  const res = await fetch(`/api/rounds/${encodeURIComponent(roundId)}`);
  if (!res.ok) throw new Error('Failed to fetch round detail');
  return res.json();
}

/* ------------------------------------------------------------------ */
/* Canonical claim-list projection (V2-FE-109)                        */
/* ------------------------------------------------------------------ */

/**
 * Build the canonical querystring for the claims list projection endpoint.
 * Exported for deterministic testing of the wire format.
 */
export function buildClaimsListQuery(params: ClaimsListParams): string {
  const search = new URLSearchParams();
  const trimmedSearch = params.search.trim();
  if (trimmedSearch.length > 0) {
    search.set('search', trimmedSearch);
  }
  if (params.filters.status) {
    search.set('status', params.filters.status);
  }
  if (params.filters.highImpact) {
    search.set('highImpact', 'true');
  }
  search.set('page', String(params.pagination.page));
  search.set('pageSize', String(params.pagination.pageSize));
  search.set('sort', `${params.sort.field}.${params.sort.direction}`);
  return search.toString();
}

function assertClaimsListEnvelope(payload: unknown): ClaimsListEnvelope {
  if (typeof payload !== 'object' || payload === null) {
    throw createClaimsListError(
      'PROJECTION_MALFORMED',
      'Claims projection response is not an object'
    );
  }

  const envelope = payload as Record<string, unknown>;
  const items = envelope.items;
  const pagination = envelope.pagination as ClaimsListEnvelope['pagination'] | undefined;
  const projection = envelope.projection as ClaimsListEnvelope['projection'] | undefined;

  if (!Array.isArray(items)) {
    throw createClaimsListError(
      'PROJECTION_MALFORMED',
      'Claims projection response is missing a valid items array'
    );
  }

  for (const item of items) {
    if (!isClaimListItem(item)) {
      throw createClaimsListError(
        'PROJECTION_MALFORMED',
        'Claims projection contains a malformed claim row'
      );
    }
  }

  if (
    !pagination ||
    typeof pagination !== 'object' ||
    !Number.isInteger(pagination.page) ||
    pagination.page < 1 ||
    !Number.isInteger(pagination.pageSize) ||
    !Number.isInteger(pagination.total) ||
    pagination.total < 0 ||
    !Number.isInteger(pagination.totalPages)
  ) {
    throw createClaimsListError(
      'PROJECTION_MALFORMED',
      'Claims projection pagination block is malformed'
    );
  }

  if (
    !projection ||
    typeof projection !== 'object' ||
    (projection.freshness !== 'fresh' &&
      projection.freshness !== 'stale' &&
      projection.freshness !== 'degraded') ||
    typeof projection.generatedAt !== 'string'
  ) {
    throw createClaimsListError(
      'PROJECTION_MALFORMED',
      'Claims projection freshness metadata is malformed'
    );
  }

  return payload as ClaimsListEnvelope;
}

/**
 * Fetch the canonical claims list projection.
 *
 * Fails closed: any non-2xx, non-JSON, or schema-violating response throws a
 * ClaimsListError with a canonical code. The UI must never render an
 * unvalidated response as protocol state.
 */
export async function fetchClaimsList(
  params: ClaimsListParams,
  signal?: AbortSignal
): Promise<ClaimsListEnvelope> {
  const clamped: ClaimsListParams = {
    ...params,
    pagination: {
      page: Math.max(1, params.pagination.page),
      pageSize: Math.min(
        CLAIMS_LIST_MAX_PAGE_SIZE,
        Math.max(CLAIMS_LIST_MIN_PAGE_SIZE, params.pagination.pageSize)
      ),
    },
  };

  let res: Response;
  try {
    res = await fetch(`/api/claims?${buildClaimsListQuery(clamped)}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    // Abort is a normal control flow path (React Query cancellation), not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw createClaimsListError(
      'PROJECTION_UNAVAILABLE',
      'Could not reach the claims projection service'
    );
  }

  if (res.status === 400 || res.status === 422) {
    throw createClaimsListError(
      'UNSUPPORTED_REQUEST',
      'The claims projection rejected this query as unsupported'
    );
  }

  if (res.status === 503) {
    throw createClaimsListError(
      'PROJECTION_STALE',
      'The claims projection is temporarily unavailable (stale or rebuilding)'
    );
  }

  if (!res.ok) {
    throw createClaimsListError(
      'PROJECTION_UNAVAILABLE',
      `Claims projection request failed with status ${res.status}`
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw createClaimsListError(
      'PROJECTION_MALFORMED',
      'Claims projection returned a non-JSON response'
    );
  }

  return assertClaimsListEnvelope(payload);
}

