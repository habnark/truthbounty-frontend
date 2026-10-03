export type UploadPhase =
  | "idle"
  | "hashing"
  | "uploading"
  | "verified"
  | "failed"
  | "cancelled"
  | "invalidated";

export type UploadFailure =
  | "unsupported-type"
  | "too-large"
  | "network"
  | "stale"
  | "rejected"
  | "integrity-mismatch"
  | "unknown";

export type UploadState = {
  phase: UploadPhase;
  progress: number; // 0-100, bytes sent, NOT proof of integrity
  localDigest?: string;
  verifiedDigest?: string;
  failure?: UploadFailure;
  retryable: boolean;
  attempt: number;
  /** Metadata of the file being uploaded, captured at START. */
  fileInfo?: FileInfo;
};

export type UploadAction =
  | { type: "START"; fileInfo: FileInfo }
  | { type: "HASHED"; digest: string }
  | { type: "PROGRESS"; percent: number }
  | { type: "UPLOAD_DONE"; remoteDigest: string }
  | { type: "FAIL"; failure: UploadFailure }
  | { type: "RETRY" }
  | { type: "CANCEL" }
  | { type: "INVALIDATE" }
  | { type: "RESET" };

/**
 * Metadata captured from the evidence file when the user selects it.
 * Used to bind the verified commitment to claim/evidence transactions
 * (V2-FE-054).
 */
export interface FileInfo {
  name: string;
  size: number;
  type: string;
}

/**
 * The content-addressed commitment established after a verified upload.
 * The `digest` is the SHA-256 of the file, confirmed by matching the
 * server-returned digest against the local hash. This is the single source
 * of truth for "this file was uploaded and its integrity was verified."
 *
 * V2-FE-054: this commitment is bound to claim/evidence transactions so
 * the reviewed commitment cannot be silently swapped server-side.
 */
export interface EvidenceCommitment {
  /** SHA-256 hex digest, verified to match the server-returned digest. */
  digest: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

/**
 * Input for building a claim content digest that incorporates the evidence
 * commitment so the on-chain commitment is bound to the reviewed file.
 */
export interface ClaimContentDigestInput {
  title: string;
  category: string;
  impact: string;
  source: string;
  description: string;
  evidenceDigest?: string | null;
}

/** Seam to the documented canonical API/IPFS client (V2-FE-103). */
export interface UploadClient {
  upload(
    file: File,
    opts: { onProgress: (percent: number) => void; signal: AbortSignal },
  ): Promise<{ digest: string }>; // digest as reported by the canonical layer
}