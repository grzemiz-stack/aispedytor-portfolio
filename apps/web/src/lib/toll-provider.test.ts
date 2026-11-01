/**
 * Toll on the planner screen: missing is shown as missing (src/tolls in the API).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { messageText } from './plan-messages';

const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/route-planner/page.tsx'), 'utf8');

it('toll without a provider shows "— nie policzono" (not calculated), not 0', () => {
  expect(src).toMatch(/route\.costs\.tolls\.totalEUR === null\s*\?\s*<span className="text-amber-700">— nie policzono<\/span>/);
});

it('the total and the margin say when they exclude toll', () => {
  expect(src).toMatch(/Łączny koszt\{route\.costs\.complete \? '' : ' \(bez myta — niepełny\)'\}/);
  expect(src).toMatch(/route\.margin\.complete === false \? ' \(bez myta — niepełna\)'/);
});

it('the provider\'s amount and currency are shown per country, with its name', () => {
  expect(src).toMatch(/\{toll\.amount\} \{toll\.currency\}/);
  expect(src).toMatch(/źródło: \{route\.costs\.tolls\.source\}/);
});

it('the codes read as sentences in both languages', () => {
  expect(messageText({ code: 'TOLL_PROVIDER_NOT_CONFIGURED' })).toMatch(/^Myto nie jest liczone/);
  expect(messageText({ code: 'TOLL_PROVIDER_UNAVAILABLE', params: { reason: 'timeout' } }, 'en')).toMatch(/\(timeout\)/);
});
