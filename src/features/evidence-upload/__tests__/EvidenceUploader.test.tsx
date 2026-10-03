/**
 * EvidenceUploader — component tests covering loading, empty, success,
 * rejection, error, recovery, and privacy-notice states.
 *
 * V2-FE-054: Content-Addressed Evidence Upload Integrity
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { EvidenceUploader } from "../EvidenceUploader";
import type { UploadState, FileInfo } from "../types";
import { useEvidenceUpload } from "../useEvidenceUpload";

const mockT = (key: string) => key;

jest.mock("@/i18n", () => ({
  useTranslations: () => mockT,
}));

jest.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1234" }),
  useChainId: () => 11155420,
}));

jest.mock("../useEvidenceUpload", () => ({
  useEvidenceUpload: jest.fn(),
}));

const mockedUseEvidenceUpload = useEvidenceUpload as jest.MockedFunction<
  typeof useEvidenceUpload
>;

const mockStart = jest.fn();
const mockRetry = jest.fn();
const mockCancel = jest.fn();
const mockReset = jest.fn();

const FILE_INFO: FileInfo = { name: "evidence.png", size: 2048, type: "image/png" };

const IDLE_STATE: UploadState = {
  phase: "idle",
  progress: 0,
  retryable: false,
  attempt: 0,
};

const HASHING_STATE: UploadState = {
  phase: "hashing",
  progress: 0,
  retryable: false,
  attempt: 1,
  fileInfo: FILE_INFO,
};

const UPLOADING_STATE: UploadState = {
  phase: "uploading",
  progress: 45,
  retryable: false,
  attempt: 1,
  localDigest: "abc123",
  fileInfo: FILE_INFO,
};

const VERIFIED_DIGEST = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";

const VERIFIED_STATE: UploadState = {
  phase: "verified",
  progress: 100,
  retryable: false,
  attempt: 1,
  verifiedDigest: VERIFIED_DIGEST,
  fileInfo: FILE_INFO,
};

const FAILED_NETWORK: UploadState = {
  phase: "failed",
  progress: 0,
  retryable: true,
  attempt: 1,
  failure: "network",
  fileInfo: FILE_INFO,
};

const FAILED_INTEGRITY: UploadState = {
  phase: "failed",
  progress: 0,
  retryable: false,
  attempt: 1,
  failure: "integrity-mismatch",
  fileInfo: FILE_INFO,
};

const FAILED_REJECTED: UploadState = {
  phase: "failed",
  progress: 0,
  retryable: false,
  attempt: 1,
  failure: "rejected",
  fileInfo: FILE_INFO,
};

const FAILED_TOO_LARGE: UploadState = {
  phase: "failed",
  progress: 0,
  retryable: false,
  attempt: 1,
  failure: "too-large",
  fileInfo: FILE_INFO,
};

const FAILED_UNSUPPORTED: UploadState = {
  phase: "failed",
  progress: 0,
  retryable: false,
  attempt: 1,
  failure: "unsupported-type",
  fileInfo: FILE_INFO,
};

const CANCELLED_STATE: UploadState = {
  phase: "cancelled",
  progress: 0,
  retryable: false,
  attempt: 1,
};

const INVALIDATED_STATE: UploadState = {
  phase: "invalidated",
  progress: 0,
  retryable: false,
  attempt: 1,
};

function setupMockState(state: UploadState) {
  mockedUseEvidenceUpload.mockReturnValue({
    state,
    start: mockStart,
    retry: mockRetry,
    cancel: mockCancel,
    reset: mockReset,
  });
}

describe("EvidenceUploader — rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("renders the upload label and file input", () => {
    setupMockState(IDLE_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByLabelText(/upload evidence/i)).toBeInTheDocument();
    expect(screen.getByTestId("evidence-uploader")).toBeInTheDocument();
  });

  it("shows fail-closed message when upload is not configured", () => {
    setupMockState(IDLE_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not configured/i);
  });

  it("always renders the privacy notice", () => {
    setupMockState(IDLE_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByTestId("evidence-privacy-notice")).toBeInTheDocument();
    expect(screen.getByText(/Privacy & integrity/i)).toBeInTheDocument();
  });

  it("disables the file input when not configured", () => {
    setupMockState(IDLE_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByLabelText(/upload evidence/i)).toBeDisabled();
  });
});

describe("EvidenceUploader — loading state (hashing)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL = "https://upload.example.com";
    setupMockState(HASHING_STATE);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("shows hashing indicator and cancel button", () => {
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Checking your file's integrity locally/i);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("renders privacy notice processing message", () => {
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByTestId("privacy-notice-processing")).toBeInTheDocument();
  });
});

describe("EvidenceUploader — uploading state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL = "https://upload.example.com";
    setupMockState(UPLOADING_STATE);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("shows progress and 'not confirmed' message", () => {
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("value", "45");
    expect(screen.getByRole("status").textContent).toMatch(/Not confirmed yet/);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

describe("EvidenceUploader — verified (success) state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL = "https://upload.example.com";
    setupMockState(VERIFIED_STATE);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("calls onCommitmentChange with the verified commitment", () => {
    const onChange = jest.fn();
    render(<EvidenceUploader onCommitmentChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        digest: VERIFIED_DIGEST,
        fileName: "evidence.png",
        fileSize: 2048,
        mimeType: "image/png",
      }),
    );
  });

  it("shows verified message", () => {
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/Upload verified/i);
    expect(screen.getByTestId("privacy-notice-verified")).toBeInTheDocument();
  });
});

describe("EvidenceUploader — rejection states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL = "https://upload.example.com";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("unsupported-type shows error with Choose file again, no retry", () => {
    setupMockState(FAILED_UNSUPPORTED);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not supported/i);
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry upload/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("privacy-notice-failed")).toBeInTheDocument();
  });

  it("too-large shows error with Choose file again, no retry", () => {
    setupMockState(FAILED_TOO_LARGE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
  });

  it("integrity-mismatch shows error with no retry, only Choose file again", () => {
    setupMockState(FAILED_INTEGRITY);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Integrity check failed/i);
    expect(screen.queryByRole("button", { name: /Retry upload/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
  });

  it("rejected shows error with Choose file again, no retry", () => {
    setupMockState(FAILED_REJECTED);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/rejected/i);
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
  });
});

describe("EvidenceUploader — error & recovery states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL = "https://upload.example.com";
    setupMockState(FAILED_NETWORK);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
  });

  it("network failure shows Retry button", () => {
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/connection failed/i);
    expect(screen.getByRole("button", { name: /Retry upload/i })).toBeInTheDocument();
  });

  it("clicking Retry calls retry handler", () => {
    jest.clearAllMocks();
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry upload/i }));
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("cancelled state shows Choose file again", () => {
    setupMockState(CANCELLED_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/cancelled/i);
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
  });

  it("invalidated state shows account/network changed message", () => {
    setupMockState(INVALIDATED_STATE);
    render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/account or network changed/i);
    expect(screen.getByRole("button", { name: /Choose file again/i })).toBeInTheDocument();
  });
});

describe("EvidenceUploader — idle state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_EVIDENCE_UPLOAD_URL;
    setupMockState(IDLE_STATE);
  });

  it("does not render progressbar in idle state", () => {
    const { container } = render(<EvidenceUploader onCommitmentChange={jest.fn()} />);
    expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument();
  });

  it("calls onCommitmentChange with null in idle state", () => {
    const onChange = jest.fn();
    render(<EvidenceUploader onCommitmentChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
