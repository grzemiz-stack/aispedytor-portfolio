/**
 * Risk analysis — the fleet ADR check uses the same rule as LTL and matching
 * (common/adr.ts, docs/decisions.md §6): NO_ADR_VEHICLE when NO vehicle passes
 * `adrCompatibility`. `hasAdr` is the source of truth, classes narrow it, and
 * classes written down without `hasAdr` do not make a vehicle ADR-capable.
 */import { RiskAnalysisService } from '../../src/risk-analysis/risk-analysis.service';

const OFFER = {
  id: 'off-1', companyId: 'comp-1', pickupCountry: 'PL', deliveryCountry: 'PL',
  pickupDate: new Date('2026-06-01'), notes: null, specialRequirements: null, penaltyClauses: null,
  loadingTimeWindow: null, unloadingTimeWindow: null, palletExchange: false, palletExchangeType: null,
  palletCount: null, requiredInsuranceMin: null, paymentTermDays: null,
  isAdr: true, adrClass: '3', isFrigo: false, temperatureMin: null, temperatureMax: null,
};

async function analyze(offer: Record<string, unknown>, vehicles: unknown[]) {
  const prisma: any = {
    offer: { findFirst: jest.fn().mockResolvedValue({ ...OFFER, ...offer }) },
    vehicle: { findMany: jest.fn().mockResolvedValue(vehicles) },
  };
  const queue: any = { enqueue: (fn: () => Promise<unknown>) => fn() };
  const r: any = await new RiskAnalysisService(prisma, queue).analyzeRisk('off-1', 'comp-1');
  return { risks: r.risks as Array<{ type: string; message: string }>, prisma };
}
const types = (risks: Array<{ type: string }>) => risks.map((x) => x.type);
const truck = (v: Record<string, unknown>) => ({ vehicleType: 'TRUCK', trailerType: 'CURTAIN', ...v });

describe('NO_ADR_VEHICLE', () => {
  it('classes written down but no hasAdr → the fleet has no ADR vehicle', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: false, adrClasses: ['3'] })]);
    expect(types(risks)).toContain('NO_ADR_VEHICLE');
  });

  it('hasAdr with the offer class → no fleet risk', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: true, adrClasses: ['3'] })]);
    expect(types(risks)).not.toContain('NO_ADR_VEHICLE');
  });

  it('hasAdr but other classes → fleet risk naming that no ADR vehicle is allowed this load', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: true, adrClasses: ['8'] })]);
    const r = risks.find((x) => x.type === 'NO_ADR_VEHICLE');
    expect(r?.message).toMatch(/Żaden pojazd ADR/);
  });

  it('hasAdr without classes listed + an offer with a class → fleet risk (classes unknown is not consent)', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: true, adrClasses: [] })]);
    expect(types(risks)).toContain('NO_ADR_VEHICLE');
  });

  it('an ADR offer without a class on a certified vehicle → no fleet risk', async () => {
    const { risks } = await analyze({ adrClass: null }, [truck({ hasAdr: true, adrClasses: [] })]);
    expect(types(risks)).toContain('ADR_CARGO');
    expect(types(risks)).not.toContain('NO_ADR_VEHICLE');
  });

  it('one fitting vehicle in the fleet is enough', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: true, adrClasses: ['8'] }), truck({ hasAdr: true, adrClasses: ['3', '8'] })]);
    expect(types(risks)).not.toContain('NO_ADR_VEHICLE');
  });

  it('no certified vehicle at all → the "no ADR vehicle in the fleet" message', async () => {
    const { risks } = await analyze({}, [truck({ hasAdr: false, adrClasses: [] })]);
    expect(risks.find((x) => x.type === 'NO_ADR_VEHICLE')?.message).toMatch(/Brak pojazdu z certyfikatem ADR/);
  });
});

it('a class given with isAdr=false is an ADR load (the same rule as LTL)', async () => {
  const { risks } = await analyze({ isAdr: false, adrClass: '3' }, [truck({ hasAdr: false })]);
  expect(types(risks)).toEqual(expect.arrayContaining(['ADR_CARGO', 'NO_ADR_VEHICLE']));
});

it('a non-ADR offer gets no ADR risks', async () => {
  const { risks } = await analyze({ isAdr: false, adrClass: null }, []);
  expect(types(risks)).not.toContain('ADR_CARGO');
  expect(types(risks)).not.toContain('NO_ADR_VEHICLE');
});

it('hasAdr is read from the database', async () => {
  const { prisma } = await analyze({}, []);
  expect(prisma.vehicle.findMany.mock.calls[0][0].select).toMatchObject({ hasAdr: true, adrClasses: true });
});
