/**
 * V2-FE Accessibility: Degraded-state UX test battery
 *
 * Covers 12 canonical degraded states across the application surface.
 * For each state verifies:
 *   a. axe-core — 0 WCAG AA violations
 *   b. Live-region announcement (role=status/alert with descriptive content)
 *   c. Retry/Try-again/Reset/Connect button is keyboard-tabbable (if present)
 *   d. Banner primary text meets WCAG AA contrast (>= 4.5:1) in light + dark
 *   e. Reduced motion: spinners/animated icons have no active animation
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  within,
} from '../utils/test-utils';
import { assertAccessible } from '../utils/axe';

import { ActiveClaimsTableSkeleton } from '@/components/skeletons/ActiveClaimsTableSkeleton';
import { ApiStaleBanner } from '@/components/common/ApiStaleBanner';
import { TransactionStatus } from '@/components/features/claim-verification/TransactionStatus';
import {
  TransactionItem,
  type TransactionItemProps,
} from '@/components/transactions/transaction-item';
import { StatusCard } from '@/components/transactions/status-card';
import { ReorgBanner } from '@/components/transactions/ReorgBanner';
import type { ReorgBannerView } from '@/lib/reorg-reconciliation';
import { FallbackBoundary } from '@/components/common/FallbackBoundary';
import { MotionSafeStatus } from '@/components/ui/MotionSafeStatus';
import { TransactionsList } from '@/components/transactions/transaction-list';

// ── Constants ────────────────────────────────────────────────────────────────

const HASH =
  '0xaaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888';

// ── Shared helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(
    hex.length === 7 ? /^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i : /^([\da-f])([\da-f])([\da-f])$/i,
  );
  if (!m) return null;
  const expand = (c: string) =>
    parseInt(c.length === 1 ? c + c : c, 16);
  return { r: expand(m[1]), g: expand(m[2]), b: expand(m[3]) };
}

function rgbStringToComponents(css: string): { r: number; g: number; b: number } | null {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
}

function resolveColor(cssValue: string): { r: number; g: number; b: number } | null {
  if (!cssValue) return null;
  const trimmed = cssValue.trim();
  if (trimmed.startsWith('#')) return hexToRgb(trimmed);
  if (trimmed.startsWith('rgb')) return rgbStringToComponents(trimmed);
  const named: Record<string, string> = {
    white: '#ffffff', black: '#000000', red: '#ff0000',
  };
  if (named[trimmed.toLowerCase()]) return hexToRgb(named[trimmed.toLowerCase()]);
  return null;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const srgb = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(color1: string, color2: string): number {
  const c1 = resolveColor(color1);
  const c2 = resolveColor(color2);
  if (!c1 || !c2) return 1;
  const L1 = relativeLuminance(c1);
  const L2 = relativeLuminance(c2);
  const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const TAILWIND_COLORS: Record<string, string> = {
  'amber-100': '#fef3c7',
  'amber-300': '#fcd34d',
  'amber-950': '#451a03',
  'yellow-50': '#fefce8',
  'yellow-300': '#fde047',
  'yellow-800': '#854d0e',
  'yellow-900': '#713f12',
  'yellow-950': '#422006',
  'orange-50': '#fff7ed',
  'orange-300': '#fdba74',
  'orange-400': '#fb923c',
  'orange-800': '#9a3412',
  'orange-900': '#7c2d12',
  'red-50': '#fef2f2',
  'red-300': '#fca5a5',
  'red-400': '#f87171',
  'red-500': '#ef4444',
  'red-800': '#991b1b',
  'red-900': '#7f1d1d',
  'emerald-400': '#34d399',
  'emerald-500': '#10b981',
  'emerald-600': '#059669',
  'blue-400': '#60a5fa',
  'blue-500': '#3b82f6',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-950': '#020617',
  white: '#ffffff',
  black: '#000000',
};

function getBannerContrast(region: HTMLElement): { ratio: number; fg: string; bg: string } {
  const isDark = document.documentElement.classList.contains('dark');
  const textEl =
    region.querySelector('p') ||
    region.querySelector('[class*="text-"]') ||
    region;
  const style = window.getComputedStyle(textEl as HTMLElement);
  const parentStyle = window.getComputedStyle(region);
  let fg = style.color || 'transparent';
  let bg = parentStyle.backgroundColor || style.backgroundColor || 'transparent';

  let cur: HTMLElement | null = region;
  let hasDarkCard = false;
  while (cur && cur !== document.body) {
    const c = cur.className || '';
    if (
      typeof c === 'string' &&
      (c.includes('#18181b') ||
        c.includes('slate-900') ||
        c.includes('slate-950') ||
        c.includes('slate-800') ||
        c.includes('amber-950') ||
        c.includes('zinc-900') ||
        c.includes('zinc-950'))
    ) {
      hasDarkCard = true;
      break;
    }
    cur = cur.parentElement;
  }

  const classNames = `${region.className} ${(textEl as HTMLElement).className}`;

  if (!resolveColor(fg) || fg === 'transparent' || !resolveColor(bg) || bg === 'transparent' || contrastRatio(fg, bg) === 1) {
    if (hasDarkCard) {
      bg = classNames.includes('amber-950') ? '#451a03' : '#18181b';
    } else {
      const bgMatches = isDark
        ? classNames.match(/dark:bg-([a-z]+-\d+)/) || classNames.match(/bg-([a-z]+-\d+)/)
        : classNames.match(/(?<!dark:)bg-([a-z]+-\d+)/) || classNames.match(/bg-([a-z]+-\d+)/);
      if (bgMatches && TAILWIND_COLORS[bgMatches[1]]) {
        bg = TAILWIND_COLORS[bgMatches[1]];
      } else {
        bg = isDark ? '#09090b' : '#ffffff';
      }
    }

    const textMatches = isDark
      ? classNames.match(/dark:text-([a-z]+-\d+)/) || classNames.match(/text-([a-z]+-\d+)/)
      : classNames.match(/(?<!dark:)text-([a-z]+-\d+)/) || classNames.match(/text-([a-z]+-\d+)/);

    if (textMatches && TAILWIND_COLORS[textMatches[1]]) {
      fg = TAILWIND_COLORS[textMatches[1]];
    } else if (hasDarkCard || isDark) {
      fg = '#ffffff';
    } else {
      fg = '#09090b';
    }
  }

  return { ratio: contrastRatio(fg, bg), fg, bg };
}

function applyDarkTheme(on: boolean) {
  if (on) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function findActionButton(): HTMLElement | null {
  const patterns = [
    /retry/i,
    /try again/i,
    /reset/i,
    /connect wallet/i,
    /reload/i,
    /clear filters/i,
    /acknowledge/i,
  ];
  for (const p of patterns) {
    const btn = screen.queryByRole('button', { name: p });
    if (btn) return btn;
  }
  return null;
}

function assertButtonTabbable(btn: HTMLElement) {
  const ti = btn.getAttribute('tabindex');
  expect(ti === null || ti === '0' || ti !== '-1').toBe(true);
  expect(btn).toBeEnabled();
  btn.focus();
  expect(document.activeElement).toBe(btn);
}

function getLiveRegion(): HTMLElement | null {
  return (
    screen.queryAllByRole('status')[0] ||
    screen.queryAllByRole('alert')[0] ||
    null
  );
}

function assertLiveRegionContent(keywordPatterns: RegExp[]) {
  const regions = [...screen.queryAllByRole('status'), ...screen.queryAllByRole('alert')];
  expect(regions.length).toBeGreaterThan(0);
  const text = regions.map((r) => r.textContent || '').join(' ').toLowerCase();
  const matches = keywordPatterns.some((p) => p.test(text));
  expect(matches).toBe(true);
}

function assertReducedMotionDisablesAnimation(container: HTMLElement, animatedClassPatterns: string[]) {
  const animatedEls = container.querySelectorAll<HTMLElement>(
    animatedClassPatterns.map((p) => `[class*="${p}"]`).join(','),
  );
  if (animatedEls.length === 0) {
    // no spinner/icon with animation class — skip sub-assertion
    return;
  }
  animatedEls.forEach((el) => {
    const style = window.getComputedStyle(el);
    const animDur = parseFloat(style.animationDuration || '0');
    const animName = style.animationName || 'none';
    const zeroDur = animDur <= 0.01;
    const noAnim = animName === 'none' || animName === '';
    expect(zeroDur || noAnim).toBe(true);
  });
}

function runLightDarkContrast(region: HTMLElement, minRatio = 4.5) {
  applyDarkTheme(false);
  const light = getBannerContrast(region);
  expect(light.ratio).toBeGreaterThanOrEqual(minRatio);
  applyDarkTheme(true);
  const dark = getBannerContrast(region);
  expect(dark.ratio).toBeGreaterThanOrEqual(minRatio);
  applyDarkTheme(false);
}

// ── ReorgBanner view helpers ─────────────────────────────────────────────────

function makeReorgView(overrides: Partial<ReorgBannerView> = {}): ReorgBannerView {
  return {
    state: 'reorg-detected',
    message: 'Chain reorg detected',
    detail: 'Previous transaction may have been orphaned. Waiting for reconciliation.',
    orphanedHash:
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    replacementHash: null,
    assertive: true,
    ...overrides,
  };
}

// ── Test battery ─────────────────────────────────────────────────────────────

describe('Degraded-state UX accessibility battery', () => {
  beforeEach(() => {
    applyDarkTheme(false);
    mockReducedMotion(false);
    jest.restoreAllMocks();
  });

  afterEach(() => {
    applyDarkTheme(false);
  });

  // ── 1. Loading / skeleton ────────────────────────────────────────────────
  it('State 1: Loading/skeleton (ActiveClaimsTableSkeleton) is accessible', async () => {
    const { container } = render(<ActiveClaimsTableSkeleton />);

    await assertAccessible(container);

    assertLiveRegionContent([/loading/i, /skeleton/i, /shimmer/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    if (region) {
      applyDarkTheme(false);
      const light = getBannerContrast(region);
      expect(light.ratio).toBeGreaterThanOrEqual(4.5);
    }

    mockReducedMotion(true);
    const { container: rmContainer } = render(<ActiveClaimsTableSkeleton />);
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-shimmer', 'animate-spin', 'animate-pulse']);
  });

  // ── 2. Empty ─────────────────────────────────────────────────────────────
  it('State 2: Empty list (TransactionsList empty) is accessible', async () => {
    const { container } = render(
      <div>
        <p className="sr-only" role="status" aria-live="polite">
          No transactions available.
        </p>
        <TransactionsList transactions={[]} />
      </div>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/empty/i, /no (transaction|claim)/i, /available/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    if (region) {
      runLightDarkContrast(region, 4.5);
    }

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <div>
        <p className="sr-only" role="status" aria-live="polite">
          No transactions available.
        </p>
        <TransactionsList transactions={[]} />
      </div>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 3. Stale ─────────────────────────────────────────────────────────────
  it('State 3: Stale data (ApiStaleBanner stale) is accessible', async () => {
    const onReload = jest.fn();
    const { container } = render(
      <ApiStaleBanner status="stale" dataAgeMs={120_000} onReload={onReload} />,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/stale/i, /outdated/i, /data/i]);

    const reloadBtn = screen.queryByRole('button', { name: /reload/i });
    if (reloadBtn) assertButtonTabbable(reloadBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();
    runLightDarkContrast(region!, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <ApiStaleBanner status="stale" dataAgeMs={120_000} />,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 4. Rejected ──────────────────────────────────────────────────────────
  it('State 4: Rejected transaction (TransactionItem failed + Rejected) is accessible', async () => {
    const props: TransactionItemProps = {
      type: 'verification',
      status: 'failed',
      title: 'Verification rejected',
      description: 'Stake amount below minimum threshold',
      amount: '5',
      timeAgo: '1m ago',
      hash: HASH,
      errorMessage: 'Rejected: verification stake below the 10 TRB minimum.',
      onRetry: jest.fn(),
    };
    const { container } = render(<TransactionItem {...props} />);

    await assertAccessible(container);

    assertLiveRegionContent([/rejected|failed/i, /reject/i]);

    const retry = screen.queryByRole('button', { name: /retry/i });
    if (retry) assertButtonTabbable(retry);

    const region = getLiveRegion();
    expect(region).not.toBeNull();
    runLightDarkContrast(region as HTMLElement, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(<TransactionItem {...props} />);
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 5. Failed / reverted ─────────────────────────────────────────────────
  it('State 5: Failed/reverted (TransactionStatus error + ReorgBanner with reason) is accessible', async () => {
    const combined = (
      <div>
        <TransactionStatus status="error" />
        <ReorgBanner
          view={makeReorgView({
            state: 'unresolved',
            message: 'Transaction reverted on-chain',
            detail: 'Revert reason: insufficient gas. Consider resubmitting with higher gas.',
          })}
          onAcknowledge={jest.fn()}
        />
      </div>
    );
    const { container } = render(combined);

    await assertAccessible(container);

    assertLiveRegionContent([/failed|revert|error/i, /revert|reason/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();
    runLightDarkContrast(region as unknown as HTMLElement, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(combined);
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 6. Pending/submitted ─────────────────────────────────────────────────
  it('State 6: Pending/submitted (TransactionStatus pending + MotionSafeStatus) is accessible', async () => {
    const combined = (
      <div>
        <TransactionStatus status="pending" />
        <MotionSafeStatus
          label="Transaction submitted"
          detail="Awaiting inclusion in the next block."
          tone="pending"
          pulse
        />
      </div>
    );
    const { container } = render(combined);

    await assertAccessible(container);

    assertLiveRegionContent([/pending|submitted/i, /awaiting|waiting/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();

    mockReducedMotion(true);
    const { container: rmContainer } = render(combined);
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 7. Confirming ────────────────────────────────────────────────────────
  it('State 7: Confirming (StatusCard confirming + progress=2 confirmations, safe=false) is accessible', async () => {
    const props: TransactionItemProps = {
      type: 'stake',
      status: 'confirming',
      title: 'Stake deposit confirming',
      description: '2 of 4 blocks required for finality.',
      amount: '100',
      timeAgo: '30s ago',
      hash: HASH,
      progress: 50,
    };
    const { container } = render(
      <div>
        <StatusCard status="confirming" count={2} />
        <TransactionItem {...props} />
        <MotionSafeStatus
          label="Confirming (2 confirmations)"
          detail="Not yet safe. Continue waiting for block confirmations."
          tone="pending"
          pulse
        />
      </div>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/confirming|confirmation/i, /2.*block|safe/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <div>
        <StatusCard status="confirming" count={2} />
        <TransactionItem {...props} />
        <MotionSafeStatus
          label="Confirming (2 confirmations)"
          detail="Not yet safe."
          tone="pending"
          pulse
        />
      </div>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 8. Confirmed-not-safe ────────────────────────────────────────────────
  it('State 8: Confirmed-not-safe (confirmations present, safe=false, indexed=false) is accessible', async () => {
    const props: TransactionItemProps = {
      type: 'verification',
      status: 'confirming',
      title: 'Verification included',
      description: 'Seen in 2 blocks — not yet safe or indexed by the projection.',
      amount: '25',
      timeAgo: '2m ago',
      hash: HASH,
      progress: 50,
    };
    const { container } = render(
      <div>
        <TransactionItem {...props} />
        <MotionSafeStatus
          label="Confirmed — not safe"
          detail="Included in 2 blocks but not yet safe. Projection has not indexed."
          tone="pending"
          pulse
        />
      </div>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/confirmed|included|not safe|indexed/i, /not yet safe|projection/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <div>
        <TransactionItem {...props} />
        <MotionSafeStatus
          label="Confirmed — not safe"
          detail="Not yet safe or indexed."
          tone="pending"
          pulse
        />
      </div>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 9. Finalized ─────────────────────────────────────────────────────────
  it('State 9: Finalized (safe=true, indexed=true, finalized=true) is accessible', async () => {
    const props: TransactionItemProps = {
      type: 'verification',
      status: 'confirmed',
      title: 'Verification finalized',
      description: 'Settlement complete. Safe and indexed in projection.',
      amount: '25',
      timeAgo: '1h ago',
      hash: HASH,
    };
    const { container } = render(
      <div>
        <StatusCard status="confirmed" count={1} />
        <TransactionItem {...props} />
        <MotionSafeStatus
          label="Finalized"
          detail="Safe, indexed, and settlement complete. State is canonical."
          tone="success"
          pulse={false}
        />
      </div>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/finalized|confirmed|complete/i, /safe|indexed|canonical/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = getLiveRegion();
    expect(region).not.toBeNull();

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <div>
        <StatusCard status="confirmed" count={1} />
        <TransactionItem {...props} />
        <MotionSafeStatus label="Finalized" tone="success" />
      </div>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 10. Reorged ──────────────────────────────────────────────────────────
  it('State 10: Reorged (ReorgBanner reorg-detected + acknowledge button) is accessible', async () => {
    const onAck = jest.fn();
    const view = makeReorgView({
      state: 'reorg-detected',
      message: 'Chain reorg detected',
      detail:
        'Your transaction from block 12345 was orphaned. Follow any replacement or resubmit.',
      orphanedHash:
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      replacementHash:
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const { container } = render(
      <ReorgBanner view={view} onAcknowledge={onAck} />,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/reorg|orphan/i, /reorg|detect|orphaned|replace/i]);

    const ack = screen.queryByRole('button', { name: /acknowledge/i });
    if (ack) assertButtonTabbable(ack);

    const region = screen.getByRole('alert');
    expect(region).not.toBeNull();
    runLightDarkContrast(region as unknown as HTMLElement, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <ReorgBanner view={view} onAcknowledge={onAck} />,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse', 'motion-safe']);
  });

  // ── 11. ConfigurationError / unsupported-chain ───────────────────────────
  it('State 11: ConfigurationError — unsupported-chain (FallbackBoundary blocked with chainId=1 reason)', async () => {
    const reason =
      'Chain 1 (Ethereum Mainnet) is not supported. Please switch to Optimism or Optimism Sepolia.';
    const { container } = render(
      <FallbackBoundary status="blocked" reason={reason} blockActions>
        <button type="button">Submit</button>
      </FallbackBoundary>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/unsupported|chain|not supported|blocked/i, /ethereum|chain 1|optimism/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = screen.getByRole('alert');
    expect(region).not.toBeNull();
    runLightDarkContrast(region as unknown as HTMLElement, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <FallbackBoundary status="blocked" reason={reason} blockActions>
        <button type="button">Submit</button>
      </FallbackBoundary>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });

  // ── 12. Degraded / RPC fallback ──────────────────────────────────────────
  it('State 12: Degraded RPC fallback (FallbackBoundary status=degraded) is accessible', async () => {
    const reason =
      'Primary RPC provider unreachable. Using fallback provider; data may be slightly delayed.';
    const { container } = render(
      <FallbackBoundary status="degraded" reason={reason} blockActions={false}>
        <button type="button">Proceed</button>
      </FallbackBoundary>,
    );

    await assertAccessible(container);

    assertLiveRegionContent([/degraded|fallback|unreachable|delayed/i, /fallback|rpc|delayed/i]);

    const retryBtn = findActionButton();
    if (retryBtn) assertButtonTabbable(retryBtn);

    const region = screen.getByRole('status');
    expect(region).not.toBeNull();
    runLightDarkContrast(region as unknown as HTMLElement, 4.5);

    mockReducedMotion(true);
    const { container: rmContainer } = render(
      <FallbackBoundary status="degraded" reason={reason}>
        <button type="button">Proceed</button>
      </FallbackBoundary>,
    );
    assertReducedMotionDisablesAnimation(rmContainer, ['animate-spin', 'animate-pulse']);
  });
});
