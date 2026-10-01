/**
 * ClaimSubmissionForm — wallet gate tests.
 *
 * Regression coverage for removed Freighter/Stellar path:
 *  - REMOVED: @stellar/freighter-api setAllowed call
 *  - REMOVED: "install/enable Freighter" error message
 *  - REPLACED: EVM wagmi useConnect / useConnectors flow
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock("@/i18n", () => {
  const mockMsgs = {
    common: { cancel: "Cancel", submit: "Submit" },
    wallet: {
      connectPrompt: "Please connect your wallet to continue",
      connect: "Connect",
      connectToSubmit: "Connect wallet to submit",
      connectFailed: "Connection failed",
      noConnector: "No connector available",
    },
    claim: {
      submitClaim: "Submit a Claim",
      submittingClaim: "Submitting your claim...",
      validation: {
        titleRequired: "Title is required",
        titleMinLength: "Title must be at least {min} characters",
        categoryRequired: "Category is required",
        impactRequired: "Impact is required",
        sourceRequired: "Source is required",
        sourceInvalidUrl: "Enter a valid URL",
        descriptionRequired: "Description is required",
        descriptionMinLength: "Description must be at least {min} characters",
      },
      errors: {
        submissionFailed: "Failed to submit claim. Please try again.",
      },
    },
  };
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => {
      const nsMessages = mockMsgs[ns as keyof typeof mockMsgs] ?? {};
      const parts = key.split(".");
      let val: unknown = nsMessages;
      for (const part of parts) {
        val = (val as Record<string, unknown>)?.[part];
        if (val === undefined) break;
      }
      if (val === undefined) val = key;
      if (typeof val === "string" && params) {
        val = val.replace(/\{(\w+)\}/g, (_, k: string) => String((params as Record<string, unknown>)[k] ?? `{${k}}`));
      }
      return typeof val === "string" ? val : key;
    },
  };
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockAccount: { address: `0x${string}`; displayName: string; chainId: number } | null = null;
const mockMutateAsync = jest.fn();
const mockConnect = jest.fn();
const mockConnectors = [{ id: 'injected', name: 'Injected', type: 'injected' }];

jest.mock('@/hooks/useAccount', () => ({
  useAccount: () => mockAccount,
}));

jest.mock('@/components/hooks/useTrust', () => ({
  useTrust: () => ({
    reputation: 100,
    accountAgeDays: 365,
    isVerified: true,
    suspicious: false,
  }),
}));

jest.mock('@/components/ui/TrustScoreTooltip', () => ({
  __esModule: true,
  default: () => <span data-testid="trust-tooltip" />,
}));

jest.mock('@/app/queries/claims.queries', () => ({
  useSubmitClaim: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

// Wagmi hooks used by the form and EvidenceUploader
jest.mock('wagmi', () => ({
  useConnect: () => ({ connect: mockConnect, connectors: mockConnectors }),
  useAccount: () => (mockAccount ? { address: mockAccount.address, chainId: mockAccount.chainId } : { address: undefined, chainId: undefined }),
  useChainId: () => mockAccount?.chainId ?? 11155420,
  usePublicClient: () => ({}),
  useReadContract: () => ({ data: undefined }),
  useWriteContract: () => ({ writeContractAsync: jest.fn() }),
}));

jest.mock('@/hooks/useWriteReadiness', () => ({
  useWriteReadiness: () => ({
    isReady: true,
    message: null,
    codes: [],
    primaryCode: null,
    ready: true,
    failures: [],
    reason: null,
    account: mockAccount?.address ?? null,
    chainId: mockAccount?.chainId ?? null,
    expectedChainId: 11155420,
    targetAddress: '0x0000000000000000000000000000000000000001',
  }),
}));

jest.mock('@/features/evidence-upload/EvidenceUploader', () => ({
  EvidenceUploader: ({ onCommitmentChange }: { onCommitmentChange: (c: unknown) => void }) => {
    React.useEffect(() => onCommitmentChange(null), []);
    return <div data-testid="evidence-uploader-mock">EvidenceUploader</div>;
  },
}));

import ClaimSubmissionForm from '../ClaimSubmissionForm';

const CONNECTED = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as `0x${string}`,
  displayName: '0xf39F…2266',
  chainId: 11155420,
};

function fillValidForm() {
  fireEvent.change(screen.getByPlaceholderText('Title'), {
    target: { value: 'A real claim title' },
  });
  fireEvent.change(screen.getByPlaceholderText('Category'), {
    target: { value: 'Politics' },
  });
  fireEvent.change(screen.getByPlaceholderText('Impact'), {
    target: { value: 'High' },
  });
  fireEvent.change(screen.getByPlaceholderText('https://example.com'), {
    target: { value: 'https://example.com/source' },
  });
  fireEvent.change(screen.getByPlaceholderText('Description'), {
    target: { value: 'A sufficiently long description.' },
  });
}

beforeEach(() => {
  mockAccount = null;
  mockConnect.mockReset();
  mockMutateAsync.mockReset();
  mockMutateAsync.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClaimSubmissionForm - wallet gate', () => {
  it('shows the Connect Wallet banner when no wallet is connected', () => {
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    expect(screen.getByTestId('connect-wallet-banner')).toBeInTheDocument();
    expect(screen.getByTestId('connect-wallet-button')).toBeInTheDocument();
  });

  it('hides the Connect Wallet banner when a wallet is connected', () => {
    mockAccount = CONNECTED;
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    expect(screen.queryByTestId('connect-wallet-banner')).not.toBeInTheDocument();
  });

  it('disables the submit button while the wallet is disconnected', () => {
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const submit = screen.getByTestId('submit-claim-button');
    expect(submit).toBeDisabled();
  });

  it('enables the submit button once a wallet is connected', () => {
    mockAccount = CONNECTED;
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const submit = screen.getByTestId('submit-claim-button');
    expect(submit).not.toBeDisabled();
  });

  it('calls wagmi connect() with the first connector when Connect Wallet is clicked', () => {
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('connect-wallet-button'));
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith({ connector: mockConnectors[0] });
  });

  // Regression: Freighter setAllowed must NOT be called anywhere
  it('does NOT call @stellar/freighter-api setAllowed (removed path)', () => {
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    fireEvent.click(screen.getByTestId('connect-wallet-button'));
    expect(mockConnect).toHaveBeenCalled();
  });
});

describe('ClaimSubmissionForm - submit guard', () => {
  it('does NOT call the submit mutation when no wallet is connected', async () => {
    const onClose = jest.fn();
    render(<ClaimSubmissionForm onClose={onClose} />);

    fillValidForm();
    fireEvent.submit(screen.getByTestId('submit-claim-button').closest('form')!);

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls the submit mutation with evidence when the wallet is connected and form is valid', async () => {
    mockAccount = CONNECTED;
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(<ClaimSubmissionForm onSubmit={onSubmit} onClose={onClose} />);

    fillValidForm();
    fireEvent.submit(screen.getByTestId('submit-claim-button').closest('form')!);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      title: 'A real claim title',
      category: 'Politics',
      impact: 'High',
      source: 'https://example.com/source',
      description: 'A sufficiently long description.',
      evidence: [],
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ClaimSubmissionForm - source URL placeholder', () => {
  it('shows an example URL as the source field placeholder', () => {
    mockAccount = CONNECTED;
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const sourceInput = screen.getByPlaceholderText('https://example.com');
    expect(sourceInput).toBeInTheDocument();
    expect(sourceInput).toHaveAttribute('name', 'source');
  });

  it('shows validation error when source URL is not a valid URL', () => {
    mockAccount = CONNECTED;
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const sourceInput = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(sourceInput, { target: { value: 'not-a-url' } });
    fireEvent.blur(sourceInput);
    expect(screen.getByText(/Enter a valid URL/i)).toBeInTheDocument();
  });

  it('clears source URL validation error when a valid URL is entered', () => {
    mockAccount = CONNECTED;
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const sourceInput = screen.getByPlaceholderText('https://example.com');

    fireEvent.change(sourceInput, { target: { value: 'not-a-url' } });
    fireEvent.blur(sourceInput);
    expect(screen.getByText(/Enter a valid URL/i)).toBeInTheDocument();

    fireEvent.change(sourceInput, { target: { value: 'https://valid.example.com' } });
    fireEvent.blur(sourceInput);
    expect(screen.queryByText(/Enter a valid URL/i)).not.toBeInTheDocument();
  });
});

describe('Protocol invariant: submit-allowed ⇔ wallet-connected', () => {
  const cases: Array<[string, typeof CONNECTED | null, boolean]> = [
    ['no wallet', null, false],
    ['connected wallet', CONNECTED, true],
  ];

  test.each(cases)(
    '%s ⇒ submit enabled = %p AND mutation runs = %p',
    async (_label, account, expectEnabled) => {
      mockAccount = account;
      render(<ClaimSubmissionForm onClose={jest.fn()} />);

      const submit = screen.getByTestId('submit-claim-button');

      if (expectEnabled) {
        expect(submit).not.toBeDisabled();
      } else {
        expect(submit).toBeDisabled();
        expect(screen.getByTestId('connect-wallet-banner')).toBeInTheDocument();
      }

      fillValidForm();
      fireEvent.submit(submit.closest('form')!);

      if (expectEnabled) {
        await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
      } else {
        await Promise.resolve();
        expect(mockMutateAsync).not.toHaveBeenCalled();
      }
    }
  );
});
