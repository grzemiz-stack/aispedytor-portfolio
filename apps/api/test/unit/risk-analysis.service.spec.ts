/**
 * RiskAnalysisService — rule-based risk check of one offer.
 *
 * The service is a deterministic set of rules (a–i) over one offer record and
 * the company's fleet. What matters is in the thresholds, in how NULL is
 * treated and in how the overall result is put together — that is what is
 * tested here. The Prisma queries are a thin delegate that only supplies data
 * to the rules.
 *
 * All seven risk fields (`penaltyClauses`, `loadingTimeWindow`, `palletExchange`,
 * `palletExchangeType`, `palletCount`, `requiredInsuranceMin`, `paymentTermDays`)
 * are covered here.
 *
 * The Prisma mock returns `null` for empty fields, as PostgreSQL does, never `undefined`.
 */
import { RiskAnalysisService } from '../../src/risk-analysis/risk-analysis.service';

/** An offer with every field set to NULL — what a row with empty columns looks like. */
const EMPTY_OFFER = {
  id: 'off-1',
  companyId: 'comp-1',
  pickupCountry: 'PL',
  deliveryCountry: 'PL',
  pickupDate: new Date('2026-06-01'),
  notes: null,
  specialRequirements: null,
  penaltyClauses: null,
  loadingTimeWindow: null,
  unloadingTimeWindow: null,
  palletExchange: false,
  palletExchangeType: null,
  palletCount: null,
  requiredInsuranceMin: null,
  paymentTermDays: null,
  isAdr: false,
  adrClass: null,
  isFrigo: false,
  temperatureMin: null,
  temperatureMax: null,
};

function makeService(opts: {
  offer?: Record<string, any> | null;
  vehicles?: any[];
} = {}) {
  const offer = opts.offer === null ? null : { ...EMPTY_OFFER, ...(opts.offer ?? {}) };
  const prisma: any = {
    offer: { findFirst: jest.fn().mockResolvedValue(offer) },
    vehicle: { findMany: jest.fn().mockResolvedValue(opts.vehicles ?? []) },
  };
  // The task queue runs the task directly — queueing is not tested here.
  const queue: any = { enqueue: (fn: () => Promise<any>) => fn() };
  return new RiskAnalysisService(prisma, queue);
}

const riskTypes = (r: { risks: Array<{ type: string }> }) => r.risks.map((x) => x.type);
const findRisk = (r: any, riskType: string) => r.risks.find((x: any) => x.type === riskType);

describe('offer without any risk factors', () => {
  it('an empty domestic offer is LOW and safe to accept', async () => {
    const r = await makeService().analyzeRisk('off-1', 'comp-1');

    expect(r.risks).toEqual([]);
    expect(r.totalRiskScore).toBe('LOW');
    expect(r.safeToAccept).toBe(true);
  });

  it('an unknown offer ends with NotFound', async () => {
    await expect(makeService({ offer: null }).analyzeRisk('brak', 'comp-1')).rejects.toThrow(
      /nie znaleziona/i,
    );
  });
});

