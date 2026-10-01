'use client';

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useClaimDetailProjection } from '@/hooks/useClaimDetailProjection';
import {
  sanitizeEvidenceList,
  SafeEvidenceItem,
} from '@/lib/security/evidence-sanitizer';

export interface EvidenceViewerProps {
  claimId: string;
  /**
   * Untrusted evidence items from the API. Defaults to the canonical sample
   * set used by the verification page; every item is sanitized before render.
   */
  evidence?: Array<{ type: string; value: string }>;
}

const DEFAULT_EVIDENCE: Array<{ type: string; value: string }> = [
  { type: 'link', value: 'https://example.com' },
  { type: 'text', value: 'Witness testimony text' },
  { type: 'image', value: 'https://example.com/evidence/img1.png' },
];

/**
 * V2-FE-075 — Evidence media/link/text rendering with fail-closed
 * sanitization. All content is treated as untrusted:
 *  - link values must pass the scheme allowlist (https/ipfs) or they render
 *    as an accessible "blocked" placeholder instead of an anchor
 *  - anchors always use target="_blank" + noopener noreferrer nofollow
 *  - images only render from https or valid ipfs URIs (data:/blob: rejected)
 *  - text renders as React text children only — no innerHTML, ever
 */
export function EvidenceViewer({
  claimId,
  evidence: rawEvidence,
}: EvidenceViewerProps) {
  const [expanded, setExpanded] = useState(true);
  const projection = useClaimDetailProjection(rawEvidence ? undefined : claimId);

  const evidence = sanitizeEvidenceList(rawEvidence ?? projection.data?.claim.evidence ?? []);

  return (
    <div className="card p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls="evidence-content"
        className="flex items-center justify-between w-full font-semibold mb-3 text-base sm:text-lg text-left focus-visible:outline-2 focus-visible:outline-[#5b5bf6] focus-visible:outline-offset-2 rounded"
      >
        <span>Evidence</span>
        <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div
          id="evidence-content"
          data-testid="evidence-scroll-container"
          className="space-y-3 sm:space-y-3 overflow-y-auto overscroll-contain"
          style={{ maxHeight: '60vh', overscrollBehavior: 'contain' }}
        >
          {projection.viewState === 'loading' && !rawEvidence && (
            <p className="text-sm text-gray-500" role="status" aria-busy="true">Loading canonical evidence...</p>
          )}
          {projection.viewState === 'error' && !rawEvidence && (
            <div className="space-y-2" role="alert">
              <p className="text-sm text-red-500">Evidence projection unavailable.</p>
              <button type="button" onClick={projection.retry} className="text-sm text-blue-600 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                Try again
              </button>
            </div>
          )}
          {projection.viewState === 'ready-stale' && !rawEvidence && (
            <p className="text-sm text-amber-700" role="status">
              Evidence projection may be outdated. Review before relying on it.
            </p>
          )}
          {evidence.length === 0 && projection.viewState !== 'loading' && projection.viewState !== 'error' && (
            <p className="text-sm text-gray-500">No evidence available.</p>
          )}

          {evidence.map((e: SafeEvidenceItem, idx) => {
            if (e.kind === 'link') {
              return (
                <a
                  key={idx}
                  href={e.href}
                  target="_blank"
                  rel={e.rel}
                  className="text-blue-600 underline text-sm sm:text-base break-all block py-1"
                  aria-label={`Evidence link: ${e.text} (opens in new tab)`}
                >
                  {e.value}
                </a>
              );
            }

            if (e.type === 'image') {
              const validation = validateEvidenceUri(e.value);
              const safeHref = getSafeEvidenceHref(e.value);
              if (!validation.isValid || !safeHref) {
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-sm text-gray-500 italic py-1"
                    role="note"
                    data-testid="evidence-blocked-item"
                  >
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Blocked image URI</span>
                  </div>
                );
              }
              return (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={idx}
                  src={safeHref}
                  alt="Evidence image"
                  className="rounded-lg max-h-40 sm:max-h-60 w-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              );
            }

            return (
              <p key={idx} className="text-sm sm:text-base leading-relaxed">
                {e.value}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default EvidenceViewer;