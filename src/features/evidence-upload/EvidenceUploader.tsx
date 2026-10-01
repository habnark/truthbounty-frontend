"use client";
import { useEffect, useMemo } from "react";
import { useAccount, useChainId } from "wagmi";
import { useEvidenceUpload } from "./useEvidenceUpload";
import { EvidenceUploadProgress } from "./EvidenceUploadProgress";
import { getVerifiedCommitment } from "./evidence-commitment";
import type { UploadClient, EvidenceCommitment } from "./types";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "application/pdf"];

function createXhrClient(url: string): UploadClient {
  return {
    upload(file, { onProgress, signal }) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const body = JSON.parse(xhr.responseText);
              const digest = body?.digest;
              if (typeof digest === "string" && digest.length > 0) return resolve({ digest });
            } catch {
              /* fall through */
            }
            return reject(new Error("invalid upload response"));
          }
          reject(Object.assign(new Error("upload failed"), { status: xhr.status }));
        };

        xhr.onerror = () => reject(new TypeError("network error"));
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        signal.addEventListener("abort", () => xhr.abort());

        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
    },
  };
}

export function EvidenceUploader({
  onCommitmentChange,
}: {
  /** Called with the verified commitment (or null) when the upload reaches a terminal phase. */
  onCommitmentChange: (commitment: EvidenceCommitment | null) => void;
}) {
  const { address } = useAccount();
  const chainId = useChainId();

  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL ?? "";
    return url ? createXhrClient(url) : null;
  }, []);

  const { state, start, retry, cancel, reset } = useEvidenceUpload({
    client,
    maxBytes: MAX_BYTES,
    allowedTypes: ALLOWED_TYPES,
    resetKey: `${address ?? "none"}:${chainId}`,
  });

  useEffect(() => {
    onCommitmentChange(getVerifiedCommitment(state));
  }, [state, onCommitmentChange]);

  return (
    <div data-testid="evidence-uploader">
      <label htmlFor="evidence-file" className="block text-sm font-medium">
        Upload evidence
      </label>
      <input
        id="evidence-file"
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        disabled={!client}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) start(f);
          e.target.value = "";
        }}
      />

      {!client && (
        <p role="alert">Evidence upload is not configured. Submission is disabled.</p>
      )}

      <EvidenceUploadProgress
        state={state}
        onRetry={retry}
        onCancel={cancel}
        onChooseAgain={reset}
      />

      <PrivacyNotice state={state} />
    </div>
  );
}

/**
 * Privacy disclosure for the evidence upload flow (V2-FE-054).
 *
 * Surfaces the privacy constraints to the user:
 *   - The file is hashed locally in the browser (SHA-256) before any upload.
 *   - The server returns its own digest; if it differs from the local hash,
 *     the upload is rejected (fail closed) and nothing is accepted.
 *   - The file's raw content is never inspected, logged, or processed beyond
 *     the cryptographic integrity check.
 *
 * The notice is always visible so the user can review the privacy guarantees
 * at every step of the upload lifecycle.
 */
function PrivacyNotice({ state }: { state: { phase: string } }) {
  const isActive = state.phase === "hashing" || state.phase === "uploading";
  const isVerified = state.phase === "verified";
  const isFailed = state.phase === "failed";

  return (
    <div
      data-testid="evidence-privacy-notice"
      className="mt-3 rounded-md border border-blue-900/30 bg-blue-950/20 px-3 py-2 text-xs text-blue-300"
    >
      <p className="mb-1 font-medium text-blue-200">Privacy &amp; integrity</p>
      <ul className="list-disc list-inside space-y-0.5">
        <li>
          Your file is hashed locally (SHA-256) in your browser before upload.
        </li>
        <li>
          The server-reported digest must match your local hash — if it does
          not, nothing is accepted.
        </li>
        <li>The file contents are never logged or inspected beyond hashing.</li>
      </ul>

      {isActive && (
        <p
          aria-live="polite"
          className="mt-1 italic"
          data-testid="privacy-notice-processing"
        >
          Verifying file integrity locally…
        </p>
      )}

      {isVerified && (
        <p
          className="mt-1 italic"
          data-testid="privacy-notice-verified"
        >
          Integrity verified — your file matches its content-addressed digest.
        </p>
      )}

      {isFailed && (
        <p
          className="mt-1 italic"
          data-testid="privacy-notice-failed"
        >
          Integrity check failed or upload rejected. No file data was accepted.
        </p>
      )}
    </div>
  );
}
