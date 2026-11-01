/**
 * The e-mail inbox: the price currency from the API and pages.
 *
 * Before: every price with "EUR" (also a recognised PLN), the "Test" tab EUR
 * by default; the list had no pages — only the first 20 e-mails were visible.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emailPriceLabel } from './email-offer';

const page = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/email/page.tsx'), 'utf8');

it('the price label carries the currency from the API; no currency → "waluta nieznana", not EUR', () => {
  expect([emailPriceLabel(1200, 'PLN'), emailPriceLabel(1200, null), emailPriceLabel(0, 'EUR')])
    .toEqual([`${(1200).toLocaleString('pl-PL')} PLN`, `${(1200).toLocaleString('pl-PL')} (waluta nieznana)`, '0 EUR']);
});

it('the inbox screen writes no hard-coded EUR next to a price and uses the label for the list, the detail and the test tab', () => {
  expect(page).not.toMatch(/toLocaleString\('pl-PL'\)\}?\s*EUR|\?\? 'EUR'/);
  expect(page.match(/emailPriceLabel\(/g)?.length).toBe(3);
  expect(page).toMatch(/emailPriceLabel\(email\.extractedPrice, email\.extractedCurrency\)/);
});

it('the inbox pages: the shared Pagination, `page` sent to the API, a filter change goes back to page 1', () => {
  expect(page).toMatch(/import Pagination from '@\/components\/pagination'/);
  expect(page).toMatch(/<Pagination[\s\S]{0,300}totalPages=\{totalPages\}/);
  expect(page).toMatch(/params\.page = String\(page\)/);
  expect(page).not.toMatch(/params\.offset/);
  // A filter change resets the page in the same handler (no second request with the old page).
  for (const handler of [/setActiveCategory\(cat\.key\); setPage\(1\);/, /setSearch\(e\.target\.value\); setPage\(1\);/, /setUnreadOnly\(e\.target\.checked\); setPage\(1\);/, /onLimitChange=\{\(l\) => \{ setLimit\(l\); setPage\(1\); \}\}/]) {
    expect(page).toMatch(handler);
  }
});
