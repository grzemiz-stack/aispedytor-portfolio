/**
 * ESLint configuration for apps/api.
 *
 * `.js`, not `.json`, because the reasons below must be readable where the
 * exemption applies — JSON has no comments.
 */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: '.',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: [
    '.eslintrc.js',
    'dist/**',
    'node_modules/**',
    // The fixture for the `zero-is-not-missing` rule test contains DELIBERATE
    // violations so the test has something to assert. The linter skips it; the
    // test lints it explicitly (`ignore: false` in test/unit/zero-rule.spec.ts).
    'test/fixtures/**',
  ],
  rules: {
    // Project rule, loaded with `--rulesdir eslint-rules`
    // (zero is a value, not missing data — docs/decisions.md §2).
    'zero-is-not-missing': 'error',
    /**
     * Unused variables: an error, with two explicit exceptions:
     * - a name starting with `_` — an argument or destructured element left
     *   out on purpose (`(_req, res) =>`, `const [_first, second]`);
     * - fields dropped by a rest (`const { password, ...safe } = user`) — the
     *   way to build an object WITHOUT those fields, not dead code.
     */
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_',
      ignoreRestSiblings: true,
    }],
  },
  overrides: [
    {
      // Tests next to the code (`.spec.ts` in `src/`) use the same fakes as
      // `test/` — the same reasoning applies.
      files: ['test/**/*.ts', 'src/**/*.spec.ts'],
      rules: {
        /**
         * `no-explicit-any` is off IN TESTS — deliberately, not silently.
         *
         * Why: most reports of this rule in apps/api came from tests, where `any`
         * is justified. A Prisma fake (`const prisma: any = {…}`) deliberately does
         * NOT implement the full delegate signatures — only the methods the test
         * uses. Typing it would mean recreating the PrismaClient interface in every
         * test file: high cost, no gain. The same applies to fixtures
         * (`{…} as any`) and assertion predicates (`(e: any) => …`).
         *
         * Safety: tests still go through `tsc --noEmit -p tsconfig.spec.json`,
         * which checks EVERY call into production code from a test. The exemption
         * covers only annotations inside the fakes.
         *
         * Scope: only this one rule and only tests (`test/` and `.spec.ts` files
         * next to the code in `src/`). All other rules,
         * including `zero-is-not-missing`, still apply in tests.
         */
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