describe('a) penalty clauses', () => {
  it('non-empty penaltyClauses gives a HIGH risk', async () => {
    const r = await makeService({ offer: { penaltyClauses: 'Kara 500 EUR za dzien zwloki.' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('PENALTY_CLAUSES');
    expect(findRisk(r, 'PENALTY_CLAUSES').level).toBe('HIGH');
  });

  it('penaltyClauses made only of spaces gives no risk', async () => {
    const r = await makeService({ offer: { penaltyClauses: '    ' } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('PENALTY_CLAUSES');
  });

  it('long clauses are cut to 200 characters in details', async () => {
    const r = await makeService({ offer: { penaltyClauses: 'K'.repeat(500) } })
      .analyzeRisk('off-1', 'comp-1');

    const item = findRisk(r, 'PENALTY_CLAUSES');
    expect(item.details).toHaveLength(201); // 200 characters + ellipsis
    expect(item.details.endsWith('…')).toBe(true);
  });
});

describe('b) loading window', () => {
  it.each([
    [30, 'HIGH'],
    [59, 'HIGH'],
    [60, 'MEDIUM'],
    [119, 'MEDIUM'],
  ])('a %i min window gives level %s', async (windowMinutes, expectedLevel) => {
    const r = await makeService({ offer: { loadingTimeWindow: windowMinutes } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'SHORT_LOADING_WINDOW').level).toBe(expectedLevel);
  });

  it('a 120 min window (the threshold) is not a risk', async () => {
    const r = await makeService({ offer: { loadingTimeWindow: 120 } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('SHORT_LOADING_WINDOW');
  });

  it('NULL loading window creates no risk', async () => {
    const r = await makeService({ offer: { loadingTimeWindow: null } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('SHORT_LOADING_WINDOW');
  });

  it('a 0 min window is a value, not missing data', async () => {
    // `loadingTimeWindow != null` — zero passes and lands in the HIGH band.
    const r = await makeService({ offer: { loadingTimeWindow: 0 } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'SHORT_LOADING_WINDOW').level).toBe('HIGH');
  });
});

describe('c) pallet exchange', () => {
  it('palletExchange=false creates no risk', async () => {
    const r = await makeService({ offer: { palletExchange: false } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('PALLET_EXCHANGE');
  });

  it('the exchange flag alone gives a MEDIUM risk', async () => {
    const r = await makeService({ offer: { palletExchange: true } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'PALLET_EXCHANGE').level).toBe('MEDIUM');
  });

  it('pallet type and count go into the message when known', async () => {
    const r = await makeService({
      offer: { palletExchange: true, palletExchangeType: 'EUR', palletCount: 33 },
    }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'PALLET_EXCHANGE').message).toContain('(EUR)');
    expect(findRisk(r, 'PALLET_EXCHANGE').message).toContain('33 szt.');
  });

  it('NULL type and count stay out of the message', async () => {
    const r = await makeService({
      offer: { palletExchange: true, palletExchangeType: null, palletCount: null },
    }).analyzeRisk('off-1', 'comp-1');

    const msg = findRisk(r, 'PALLET_EXCHANGE').message;
    expect(msg).not.toContain('null');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('()');
  });
});

describe('d) ADR', () => {
  it('ADR cargo without an ADR vehicle gives two HIGH risks', async () => {
    const r = await makeService({
      offer: { isAdr: true, adrClass: '3' },
      vehicles: [{ vehicleType: 'TRUCK', adrClasses: [] }],
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toEqual(expect.arrayContaining(['ADR_CARGO', 'NO_ADR_VEHICLE']));
    expect(findRisk(r, 'ADR_CARGO').message).toContain('klasa 3');
  });

  it('a vehicle with ADR classes removes the no-ADR-vehicle risk', async () => {
    const r = await makeService({
      offer: { isAdr: true },
      vehicles: [{ vehicleType: 'TRUCK', hasAdr: true, adrClasses: ['3'] }],
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('ADR_CARGO');
    expect(riskTypes(r)).not.toContain('NO_ADR_VEHICLE');
  });

  it('an empty fleet counts as no ADR vehicle', async () => {
    const r = await makeService({ offer: { isAdr: true }, vehicles: [] }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('NO_ADR_VEHICLE');
  });
});

describe('e) reefer', () => {
  it('the reefer flag without a reefer in the fleet gives a HIGH risk', async () => {
    const r = await makeService({
      offer: { isFrigo: true },
      vehicles: [{ vehicleType: 'TRUCK', adrClasses: [] }],
    }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'NO_FRIGO_VEHICLE').level).toBe('HIGH');
  });

  it('a temperature alone makes the load a reefer load', async () => {
    const r = await makeService({
      offer: { isFrigo: false, temperatureMin: 2, temperatureMax: 8 },
      vehicles: [],
    }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'NO_FRIGO_VEHICLE').message).toContain('2°C / 8°C');
  });

  it('0°C is a value, not missing data', async () => {
    const r = await makeService({
      offer: { isFrigo: false, temperatureMin: 0, temperatureMax: 0 },
      vehicles: [],
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('NO_FRIGO_VEHICLE');
  });

  it('a reefer in the fleet removes the risk', async () => {
    const r = await makeService({
      offer: { isFrigo: true },
      vehicles: [{ vehicleType: 'REFRIGERATED', adrClasses: [] }],
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('NO_FRIGO_VEHICLE');
  });
});

describe('f) required carrier liability insurance (OCP)', () => {
  it('a positive minimum gives a MEDIUM risk', async () => {
    const r = await makeService({ offer: { requiredInsuranceMin: 100000 } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'INSURANCE_REQUIREMENT').level).toBe('MEDIUM');
  });

  it('NULL creates no risk', async () => {
    const r = await makeService({ offer: { requiredInsuranceMin: null } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('INSURANCE_REQUIREMENT');
  });

  it('zero creates no risk — no requirement is not a zero requirement', async () => {
    const r = await makeService({ offer: { requiredInsuranceMin: 0 } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('INSURANCE_REQUIREMENT');
  });
});

describe('g) payment term', () => {
  it.each([
    [91, 'HIGH'],
    [120, 'HIGH'],
  ])('a %i-day term gives %s', async (termDays, expectedLevel) => {
    const r = await makeService({ offer: { paymentTermDays: termDays } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'LONG_PAYMENT_TERM').level).toBe(expectedLevel);
  });

  it.each([[61], [90]])('a %i-day term gives MEDIUM', async (termDays) => {
    const r = await makeService({ offer: { paymentTermDays: termDays } }).analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'LONG_PAYMENT_TERM').level).toBe('MEDIUM');
  });

  it('a 60-day term (the threshold) is not a risk', async () => {
    const r = await makeService({ offer: { paymentTermDays: 60 } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('LONG_PAYMENT_TERM');
  });

  it('NULL creates no risk', async () => {
    const r = await makeService({ offer: { paymentTermDays: null } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('LONG_PAYMENT_TERM');
  });
});

describe('h) international transport', () => {
  it('PL -> DE gives a LOW risk with the direction in the message', async () => {
    const r = await makeService({ offer: { pickupCountry: 'PL', deliveryCountry: 'DE' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'INTERNATIONAL_TRANSPORT').level).toBe('LOW');
    expect(findRisk(r, 'INTERNATIONAL_TRANSPORT').message).toContain('PL→DE');
  });

  it('lower-case country codes are normalized', async () => {
    const r = await makeService({ offer: { pickupCountry: 'pl', deliveryCountry: 'de' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('INTERNATIONAL_TRANSPORT');
  });

  it('domestic transport is not a risk', async () => {
    const r = await makeService({ offer: { pickupCountry: 'PL', deliveryCountry: 'PL' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('INTERNATIONAL_TRANSPORT');
  });

  it('a destination outside the EU does not trigger the cabotage rule', async () => {
    const r = await makeService({ offer: { pickupCountry: 'PL', deliveryCountry: 'UA' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('INTERNATIONAL_TRANSPORT');
  });

  it('NULL countries do not break the rule', async () => {
    const r = await makeService({ offer: { pickupCountry: null, deliveryCountry: null } })
      .analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).not.toContain('INTERNATIONAL_TRANSPORT');
  });
});

describe('no vehicle-document rule', () => {
  // An offer has no assigned vehicle; the rule read one from the removed
  // OfferAnalysis table, which nothing filled. Document expiry is reported
  // per vehicle by GET /vehicles/expiring.
  it('risk analysis reads only the offer and the fleet', async () => {
    const service = makeService({ offer: { pickupDate: new Date('2026-06-01') } });
    const touched: string[] = [];
    const record = (target: any, prefix: string): any => new Proxy(target, {
      get(t, key) {
        if (typeof key !== 'string' || key === 'then') return t[key];
        const path = prefix ? `${prefix}.${key}` : key;
        touched.push(path);
        const value = t[key] ?? {};
        return typeof value === 'object' && !prefix ? record(value, path) : value;
      },
    });
    (service as any).prisma = record((service as any).prisma, '');

    const r = await service.analyzeRisk('off-1', 'comp-1');

    expect([...new Set(touched)].sort()).toEqual(['offer', 'offer.findFirst', 'vehicle', 'vehicle.findMany']);
    expect(riskTypes(r)).not.toContain('VEHICLE_DOCS_EXPIRY');
  });
});

describe('i) risk phrase scanning in the text', () => {
  it('a phrase in notes creates a risk with the category in the type name', async () => {
    const r = await makeService({ offer: { notes: 'Obowiazuje kara umowna za zwloke.' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'KEYWORD_PENALTY_RISK').level).toBe('HIGH');
    expect(findRisk(r, 'KEYWORD_PENALTY_RISK').details).toContain('kara umowna');
  });

  it('matching is case-insensitive', async () => {
    const r = await makeService({ offer: { notes: 'KARA UMOWNA' } }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('KEYWORD_PENALTY_RISK');
  });

  it('phrases of one category merge into one risk', async () => {
    const r = await makeService({ offer: { notes: 'kara umowna oraz odszkodowanie' } })
      .analyzeRisk('off-1', 'comp-1');

    const keywordRisks = r.risks.filter((x) => x.type === 'KEYWORD_PENALTY_RISK');
    expect(keywordRisks).toHaveLength(1);
    expect(keywordRisks[0].details).toContain('kara umowna');
    expect(keywordRisks[0].details).toContain('odszkodowanie');
  });

  it('the order of phrases in the text does not decide — a category with a HIGH phrase is HIGH', async () => {
    // 'reklamacja' = MEDIUM comes first in the text, but phrases are checked in
    // the order of RISK_KEYWORDS, where 'kara umowna' (HIGH) is earlier — the
    // category starts HIGH. This test does NOT reach the raise step (see below).
    const r = await makeService({ offer: { notes: 'reklamacja, a takze kara umowna' } })
      .analyzeRisk('off-1', 'comp-1');

    expect(findRisk(r, 'KEYWORD_PENALTY_RISK').level).toBe('HIGH');
  });

  describe('raising a category to the highest level found', () => {
    // In the list 'okno czasowe' (MEDIUM) and 'awizacja' (LOW) come BEFORE
    // 'fix termin' (HIGH) in the same TIME_WINDOW category — the category
    // starts lower and must be raised.
    it('MEDIUM, then HIGH: level HIGH, the HIGH phrase message, both phrases in details', async () => {
      const r = await makeService({ offer: { notes: 'fix termin, okno czasowe 8-10' } })
        .analyzeRisk('off-1', 'comp-1');

      const risk = findRisk(r, 'KEYWORD_TIME_WINDOW');
      expect(risk.level).toBe('HIGH');
      expect(risk.message).toMatch(/Termin FIX/);
      expect(risk.details).toContain('okno czasowe');
      expect(risk.details).toContain('fix termin');
      expect(r.risks.filter((x) => x.type === 'KEYWORD_TIME_WINDOW')).toHaveLength(1);
    });

    it('LOW, then HIGH: level HIGH', async () => {
      const r = await makeService({ offer: { notes: 'awizacja wymagana, fix termin' } })
        .analyzeRisk('off-1', 'comp-1');

      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').level).toBe('HIGH');
      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').message).toMatch(/Termin FIX/);
    });

    it('LOW, then MEDIUM: level MEDIUM with the MEDIUM phrase message', async () => {
      // 'awizacja' (LOW) is listed before 'slot' (MEDIUM).
      const r = await makeService({ offer: { notes: 'awizacja i slot 10:00' } })
        .analyzeRisk('off-1', 'comp-1');

      const risk = findRisk(r, 'KEYWORD_TIME_WINDOW');
      expect(risk.level).toBe('MEDIUM');
      expect(risk.message).toMatch(/Wymagany slot/);
      expect(risk.details).toContain('awizacja');
      expect(risk.details).toContain('slot');
    });

    it('LOW, MEDIUM and HIGH: level HIGH with the HIGH phrase message', async () => {
      const r = await makeService({ offer: { notes: 'awizacja, slot, fix termin' } })
        .analyzeRisk('off-1', 'comp-1');

      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').level).toBe('HIGH');
      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').message).toMatch(/Termin FIX/);
    });

    it('LOW phrases only: level LOW with the first one\'s message', async () => {
      const r = await makeService({ offer: { notes: 'rampa nr 3, awizacja dzien wczesniej' } })
        .analyzeRisk('off-1', 'comp-1');

      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').level).toBe('LOW');
      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').message).toMatch(/awizacja/i);
    });

    it('without a HIGH phrase the level stays (MEDIUM with the first phrase message)', async () => {
      const r = await makeService({ offer: { notes: 'okno czasowe, slot 10:00' } })
        .analyzeRisk('off-1', 'comp-1');

      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').level).toBe('MEDIUM');
      expect(findRisk(r, 'KEYWORD_TIME_WINDOW').message).toMatch(/okno czasowe/);
    });
  });

  it('a phrase in specialRequirements is found too', async () => {
    const r = await makeService({
      offer: { notes: null, specialRequirements: 'kara umowna', penaltyClauses: null },
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r)).toContain('KEYWORD_PENALTY_RISK');
  });

  it('NULL text fields give no matches', async () => {
    const r = await makeService({
      offer: { notes: null, specialRequirements: null, penaltyClauses: null },
    }).analyzeRisk('off-1', 'comp-1');

    expect(riskTypes(r).filter((t) => t.startsWith('KEYWORD_'))).toEqual([]);
  });
});

describe('overall result', () => {
  it('no risks = LOW and safe', async () => {
    const r = await makeService().analyzeRisk('off-1', 'comp-1');

    expect(r.totalRiskScore).toBe('LOW');
    expect(r.safeToAccept).toBe(true);
  });

  it('only MEDIUM = MEDIUM, still safe', async () => {
    const r = await makeService({ offer: { paymentTermDays: 75 } }).analyzeRisk('off-1', 'comp-1');

    expect(r.totalRiskScore).toBe('MEDIUM');
    expect(r.safeToAccept).toBe(true);
  });

  it('one HIGH = HIGH and no longer safe', async () => {
    const r = await makeService({ offer: { penaltyClauses: 'kara' } }).analyzeRisk('off-1', 'comp-1');

    expect(r.totalRiskScore).toBe('HIGH');
    expect(r.safeToAccept).toBe(false);
  });

  it('three or more HIGH risks raise the result to CRITICAL', async () => {
    const r = await makeService({
      offer: { penaltyClauses: 'kara umowna', loadingTimeWindow: 30, isAdr: true },
      vehicles: [],
    }).analyzeRisk('off-1', 'comp-1');

    expect(r.totalRiskScore).toBe('CRITICAL');
    expect(r.safeToAccept).toBe(false);
  });

  it('analyzedAt is an ISO timestamp', async () => {
    const r = await makeService().analyzeRisk('off-1', 'comp-1');

    expect(r.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
