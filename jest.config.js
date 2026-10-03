/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Handle module aliases (this will be automatically configured for you based on your tsconfig.json paths)
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testEnvironment: 'jest-environment-jsdom',
  // Only pick up unit/integration tests. Playwright (e2e/*.spec.ts) and
  // Vitest (*.spec.ts) specs run through their own runners.
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)',
    '<rootDir>/src/**/?(*.)+(spec|test).[jt]s?(x)',
    '<rootDir>/**/*.test.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/e2e/',
    '<rootDir>/.kilo/',
    '<rootDir>/.freebuff/',
    '<rootDir>/.trae/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.kilo/',
    '<rootDir>/.freebuff/',
    '<rootDir>/.trae/',
  ],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/app/layout.tsx',
    '!src/app/providers.tsx',
  ],
}

// Wrap so we can merge transformIgnorePatterns after next/jest sets them.
// next-intl ships ESM-only in v4; it must not be excluded from transformation.
const jestConfigWithNextDefaults = createJestConfig(customJestConfig)

module.exports = async () => {
  const config = await jestConfigWithNextDefaults()
  // Allow next-intl (and its peer next-intl/server, next-intl/middleware) to be
  // transformed alongside wagmi and viem which next/jest already handles.
  config.transformIgnorePatterns = (config.transformIgnorePatterns ?? []).map(
    (pattern) => (typeof pattern === 'string' ? pattern.replace(/\(wagmi/g, '(next-intl|wagmi') : pattern)
  )
  return config
}
