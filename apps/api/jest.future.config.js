/**
 * The same unit tests with the clock at +5 years (test/setup/clock-shift.ts).
 * A test fails when it relies on a hardcoded date "in the future" instead of
 * a fake clock or an injected "now".
 */
const base = require('./jest.config');

module.exports = {
  ...base,
  setupFilesAfterEnv: ['<rootDir>/test/setup/clock-shift.ts'],
};
