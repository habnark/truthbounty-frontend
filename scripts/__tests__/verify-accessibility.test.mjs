import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'verify-accessibility.mjs');

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'truthbounty-a11y-scan-'));
}

function writeSubFile(root, subPath, contents) {
  const fullPath = join(root, subPath);
  const dir = fullPath.slice(0, Math.max(0, fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\')));
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, contents);
}

function runA11yScan(root) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
}

test('accessibility gate: clean workspace passes with exit code 0', () => {
  const root = makeTempRoot();
  try {
    // Write mock test file with no skips
    writeSubFile(
      root,
      'src/__tests__/accessibility/degraded-state-ux.test.tsx',
      `
      // Canonical states: loading, empty, stale, rejected, failed, pending,
      // confirming, confirmed-not-safe, finalized, reorged, unsupported-chain, degraded-rpc
      describe('Degraded-state UX', () => {
        it('tests all 12 canonical states', () => {});
      });
      `
    );
    writeSubFile(
      root,
      'src/components/StatusBanner.tsx',
      `<div role="status" aria-live="polite">Status Banner</div>`
    );

    const result = runA11yScan(root);
    assert.equal(result.status, 0, 'expected exit code 0 for clean workspace');
    assert.match(result.stdout, /Accessibility CI Gate passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accessibility gate: concealed test skip (it.skip) causes exit code 1', () => {
  const root = makeTempRoot();
  try {
    writeSubFile(
      root,
      'src/__tests__/accessibility/bad-skip.test.tsx',
      `
      describe('Accessibility Suite', () => {
        it.skip('this test is skipped', () => {});
      });
      `
    );

    const result = runA11yScan(root);
    assert.notEqual(result.status, 0, 'expected non-zero exit code when concealed test skip exists');
    assert.match(result.stderr, /Concealed accessibility test skip found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('accessibility gate: missing canonical state coverage causes exit code 1', () => {
  const root = makeTempRoot();
  try {
    writeSubFile(
      root,
      'src/__tests__/accessibility/degraded-state-ux.test.tsx',
      `
      // Missing some canonical states
      describe('Degraded-state UX', () => {
        it('loading state', () => {});
      });
      `
    );

    const result = runA11yScan(root);
    assert.notEqual(result.status, 0, 'expected non-zero exit code when canonical state missing');
    assert.match(result.stderr, /Missing accessibility test coverage/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
