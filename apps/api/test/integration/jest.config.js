/**
 * Integration tests — a real database from tools/demo-test.sh (DATABASE_URL,
 * DEMO_NOW). Not part of the plain `npm test`: they need Docker.
 */
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
};
