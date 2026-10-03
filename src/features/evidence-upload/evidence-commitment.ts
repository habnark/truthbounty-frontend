/**
 * V2-FE-054 — Content-Addressed Evidence Upload Integrity: commitment binding.
 *
 * Pure, side-effect-free functions that bind a verified evidence file digest
 * (SHA-256, confirmed by local/server match) to claim/evidence transactions.
 *
 * These functions are deterministic and unit-testable in isolation. They never
 * fabricate digests, calldata, or protocol state — they only combine values the
 * caller has already obtained from canonical sources (local hashing + server
 * verification + form fields).
 */

import { keccak256, stringToHex } from "viem";
import type {
  EvidenceCommitment,
  FileInfo,
  UploadState,
  ClaimContentDigestInput,
} from "./types";

/**
 * Build an {@link EvidenceCommitment} from a verified upload state.
 * Returns `null` when the upload has not reached the `verified` phase —
 * nothing is fabricated and no partial digest is exposed.
 */
export function getVerifiedCommitment(state: UploadState): EvidenceCommitment | null {
  if (state.phase !== "verified" || !state.verifiedDigest || !state.fileInfo) {
    return null;
  }
  return {
    digest: state.verifiedDigest,
    fileName: state.fileInfo.name,
    fileSize: state.fileInfo.size,
    mimeType: state.fileInfo.type,
  };
}

/**
 * Build a content digest that incorporates the verified evidence digest so the
 * on-chain commitment is bound to the reviewed file.
 *
 * The evidence digest is appended to the canonical claim fields and hashed with
 * keccak256 (matching the contract's `createClaim` contentDigest scheme). This
 * means the on-chain commitment is only reproducible when the *same* evidence
 * file (same SHA-256) is present — a server cannot swap the file after the
 * wallet signs without breaking the digest match.
 *
 * When no evidence has been uploaded/verified, the digest is identical to the
 * existing scheme (no evidenceDigest segment) so existing flows are unaffected.
 */
export function buildContentDigest(
  input: ClaimContentDigestInput
): `0x${string}` {
  const evidenceSegment = input.evidenceDigest
    ? `|${input.evidenceDigest.toLowerCase()}`
    : "";
  const raw = `${input.title}|${input.category}|${input.impact}|${input.source}|${input.description}${evidenceSegment}`;
  return keccak256(stringToHex(raw));
}

/**
 * Build the canonical evidence array for the off-chain claim submission API.
 *
 * Each entry carries the verified SHA-256 digest as a content-addressed
 * reference (`sha256:<digest>`). The backend can resolve this CID against the
 * canonical content store to verify the file was uploaded with integrity.
 *
 * Returns an empty array when no commitment is available — never a
 * placeholder or fabricated entry.
 */
export function buildEvidenceSubmission(
  commitment: EvidenceCommitment | null
): Array<{ type: string; value: string }> {
  if (!commitment || !commitment.digest) return [];
  return [
    {
      type: "document",
      value: `sha256:${commitment.digest.toLowerCase()}`,
    },
  ];
}

/**
 * Build a human-readable summary of the evidence commitment for display in the
 * UI (e.g., "evidence.pdf (2.1 MB, image/png) verified").
 */
export function formatEvidenceCommitment(
  commitment: EvidenceCommitment | null
): string {
  if (!commitment) return "No evidence file uploaded";
  const sizeMB = (commitment.fileSize / (1024 * 1024)).toFixed(1);
  return `${commitment.fileName} (${sizeMB} MB, ${commitment.mimeType}) — sha256 verified`;
}

/**
 * Pure check: does this upload state represent a verified commitment that can
 * be safely bound to a transaction?
 */
export function isEvidenceVerified(state: UploadState): boolean {
  return (
    state.phase === "verified" &&
    typeof state.verifiedDigest === "string" &&
    state.verifiedDigest.length > 0
  );
}

/**
 * Extract the file info from an upload state for UI display (filename, etc.).
 */
export function getUploadFileInfo(state: UploadState): FileInfo | null {
  return state.fileInfo ?? null;
}

/**
 * Convert a raw File object to a FileInfo record (pure, no side effects).
 */
export function toFileInfo(file: File): FileInfo {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
  };
}
