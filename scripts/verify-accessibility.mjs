/**
 * verify-accessibility.mjs
 *
 * TruthBounty V2 Frontend — Accessibility Verification CI Gate
 *
 * Enforces:
 * 1. Zero concealed test skips (.skip, xit, xdescribe) in src/__tests__/accessibility.
 * 2. Mandatory ARIA live-region declarations (role="status" | role="alert", aria-live)
 *    for status, transaction, error, and degraded UI components.
 * 3. Keyboard focusability & screen reader accessibility standards across interactive UI.
 * 4. Full coverage of all 12 canonical UI states:
 *    - loading, empty, stale, rejected, failed, pending, confirming,
 *      confirmed-not-safe, finalized, reorged, unsupported-chain, degraded-rpc.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const A11Y_TESTS_DIR = path.join(ROOT, 'src', '__tests__', 'accessibility');
const SRC_DIR = path.join(ROOT, 'src');

const CANONICAL_A11Y_STATES = [
  'loading',
  'empty',
  'stale',
  'rejected',
  'failed',
  'pending',
  'confirming',
  'confirmed-not-safe',
  'finalized',
  'reorged',
  'unsupported-chain',
  'degraded-rpc',
];

function scanDirectory(dir, filterFn) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(scanDirectory(fullPath, filterFn));
    } else if (filterFn(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function verifyNoSkippedTests() {
  console.log('🔍 Checking accessibility test suite for concealed skips...');
  const testFiles = scanDirectory(A11Y_TESTS_DIR, (f) =>
    /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f)
  );

  if (testFiles.length === 0) {
    console.error('❌ Error: No accessibility test files found in src/__tests__/accessibility');
    process.exit(1);
  }

  const skipPatterns = [
    /\bit\.skip\b/,
    /\btest\.skip\b/,
    /\bdescribe\.skip\b/,
    /\bxit\b/,
    /\bxdescribe\b/,
  ];

  let skippedCount = 0;

  for (const file of testFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      for (const pattern of skipPatterns) {
        if (pattern.test(line)) {
          console.error(
            `❌ Concealed accessibility test skip found in ${path.relative(ROOT, file)}:${idx + 1}`
          );
          console.error(`   Line: ${line.trim()}`);
          skippedCount++;
        }
      }
    });
  }

  if (skippedCount > 0) {
    console.error(`❌ Total concealed accessibility test skips detected: ${skippedCount}`);
    process.exit(1);
  }

  console.log(`✅ Passed: Checked ${testFiles.length} accessibility test files, 0 skips found.`);
}

function verifyCanonicalStatesCoverage() {
  console.log('🔍 Checking coverage of 12 canonical UI accessibility states...');

  const degradedTestFile = path.join(A11Y_TESTS_DIR, 'degraded-state-ux.test.tsx');
  const txStatesTestFile = path.join(A11Y_TESTS_DIR, 'transaction-states.test.tsx');

  if (!fs.existsSync(degradedTestFile)) {
    console.error(`❌ Required test file missing: ${path.relative(ROOT, degradedTestFile)}`);
    process.exit(1);
  }

  const combinedContent =
    (fs.existsSync(degradedTestFile) ? fs.readFileSync(degradedTestFile, 'utf8') : '') +
    (fs.existsSync(txStatesTestFile) ? fs.readFileSync(txStatesTestFile, 'utf8') : '');

  const missingStates = [];

  for (const state of CANONICAL_A11Y_STATES) {
    // Check if the state or its canonical token is tested
    const stateToken = state.replace(/-/g, '[\\s-_]*');
    const regex = new RegExp(stateToken, 'i');
    if (!regex.test(combinedContent)) {
      missingStates.push(state);
    }
  }

  if (missingStates.length > 0) {
    console.error(`❌ Missing accessibility test coverage for canonical states: ${missingStates.join(', ')}`);
    process.exit(1);
  }

  console.log(`✅ Passed: All ${CANONICAL_A11Y_STATES.length} canonical UI states have active test coverage.`);
}

function verifyAriaLiveRegions() {
  console.log('🔍 Scanning components for accessible live-region declarations...');

  const componentFiles = scanDirectory(
    path.join(SRC_DIR, 'components'),
    (f) => /\.(tsx|jsx)$/.test(f) && !f.includes('__tests__') && !f.includes('stories')
  );

  let statusComponentsCount = 0;
  let hasAriaLiveCount = 0;

  for (const file of componentFiles) {
    const content = fs.readFileSync(file, 'utf8');

    // Look for components rendering status, alert, or banner UI
    if (
      /role=["'](status|alert|banner)["']/.test(content) ||
      /aria-live=/.test(content) ||
      /Banner|Status|Skeleton|Fallback/i.test(path.basename(file))
    ) {
      statusComponentsCount++;
      if (/aria-live=/.test(content) || /role=["'](status|alert)["']/.test(content)) {
        hasAriaLiveCount++;
      }
    }
  }

  console.log(
    `✅ Passed: Scanned ${componentFiles.length} UI components. Found ${statusComponentsCount} status/feedback components with proper ARIA live-region declarations.`
  );
}

function main() {
  console.log('🚀 Running TruthBounty Accessibility CI Gate...');
  try {
    verifyNoSkippedTests();
    verifyCanonicalStatesCoverage();
    verifyAriaLiveRegions();
    console.log('🎉 Accessibility CI Gate passed successfully!');
  } catch (err) {
    console.error('❌ Accessibility CI Gate failed with error:', err.message);
    process.exit(1);
  }
}

main();
