/**
 * Admin messages in English: startup and configuration errors, server logs
 * (Logger/console), the seed and the scripts in `tools/`.
 *
 * API messages shown in the interface (HTTP exceptions, message codes) and
 * the web texts stay Polish — they are not checked here. Only texts that end
 * up in a log or on a terminal are checked; comments are not.
 *
 * "Polish" = a Polish letter, a word from the list of forms that are never
 * correct Polish without diacritics (`tools/polish-words-without-diacritics.json`,
 * shared with the UI text test), or a common Polish word from `COMMON_POLISH`
 * below. The second list lives only here: those are correct Polish, so the
 * UI text test would raise false alarms, while an English message must never
 * contain them. Polish without diacritics outside both lists is not caught.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import { secretProblems, validateEnv, requireEncryptionKey, requireJwtSecret } from '../../src/common/config/secrets';
import { seedRefusal } from '../../prisma/seed-guard';

const ROOT = resolve(__dirname, '../../../..');
const API = resolve(__dirname, '../..');
const WORDS: string[] = JSON.parse(readFileSync(join(ROOT, 'tools/polish-words-without-diacritics.json'), 'utf8')).words;
const LETTER = 'A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż';
const PL_CHARS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const PL_WORD = new RegExp(`(?<![${LETTER}])(${WORDS.join('|')})(?![${LETTER}])`, 'i');
/** Common Polish words (no diacritics) — only for messages that must be English. */
const COMMON_POLISH = ['nie', 'jest', 'dla', 'lub', 'oraz', 'przez', 'bez', 'juz', 'brak', 'sa', 'czy', 'gdy'];
const COMMON_WORD = new RegExp(`(?<![${LETTER}])(${COMMON_POLISH.join('|')})(?![${LETTER}])`, 'i');
/** "jest" is also the test runner — its forms are not a Polish word. */
const withoutJestRunner = (text: string) => text.replace(/npx jest\b|\bjest\.config\b|\$JEST\b|\bJEST=/g, '');
const isPolish = (text: string) => PL_CHARS.test(text) || PL_WORD.test(text) || COMMON_WORD.test(withoutJestRunner(text));

const LOG_METHODS = new Set(['log', 'warn', 'error', 'debug', 'verbose', 'fatal', 'info']);
const ERROR_CLASSES = new Set(['Error', 'TypeError', 'RangeError']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return ['node_modules', 'migrations'].includes(e.name) ? [] : tsFiles(p);
    return /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });
}

/** The fixed text parts of an argument (without the `${…}` expressions). */
function literalText(n: ts.Node): string[] {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return [...literalText(n.left), ...literalText(n.right)];
  return [];
}

/** Messages in code: Logger/console arguments and `throw new Error(…)`. */
function adminMessages(file: string, code: string): { where: string; text: string }[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const out: { where: string; text: string }[] = [];
  const add = (n: ts.Node, args: readonly ts.Expression[] | undefined) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    for (const a of args ?? []) for (const text of literalText(a)) out.push({ where: `${relative(ROOT, file)}:${line}`, text });
  };
  (function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && LOG_METHODS.has(n.expression.name.text)) {
      const target = n.expression.expression.getText(sf);
      if (target === 'console' || /logger/i.test(target)) add(n, n.arguments);
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && ERROR_CLASSES.has(n.expression.text) && ts.isThrowStatement(n.parent)) {
      add(n, n.arguments);
    }
    ts.forEachChild(n, visit);
  })(sf);
  return out;
}

/** Script lines without comments. */
function shellLines(file: string, code: string): { where: string; text: string }[] {
  return code.split('\n').flatMap((line, i) => {
    if (/^\s*#/.test(line)) return [];
    const text = line.replace(/\s#\s.*$/, '');
    return text.trim() ? [{ where: `${relative(ROOT, file)}:${i + 1}`, text }] : [];
  });
}

const polishIn = (items: { where: string; text: string }[]) => items.filter((m) => isPolish(m.text)).map((m) => `${m.where}: ${m.text}`);

describe('admin messages are in English', () => {
  it('Logger, console and thrown Error texts in apps/api/src and apps/api/prisma', () => {
    const files = [...tsFiles(join(API, 'src')), ...tsFiles(join(API, 'prisma'))];
    expect(files.length).toBeGreaterThan(50);
    expect(polishIn(files.flatMap((f) => adminMessages(f, readFileSync(f, 'utf8'))))).toEqual([]);
  });

  it('scripts in tools/ (full check, demo test)', () => {
    const tools = join(ROOT, 'tools');
    const files = readdirSync(tools, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sh'))
      .map((e) => join(tools, e.name));
    expect(files.map((f) => relative(ROOT, f))).toEqual(expect.arrayContaining(['tools/bramka.sh', 'tools/demo-test.sh']));
    expect(polishIn(files.flatMap((f) => shellLines(f, readFileSync(f, 'utf8'))))).toEqual([]);
  });

  it('startup errors for missing and unsafe secrets', () => {
    const bad = [
      {},
      { JWT_SECRET: 'change-this-to-a-long-random-secret', ENCRYPTION_KEY: 'xyz' },
      { JWT_SECRET: 'short', ENCRYPTION_KEY: '0'.repeat(64) },
    ];
    const texts = bad.flatMap((env) => secretProblems(env));
    expect(texts).toHaveLength(6);
    for (const env of bad) expect(() => validateEnv(env)).toThrow();
    const thrown = bad.map((env) => {
      try { validateEnv(env); return ''; } catch (e) { return (e as Error).message; }
    });
    const one = (f: () => unknown) => { try { f(); return ''; } catch (e) { return (e as Error).message; } };
    texts.push(...thrown, one(() => requireJwtSecret('')), one(() => requireEncryptionKey('')));
    expect(texts.filter(isPolish)).toEqual([]);
  });

  it('the seed refusal on production', () => {
    const text = seedRefusal({ NODE_ENV: 'production' });
    expect(text).toMatch(/^Seed refuses: NODE_ENV=production/);
    expect(isPolish(text!)).toBe(false);
  });

  it('the check itself: Polish letters, a word without diacritics, comments ignored', () => {
    expect(isPolish('API nasłuchuje')).toBe(true);
    expect(isPolish('Import: wstawil 3 oferty')).toBe(true);
    expect(isPolish('Geocoding failed: blad')).toBe(true);
    expect(isPolish('Seed refuses — nie uruchamiaj go na bazie produkcyjnej')).toBe(true);
    expect(isPolish('Cache hit: Poznan')).toBe(false);
    expect(isPolish('Saved notes for Sanok')).toBe(false);
    expect(isPolish('JEST="npx jest --config test/integration/jest.config.js"; $JEST test/x')).toBe(false);
    expect(isPolish('Konfiguracja jest niepoprawna')).toBe(true);
    const code = "// Komentarz: błąd\nthis.logger.warn(`Nie udało się ${x}`);\nthrow new Error('ok');\nthrow new HttpException('Błąd', 400);";
    expect(adminMessages('x.ts', code).map((m) => m.text)).toEqual(['Nie udało się ', '', 'ok']);
    expect(shellLines('x.sh', '# komentarz: błąd\necho "ok" # przypis: błąd\necho "błąd"').map((m) => m.text)).toEqual(['echo "ok"', 'echo "błąd"']);
  });
});
