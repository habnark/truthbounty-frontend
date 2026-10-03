"use client";

/**
 * ClaimRewardsPanel — V2-FE-060
 *
 * Renders finalized claimable balances read from the backend projection
 * (V2-BE-017), explains allocation categories, and submits pull claims via
 * wagmi/viem against the frozen release ABI.
 *
 * Security invariants:
 *  - All state is sourced from useRewards (validated entitlements +
 *    receipt-reconciled claim lifecycle). No mock data, no fabricated values.
 *  - Fail-closed: wallet/chain/session prerequisites are checked by the hook;
 *    the panel renders a non-actionable message when isUnsupported is true.
 *  - Lifecycle state is driven only by canonical on-chain receipts (never
 *    by timers or client guesses).
 *  - Explorer links are generated from the confirmed tx hash only; they are
 *    never shown before confirmation.
 */

import React from "react";
import { useRewards } from "@/hooks/useRewards";
import { ClaimRewardsPanelSkeleton } from "@/components/skeletons";
import { getTransactionExplorerUrl } from "@/lib/explorer";
import { formatCurrency } from "@/lib/format";

interface ClaimRewardsPanelProps {
  isLoading?: boolean;
}

export default function ClaimRewardsPanel({
  isLoading: externalLoading = false,
}: ClaimRewardsPanelProps) {
  const {
    pendingRewards,
    totalClaimableDisplay,
    status,
    lastTxHash,
    receiptProjection,
    errorMessage,
    isLoading: isEntitlementsLoading,
    loadError,
    isUnsupported,
    unsupportedReason,
    claimAll,
    refresh,
    reset,
  } = useRewards();

  const hasRewards = pendingRewards.length > 0;
  const isLoading = externalLoading || isEntitlementsLoading || status === "loading";
  const isSuccess = status === "success";
  const isError = status === "error";
  const isConfirming = status === "confirming";

  const handleClaim = () => {
    void claimAll();
  };

  // Fail closed: wallet/chain/session prerequisites unmet. Same panel shell,
  // with an explicit, actionable state instead of claim controls.
  if (isUnsupported) {
    return (
      <div className="bg-[#18181b] rounded-xl border border-[#232329] overflow-hidden min-h-[280px]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#232329]">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg bg-[#5b5bf6]/20 flex items-center justify-center"
              aria-hidden="true"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 1l1.94 3.93L14 5.27l-3 2.93.71 4.13L8 10.27l-3.71 2.06.71-4.13L2 5.27l4.06-.34L8 1z"
                  fill="#5b5bf6"
                />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">
                Claimable Rewards
              </p>
              <p className="text-[#a1a1aa] text-xs">Earned from verified claims</p>
            </div>
          </div>
        </div>
        <div
          className="px-6 py-8 text-center"
          role="status"
          aria-live="polite"
        >
          <p className="text-[#a1a1aa] text-sm">
            {unsupportedReason ??
              "Rewards are unavailable for this wallet or network."}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !isConfirming) {
    return <ClaimRewardsPanelSkeleton />;
  }

  if (loadError) {
    return (
      <div className="bg-[#18181b] rounded-xl border border-[#232329] overflow-hidden min-h-[280px]">
        <div className="px-6 py-8 text-center" role="alert">
          <p className="text-red-400 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 text-sm text-white underline hover:text-[#d4d4d8] focus:outline-none focus:ring-2 focus:ring-[#5b5bf6] rounded"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#18181b] rounded-xl border border-[#232329] overflow-hidden min-h-[280px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between px-4 sm:px-6 py-4 border-b border-[#232329]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg bg-[#5b5bf6]/20 flex items-center justify-center"
            aria-hidden="true"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M8 1l1.94 3.93L14 5.27l-3 2.93.71 4.13L8 10.27l-3.71 2.06.71-4.13L2 5.27l4.06-.34L8 1z"
                fill="#5b5bf6"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">
              Claimable Rewards
            </p>
            <p className="text-[#a1a1aa] text-xs truncate">
              Earned from verified claims
            </p>
          </div>
        </div>

        {/* Total + Claim button — full width on mobile, inline from sm */}
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-start">
          <div className="text-right">
            <p className="text-xs text-[#a1a1aa]">Total available</p>
            <p
              className={`text-xl font-bold font-mono tabular-nums transition-colors ${
                hasRewards ? "text-[#5b5bf6]" : "text-[#a1a1aa]"
              }`}
            >
              {totalClaimableDisplay ?? "0"}
            </p>
          </div>

          <button
            onClick={handleClaim}
            disabled={!hasRewards || isConfirming || isSuccess}
            aria-busy={isConfirming}
            aria-describedby="rewards-claim-status"
            className={`
              relative px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200
              flex items-center gap-2 min-w-[140px] justify-center
              ${
                isSuccess
                  ? "bg-green-500/20 text-green-400 border border-green-500/30 cursor-default"
                  : isError
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : hasRewards && !isConfirming
                      ? "bg-[#5b5bf6] text-white hover:bg-[#4a4ae5] hover:shadow-lg hover:shadow-[#5b5bf6]/20 active:scale-95"
                      : "bg-[#232329] text-[#a1a1aa] cursor-not-allowed border border-[#232329]"
              }
            `}
          >
            {isConfirming ? (
              <>
                <svg
                  className="animate-spin"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Claiming…
              </>
            ) : isSuccess ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 8l3.5 3.5L13 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Claimed!
              </>
            ) : isError ? (
              "Retry"
            ) : (
              "Claim Rewards"
            )}
          </button>
        </div>
      </div>

      {/* Reward list — categories with human-facing explanations */}
      <ul
        className="divide-y divide-[#232329]"
        aria-label="Claimable reward entitlements"
      >
        {pendingRewards.length === 0 ? (
          <li className="px-6 py-8 flex flex-col items-center gap-2 text-center list-none">
            <div
              className="w-10 h-10 rounded-full bg-[#232329] flex items-center justify-center mb-1"
              aria-hidden="true"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 1l1.94 3.93L14 5.27l-3 2.93.71 4.13L8 10.27l-3.71 2.06.71-4.13L2 5.27l4.06-.34L8 1z"
                  stroke="#a1a1aa"
                  strokeWidth="1"
                  fill="none"
                />
              </svg>
            </div>
            <p className="text-[#a1a1aa] text-sm">No unclaimed rewards</p>
            <p className="text-[#71717a] text-xs">
              Rewards appear here once your verified claims are settled.
            </p>
          </li>
        ) : (
          pendingRewards.map((reward) => (
            <li
              key={reward.claimId}
              className="flex items-center justify-between px-4 py-3 hover:bg-[#232329]/40 transition-colors sm:px-6"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-2 h-2 rounded-full bg-[#5b5bf6] shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">
                    {reward.categoryExplanation || (reward as { title?: string }).title}
                  </p>
                  <p className="text-[#71717a] text-xs">
                    {(reward.category ?? "").replace(/_/g, " ")} · {reward.amountRaw}
                  </p>
                </div>
              </div>
              <span className="text-[#5b5bf6] font-semibold text-sm ml-4 shrink-0 font-mono">
                +{reward.amountFormatted}
              </span>
            </li>
          ))
        )}
      </ul>

      {/* Status footer — canonical receipt/projection feedback */}
      <div
        id="rewards-claim-status"
        className={`px-6 py-3 text-xs border-t ${
          isSuccess
            ? "border-green-900/30 bg-green-900/10 text-green-400"
            : isError
              ? "border-red-900/30 bg-red-900/10 text-red-400"
              : isConfirming
                ? "border-[#232329] bg-[#18181b] text-[#a1a1aa]"
                : "border-transparent"
        } ${isSuccess || isError || isConfirming ? "" : "hidden"}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isConfirming ? (
          <>Claim submitted — waiting for on-chain confirmation…</>
        ) : isSuccess && lastTxHash ? (
          <>
            <div>
              Transaction confirmed &nbsp;
              <a
                href={getTransactionExplorerUrl(lastTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono opacity-70 underline hover:opacity-100"
                aria-label={`Transaction hash: ${lastTxHash.slice(0, 18)}…${lastTxHash.slice(-6)} (opens in new tab)`}
              >
                {lastTxHash.slice(0, 18)}…{lastTxHash.slice(-6)}
              </a>
              &nbsp;
              <a
                href={getTransactionExplorerUrl(lastTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-100"
                aria-label="View on Explorer (opens in new tab)"
              >
                View on Explorer
              </a>
            </div>
            {receiptProjection && (
              <div className="mt-2" aria-label="Receipt reconciliation">
                {receiptProjection.receivedAssets.length > 0 ? (
                  <ul className="space-y-1" aria-label="Assets received">
                    {receiptProjection.receivedAssets.map((asset) => (
                      <li key={asset.asset} className="font-mono">
                        Received {asset.amount.toString()} from {asset.asset}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No ERC-20 transfers to this wallet were recorded in this receipt.</p>
                )}
                {receiptProjection.outstandingClaimIds.length > 0 && (
                  <p className="mt-1">
                    {receiptProjection.outstandingClaimIds.length} entitlement{receiptProjection.outstandingClaimIds.length === 1 ? " remains" : "s remain"} outstanding in the receipt projection.{' '}
                    <button
                      type="button"
                      onClick={reset}
                      className="underline hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-green-400 rounded"
                    >
                      Review remaining rewards
                    </button>
                  </p>
                )}
              </div>
            )}
          </>
        ) : isError ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true">⚠</span>
            <span>{errorMessage ?? "Claim failed."}</span>
            <button
              type="button"
              onClick={reset}
              className="underline hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
            >
              Dismiss
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
