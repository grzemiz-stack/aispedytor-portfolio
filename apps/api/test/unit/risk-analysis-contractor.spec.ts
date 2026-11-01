/**
 * Offer risk analysis looks at the contractor.
 *
 * Before: risk analysis did not read the contractor at all — an offer from a
 * contractor with a payment rating of 1 (or on the blacklist) got "✓ Bezpieczna
 * do akceptacji". Now the same rule as the LTL card and negotiation
 * (common/counterparty-risk.ts):
 *  - the blacklist → HIGH (CONTRACTOR_BLACKLISTED) and a CRITICAL total,
 *    whatever the rest of the offer,
 *  - a payment rating ≤ 2 → HIGH (CONTRACTOR_PAYMENT_RISK),
 *  - reliability < 40 → MEDIUM (CONTRACTOR_RELIABILITY_RISK).
 * No ratings (null) is not a risk — as in counterpartyRisk. The contractor is
 * looked up in the caller's company.
 */
import { RiskAnalysisService } from '../../src/risk-analysis/risk-analysis.service';

const OFFER = {
  id: 'off-1', companyId: 'comp-1', contractorId: 'k-1', pickupCountry: 'PL', deliveryCountry: 'PL',
  pickupDate: new Date('2030-06-01'), notes: null, specialRequirements: null, penaltyClauses: null,
  loadingTimeWindow: null, unloadingTimeWindow: null, palletExchange: false, palletExchangeType: null,
  palletCount: null, requiredInsuranceMin: null, paymentTermDays: null, isAdr: false, adrClass: null,
  isFrigo: false, temperatureMin: null, temperatureMax: null,
};
const GOOD = { name: 'K', isBlacklisted: false, paymentRating: 4, reliabilityScore: 80 };

function analyze(contractor: object | null, offer: object = {}) {
  const prisma: any = {
    offer: { findFirst: jest.fn(async () => ({ ...OFFER, ...offer })) },
    vehicle: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    offerAnalysis: { findUnique: jest.fn(async () => null) },
    contractor: { findFirst: jest.fn(async () => contractor) },
  };
  const svc = new RiskAnalysisService(prisma, { enqueue: (fn: () => Promise<any>) => fn() } as any);
  return { run: () => svc.analyzeRisk('off-1', 'comp-1'), prisma };
}
const types = (r: any) => r.risks.map((x: any) => [x.type, x.level]);

it('a payment rating of 1 → HIGH, not "safe to accept" (the audit case)', async () => {
  const r = await analyze({ ...GOOD, paymentRating: 1 }).run();
  expect([types(r), r.safeToAccept, r.totalRiskScore]).toEqual([[['CONTRACTOR_PAYMENT_RISK', 'HIGH']], false, 'HIGH']);
  expect(r.risks[0].message).toMatch(/1\/5/);
});

it.each([[2, true], [3, false]])('payment rating %i → payment risk: %s (≤ 2, as in negotiation and LTL)', async (rating, risk) => {
  const r = await analyze({ ...GOOD, paymentRating: rating }).run();
  expect(types(r).some((t: any) => t[0] === 'CONTRACTOR_PAYMENT_RISK')).toBe(risk);
});

it('a blacklisted contractor, the rest of the offer clean → CRITICAL overall, not just one HIGH', async () => {
  const r = await analyze({ ...GOOD, isBlacklisted: true }).run();
  expect([types(r), r.safeToAccept, r.totalRiskScore]).toEqual([[['CONTRACTOR_BLACKLISTED', 'HIGH']], false, 'CRITICAL']);
});

it('one HIGH that is not the blacklist (payment rating 1) stays HIGH overall, not CRITICAL', async () => {
  const r = await analyze({ ...GOOD, paymentRating: 1 }).run();
  expect(r.totalRiskScore).toBe('HIGH');
});

it.each([[39, true], [40, false]])('reliability %i → MEDIUM reliability risk: %s; still safe to accept', async (score, risk) => {
  const r = await analyze({ ...GOOD, reliabilityScore: score }).run();
  expect(types(r)).toEqual(risk ? [['CONTRACTOR_RELIABILITY_RISK', 'MEDIUM']] : []);
  expect([r.safeToAccept, r.totalRiskScore]).toEqual([true, risk ? 'MEDIUM' : 'LOW']);
});

it('all three at once: three risks, critical with another HIGH', async () => {
  const r = await analyze({ name: 'K', isBlacklisted: true, paymentRating: 1, reliabilityScore: 10 }, { penaltyClauses: 'kara 500 EUR' }).run();
  expect(types(r).filter((t: any) => t[0].startsWith('CONTRACTOR_'))).toEqual([
    ['CONTRACTOR_BLACKLISTED', 'HIGH'], ['CONTRACTOR_PAYMENT_RISK', 'HIGH'], ['CONTRACTOR_RELIABILITY_RISK', 'MEDIUM'],
  ]);
  expect(r.totalRiskScore).toBe('CRITICAL');
});

it('no ratings (null) is not a risk', async () => {
  const r = await analyze({ name: 'K', isBlacklisted: null, paymentRating: null, reliabilityScore: null }).run();
  expect([types(r), r.safeToAccept]).toEqual([[], true]);
});

it('the contractor is looked up in the caller\'s company only', async () => {
  const { run, prisma } = analyze({ ...GOOD, paymentRating: 1 });
  await run();
  expect(prisma.contractor.findFirst.mock.calls[0][0].where).toEqual({ id: 'k-1', companyId: 'comp-1' });
});

it('an offer without a contractor: no lookup, no contractor risk', async () => {
  const { run, prisma } = analyze(null, { contractorId: null });
  const r = await run();
  expect([prisma.contractor.findFirst.mock.calls.length, types(r)]).toEqual([0, []]);
});
