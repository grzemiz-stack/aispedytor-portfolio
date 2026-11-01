/**
 * Web tests — for now only pure logic: the message dictionary, formatting
 * and source checks. No DOM, so the `node` environment is enough.
 *
 * Jest rather than vitest on purpose: the repository already uses it in
 * `apps/api`, and vitest pulls in rollup with a per-platform native binary
 * that npm does not install correctly from this lockfile. One test runner
 * in the repository is also one thing less to maintain.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
