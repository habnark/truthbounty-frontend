/**
 * ClaimSubmissionForm — modal layout tests.
 *
 * Regression: @stellar/freighter-api is no longer imported by the form.
 * Regression: @next-intl context is mocked so translations resolve in tests.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock("@/i18n", () => {
  const mockMsgs = {
    common: { cancel: "Cancel" },
    claim: { submitClaim: "Submit a Claim", submittingClaim: "Submitting your claim..." },
    wallet: { connectPrompt: "Please connect your wallet to continue", connect: "Connect", connectToSubmit: "Connect wallet to submit" },
  };
  return {
    useTranslations: (ns: string) => (key: string) => {
      const nsMessages = mockMsgs[ns as keyof typeof mockMsgs] ?? {};
      const parts = key.split(".");
      let val: unknown = nsMessages;
      for (const part of parts) {
        val = (val as Record<string, unknown>)?.[part];
        if (val === undefined) break;
      }
      return typeof val === "string" ? val : key;
    },
  };
});

let mockApiPending = false;

jest.mock('@/components/hooks/useTrust', () => ({
  useTrust: () => ({
    isVerified: true,
    reputation: 80,
    accountAgeDays: 90,
    suspicious: false,
  }),
}));

jest.mock('@/hooks/useAccount', () => ({
  useAccount: () => ({
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    displayName: '0xf39F…2266',
    chainId: 11155420,
  }),
}));

jest.mock('@/app/queries/claims.queries', () => ({
  useSubmitClaim: () => ({ mutateAsync: jest.fn(), isPending: mockApiPending }),
}));

jest.mock('wagmi', () => ({
  useConnectors: () => [{ id: 'injected', name: 'Injected', type: 'injected' }],
  useConnect: () => ({ connect: jest.fn() }),
  useAccount: () => ({
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    chainId: 11155420,
  }),
  useChainId: () => 11155420,
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
    account: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    chainId: 11155420,
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

describe('ClaimSubmissionForm modal layout', () => {
  beforeEach(() => {
    mockApiPending = false;
  });

  it('uses modal shell and panel classes for mobile-safe spacing', () => {
    render(<ClaimSubmissionForm onClose={jest.fn()} />);
    const modal = screen.getByTestId('claim-submission-modal');
    expect(modal.className).toContain('modal-shell');
    const form = modal.querySelector('form');
    expect(form?.className).toContain('modal-panel');
  });

  it('keeps the dialog open on Escape while submission is pending', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    mockApiPending = true;
    const { rerender } = render(<ClaimSubmissionForm onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    mockApiPending = false;
    rerender(<ClaimSubmissionForm onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
