import {
  buildContentDigest,
  buildEvidenceSubmission,
  formatEvidenceCommitment,
  getVerifiedCommitment,
  isEvidenceVerified,
  toFileInfo,
} from "../evidence-commitment";
import type { UploadState, EvidenceCommitment, FileInfo } from "../types";

const FILE_INFO: FileInfo = {
  name: "evidence.pdf",
  size: 2048576,
  type: "application/pdf",
};

const COMMITMENT: EvidenceCommitment = {
  digest: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  fileName: "evidence.pdf",
  fileSize: 2048576,
  mimeType: "application/pdf",
};

const baseState = (overrides: Partial<UploadState> = {}): UploadState => ({
  phase: "idle",
  progress: 0,
  retryable: false,
  attempt: 0,
  ...overrides,
});

describe("getVerifiedCommitment", () => {
  it("returns null when phase is not verified", () => {
    expect(getVerifiedCommitment(baseState({ phase: "uploading" }))).toBeNull();
    expect(getVerifiedCommitment(baseState({ phase: "idle" }))).toBeNull();
    expect(getVerifiedCommitment(baseState({ phase: "failed" }))).toBeNull();
  });

  it("returns null when verified but no digest", () => {
    expect(getVerifiedCommitment(baseState({ phase: "verified" }))).toBeNull();
  });

  it("returns null when verified with digest but no fileInfo", () => {
    expect(
      getVerifiedCommitment(baseState({ phase: "verified", verifiedDigest: "abc" }))
    ).toBeNull();
  });

  it("returns a commitment when verified with digest and fileInfo", () => {
    const result = getVerifiedCommitment(
      baseState({
        phase: "verified",
        verifiedDigest: COMMITMENT.digest,
        fileInfo: FILE_INFO,
      }),
    );
    expect(result).toEqual(COMMITMENT);
  });
});

describe("buildContentDigest", () => {
  const BASE_INPUT = {
    title: "Test Claim",
    category: "Science",
    impact: "High",
    source: "https://example.com/evidence",
    description: "A detailed description of the claim.",
  };

  it("produces a deterministic 32-byte hex digest without evidence", () => {
    const d1 = buildContentDigest({ ...BASE_INPUT, evidenceDigest: null });
    const d2 = buildContentDigest({ ...BASE_INPUT, evidenceDigest: undefined });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("includes evidence digest as an additional segment", () => {
    const without = buildContentDigest({ ...BASE_INPUT, evidenceDigest: null });
    const withEvidence = buildContentDigest({
      ...BASE_INPUT,
      evidenceDigest: "abc123",
    });
    expect(without).not.toBe(withEvidence);
  });

  it("lowercases the evidence digest segment", () => {
    const withUpper = buildContentDigest({ ...BASE_INPUT, evidenceDigest: "ABC123" });
    const withLower = buildContentDigest({ ...BASE_INPUT, evidenceDigest: "abc123" });
    expect(withLower).toBe(withUpper);
  });

  it("omits evidence segment when digest is null/undefined", () => {
    const withNull = buildContentDigest({ ...BASE_INPUT, evidenceDigest: null });
    const withUndefined = buildContentDigest({ ...BASE_INPUT, evidenceDigest: undefined });
    const withoutKey = buildContentDigest({ ...BASE_INPUT });
    expect(withNull).toBe(withUndefined);
    expect(withUndefined).toBe(withoutKey);
  });
});

describe("buildEvidenceSubmission", () => {
  it("returns an empty array when commitment is null", () => {
    expect(buildEvidenceSubmission(null)).toEqual([]);
  });

  it("returns empty array when commitment has no digest", () => {
    const empty = { ...COMMITMENT, digest: "" };
    expect(buildEvidenceSubmission(empty)).toEqual([]);
  });

  it("returns a sha256:content-addressed evidence entry when verified", () => {
    const result = buildEvidenceSubmission(COMMITMENT);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "document",
      value: `sha256:${COMMITMENT.digest.toLowerCase()}`,
    });
  });

  it("lowercases the digest in the submission value", () => {
    const upperCommitment = { ...COMMITMENT, digest: COMMITMENT.digest.toUpperCase() };
    const result = buildEvidenceSubmission(upperCommitment);
    expect(result[0].value).toBe(`sha256:${COMMITMENT.digest.toLowerCase()}`);
  });
});

describe("isEvidenceVerified", () => {
  it("returns false for idle phase", () => {
    expect(isEvidenceVerified(baseState({ phase: "idle" }))).toBe(false);
  });

  it("returns false for uploading phase", () => {
    expect(isEvidenceVerified(baseState({ phase: "uploading" }))).toBe(false);
  });

  it("returns false for failed phase", () => {
    expect(isEvidenceVerified(baseState({ phase: "failed" }))).toBe(false);
  });

  it("returns false for verified phase without a digest", () => {
    expect(isEvidenceVerified(baseState({ phase: "verified" }))).toBe(false);
  });

  it("returns false for verified phase with empty digest", () => {
    expect(
      isEvidenceVerified(baseState({ phase: "verified", verifiedDigest: "" })),
    ).toBe(false);
  });

  it("returns true for verified phase with a non-empty digest", () => {
    expect(
      isEvidenceVerified(
        baseState({ phase: "verified", verifiedDigest: COMMITMENT.digest }),
      ),
    ).toBe(true);
  });
});

describe("formatEvidenceCommitment", () => {
  it("returns a placeholder when commitment is null", () => {
    expect(formatEvidenceCommitment(null)).toBe("No evidence file uploaded");
  });

  it("formats file name, size, and digest status", () => {
    const result = formatEvidenceCommitment(COMMITMENT);
    expect(result).toContain("evidence.pdf");
    expect(result).toContain("2.0 MB");
    expect(result).toContain("sha256 verified");
  });
});

describe("toFileInfo", () => {
  it("extracts name, size, and type from a File object", () => {
    const file = new File(["content"], "test.png", {
      type: "image/png",
      lastModified: Date.now(),
    });
    const result = toFileInfo(file);
    expect(result).toEqual({
      name: "test.png",
      size: file.size,
      type: "image/png",
    });
  });
});
