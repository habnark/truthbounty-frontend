import type { UploadAction, UploadFailure, UploadState } from "./types";

export const initialUploadState: UploadState = {
  phase: "idle",
  progress: 0,
  retryable: false,
  attempt: 0,
};

const RETRYABLE: UploadFailure[] = ["network", "stale"];

export function uploadReducer(state: UploadState, action: UploadAction): UploadState {
  switch (action.type) {
    case "START":
      return { ...initialUploadState, phase: "hashing", attempt: 1, fileInfo: action.fileInfo };

    case "HASHED":
      if (state.phase !== "hashing") return state;
      return { ...state, phase: "uploading", localDigest: action.digest, progress: 0 };

    case "PROGRESS":
      if (state.phase !== "uploading") return state;
      // Clamp, never go backwards, never exceed 99 until the digest is verified.
      return { ...state, progress: Math.max(state.progress, Math.min(99, Math.floor(action.percent))) };

    case "UPLOAD_DONE":
      if (state.phase !== "uploading") return state;
      if (!state.localDigest || action.remoteDigest !== state.localDigest) {
        return { ...state, phase: "failed", failure: "integrity-mismatch", retryable: false, progress: 0 };
      }
      return { ...state, phase: "verified", verifiedDigest: action.remoteDigest, progress: 100, failure: undefined, retryable: false };

    case "FAIL":
      if (state.phase === "verified" || state.phase === "cancelled" || state.phase === "invalidated") return state;
      return { ...state, phase: "failed", failure: action.failure, retryable: RETRYABLE.includes(action.failure) };

    case "RETRY":
      if (state.phase !== "failed" || !state.retryable || !state.localDigest) return state;
      return { ...state, phase: "uploading", progress: 0, failure: undefined, attempt: state.attempt + 1 };

    case "CANCEL":
      if (state.phase === "verified") return state;
      return { ...initialUploadState, phase: "cancelled" };

    case "INVALIDATE":
      return { ...initialUploadState, phase: "invalidated" };

    case "RESET":
      return initialUploadState;
  }
}