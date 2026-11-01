/**
 * Jest — unit tests of the API.
 *
 * Tests make no network calls; HTTP (OSRM, Nominatim) is replaced by stubs —
 * the network guard (test/setup/network-guard.ts) keeps it so.
 * Tests in ./test are outside the build's rootDir (./src), so `nest build`
 * does not compile them into dist/. The integration tests have their own
 * config (test/integration/jest.config.js).
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
  setupFiles: ['<rootDir>/test/setup/network-guard.ts'],
};
