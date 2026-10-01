/**
 * V2-FE-050 — PermitSigningPanel component states, accessibility and keyboard.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermitSigningPanel } from '@/components/ui/PermitSigningPanel';
import type { PermitStatus, UsePermitSignatureResult } from '@/hooks/usePermitSignature';
import { assertAccessible } from '@/__tests__/utils/axe';

const ROWS = [
  { label: 'Token', value: 'TST (0x5FbDB2315678afecb367f032d93F642f64180aa3)' },
  { label: 'Spender', value: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { label: 'Amount', value: '2.5 TST' },
  { label: 'Nonce', value: '4' },
  { label: 'Expires', value: '2033-05-18 03:48:20 UTC' },
  { label: 'Network', value: 'Chain 11155420' },
  { label: 'Signer', value: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
];

function fakePermit(overrides: Partial<UsePermitSignatureResult> = {}): UsePermitSignatureResult {
  return {
    status: 'idle',
    unavailableReason: null,
    errorReason: null,
    entrypoint: 'createClaimWithPermit',
    asset: null,
    typedData: null,
    displayRows: [],
    prepare: jest.fn().mockResolvedValue(undefined),
    sign: jest.fn().mockResolvedValue(undefined),
    getSubmittablePermit: jest.fn().mockResolvedValue(null),
    markConsumed: jest.fn(),
    reset: jest.fn(),
    ...overrides,
  };
}

function renderPanel(permit: UsePermitSignatureResult) {
  return render(<PermitSigningPanel permit={permit} fallback={<button type="button">Approve TST</button>} />);
}

const withRows = (status: PermitStatus) => fakePermit({ status, displayRows: ROWS });

describe('PermitSigningPanel states', () => {
  it('renders only the fallback when unavailable', () => {
    renderPanel(fakePermit({ status: 'unavailable', unavailableReason: 'no-entrypoint' }));
    expect(screen.getByRole('button', { name: 'Approve TST' })).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permit-signing-panel')).not.toBeInTheDocument();
  });

  it.each<[string, UsePermitSignatureResult, RegExp | null, string[]]>([
    ['idle', fakePermit(), null, ['Review permit', 'Use standard approval instead']],
    ['preparing', fakePermit({ status: 'preparing' }), /reading permit details/i, ['Reading permit details…', 'Use standard approval instead']],
    ['ready', withRows('ready'), /review the permit details/i, ['Sign permit', 'Use standard approval instead']],
    ['awaiting-signature', withRows('awaiting-signature'), /waiting for your wallet/i, ['Waiting for wallet…']],
    ['signed', withRows('signed'), /permit signed/i, []],
    ['rejected', fakePermit({ status: 'rejected' }), /declined/i, ['Review permit again', 'Use standard approval instead']],
    ['expired', fakePermit({ status: 'expired' }), /expired/i, ['Review permit again', 'Use standard approval instead']],
    [
      'error',
      fakePermit({ status: 'error', errorReason: 'NONCE_CONSUMED' }),
      /already used or replaced/i,
      ['Review permit again', 'Use standard approval instead'],
    ],
  ])('%s: announces state, offers the right actions and is accessible', async (_label, permit, message, buttons) => {
    const { container } = renderPanel(permit);

    const status = screen.getByRole('status');
    if (message) expect(status).toHaveTextContent(message);
    else expect(status).toBeEmptyDOMElement();

    const names = screen.queryAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(buttons);
    expect(screen.getByRole('region', { name: /authorize with a permit signature/i })).toBeInTheDocument();
    await assertAccessible(container);
  });

  it.each(['preparing', 'awaiting-signature'] as const)('%s: in-flight button is busy and disabled', (status) => {
    renderPanel(withRows(status));
    const busy = screen.getByRole('button', { busy: true });
    expect(busy).toBeDisabled();
  });

  it.each(['ready', 'awaiting-signature', 'signed'] as const)('%s: shows every signed field', (status) => {
    renderPanel(withRows(status));
    const details = screen.getByLabelText(/permit details/i);
    for (const row of ROWS) {
      expect(details).toHaveTextContent(row.label);
      expect(details).toHaveTextContent(row.value);
    }
  });

  it.each(['SIGNER_MISMATCH', 'SIGNATURE_FAILED', 'READ_FAILED'] as const)('error %s has a specific message', (reason) => {
    renderPanel(fakePermit({ status: 'error', errorReason: reason }));
    expect(screen.getByRole('status').textContent).not.toMatch(/^The permit could not be used\.$/);
  });
});

describe('PermitSigningPanel keyboard', () => {
  it('Enter on "Review permit" prepares', async () => {
    const user = userEvent.setup();
    const permit = fakePermit();
    renderPanel(permit);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(permit.prepare).toHaveBeenCalledTimes(1);
  });

  it('Space on "Sign permit" signs', async () => {
    const user = userEvent.setup();
    const permit = withRows('ready');
    renderPanel(permit);

    screen.getByRole('button', { name: 'Sign permit' }).focus();
    await user.keyboard(' ');
    expect(permit.sign).toHaveBeenCalledTimes(1);
  });

  it('switching to the standard approval discards the permit', async () => {
    const user = userEvent.setup();
    const permit = withRows('ready');
    renderPanel(permit);

    screen.getByRole('button', { name: 'Use standard approval instead' }).focus();
    await user.keyboard('{Enter}');

    expect(permit.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Approve TST' })).toBeInTheDocument();
  });
});
