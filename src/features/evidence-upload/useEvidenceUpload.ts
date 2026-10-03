"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { initialUploadState, uploadReducer } from "./uploadMachine";
import { sha256Hex } from "./hash";
import type { UploadClient, UploadFailure, FileInfo } from "./types";

export type UploadConfig = {
  client: UploadClient | null; // null = missing config -> fail closed
  maxBytes: number;
  allowedTypes: string[];
  /** Change this (e.g. `${address}:${chainId}`) to invalidate an in-flight upload. */
  resetKey: string;
};

function classify(err: unknown): UploadFailure {
  const status = (err as { status?: number })?.status;
  if (err instanceof DOMException && err.name === "AbortError") return "unknown";
  if (status === 401 || status === 403 || status === 400 || status === 413 || status === 415) return "rejected";
  if (status === 409 || status === 410) return "stale";
  if (typeof navigator !== "undefined" && !navigator.onLine) return "network";
  if (err instanceof TypeError) return "network"; // fetch network failure
  if (typeof status === "number" && status >= 500) return "network";
  return "unknown";
}

export function useEvidenceUpload(cfg: UploadConfig) {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runUpload = useCallback(
    async (file: File) => {
      if (!cfg.client) return dispatch({ type: "FAIL", failure: "unknown" }); // missing config: fail closed
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const { digest } = await cfg.client.upload(file, {
          signal: ctrl.signal,
          onProgress: (p) => dispatch({ type: "PROGRESS", percent: p }),
        });
        if (!ctrl.signal.aborted) dispatch({ type: "UPLOAD_DONE", remoteDigest: digest });
      } catch (err) {
        if (!ctrl.signal.aborted) dispatch({ type: "FAIL", failure: classify(err) });
      }
    },
    [cfg.client],
  );

  const start = useCallback(
    async (file: File) => {
      const fileInfo: FileInfo = {
        name: file.name,
        size: file.size,
        type: file.type,
      };
      if (!cfg.allowedTypes.includes(file.type)) {
        dispatch({ type: "START", fileInfo });
        return dispatch({ type: "FAIL", failure: "unsupported-type" });
      }
      if (file.size > cfg.maxBytes) {
        dispatch({ type: "START", fileInfo });
        return dispatch({ type: "FAIL", failure: "too-large" });
      }
      fileRef.current = file;
      dispatch({ type: "START", fileInfo });
      try {
        const digest = await sha256Hex(file);
        dispatch({ type: "HASHED", digest });
        await runUpload(file);
      } catch {
        dispatch({ type: "FAIL", failure: "unknown" });
      }
    },
    [cfg.allowedTypes, cfg.maxBytes, runUpload],
  );

  const retry = useCallback(async () => {
    if (!fileRef.current) return;
    dispatch({ type: "RETRY" });
    await runUpload(fileRef.current);
  }, [runUpload]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "CANCEL" });
  }, []);

  // Account / chain change: abort and invalidate.
  const firstKey = useRef(cfg.resetKey);
  useEffect(() => {
    if (firstKey.current === cfg.resetKey) return;
    firstKey.current = cfg.resetKey;
    abortRef.current?.abort();
    fileRef.current = null;
    dispatch({ type: "INVALIDATE" });
  }, [cfg.resetKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, start, retry, cancel, reset: () => dispatch({ type: "RESET" }) };
}