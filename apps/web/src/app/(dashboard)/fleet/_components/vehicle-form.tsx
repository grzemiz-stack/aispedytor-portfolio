'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { VEHICLE_CATEGORIES, isTowed, vehicleCategoryIcon, vehicleCategoryLabel } from '@/lib/vehicle-categories';
import { messageText } from '@/lib/plan-messages';
import { VEHICLE_RULES as RULES, validateVehicleField as validate, vehicleFormErrors, vehiclePayload } from '@/lib/vehicle-payload';
import { ADR_CLASSES, otherAdrEntries, toggleAdrClass } from '@/lib/adr-classes';

interface ParentVehicle {
  id: string;
  plateNumber: string;
  brand: string | null;
  model: string | null;
}

// ─── Validation ─────────────────────────────────────────────────────────────


// ─── Component ──────────────────────────────────────────────────────────────

export const INITIAL_FORM = {
  plateNumber: '',
  licensePlate: '',
  ocrNumber: '',
  brand: '',
  model: '',
  vin: '',
  year: '',
  vehicleType: 'TRUCK',
  vehicleCategory: 'TRUCK',
  trailerType: '',
  parentVehicleId: '',
  maxWeightKg: '',
  grossVehicleWeightKg: '',
  curbWeightKg: '',
  maxVolumeM3: '',
  maxLoadingMeters: '',
  maxPalletCount: '',
  axleCount: '',
  lengthM: '',
  heightM: '',
  widthM: '',
  hasAdr: false,
  adrClasses: [] as string[],
  hasGps: false,
  fuelCardType: '',
  fuelCardLast4: '',
  fuelCardExpiry: '',
  technicalInspectionFrom: '',
  technicalInspectionTo: '',
  insuranceFrom: '',
  insuranceTo: '',
  tachographLegalizationFrom: '',
  tachographLegalizationTo: '',
  plannedMaintenanceDate: '',
  plannedMaintenanceNotes: '',
  notes: '',
};

