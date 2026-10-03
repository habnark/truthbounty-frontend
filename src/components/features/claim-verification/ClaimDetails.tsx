'use client';

import { Claim } from '@/app/types/claim';
import { useEffect } from 'react';
import { useClaimDetailProjection } from '@/hooks/useClaimDetailProjection';
import { useTrustForAddress } from '@/components/hooks/useTrust';
import TrustScoreTooltip from '@/components/ui/TrustScoreTooltip';
import { ClaimDetailsSkeleton } from '@/components/skeletons';
import {
  sanitizeEvidenceList,
  sanitizeText,
} from '@/lib/security/evidence-sanitizer';
import { PrivateEvidenceLink } from '@/components/security/PrivateEvidenceLink';

export interface ClaimDetailsProps {
  claimId?: string;
  claim?: Claim;
  isLoading?: boolean;
  onNotFound?: () => void;
}

export function ClaimDetails({ claimId, claim: initialClaim, isLoading: externalLoading = false, onNotFound }: ClaimDetailsProps) {
  const projection = useClaimDetailProjection(initialClaim ? undefined : claimId);
  const claim = initialClaim || projection.data?.claim;
  const isLoading = externalLoading || (!initialClaim && projection.viewState === 'loading');
  const notFound = !initialClaim && projection.viewState === 'not-found';

  useEffect(() => {
    if (notFound) onNotFound?.();
  }, [notFound, onNotFound]);

  const proposerAddress = claim?.proposer || claim?.claimantAddress;
  const proposerTrust = useTrustForAddress(proposerAddress);

  if (isLoading && !notFound) {
    return <ClaimDetailsSkeleton />;
  }

  if (notFound) {
    return (
      <div className="bg-[#18181b] border border-red-500/20 rounded-xl p-6 text-center">
        <h3 className="text-lg font-bold text-red-500 mb-2">Claim Not Found</h3>
        <p className="text-gray-400 text-sm">The requested claim does not exist or has been removed.</p>
      </div>
    );
  }

  if (!claim) {
    const staleProjection = projection.error?.code === 'PROJECTION_STALE';
    return (
      <div className={`rounded-xl border p-6 text-center ${staleProjection ? 'border-amber-500/30 bg-amber-500/10' : 'border-red-500/20 bg-[#18181b]'}`} role="alert">
        <h3 className={`mb-2 text-lg font-bold ${staleProjection ? 'text-amber-300' : 'text-red-500'}`}>
          {staleProjection ? 'Claim projection is stale' : 'Claim details unavailable'}
        </h3>
        <p className="text-sm text-gray-400">
          {staleProjection ? 'The projection service is rebuilding. No claim state is being presented as current.' : 'The canonical claim projection could not be verified.'}
        </p>
        <button type="button" onClick={projection.retry} className="mt-4 rounded-md border border-gray-600 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
          Try again
        </button>
      </div>
    );
  }

  // V2-FE-075 — claim content arrives from the API and is untrusted.
  const safeTitle = sanitizeText(claim.title, 300);
  const safeDescription = sanitizeText(claim.description, 5000);
  const safeCategory = claim.category ? sanitizeText(claim.category, 100) : null;
  const evidence = sanitizeEvidenceList(claim.evidence);
  const isStale = !initialClaim && projection.viewState === 'ready-stale';

  return (
    <div className="bg-[#18181b] border border-[#232329] rounded-xl p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232329] pb-4">
        <h2 className="min-w-0 flex-1 text-lg font-bold break-words text-white sm:text-xl">{safeTitle}</h2>
        <span className="shrink-0 px-3 py-1 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 rounded-full text-xs font-semibold uppercase tracking-wider">
          {claim.status}
        </span>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Description</h3>
        <p className="text-gray-200 text-sm leading-relaxed break-words">{safeDescription}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-[#232329] text-xs text-gray-400">
        <div>
          {claim.category ? (
            <>
              <span>Category: </span>
              <span className="text-gray-200 font-medium">{safeCategory ?? 'Uncategorized'}</span>
            </>
          ) : (
            <span>Category: Uncategorized</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span>Proposer Trust:</span>
          <span className="text-yellow-500 font-bold">{proposerTrust.reputation ?? '—'}</span>
          <TrustScoreTooltip />
        </div>
      </div>

      {evidence.length > 0 && (
        <div className="pt-4 border-t border-[#232329] space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Evidence</h3>
          <ul className="space-y-1">
            {evidence.map((ev, idx) => (
              <li key={idx} className="text-xs text-gray-300">
                {ev.kind === 'link' && (
                  <PrivateEvidenceLink
                    href={ev.href}
                    className="text-blue-400 underline break-all"
                    ariaLabel={`Evidence link ${idx + 1} (truncated for privacy, click to copy)`}
                    showIcon={true}
                  />
                )}
                {ev.kind === 'image' && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={ev.src}
                    alt="Evidence image"
                    className="rounded max-h-40 w-auto"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                )}
                {ev.kind === 'text' && <span>{ev.text}</span>}
                {ev.kind === 'blocked' && (
                  <span className="text-gray-500 italic" role="note">
                    {ev.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
