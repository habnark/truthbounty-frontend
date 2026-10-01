// ---------------------------------------------------------------------------
// 8. V2-FE-046 — identity invalidation has no mock/simulator deps
// ---------------------------------------------------------------------------

describe('wallet identity invalidation — no mock/placeholder runtime dependencies', () => {
  const productionFiles = [
    path.resolve(__dirname, '../../lib/wallet/identity.ts'),
    path.resolve(__dirname, '../../hooks/useWalletIdentityInvalidation.ts'),
  ];

  it.each(productionFiles)('%s does not import mocks or simulators', (filePath) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/mock-wagmi|transaction-simulator|@stellar\/freighter-api/i);
    expect(content).not.toContain('Math.random');
  });

  it('identity policy is pure — no wallet SDK, React, or storage imports', () => {
    const filePath = path.resolve(__dirname, '../../lib/wallet/identity.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/from 'wagmi'|from 'react'|localStorage|sessionStorage/);
  });
});

// ---------------------------------------------------------------------------
// 8b. Production bundle must not import mock datasets or fabricate runtime state
// ---------------------------------------------------------------------------

describe('production bundle — mock isolation', () => {
  it('does not import mock data modules from production source files', () => {
    const srcRoot = path.resolve(__dirname, '../../');
    const files: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'mocks') continue;
          walk(fullPath);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    walk(path.join(srcRoot, 'app'));
    walk(path.join(srcRoot, 'components'));
    walk(path.join(srcRoot, 'hooks'));
    walk(path.join(srcRoot, 'lib'));
    walk(path.join(srcRoot, 'config'));

    const badFiles = files.filter((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      return (
        content.includes('@/data/mock-data') ||
        content.includes('../data/mock-data') ||
        content.includes("'@/__tests__/") ||
        content.includes('"@/__tests__/')
      );
    });

    expect(badFiles).toEqual([]);
  });

  it('does not generate fabricated wallet/tx data with Math.random in production source', () => {
    const srcRoot = path.resolve(__dirname, '../../');
    const files: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'mocks') continue;
          walk(fullPath);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    walk(path.join(srcRoot, 'app'));
    walk(path.join(srcRoot, 'components'));
    walk(path.join(srcRoot, 'hooks'));
    walk(path.join(srcRoot, 'lib'));
    walk(path.join(srcRoot, 'config'));

    const badFiles = files.filter((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      return content.includes('Math.random()') || content.includes('Math.random');
    });

    expect(badFiles).toEqual([]);
  });
});