export function VehicleForm({
  mode,
  initialData,
  vehicleId,
}: {
  mode: 'new' | 'edit';
  initialData?: Partial<typeof INITIAL_FORM>;
  vehicleId?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ ...INITIAL_FORM, ...initialData });
  const [tractors, setTractors] = useState<ParentVehicle[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const isTrailer = isTowed(form.vehicleCategory);

  // The "what can I attach to" list comes from the API — the attachment rule
  // lives on the server: semi-trailer → tractor, drawbar trailer → rigid or van.
  // The response is paginated ({ data, meta }), so the vehicles are in r.data.data.
  useEffect(() => {
    if (isTrailer) {
      apiClient
        .get(`/vehicles?parentFor=${form.vehicleCategory}&limit=100`)
        .then((r) => setTractors(r.data.data ?? []))
        .catch(() => setTractors([]));
    }
  }, [isTrailer, form.vehicleCategory]);

  function set(key: string, value: string | boolean | string[]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function handleBlur(key: string) {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const err = validate(key, String((form as any)[key] ?? ''));
    if (err) setErrors((prev) => ({ ...prev, [key]: err }));
    else setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  const hasErrors = useMemo(() => {
    const plateErr = validate('plateNumber', form.plateNumber);
    return !!plateErr || Object.keys(errors).length > 0;
  }, [form.plateNumber, errors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Every rule — also required fields cleared in edit.
    const newErrors = vehicleFormErrors(form);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched(Object.fromEntries(Object.keys(newErrors).map((k) => [k, true])));
      return;
    }

    setError('');
    setLoading(true);
    try {
      // Edit: a cleared field = null (lib/vehicle-payload.ts).
      const payload = vehiclePayload(form, mode);

      if (mode === 'edit' && vehicleId) {
        await apiClient.patch(`/vehicles/${vehicleId}`, payload);
        router.push(`/fleet/${vehicleId}`);
      } else {
        await apiClient.post('/vehicles', payload);
        router.push('/fleet');
      }
    } catch (err: any) {
      // An attachment-rule error comes as a code — a sentence from the dictionary.
      const data = err.response?.data;
      setError(data?.code ? messageText(data) : data?.message ?? 'Błąd podczas zapisywania pojazdu');
    } finally {
      setLoading(false);
    }
  }

  const field = (label: string, key: string, type = 'text', placeholder = '', hint = '') => {
    const rule = RULES[key];
    const err = touched[key] ? errors[key] : undefined;
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
          type={type}
          value={(form as any)[key]}
          onChange={(e) => set(key, e.target.value)}
          onBlur={() => handleBlur(key)}
          placeholder={placeholder}
          {...(type === 'number' && rule?.min !== undefined ? { min: rule.min } : {})}
          {...(type === 'number' && rule?.max !== undefined ? { max: rule.max } : {})}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
            err ? 'border-red-400 ring-1 ring-red-200' : 'border-gray-300'
          }`}
        />
        {err ? (
          <p className="text-xs text-red-500 mt-1">{err}</p>
        ) : hint ? (
          <p className="text-xs text-gray-500 mt-1">{hint}</p>
        ) : null}
      </div>
    );
  };

  const chk = (label: string, key: string, description?: string) => (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={(form as any)[key] as boolean}
        onChange={(e) => set(key, e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <div>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
    </label>
  );

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{mode === 'edit' ? 'Edytuj pojazd' : 'Nowy pojazd'}</h1>
        <p className="text-sm text-gray-500 mt-1">{mode === 'edit' ? 'Zaktualizuj dane pojazdu' : 'Dodaj pojazd do floty'}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dane pojazdu */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Dane pojazdu</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Numer rejestracyjny *', 'plateNumber', 'text', 'np. WA 12345')}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kategoria pojazdu</label>
              <select
                value={form.vehicleCategory}
                onChange={(e) => set('vehicleCategory', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {VEHICLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{vehicleCategoryIcon(c)} {vehicleCategoryLabel(c)}</option>
                ))}
              </select>
            </div>
          </div>

          {isTrailer && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.vehicleCategory === 'SEMI_TRAILER' ? 'Przypisany ciągnik (opcjonalnie)' : 'Przypisana solówka lub bus (opcjonalnie)'}
              </label>
              <select
                value={form.parentVehicleId}
                onChange={(e) => set('parentVehicleId', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— brak —</option>
                {tractors.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plateNumber}{t.brand ? ` — ${t.brand} ${t.model ?? ''}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typ pojazdu</label>
              <select
                value={form.vehicleType}
                onChange={(e) => set('vehicleType', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="TRUCK">Ciężarówka</option>
                <option value="VAN">Van</option>
                <option value="MEGA">Mega</option>
                <option value="STANDARD">Standard</option>
                <option value="REFRIGERATED">Chłodnia</option>
              </select>
              {errors.vehicleType && <p className="text-xs text-red-500 mt-1">{errors.vehicleType}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Typ nadwozia</label>
              <select
                value={form.trailerType}
                onChange={(e) => set('trailerType', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— brak —</option>
                <option value="CURTAIN">Firanka</option>
                <option value="BOX">Skrzynia</option>
                <option value="REEFER">Chłodnia</option>
                <option value="FLATBED">Platforma</option>
                <option value="TANKER">Cysterna</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Marka', 'brand', 'text', 'np. Volvo')}
            {field('Model', 'model', 'text', 'np. FH16')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field('VIN', 'vin')}
            {field('Rok produkcji', 'year', 'number')}
            {field('Liczba osi', 'axleCount', 'number', '', 'Osie tego pojazdu, nie całego zestawu: ciągnik zwykle 2, naczepa zwykle 3')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Nr dowodu rej. (OCR)', 'ocrNumber')}
            {field('Nr rej. dodatkowy', 'licensePlate')}
          </div>
        </div>

        {/* Payload and dimensions */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Ładowność i wymiary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Max masa (kg)', 'maxWeightKg', 'number', '', 'Ładowność — ile wolno załadować, bez masy pojazdu')}
            {field('Max objętość (m³)', 'maxVolumeM3', 'number')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field(
              'DMC zestawu (kg)',
              'grossVehicleWeightKg',
              'number',
              'np. 40000',
              'Dopuszczalna masa całkowita — dowód rejestracyjny, pole F.2',
            )}
            {field(
              'Masa własna (kg)',
              'curbWeightKg',
              'number',
              'np. 16500',
              'Masa pustego zestawu — dowód rejestracyjny, pole G',
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Metry ładunkowe (m)', 'maxLoadingMeters', 'number', 'np. 13.6')}
            {field('Max palety (szt.)', 'maxPalletCount', 'number')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {field('Długość (m)', 'lengthM', 'number')}
            {field('Wysokość (m)', 'heightM', 'number')}
            {field('Szerokość (m)', 'widthM', 'number')}
          </div>
          <div className="flex gap-6 pt-2">
            {chk('Certyfikat ADR', 'hasAdr', 'Pojazd dopuszczony do przewozu materiałów niebezpiecznych')}
            {chk('GPS Tracker', 'hasGps', 'Pojazd wyposażony w urządzenie GPS')}
          </div>
          {form.hasAdr && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Klasy ADR</p>
              <p className="text-xs text-gray-500 mb-2">
                Dopasowanie przepuści ofertę ADR tylko z zaznaczonymi klasami. Bez zaznaczonych — oferta ADR z klasą nie przejdzie.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ADR_CLASSES.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.adrClasses.includes(c)}
                      onChange={(e) => set('adrClasses', toggleAdrClass(form.adrClasses, c, e.target.checked))}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    {c}
                  </label>
                ))}
              </div>
              {otherAdrEntries(form.adrClasses).length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Inne zapisane wpisy (zostają): {otherAdrEntries(form.adrClasses).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Dokumenty i terminy */}
        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Dokumenty i terminy</h2>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Przegląd techniczny</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Data od', 'technicalInspectionFrom', 'date')}
              {field('Data do', 'technicalInspectionTo', 'date')}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Ubezpieczenie OC/AC</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Data od', 'insuranceFrom', 'date')}
              {field('Data do', 'insuranceTo', 'date')}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Legalizacja tachografu</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('Data od', 'tachographLegalizationFrom', 'date')}
              {field('Data do', 'tachographLegalizationTo', 'date')}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Karta paliwowa</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Typ karty</label>
                <select
                  value={form.fuelCardType}
                  onChange={(e) => set('fuelCardType', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">— brak —</option>
                  {['Shell', 'BP', 'Orlen', 'DKV', 'E100', 'Inne'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ostatnie 4 cyfry</label>
                <input
                  type="text"
                  maxLength={4}
                  value={form.fuelCardLast4}
                  onChange={(e) => set('fuelCardLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="np. 1234"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              {field('Data ważności', 'fuelCardExpiry', 'date')}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Planowany serwis</p>
            {field('Data serwisu', 'plannedMaintenanceDate', 'date')}
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Opis planowanego serwisu</label>
              <textarea
                value={form.plannedMaintenanceNotes}
                onChange={(e) => set('plannedMaintenanceNotes', e.target.value)}
                placeholder="np. Wymiana opon, serwis hamulców..."
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Uwagi */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">Uwagi</h2>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Dodatkowe informacje o pojeździe..."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || hasErrors}
            className="bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : mode === 'edit' ? 'Zapisz zmiany' : 'Dodaj pojazd'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 rounded-xl text-sm font-medium border border-gray-300 hover:bg-gray-50 transition"
          >
            Anuluj
          </button>
        </div>
      </form>
    </div>
  );
}
