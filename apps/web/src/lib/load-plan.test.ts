import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPlanItem, type LoadPlanSource } from './load-plan';
import { messageText } from './plan-messages';

const offer = (over: Partial<LoadPlanSource> = {}): LoadPlanSource => ({
  id: 'o1', weightKg: 1200, lengthM: 2.4, palletCount: 6, cargoType: 'Palety',
  pickupCity: 'Poznań', deliveryCity: 'Berlin', ...over,
});

describe('loadPlanItem — no invented values', () => {
  it('complete offer → the item with its own weight and length', () => {
    expect(loadPlanItem(offer(), 3)).toEqual({
      ok: true,
      item: { offerId: 'o1', weight: 1200, meters: 2.4, description: 'Palety', loadingCity: 'Poznań', unloadingCity: 'Berlin', position: 3 },
    });
  });

  it('no weight → not added, with the code (not 0 kg, which would pass the GVW check)', () => {
    expect(loadPlanItem(offer({ weightKg: null }), 1)).toEqual({
      ok: false, missing: ['weightKg'],
      message: { code: 'LOAD_PLAN_OFFER_INCOMPLETE', params: { missing: 'weightKg' } },
    });
  });

  it('no length and no pallets → not added (no default 2.4 m)', () => {
    const r = loadPlanItem(offer({ lengthM: null, palletCount: null }), 1);
    expect(r).toMatchObject({ ok: false, missing: ['dimensions'] });
  });

  it('both missing → both named', () => {
    const r = loadPlanItem(offer({ weightKg: null, lengthM: null, palletCount: null }), 1);
    expect(r).toMatchObject({ ok: false, message: { params: { missing: 'weightKg,dimensions' } } });
  });

  it('no length but pallets → pallets × 0.4 m (a real conversion, as in the API)', () => {
    const r = loadPlanItem(offer({ lengthM: null, palletCount: 3 }), 1);
    expect(r.ok && r.item.meters).toBeCloseTo(1.2, 10); // 3 × 0.4 in floating point
  });

  it('0 kg and 0 m are values, not missing data', () => {
    expect(loadPlanItem(offer({ weightKg: 0, lengthM: 0 }), 1)).toMatchObject({ ok: true, item: { weight: 0, meters: 0 } });
  });

  it('the sentence names what is missing, in both languages', () => {
    const m = { code: 'LOAD_PLAN_OFFER_INCOMPLETE', params: { missing: 'weightKg,dimensions' } };
    expect(messageText(m, 'pl')).toBe(
      'Nie dodano do planu: brak masy i wymiarów (długość albo liczba palet) — uzupełnij ofertę, żeby policzyć zajętość i DMC.',
    );
    expect(messageText(m, 'en')).toContain('missing weight and dimensions (length or pallet count)');
  });
});

describe('LTL screen builds load-plan items only through loadPlanItem', () => {
  const PAGE = readFileSync(resolve(__dirname, '../app/(dashboard)/ltl-matching/page.tsx'), 'utf8');
  const add = PAGE.slice(PAGE.indexOf('function addToLoadPlan'), PAGE.indexOf('function removeFromLoadPlan'));

  it('addToLoadPlan uses loadPlanItem and stops on incomplete data', () => {
    expect(add).toMatch(/loadPlanItem\(offer, loadPlanOffers\.length \+ 1\)/);
    expect(add).toMatch(/if \(!result\.ok\) return;/);
  });

  it('no invented weight or length anywhere on the screen', () => {
    expect(PAGE).not.toMatch(/weightKg \|\| 0/);
    expect(PAGE).not.toMatch(/:\s*2\.4\)/);
  });

  it('an incomplete offer card cannot be clicked into the plan and says why', () => {
    expect(PAGE).toMatch(/onClick=\{\(\) => \{ if \(incomplete\) return;/);
    expect(PAGE).toMatch(/\{incomplete && \([\s\S]*?messageText\(incomplete\)/);
  });

  it('0 t is shown as 0.0t, not "?t" (!= null, not truthiness)', () => {
    expect(PAGE).toContain("o.weightKg != null ? `${(o.weightKg / 1000).toFixed(1)}t` : '?t'");
  });
});
