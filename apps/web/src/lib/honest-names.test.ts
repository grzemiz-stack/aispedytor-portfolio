/**
 * The offer score is a heuristic — the screens do not call it "AI" (docs/decisions.md §9).
 *
 * `ai-evaluation` computes the score from margin thresholds and the price per
 * km against the company's average; no model is involved. The module name and
 * the API paths stay.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, '..', 'app/(dashboard)', f), 'utf8');
/** Texts visible in JSX and in strings — comments removed. */
const visible = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

it.each([
  ['page.tsx', /Rekomendacje AI|rekomendacje AI/],
  ['offers/page.tsx', /Oceń AI|AI \{aiScores|label: 'AI'|ocen[ay]? AI/],
  ['offers/[id]/page.tsx', /AI Ocena oferty|oceny AI/],
])('%s does not call the heuristic score "AI"', (file, pattern) => {
  expect(visible(read(file))).not.toMatch(pattern);
});

it('the offer page says what the score is made of', () => {
  expect(read('offers/[id]/page.tsx')).toMatch(/heurystyka: marża i stawka wobec Twoich ofert na tej trasie — bez modelu AI/);
});

it('the score card shows the rate notes of the history average', () => {
  expect(read('offers/[id]/page.tsx')).toMatch(/messagesToText\(aiEval\.messages \?\? \[\]\)/);
});

it('the offer page has no "Analiza AI" block and does not read offer.analysis', () => {
  const src = read('offers/[id]/page.tsx');
  expect(src).not.toMatch(/Analiza AI/);
  expect(src).not.toMatch(/offer\.analysis/);
});

it('e-mail screen says it classifies e-mails sent to the app and reads no mailbox', () => {
  const src = visible(read('email/page.tsx'));
  expect(src).toMatch(/Klasyfikuje e-maile wklejone w panelu testowym albo przesłane przez API/);
  expect(src).toMatch(/nie łączy się\s+ze skrzynką pocztową — konektor skrzynki \(IMAP, Gmail\) jest poza zakresem produktu/);
  expect(src).not.toMatch(/Skrzynka odbiorcza|Zapisz do skrzynki|Inteligentne przetwarzanie/);
});
