/**
 * Polish UI texts keep their diacritics ("Wyloguj sie" was on the sidebar).
 *
 * Reads the code of screens and components without comments and looks for
 * words that are not correct Polish without their diacritics. Comments do
 * not count — they are not UI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
/**
 * Forms that have diacritics in correct Polish — a list shared with the admin
 * message test (apps/api/test/unit/admin-messages-english.spec.ts).
 */
const WORDS: string[] = JSON.parse(readFileSync(resolve(__dirname, '../../../../tools/polish-words-without-diacritics.json'), 'utf8')).words;
/** Letters (Polish included) — the word boundary; no `u` flag (written when the web compiled to ES5). */
const LETTER = 'A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż';
const ASCII_ONLY = new RegExp(`(?<![${LETTER}])(${WORDS.join('|')})(?![${LETTER}])`, 'i');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Code without comments (`//…`, `/* … *\/`, `{/* … *\/}`). */
const withoutComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

it('no UI text in app/ and components/ uses Polish words without their diacritics', () => {
  const hits = [...files(join(SRC, 'app')), ...files(join(SRC, 'components'))].flatMap((f) =>
    withoutComments(readFileSync(f, 'utf8'))
      .split('\n')
      .filter((line) => ASCII_ONLY.test(line))
      .map((line) => `${relative(SRC, f)}: ${line.trim()}`),
  );
  expect(hits).toEqual([]);
});

it('the shared word list is loaded', () => {
  expect(WORDS).toEqual(expect.arrayContaining(['sie', 'blad', 'wstawil']));
});

it('the check itself catches the old logout text', () => {
  expect(ASCII_ONLY.test(withoutComments("<button>Wyloguj sie →</button>"))).toBe(true);
  expect(ASCII_ONLY.test(withoutComments("// Kierunek bledu ma byc bezpieczny"))).toBe(false);
});
