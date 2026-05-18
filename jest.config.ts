import type { Config } from 'jest';

/**
 * Jest configuration for the salary-system-rebuild Next.js app.
 *
 * Two projects are defined so that domain (pure TS) tests run in a Node
 * environment while UI tests run in jsdom. ts-jest is used in both projects
 * so TypeScript files compile transparently.
 */
const config: Config = {
  // Top-level options passed to every project unless overridden
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  projects: [
    {
      displayName: 'domain',
      preset: 'ts-jest',
      testEnvironment: 'node',
      rootDir: '<rootDir>',
      testMatch: [
        '<rootDir>/src/domain/**/*.test.ts',
        '<rootDir>/tests/integration/**/*.test.ts',
        '<rootDir>/src/lib/**/*.test.ts',
        '<rootDir>/src/app/actions/**/*.test.ts',
        '<rootDir>/src/migration/**/*.test.ts',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
    },
    {
      displayName: 'ui',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      rootDir: '<rootDir>',
      testMatch: [
        '<rootDir>/src/app/**/*.test.tsx',
        '<rootDir>/src/app/**/*.test.ts',
        '<rootDir>/src/components/**/*.test.tsx',
        '<rootDir>/src/components/**/*.test.ts',
        '<rootDir>/src/lib/**/*.test.tsx',
      ],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/.next/',
        '<rootDir>/src/app/actions/',
      ],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      // The repo tsconfig sets `jsx: preserve` for Next.js. ts-jest honours
      // that and leaves JSX untouched, which Jest can't parse. Override
      // here so JSX in `.test.tsx` files compiles to plain JS.
      transform: {
        '^.+\\.(ts|tsx)$': [
          'ts-jest',
          {
            tsconfig: {
              jsx: 'react-jsx',
            },
          },
        ],
      },
    },
  ],
};

export default config;
