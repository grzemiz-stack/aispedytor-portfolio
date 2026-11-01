/**
 * Forms: "Przypisz do mnie", the new offer, the vehicle edit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { offerStatusRequest } from './offer-status';
import { offerFormErrors, offerPayload } from './offer-form';
import { vehicleFormErrors, vehiclePayload } from './vehicle-payload';
import { messageText } from './plan-messages';

const read = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('"Przypisz do mnie" assigns the person', () => {
  it('ASSIGNED → the assign route with the logged-in user, no status body', () => {
    expect(offerStatusRequest('o1', 'ASSIGNED', 'u1')).toEqual({ url: '/offers/o1/assign/u1' });
  });
  it('no logged-in user → nothing to send', () => {
    expect(offerStatusRequest('o1', 'ASSIGNED', null)).toBeNull();
  });
  it('other statuses → /status as before', () => {
    expect(offerStatusRequest('o1', 'ACCEPTED', 'u1')).toEqual({ url: '/offers/o1/status', body: { status: 'ACCEPTED' } });
  });
  it('both offer screens go through offerStatusRequest; no screen sends ASSIGNED to /status', () => {
    for (const f of ['app/(dashboard)/offers/page.tsx', 'app/(dashboard)/offers/[id]/page.tsx']) {
      const src = read(f);
      expect([f, /offerStatusRequest\(/.test(src), /patch\(`\/offers\/\$\{[^}]+\}\/status`/.test(src)]).toEqual([f, true, false]);
    }
  });
  it('the API refusal reads as a sentence', () => {
    expect(messageText({ code: 'OFFER_ASSIGN_VIA_ASSIGN' })).toMatch(/Przypisz do mnie/);
  });
});

describe('the new offer form', () => {
  const FORM: Record<string, string> = {
    pickupCity: 'Poznań', pickupCountry: 'PL', pickupPostal: '', pickupDate: '2030-10-12', deliveryCity: 'Berlin', deliveryCountry: 'DE',
    deliveryPostal: '', deliveryDate: '', cargoType: '', weightKg: '', volumeM3: '', price: '100', currency: 'EUR', distanceKm: '300',
    fuelCostEstimate: '50', tollCostEstimate: '20', notes: '', clientName: '', contactEmail: '', contactPhone: '', penaltyClauses: '',
    loadingTimeWindow: '', unloadingTimeWindow: '', palletExchangeType: '', palletCount: '', adrClass: '', temperatureMin: '',
    temperatureMax: '', requiredInsuranceMin: '', paymentTermDays: '', specialRequirements: '',
  };
  const BOOLS = { palletExchange: false, isAdr: false, isFrigo: false };

  it('the body has no computed fields (the API computes the rate per km); the toll typed in stays, fuel is gone', () => {
    const body = offerPayload(FORM, BOOLS);
    for (const f of ['pricePerKm', 'totalCostEstimate', 'profitEstimate', 'profitMarginPercent', 'fuelCostEstimate']) expect(body).not.toHaveProperty(f);
    expect([body.price, body.distanceKm, body.tollCostEstimate]).toEqual([100, 300, 20]);
  });

  it.each([
    ['empty', ''],
    ['not a day', '2030-02-31'],
    ['not a date', 'jutro'],
  ])('the pickup date is checked: %s → an error on the form', (_n, value) => {
    expect(offerFormErrors({ ...FORM, pickupDate: value })).toHaveProperty('pickupDate');
  });

  it('a valid form has no errors', () => {
    expect(offerFormErrors(FORM)).toEqual({});
  });

  it('the API error is shown through apiErrorText (codes and message arrays), not a raw array', () => {
    const page = read('app/(dashboard)/offers/new/page.tsx');
    expect(page).toMatch(/setError\(apiErrorText\(err\?\.response\?\.data, /);
    expect(page).toMatch(/apiClient\.post\('\/offers', offerPayload\(form, bools\)\)/);
  });
});

describe('editing a vehicle clears fields', () => {
  const FORM = {
    plateNumber: 'PO 12345', licensePlate: '', ocrNumber: '', brand: '', model: '', vin: '', year: '', vehicleType: 'TRUCK',
    vehicleCategory: 'SEMI_TRAILER', trailerType: '', parentVehicleId: '', maxWeightKg: '', grossVehicleWeightKg: '', curbWeightKg: '',
    maxVolumeM3: '', maxLoadingMeters: '', maxPalletCount: '', axleCount: '', lengthM: '', heightM: '', widthM: '', hasAdr: false,
    hasGps: false, technicalInspectionFrom: '', technicalInspectionTo: '', insuranceFrom: '', insuranceTo: '',
    tachographLegalizationFrom: '', tachographLegalizationTo: '', plannedMaintenanceDate: '', plannedMaintenanceNotes: '',
    fuelCardType: '', fuelCardLast4: '', fuelCardExpiry: '', notes: '',
  };
  const CLEARABLE = ['licensePlate', 'ocrNumber', 'brand', 'model', 'vin', 'year', 'trailerType', 'parentVehicleId', 'maxWeightKg',
    'grossVehicleWeightKg', 'curbWeightKg', 'maxVolumeM3', 'maxLoadingMeters', 'maxPalletCount', 'axleCount',
    'technicalInspectionFrom', 'technicalInspectionTo', 'insuranceFrom', 'insuranceTo', 'tachographLegalizationFrom',
    'tachographLegalizationTo', 'plannedMaintenanceDate', 'plannedMaintenanceNotes', 'fuelCardType', 'fuelCardLast4', 'fuelCardExpiry', 'notes'];

  it('edit: every cleared optional field is sent as null (the API clears it)', () => {
    const body = vehiclePayload(FORM, 'edit');
    expect(CLEARABLE.filter((k) => body[k] !== null)).toEqual([]);
  });

  it('new vehicle: empty fields are left out, as before', () => {
    const body = vehiclePayload(FORM, 'new');
    expect(CLEARABLE.filter((k) => body[k] !== undefined)).toEqual([]);
  });

  it('values are sent as values (0 kg curb weight is a value)', () => {
    const body = vehiclePayload({ ...FORM, parentVehicleId: 'v9', curbWeightKg: '0', insuranceTo: '2031-01-01', vin: 'WDB123' }, 'edit');
    expect([body.parentVehicleId, body.curbWeightKg, body.insuranceTo, body.vin]).toEqual(['v9', 0, '2031-01-01', 'WDB123']);
  });

  it.each([['plateNumber'], ['vehicleType']])('the required %s cleared in edit → an error on the form, not null', (key) => {
    expect(vehicleFormErrors({ ...FORM, [key]: '' })).toHaveProperty(key);
  });

  it('the form submits through vehiclePayload and vehicleFormErrors', () => {
    const src = read('app/(dashboard)/fleet/_components/vehicle-form.tsx');
    expect(src).toMatch(/const payload = vehiclePayload\(form, mode\);/);
    expect(src).toMatch(/const newErrors = vehicleFormErrors\(form\);/);
    expect(src).not.toMatch(/\|\| undefined/);
  });
});
