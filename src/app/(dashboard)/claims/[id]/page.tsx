
'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import MainLayout from '@/components/layout/MainLayout';

import { ClaimDetails } from '@/components/features/claim-verification/ClaimDetails';
import { EvidenceViewer } from '@/components/features/claim-verification/EvidenceViewer';
import { StakeForm } from '@/components/features/claim-verification/StakeForm';
import { VerificationActions } from '@/components/features/claim-verification/VerificationActions';
import { FeatureErrorBoundary } from '@/components/common/FeatureErrorBoundary';

export default function ClaimDetailPage() {
  // Route params are read through useParams() rather than the page props:
  // under async request APIs the props value is a Promise on the client, and
  // `params.id` evaluated to undefined there, so the page rendered its
  // "Claim not Found" state without ever consulting the API projection.
  const { id: claimId } = useParams<{ id: string }>();

  const [stakeAmount, setStakeAmount] = useState(0);
  const [claimNotFound, setClaimNotFound] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      setIsLoading(true);
      getClaimById(params.id)
        .then((data) => {
          setClaim(data);
          setIsLoading(false);
        })
        .catch((err) => {
          if (err.message === 'CLAIM_NOT_FOUND') {
            setClaimNotFound(true);
          }
          setIsLoading(false);
        });
    }
  }, [params.id]);

  const handleStakeChange = (stake: string) => {
    const value = parseFloat(stake) || 0;
    setStakeAmount(value);
  };

  const handleNotFound = () => {
    setClaimNotFound(true);
  };

  if (claimNotFound) {
    return (
      <MainLayout>
        <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            Claim not found
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            The claim you&apos;re looking for doesn&apos;t exist, has been
            removed, or is no longer available for verification.
          </p>

          <button
            type="button"
            onClick={() => window.history.back()}
            className="mt-6 inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:focus:ring-gray-600"
          >
            Go back
          </button>
        </div>
      </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-gray-50/70 dark:bg-gray-950">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">

        {/* Page Header */}
        <header className="mb-6 lg:mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span>Claims</span>
                <span aria-hidden="true">/</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  Verification
                </span>
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-3xl">
                Claim Verification
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400 sm:text-base">
                Review the claim, examine the available evidence, and submit
                your verification decision.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Verification available
            </div>
          </div>
        </header>

        {/* Main Layout */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">

          {/* Main Content */}
          <section className="min-w-0 space-y-6">
            {/* Claim */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:px-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      Claim
                    </h2>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Review the claim details before verifying.
                    </p>
                  </div>

                  <span className="hidden rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300 sm:inline-flex">
                    ID: {claimId}
                  </span>
                </div>
              </div>

              <div className="p-5 sm:p-6">
                <FeatureErrorBoundary scope="claim-details">
                  <ClaimDetails
                    claimId={claimId}
                    onNotFound={handleNotFound}
                  />
                </FeatureErrorBoundary>
              </div>
            </div>

            {/* Evidence */}
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:px-6">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Evidence
                </h2>

                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Examine the evidence supporting this claim.
                </p>
              </div>

              <div className="p-5 sm:p-6">
                <FeatureErrorBoundary scope="evidence">
                  <EvidenceViewer claimId={claimId} />
                </FeatureErrorBoundary>
              </div>
            </div>
          </section>

          {/* Verification Sidebar */}
          <aside className="space-y-6 lg:sticky lg:top-6">

            {/* Verification Summary */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
                  <svg
                    className="h-5 w-5 text-gray-700 dark:text-gray-300"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M12 3l8.25 4.5v5.25c0 4.485-3.438 7.93-8.25 8.25-4.812-.32-8.25-3.765-8.25-8.25V7.5L12 3z"
                    />
                  </svg>
                </div>

                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Verify this claim
                  </h2>

                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    Stake on your assessment and submit your verification
                    decision.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Your stake
                  </span>

                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {stakeAmount > 0 ? stakeAmount : '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-gray-800/60">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Status
                  </span>

                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    Awaiting verification
                  </span>
                </div>
              </div>
            </div>

            {/* Stake */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Stake
                </h2>

                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Choose how much you want to stake on your verification.
                </p>
              </div>

              <div className="p-5">
                <FeatureErrorBoundary scope="stake">
                  <StakeForm
                    claimId={claimId}
                    onStakeChange={handleStakeChange}
                  />
                </FeatureErrorBoundary>
              </div>
            </div>

            {/* Actions */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Decision
                </h2>

                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Submit your final verification decision.
                </p>
              </div>

              <div className="p-5">
                <FeatureErrorBoundary scope="verification-actions">
                  <VerificationActions
                    claimId={claimId}
                    stakeAmount={stakeAmount}
                  />
                </FeatureErrorBoundary>
              </div>
            </div>

            {/* Important Notice */}
            <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div className="flex gap-3">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM10.29 3.86l-7.1 12.5A1.75 1.75 0 004.71 19h14.58a1.75 1.75 0 001.52-2.64l-7.1-12.5a1.75 1.75 0 00-3.04 0z"
                  />
                </svg>

                <div>
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    Before you submit
                  </p>

                  <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-400">
                    Make sure you have reviewed the claim and all available
                    evidence. Your verification decision may not be reversible.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
    </MainLayout>
  );
}