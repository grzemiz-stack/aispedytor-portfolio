/**
 * Paginated lists from the API.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageItems } from './paginated';

it('takes the list from { data, meta }', () => {
  expect(pageItems({ data: [{ id: 'a' }], meta: { total: 1 } })).toEqual([{ id: 'a' }]);
  expect(pageItems({ data: [], meta: { total: 0 } })).toEqual([]);
});

it('another shape is an error, not a silent empty list', () => {
  expect(() => pageItems([{ id: 'a' }])).toThrow(/data/);
  expect(() => pageItems({ emails: [] })).toThrow(/data/);
  expect(() => pageItems(null)).toThrow(/data/);
});

const screen = (f: string) => readFileSync(resolve(__dirname, '..', 'app/(dashboard)', f), 'utf8');

it('dashboard reads /offers through pageItems and shows a load error instead of swallowing it', () => {
  const src = screen('page.tsx');
  expect(src).toMatch(/pageItems<TopOffer>\(offersRes\.data\)/);
  expect(src).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  expect(src).toMatch(/setLoadError\(apiErrorText\(/);
  expect(src).toMatch(/\{loadError && /);
});

it('e-mail inbox reads { data, meta } and shows a load error instead of an empty inbox', () => {
  const src = screen('email/page.tsx');
  expect(src).toMatch(/setEmails\(pageItems<EmailItem>\(inboxRes\.data\)\)/);
  expect(src).toMatch(/setTotal\(inboxRes\.data\.meta\.total\)/);
  expect(src).not.toMatch(/inboxRes\.data\.(emails|total)/);
  expect(src).toMatch(/setInboxError\(apiErrorText\(/);
  expect(src).toMatch(/\{!loading && inboxError && /);
});
