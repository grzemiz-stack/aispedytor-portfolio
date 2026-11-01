'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { VehicleForm } from '../../_components/vehicle-form';

function toDateStr(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function EditVehiclePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [initialData, setInitialData] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    apiClient.get(`/vehicles/${id}`).then((r) => {
      const v = r.data;
      setInitialData({
        plateNumber: v.plateNumber ?? '',
        licensePlate: v.licensePlate ?? '',
        ocrNumber: v.ocrNumber ?? '',
        brand: v.brand ?? '',
        model: v.model ?? '',
        vin: v.vin ?? '',
        year: v.year?.toString() ?? '',
        vehicleType: v.vehicleType ?? 'TRUCK',
        vehicleCategory: v.vehicleCategory ?? 'TRUCK',
        trailerType: v.trailerType ?? '',
        parentVehicleId: v.parentVehicleId ?? '',
        maxWeightKg: v.maxWeightKg?.toString() ?? '',
        // `?.toString()` keeps zero: (0)?.toString() === '0'.
        grossVehicleWeightKg: v.grossVehicleWeightKg?.toString() ?? '',
        curbWeightKg: v.curbWeightKg?.toString() ?? '',
        maxVolumeM3: v.maxVolumeM3?.toString() ?? '',
        maxLoadingMeters: v.maxLoadingMeters?.toString() ?? '',
        maxPalletCount: v.maxPalletCount?.toString() ?? '',
        axleCount: v.axleCount?.toString() ?? '',
        lengthM: v.lengthM?.toString() ?? '',
        heightM: v.heightM?.toString() ?? '',
        widthM: v.widthM?.toString() ?? '',
        hasAdr: v.hasAdr ?? false,
        adrClasses: Array.isArray(v.adrClasses) ? v.adrClasses : [],
        hasGps: v.hasGps ?? false,
        fuelCardType: v.fuelCardType ?? '',
        fuelCardLast4: v.fuelCardLast4 ?? '',
        fuelCardExpiry: toDateStr(v.fuelCardExpiry),
        technicalInspectionFrom: toDateStr(v.technicalInspectionFrom),
        technicalInspectionTo: toDateStr(v.technicalInspectionTo),
        insuranceFrom: toDateStr(v.insuranceFrom),
        insuranceTo: toDateStr(v.insuranceTo),
        tachographLegalizationFrom: toDateStr(v.tachographLegalizationFrom),
        tachographLegalizationTo: toDateStr(v.tachographLegalizationTo),
        plannedMaintenanceDate: toDateStr(v.plannedMaintenanceDate),
        plannedMaintenanceNotes: v.plannedMaintenanceNotes ?? '',
        notes: v.notes ?? '',
      });
    }).catch(() => router.push('/fleet'));
  }, [id, router]);

  if (!initialData) return <p className="text-sm text-gray-400 py-12 text-center">Ładowanie...</p>;

  return <VehicleForm mode="edit" initialData={initialData} vehicleId={id} />;
}
