/**
 * Tests of the ESLint rule `zero-is-not-missing` itself.
 *
 * The rule must not fire on `items.length ? … : null`, the idiom for checking
 * an empty array. An empty array REALLY is missing data, so this is not the
 * "zero as missing" defect — reporting it would be a false alarm (it used to
 * show up in the project's own Prisma aggregate fakes).
 *
 * The rule needs type information, so the test lints a real file that belongs
 * to the tsconfig project — the same path CI takes, not synthetic code.
 */
import { ESLint } from 'eslint';
import * as path from 'path';
import { readdirSync } from 'fs';

const API_DIR = path.join(__dirname, '../..');
const FIXTURE = path.join(API_DIR, 'test/fixtures/zero-is-not-missing.fixture.ts');

async function reportedLines(): Promise<number[]> {
  // @types/eslint in this version describes the flat config (ESLint 9), while the
  // repo uses eslintrc + --rulesdir (ESLint 8). Hence the cast of the constructor options.
  const eslint = new ESLint({
    cwd: API_DIR,
    rulePaths: [path.join(API_DIR, 'eslint-rules')],
    ignore: false,
    useEslintrc: false,
    overrideConfig: {
      parser: require.resolve('@typescript-eslint/parser'),
      parserOptions: {
        project: path.join(API_DIR, 'tsconfig.json'),
        tsconfigRootDir: API_DIR,
        sourceType: 'module',
      },
      rules: { 'zero-is-not-missing': 'error' },
    },
  } as any);
  const [lintResult] = await eslint.lintFiles([FIXTURE]);
  return lintResult.messages
    .filter((m) => m.ruleId === 'zero-is-not-missing')
    .map((m) => m.line)
    .sort((a, b) => a - b);
}

describe('ESLint rule zero-is-not-missing', () => {
  jest.setTimeout(60_000);

  it('reports exactly the two faulty expressions and nothing else', async () => {
    expect(await reportedLines()).toEqual([21, 22]);
  });

  it('does not report `.length` on an array — the empty-array idiom is not a defect', async () => {
    const lines = await reportedLines();
    expect(lines).not.toContain(13);
    expect(lines).not.toContain(14);
  });

  it('does not report `.length` on a string', async () => {
    expect(await reportedLines()).not.toContain(15);
  });

  it('does not report explicit checks, text fields or `??`', async () => {
    const lines = await reportedLines();
    [16, 17, 18].forEach((l) => expect(lines).not.toContain(l));
  });
});

it('every project rule configured in .eslintrc.js has its file in eslint-rules', () => {
  // `npm run lint` loads them with --rulesdir; the full check does not run lint,
  // so a renamed or missing rule file would otherwise go unnoticed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const config = require(path.join(API_DIR, '.eslintrc.js'));
  const projectRules = Object.keys(config.rules).filter((id) => !id.includes('/'));
  const files = readdirSync(path.join(API_DIR, 'eslint-rules')).map((f) => f.replace(/\.js$/, ''));
  expect(projectRules.length).toBeGreaterThan(0);
  expect(projectRules.sort()).toEqual(files.sort());
});
