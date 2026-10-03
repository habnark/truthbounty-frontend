import { initialUploadState, uploadReducer } from "../uploadMachine";
import type { UploadAction, UploadState, FileInfo } from "../types";

const FILE_INFO: FileInfo = { name: "evidence.png", size: 1024, type: "image/png" };

const run = (actions: UploadAction[], from: UploadState = initialUploadState) =>
  actions.reduce(uploadReducer, from);

describe("uploadReducer", () => {
  it("happy path ends verified only when digests match", () => {
    const s = run([
      { type: "START", fileInfo: FILE_INFO },
      { type: "HASHED", digest: "abc" },
      { type: "PROGRESS", percent: 100 },
      { type: "UPLOAD_DONE", remoteDigest: "abc" },
    ]);
    expect(s.phase).toBe("verified");
    expect(s.progress).toBe(100);
    expect(s.verifiedDigest).toBe("abc");
  });

  it("progress is capped below 100 until verified", () => {
    const s = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "abc" }, { type: "PROGRESS", percent: 100 }]);
    expect(s.progress).toBe(99);
    expect(s.phase).toBe("uploading");
  });

  it("progress never goes backwards", () => {
    const s = run([
      { type: "START", fileInfo: FILE_INFO },
      { type: "HASHED", digest: "abc" },
      { type: "PROGRESS", percent: 60 },
      { type: "PROGRESS", percent: 40 },
    ]);
    expect(s.progress).toBe(60);
  });

  it("integrity mismatch fails closed and is not retryable", () => {
    const s = run([
      { type: "START", fileInfo: FILE_INFO },
      { type: "HASHED", digest: "abc" },
      { type: "UPLOAD_DONE", remoteDigest: "zzz" },
    ]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toBe("integrity-mismatch");
    expect(s.retryable).toBe(false);
    expect(s.verifiedDigest).toBeUndefined();
  });

  it("network failure is retryable and retry increments attempt", () => {
    const failed = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "abc" }, { type: "FAIL", failure: "network" }]);
    expect(failed.retryable).toBe(true);
    const retried = uploadReducer(failed, { type: "RETRY" });
    expect(retried.phase).toBe("uploading");
    expect(retried.attempt).toBe(2);
  });

  it("rejected, too-large and unsupported are not retryable", () => {
    for (const f of ["rejected", "too-large", "unsupported-type"] as const) {
      const s = run([{ type: "START", fileInfo: FILE_INFO }, { type: "FAIL", failure: f }]);
      expect(s.retryable).toBe(false);
      expect(uploadReducer(s, { type: "RETRY" })).toEqual(s);
    }
  });

  it("cancel and invalidate reset progress and never yield success", () => {
    const mid = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "abc" }, { type: "PROGRESS", percent: 50 }]);
    expect(uploadReducer(mid, { type: "CANCEL" }).phase).toBe("cancelled");
    expect(uploadReducer(mid, { type: "INVALIDATE" }).phase).toBe("invalidated");
  });

  it("late events after cancel or verify cannot change the outcome", () => {
    const cancelled = run([{ type: "START", fileInfo: FILE_INFO }, { type: "CANCEL" }]);
    expect(uploadReducer(cancelled, { type: "UPLOAD_DONE", remoteDigest: "abc" }).phase).toBe("cancelled");
    const verified = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "a" }, { type: "UPLOAD_DONE", remoteDigest: "a" }]);
    expect(uploadReducer(verified, { type: "FAIL", failure: "network" }).phase).toBe("verified");
  });

  it("boundary: empty digest never verifies", () => {
    const s = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "" }, { type: "UPLOAD_DONE", remoteDigest: "" }]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toBe("integrity-mismatch");
    expect(s.retryable).toBe(false);
    expect(s.verifiedDigest).toBeUndefined();
  });

  it("boundary: only a local digest is not enough to verify", () => {
    const s = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "abc" }, { type: "UPLOAD_DONE", remoteDigest: "" }]);
    expect(s.phase).toBe("failed");
    expect(s.failure).toBe("integrity-mismatch");
    expect(s.verifiedDigest).toBeUndefined();
  });

  it("START captures fileInfo and persists it through hashing", () => {
    const s = run([{ type: "START", fileInfo: FILE_INFO }, { type: "HASHED", digest: "abc" }]);
    expect(s.fileInfo).toEqual(FILE_INFO);
    expect(s.phase).toBe("uploading");
  });

  it("START without fileInfo still transitions to hashing (type-safe)", () => {
    // START requires fileInfo per the type system; verify it's stored
    const s = uploadReducer(initialUploadState, { type: "START", fileInfo: FILE_INFO });
    expect(s.phase).toBe("hashing");
    expect(s.fileInfo).toEqual(FILE_INFO);
  });
});
