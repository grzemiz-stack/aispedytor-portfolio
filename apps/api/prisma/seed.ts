import 'dotenv/config';
import { refuseSeedOutsideDevOrTest } from './seed-guard';
import { extraSeedVehicles } from './seed-vehicles';
import { SEED_DRIVERS, seedDriverStatuses } from './seed-drivers';
import { seedDemoLtl, DEMO_LTL_PREFIX } from './seed-demo-ltl';
import { coordsOnly, refreshSeedCoords, withCoords } from './seed-cities';
import { requireEncryptionKey } from '../src/common/config/secrets';
import { economicsWithRate } from '../src/offers/offer-economics';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

// First statement: outside an explicit NODE_ENV=development|test the seed stops
// here, before it touches the database and the encryption key (prisma/seed-guard.ts).
refuseSeedOutsideDevOrTest();

const prisma = new PrismaClient();

// ─── AES-256-GCM helpers ──────────────────────────────────────────────────────
// The same key as the application and the same rule: no all-zero fallback
// value — otherwise the seed would encrypt data with a key the application rejects.
const ENCRYPTION_KEY = requireEncryptionKey(process.env.ENCRYPTION_KEY);

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function emailHash(email: string): string {
  return crypto
    .createHmac('sha256', ENCRYPTION_KEY)
    .update(email.toLowerCase())
    .digest('hex');
}

/** The seed company cost per km (company.upsert below) — the same number. */
const SEED_COMPANY_RATE = { costPerKm: 4.2, costCurrency: 'PLN' };

/**
 * The demo offer's money fields. Cost, profit and margin with the same
 * function as the API (offers/offer-economics.ts): the company cost per km ×
 * km + the offer toll (as a manual toll). Fuel stays only as an informational
 * offer field — it is not part of the cost.
 */
function calcCosts(price: number, distanceKm: number, currency = 'EUR') {
  const fuelCostEstimate = Math.round(distanceKm * 0.35 * 100) / 100;
  const tollCostEstimate = Math.round(distanceKm * 0.15 * 100) / 100;
  const pricePerKm = Math.round((price / distanceKm) * 100) / 100;
  const economics = economicsWithRate({ price, currency, distanceKm, tollCostEstimate }, SEED_COMPANY_RATE);
  return { fuelCostEstimate, tollCostEstimate, pricePerKm, ...economics };
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(8, 0, 0, 0);
  return d;
}

/**
 * Clock of the LTL demo scenario. Now by default; `SEED_NOW` (ISO) moves it —
 * the Docker test checks the demo "on any day" (tools/demo-test.sh).
 */
function seedNow(): Date {
  const raw = process.env.SEED_NOW;
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`SEED_NOW is not a date: ${raw}`);
  return d;
}

async function main() {
  console.log('🌱 Seeding database...');

  // ── 1. Test company ───────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { id: 'seed-company-001' },
    update: {},
    create: {
      id: 'seed-company-001',
      name: 'SpedycjaPlus Sp. z o.o.',
      taxId: '1234567890',
      subscriptionPlan: 'PRO',
      maxDispatchers: 20,
      // The demo shows profit and a threshold price. Without a cost per km the LTL ranking uses revenue (docs/decisions.md §3).
      costPerKm: 4.2,
      costCurrency: 'PLN',
      settings: {
        timezone: 'Europe/Warsaw',
        currency: 'PLN',
        defaultCountry: 'PL',
      },
    },
  });
  console.log(`✅ Company: ${company.name}`);

  // ── 2. Admin ───────────────────────────────────────────────────────────────
  const adminEmail = 'admin@spedytor.example.com';
  const adminHash = emailHash(adminEmail);
  await prisma.user.upsert({
    where: { emailHash: adminHash },
    update: {},
    create: {
      companyId: company.id,
      emailEncrypted: encrypt(adminEmail),
      emailHash: adminHash,
      passwordHash: await bcrypt.hash('Admin1234!', 12),
      firstNameEncrypted: encrypt('Jan'),
      lastNameEncrypted: encrypt('Admin'),
      phoneEncrypted: encrypt('+48 600 000 000'),
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`✅ Admin: ${adminEmail}`);

  // ── 3. Dispatchers ────────────────────────────────────────────────────────
  const dispatchers = [
    { email: 'jan.kowalski@spedytor.example.com', first: 'Jan',  last: 'Kowalski', phone: '+48 601 111 222' },
    { email: 'anna.nowak@spedytor.example.com',   first: 'Anna', last: 'Nowak',    phone: '+48 602 333 444' },
  ];

  const createdDispatchers = [];
  for (const d of dispatchers) {
    const hash = emailHash(d.email);
    const user = await prisma.user.upsert({
      where: { emailHash: hash },
      update: {},
      create: {
        companyId: company.id,
        emailEncrypted: encrypt(d.email),
        emailHash: hash,
        passwordHash: await bcrypt.hash('Disp1234!', 12),
        firstNameEncrypted: encrypt(d.first),
        lastNameEncrypted: encrypt(d.last),
        phoneEncrypted: encrypt(d.phone),
        role: 'DISPATCHER',
        isActive: true,
        preferences: { notifications: true, autoAssign: false },
      },
    });
    createdDispatchers.push(user);
    console.log(`✅ Dispatcher: ${d.email}`);
  }

  // ── 4. Vehicles (skip if already seeded) ──────────────────────────────────
  const vehicleCount = await prisma.vehicle.count({ where: { companyId: company.id } });
  if (vehicleCount === 0) {
    const vehicles = [
      {
        plateNumber: 'WA 12345',
        vehicleType: 'TRUCK' as const,
        trailerType: 'CURTAIN' as const,
        maxWeightKg: 24000,
        maxVolumeM3: 90,
        lengthM: 13.6,
        currentCity: 'Warszawa',
        currentCountry: 'PL',
        status: 'AVAILABLE' as const,
        dispatcherId: createdDispatchers[0].id,
      },
      {
        plateNumber: 'WA 67890',
        vehicleType: 'TRUCK' as const,
        trailerType: 'REEFER' as const,
        maxWeightKg: 22000,
        maxVolumeM3: 85,
        lengthM: 13.6,
        currentCity: 'Łódź',
        currentCountry: 'PL',
        status: 'IN_TRANSIT' as const,
        dispatcherId: createdDispatchers[0].id,
      },
      {
        plateNumber: 'KR 11111',
        vehicleType: 'STANDARD' as const,
        trailerType: 'BOX' as const,
        maxWeightKg: 18000,
        maxVolumeM3: 70,
        lengthM: 13.6,
        currentCity: 'Kraków',
        currentCountry: 'PL',
        status: 'AVAILABLE' as const,
        dispatcherId: createdDispatchers[1].id,
      },
      {
        plateNumber: 'GD 22222',
        vehicleType: 'MEGA' as const,
        trailerType: 'CURTAIN' as const,
        maxWeightKg: 24000,
        maxVolumeM3: 100,
        lengthM: 13.6,
        heightM: 3.0,
        currentCity: 'Gdańsk',
        currentCountry: 'PL',
        status: 'RETURNING' as const,
        dispatcherId: createdDispatchers[1].id,
      },
    ];

    for (const v of vehicles) {
      await prisma.vehicle.create({ data: { companyId: company.id, ...v } });
    }
    console.log(`✅ Vehicles: ${vehicles.length}`);
  } else {
    console.log(`⏭️  Vehicles: already there (${vehicleCount}), skipped`);
  }

  // ── 5. Contractors (skip if already seeded) ───────────────────────────────
  const contractorCount = await prisma.contractor.count({ where: { companyId: company.id } });
  if (contractorCount === 0) {
    const contractors = [
      { name: 'TransLogistic GmbH', taxId: 'DE123456789', country: 'DE', paymentRating: 5, reliabilityScore: 92, avgPaymentDays: 30 },
      { name: 'Freight Masters NL', taxId: 'NL987654321', country: 'NL', paymentRating: 4, reliabilityScore: 78, avgPaymentDays: 45 },
      { name: 'EastCargo Sp. z o.o.', taxId: 'PL5552223', country: 'PL', paymentRating: 3, reliabilityScore: 60, avgPaymentDays: 60, isBlacklisted: false },
    ];
    for (const c of contractors) {
      await prisma.contractor.create({ data: { companyId: company.id, ...c } });
    }
    console.log(`✅ Contractors: ${contractors.length}`);
  } else {
    console.log(`⏭️  Contractors: already there (${contractorCount}), skipped`);
  }

  // ── 6. Sample offers (skip if already seeded) ─────────────────────────────
  const offerCount = await prisma.offer.count({ where: { companyId: company.id } });
  if (offerCount === 0) {
    const firstContractor = await prisma.contractor.findFirst({ where: { companyId: company.id } });
    const secondContractor = await prisma.contractor.findFirst({ where: { companyId: company.id }, skip: 1 });

    const offers = [
      {
        source: 'TRANS_EU' as const,
        externalId: 'TE-001',
        status: 'NEW' as const,
        pickupCity: 'Warszawa', pickupCountry: 'PL', pickupPostal: '00-001',
        deliveryCity: 'Berlin', deliveryCountry: 'DE', deliveryPostal: '10115',
        pickupDate: daysFromNow(1),
        weightKg: 18000, volumeM3: 75, lengthM: 13.0,
        price: 2800, currency: 'EUR', pricePerKm: 1.85,
        cargoType: 'Elektronika',
        contractorId: firstContractor?.id,
        contactEmail: 'dispatch@translogistic.example.com',
        contactPhone: '+49 30 123456',
      },
      {
        source: 'TIMOCOM' as const,
        externalId: 'TC-002',
        status: 'NEW' as const,
        pickupCity: 'Hamburg', pickupCountry: 'DE',
        deliveryCity: 'Warszawa', deliveryCountry: 'PL',
        pickupDate: daysFromNow(1),
        weightKg: 22000, lengthM: 13.6,
        price: 2200, currency: 'EUR', pricePerKm: 1.60,
        cargoType: 'Palety',
        contractorId: secondContractor?.id,
      },
      {
        source: 'MANUAL' as const,
        status: 'ASSIGNED' as const,
        assignedToId: createdDispatchers[0].id,
        assignedAt: new Date(),
        pickupCity: 'Gdańsk', pickupCountry: 'PL',
        deliveryCity: 'Amsterdam', deliveryCountry: 'NL',
        pickupDate: daysFromNow(2),
        isFrigo: true, temperatureMin: 2, temperatureMax: 8,
        weightKg: 15000, volumeM3: 60,
        price: 3500, currency: 'EUR',
        cargoType: 'Produkty spożywcze',
      },
    ];

    for (const o of offers) {
      // Coordinates from one map (seed-cities.ts) — without them LTL does not rank the offer.
      await prisma.offer.create({ data: { companyId: company.id, ...withCoords(o) } });
    }
    console.log(`✅ Base offers: ${offers.length}`);
  } else {
    console.log(`⏭️  Base offers: already there (${offerCount}), skipped`);
  }

  // ── 7. Demo offers (12 routes) ────────────────────────────────────────────
  // Always upsert: creates new ones, overwrites the coordinates of existing
  // ones from the city map (databases seeded before the map had them empty).
  {
    const contractors = await prisma.contractor.findMany({ where: { companyId: company.id } });
    const c0 = contractors[0]?.id;
    const c1 = contractors[1]?.id;
    const c2 = contractors[2]?.id;
    const d0 = createdDispatchers[0].id;
    const d1 = createdDispatchers[1].id;

    type OfferStatus = 'NEW' | 'ASSIGNED' | 'ACCEPTED';
    type OfferSource = 'TRANS_EU' | 'TIMOCOM' | 'TELEROUTE' | 'MANUAL';

    interface DemoRoute {
      externalId: string;
      source: OfferSource;
      status: OfferStatus;
      pickupCity: string; pickupCountry: string;
      deliveryCity: string; deliveryCountry: string;
      pickupDate: Date;
      distanceKm: number;
      price: number;
      currency: string;
      cargoType: string;
      isFrigo?: boolean;
      temperatureMin?: number;
      temperatureMax?: number;
      weightKg: number;
      contractorId?: string;
      assignedToId?: string;
      assignedAt?: Date;
    }

    const demoRoutes: DemoRoute[] = [
      // 1. Warszawa → Berlin, frigo
      {
        externalId: 'DEMO-001', source: 'TRANS_EU', status: 'NEW',
        pickupCity: 'Warszawa', pickupCountry: 'PL',
        deliveryCity: 'Berlin', deliveryCountry: 'DE',
        pickupDate: daysFromNow(1), distanceKm: 580, price: 1800, currency: 'EUR',
        cargoType: 'Artykuły spożywcze', isFrigo: true, temperatureMin: 2, temperatureMax: 8,
        weightKg: 18000, contractorId: c0,
      },
      // 2. Poznań → Hamburg, curtain-sider
      {
        externalId: 'DEMO-002', source: 'TRANS_EU', status: 'NEW',
        pickupCity: 'Poznań', pickupCountry: 'PL',
        deliveryCity: 'Hamburg', deliveryCountry: 'DE',
        pickupDate: daysFromNow(1), distanceKm: 620, price: 2100, currency: 'EUR',
        cargoType: 'Palety przemysłowe',
        weightKg: 20000, contractorId: c1,
      },
      // 3. Kraków → Amsterdam, curtain-sider — ACCEPTED
      {
        externalId: 'DEMO-003', source: 'TIMOCOM', status: 'ACCEPTED',
        pickupCity: 'Kraków', pickupCountry: 'PL',
        deliveryCity: 'Amsterdam', deliveryCountry: 'NL',
        pickupDate: daysFromNow(2), distanceKm: 1350, price: 3200, currency: 'EUR',
        cargoType: 'Chemia budowlana',
        weightKg: 22000, contractorId: c1,
      },
      // 4. Wrocław → Praga, curtain-sider
      {
        externalId: 'DEMO-004', source: 'MANUAL', status: 'NEW',
        pickupCity: 'Wrocław', pickupCountry: 'PL',
        deliveryCity: 'Praga', deliveryCountry: 'CZ',
        pickupDate: daysFromNow(2), distanceKm: 340, price: 950, currency: 'EUR',
        cargoType: 'AGD',
        weightKg: 15000, contractorId: c2,
      },
      // 5. Gdańsk → Kopenhaga, reefer — ASSIGNED
      {
        externalId: 'DEMO-005', source: 'TRANS_EU', status: 'ASSIGNED',
        pickupCity: 'Gdańsk', pickupCountry: 'PL',
        deliveryCity: 'Kopenhaga', deliveryCountry: 'DK',
        pickupDate: daysFromNow(3), distanceKm: 680, price: 2400, currency: 'EUR',
        cargoType: 'Ryby i owoce morza', isFrigo: true, temperatureMin: -2, temperatureMax: 4,
        weightKg: 14000, contractorId: c0, assignedToId: d0, assignedAt: new Date(),
      },
      // 6. Łódź → Wiedeń, curtain-sider — ACCEPTED
      {
        externalId: 'DEMO-006', source: 'TIMOCOM', status: 'ACCEPTED',
        pickupCity: 'Łódź', pickupCountry: 'PL',
        deliveryCity: 'Wiedeń', deliveryCountry: 'AT',
        pickupDate: daysFromNow(3), distanceKm: 680, price: 1900, currency: 'EUR',
        cargoType: 'Odzież i tekstylia',
        weightKg: 16000, contractorId: c2,
      },
      // 7. Katowice → Mediolan, curtain-sider
      {
        externalId: 'DEMO-007', source: 'TELEROUTE', status: 'NEW',
        pickupCity: 'Katowice', pickupCountry: 'PL',
        deliveryCity: 'Mediolan', deliveryCountry: 'IT',
        pickupDate: daysFromNow(5), distanceKm: 1100, price: 2800, currency: 'EUR',
        cargoType: 'Części samochodowe',
        weightKg: 19000, contractorId: c0,
      },
      // 8. Szczecin → Rotterdam — ASSIGNED
      {
        externalId: 'DEMO-008', source: 'TRANS_EU', status: 'ASSIGNED',
        pickupCity: 'Szczecin', pickupCountry: 'PL',
        deliveryCity: 'Rotterdam', deliveryCountry: 'NL',
        pickupDate: daysFromNow(5), distanceKm: 850, price: 2600, currency: 'EUR',
        cargoType: 'Kontenery przemysłowe',
        weightKg: 24000, contractorId: c1, assignedToId: d1, assignedAt: new Date(),
      },
      // 9. Berlin → Warszawa, return load
      {
        externalId: 'DEMO-009', source: 'TIMOCOM', status: 'NEW',
        pickupCity: 'Berlin', pickupCountry: 'DE',
        deliveryCity: 'Warszawa', deliveryCountry: 'PL',
        pickupDate: daysFromNow(7), distanceKm: 580, price: 1600, currency: 'EUR',
        cargoType: 'Elektronika użytkowa',
        weightKg: 17000, contractorId: c2,
      },
      // 10. München → Kraków, frigo — ASSIGNED
      {
        externalId: 'DEMO-010', source: 'TELEROUTE', status: 'ASSIGNED',
        pickupCity: 'München', pickupCountry: 'DE',
        deliveryCity: 'Kraków', deliveryCountry: 'PL',
        pickupDate: daysFromNow(7), distanceKm: 820, price: 2200, currency: 'EUR',
        cargoType: 'Mięso i wędliny', isFrigo: true, temperatureMin: 0, temperatureMax: 6,
        weightKg: 18000, contractorId: c0, assignedToId: d0, assignedAt: new Date(),
      },
      // 11. Paris → Poznań — ACCEPTED
      {
        externalId: 'DEMO-011', source: 'TRANS_EU', status: 'ACCEPTED',
        pickupCity: 'Paryż', pickupCountry: 'FR',
        deliveryCity: 'Poznań', deliveryCountry: 'PL',
        pickupDate: daysFromNow(10), distanceKm: 1200, price: 3100, currency: 'EUR',
        cargoType: 'Produkty luksusowe',
        weightKg: 20000, contractorId: c1,
      },
      // 12. Lyon → Wrocław, reefer — ASSIGNED
      {
        externalId: 'DEMO-012', source: 'TIMOCOM', status: 'ASSIGNED',
        pickupCity: 'Lyon', pickupCountry: 'FR',
        deliveryCity: 'Wrocław', deliveryCountry: 'PL',
        pickupDate: daysFromNow(10), distanceKm: 1400, price: 3500, currency: 'EUR',
        cargoType: 'Nabiał i produkty mleczne', isFrigo: true, temperatureMin: 2, temperatureMax: 8,
        weightKg: 21000, contractorId: c0, assignedToId: d1, assignedAt: new Date(),
      },
    ];

    let created = 0;
    for (const route of demoRoutes) {
      const costs = calcCosts(route.price, route.distanceKm, route.currency);
      const { externalId, source, status, assignedToId, assignedAt, contractorId, isFrigo, temperatureMin, temperatureMax, ...rest } = route;
      await prisma.offer.upsert({
        where: { companyId_source_externalId: { companyId: company.id, source, externalId } },
        update: coordsOnly(rest),
        create: {
          companyId: company.id,
          externalId,
          source,
          status,
          ...(assignedToId && { assignedToId, assignedAt }),
          ...(contractorId && { contractorId }),
          isFrigo: isFrigo ?? false,
          ...(temperatureMin !== undefined && { temperatureMin }),
          ...(temperatureMax !== undefined && { temperatureMax }),
          ...withCoords(rest),
          ...costs,
        },
      });
      created++;
    }
    console.log(`✅ Demo offers: ${created} routes (coordinates from the map)`);
  }

  // ── 8. Dispatcher demand (skip if already seeded) ─────────────────────────
  const demandCount = await prisma.dispatcherDemand.count({ where: { companyId: company.id } });
  if (demandCount === 0) {
    await prisma.dispatcherDemand.create({
      data: {
        companyId: company.id,
        dispatcherId: createdDispatchers[0].id,
        availableTrucks: 2,
        vehicleTypes: ['TRUCK', 'MEGA'],
        regions: ['DE', 'NL', 'BE', 'FR'],
        preferredCountries: ['DE', 'NL', 'BE'],
        preferredDirections: ['PL→DE', 'PL→NL'],
        minPricePerKm: 1.5,
        minMarginPct: 8,
        searchReloads: true,
        searchReturns: true,
        maxPickupRadiusKm: 150,
        isActive: true,
      },
    });
    console.log('✅ Dispatcher demand');
  } else {
    console.log('⏭️  Demand: already there, skipped');
  }

  // ── 9. Extra contractors (10 new) ─────────────────────────────────────────
  const extraContractorCount = await prisma.contractor.count({
    where: { companyId: company.id, name: { startsWith: 'Seed-' } },
  });
  if (extraContractorCount < 10) {
    const extraContractors = [
      { name: 'Seed-Blitz Spedition AG', taxId: 'DE998877665', country: 'DE', city: 'Hamburg', paymentRating: 5, reliabilityScore: 95, avgPaymentDays: 21 },
      { name: 'Seed-Van der Berg Transport', taxId: 'NL112233445', country: 'NL', city: 'Rotterdam', paymentRating: 4, reliabilityScore: 88, avgPaymentDays: 30 },
      { name: 'Seed-Transports Dupont SARL', taxId: 'FR55443322', country: 'FR', city: 'Lyon', paymentRating: 3, reliabilityScore: 72, avgPaymentDays: 45 },
      { name: 'Seed-Logistica Rossi SRL', taxId: 'IT77665544', country: 'IT', city: 'Milano', paymentRating: 4, reliabilityScore: 82, avgPaymentDays: 60 },
      { name: 'Seed-Iberica Cargo SL', taxId: 'ES33221100', country: 'ES', city: 'Barcelona', paymentRating: 2, reliabilityScore: 55, avgPaymentDays: 75 },
      { name: 'Seed-ČeskáLogistika s.r.o.', taxId: 'CZ12345678', country: 'CZ', city: 'Praha', paymentRating: 4, reliabilityScore: 85, avgPaymentDays: 30 },
      { name: 'Seed-Alpen Transport GmbH', taxId: 'AT99887766', country: 'AT', city: 'Wien', paymentRating: 5, reliabilityScore: 98, avgPaymentDays: 14 },
      { name: 'Seed-PolTrans Express', taxId: 'PL6667778', country: 'PL', city: 'Poznań', paymentRating: 3, reliabilityScore: 65, avgPaymentDays: 45 },
      { name: 'Seed-Nordic Freight AB', taxId: 'SE55667788', country: 'SE', city: 'Stockholm', paymentRating: 4, reliabilityScore: 90, avgPaymentDays: 30 },
      { name: 'Seed-Magyar Szállítás Kft', taxId: 'HU11223344', country: 'HU', city: 'Budapest', paymentRating: 2, reliabilityScore: 40, avgPaymentDays: 90 },
    ];
    for (const c of extraContractors) {
      await prisma.contractor.upsert({
        where: { id: `seed-contractor-${c.name}` },
        update: {},
        create: { id: `seed-contractor-${c.name}`, companyId: company.id, ...c },
      });
    }
    console.log(`✅ Extra contractors: ${extraContractors.length}`);
  } else {
    console.log(`⏭️  Extra contractors: already there, skipped`);
  }

  // ── 10. Extra vehicles ────────────────────────────────────────────────────
  // Always upsert: creates new ones, completes the record of existing ones
  // (gross and curb weight) — otherwise a database seeded earlier would still get 422 in LTL.
  {
    const d0 = createdDispatchers[0].id;
    const d1 = createdDispatchers[1].id;
    // Definitions in seed-vehicles.ts — 2-axle tractors + attached 3-axle semi-trailers.
    const extraVehicles = extraSeedVehicles(d0, d1);
    for (const v of extraVehicles) {
      const { id, ...rest } = v;
      await prisma.vehicle.upsert({
        where: { id },
        update: {
          maxWeightKg: rest.maxWeightKg,
          grossVehicleWeightKg: rest.grossVehicleWeightKg,
          curbWeightKg: rest.curbWeightKg,
        },
        create: { id, companyId: company.id, ...rest },
      });
    }
    console.log(`✅ Extra vehicles: ${extraVehicles.length} (records completed)`);
  }

  // ── 10b. LTL demo scenario (Poznań, PL → Berlin, DE) ────────────────────
  // On EVERY run: old demo offers are deleted, new ones are dated from now.
  {
    const now = seedNow();
    const r = await seedDemoLtl(prisma, company.id, now);
    console.log(`✅ Demo LTL: ${r.created} offers ${DEMO_LTL_PREFIX}* from ${now.toISOString().slice(0, 10)} (${r.removed} old ones removed)`);
  }

  // ── 11. 100 freight offers on realistic PL↔EU routes ─────────────────────
  const bulkOfferCount = await prisma.offer.count({
    where: { companyId: company.id, externalId: { startsWith: 'BULK-' } },
  });

  if (bulkOfferCount < 100) {
    const allContractors = await prisma.contractor.findMany({ where: { companyId: company.id } });
    const d0 = createdDispatchers[0].id;
    const d1 = createdDispatchers[1].id;

    // 45 unique routes
    const routes = [
      // PL→DE
      { from: 'Poznań', fc: 'PL', to: 'Hamburg', tc: 'DE', km: 620 },
      { from: 'Warszawa', fc: 'PL', to: 'Berlin', tc: 'DE', km: 580 },
      { from: 'Wrocław', fc: 'PL', to: 'München', tc: 'DE', km: 650 },
      { from: 'Gdańsk', fc: 'PL', to: 'Frankfurt', tc: 'DE', km: 950 },
      { from: 'Katowice', fc: 'PL', to: 'Stuttgart', tc: 'DE', km: 780 },
      { from: 'Szczecin', fc: 'PL', to: 'Hannover', tc: 'DE', km: 450 },
      { from: 'Łódź', fc: 'PL', to: 'Dresden', tc: 'DE', km: 480 },
      { from: 'Rzeszów', fc: 'PL', to: 'Nürnberg', tc: 'DE', km: 900 },
      // PL→NL
      { from: 'Łódź', fc: 'PL', to: 'Rotterdam', tc: 'NL', km: 1150 },
      { from: 'Katowice', fc: 'PL', to: 'Amsterdam', tc: 'NL', km: 1200 },
      { from: 'Poznań', fc: 'PL', to: 'Eindhoven', tc: 'NL', km: 1050 },
      // PL→FR
      { from: 'Poznań', fc: 'PL', to: 'Paris', tc: 'FR', km: 1300 },
      { from: 'Kraków', fc: 'PL', to: 'Lyon', tc: 'FR', km: 1500 },
      { from: 'Warszawa', fc: 'PL', to: 'Marseille', tc: 'FR', km: 1900 },
      // PL→IT
      { from: 'Wrocław', fc: 'PL', to: 'Milano', tc: 'IT', km: 1100 },
      { from: 'Rzeszów', fc: 'PL', to: 'Roma', tc: 'IT', km: 1500 },
      { from: 'Katowice', fc: 'PL', to: 'Verona', tc: 'IT', km: 950 },
      // PL→ES
      { from: 'Kraków', fc: 'PL', to: 'Barcelona', tc: 'ES', km: 2100 },
      { from: 'Warszawa', fc: 'PL', to: 'Madrid', tc: 'ES', km: 2500 },
      // PL→BE
      { from: 'Poznań', fc: 'PL', to: 'Antwerpen', tc: 'BE', km: 1050 },
      { from: 'Łódź', fc: 'PL', to: 'Bruxelles', tc: 'BE', km: 1150 },
      // PL→AT
      { from: 'Katowice', fc: 'PL', to: 'Wien', tc: 'AT', km: 440 },
      { from: 'Kraków', fc: 'PL', to: 'Graz', tc: 'AT', km: 560 },
      // PL→CZ
      { from: 'Wrocław', fc: 'PL', to: 'Praha', tc: 'CZ', km: 340 },
      { from: 'Katowice', fc: 'PL', to: 'Brno', tc: 'CZ', km: 200 },
      // PL→SE
      { from: 'Gdańsk', fc: 'PL', to: 'Stockholm', tc: 'SE', km: 1100 },
      { from: 'Szczecin', fc: 'PL', to: 'Malmö', tc: 'SE', km: 380 },
      // PL→HU
      { from: 'Rzeszów', fc: 'PL', to: 'Budapest', tc: 'HU', km: 420 },
      { from: 'Kraków', fc: 'PL', to: 'Budapest', tc: 'HU', km: 480 },
      // Return routes
      { from: 'Hamburg', fc: 'DE', to: 'Poznań', tc: 'PL', km: 620 },
      { from: 'Berlin', fc: 'DE', to: 'Warszawa', tc: 'PL', km: 580 },
      { from: 'München', fc: 'DE', to: 'Kraków', tc: 'PL', km: 650 },
      { from: 'Rotterdam', fc: 'NL', to: 'Łódź', tc: 'PL', km: 1150 },
      { from: 'Amsterdam', fc: 'NL', to: 'Gdańsk', tc: 'PL', km: 1250 },
      { from: 'Paris', fc: 'FR', to: 'Wrocław', tc: 'PL', km: 1400 },
      { from: 'Lyon', fc: 'FR', to: 'Katowice', tc: 'PL', km: 1500 },
      { from: 'Milano', fc: 'IT', to: 'Warszawa', tc: 'PL', km: 1300 },
      { from: 'Wien', fc: 'AT', to: 'Kraków', tc: 'PL', km: 440 },
      { from: 'Praha', fc: 'CZ', to: 'Wrocław', tc: 'PL', km: 340 },
      { from: 'Budapest', fc: 'HU', to: 'Rzeszów', tc: 'PL', km: 420 },
      { from: 'Frankfurt', fc: 'DE', to: 'Gdańsk', tc: 'PL', km: 950 },
      { from: 'Stuttgart', fc: 'DE', to: 'Katowice', tc: 'PL', km: 780 },
      { from: 'Barcelona', fc: 'ES', to: 'Poznań', tc: 'PL', km: 2100 },
      { from: 'Antwerpen', fc: 'BE', to: 'Łódź', tc: 'PL', km: 1050 },
      { from: 'Stockholm', fc: 'SE', to: 'Gdańsk', tc: 'PL', km: 1100 },
    ];

    const cargoTypes = [
      'Palety EUR 120x80', 'Chemia przemysłowa', 'Elektronika', 'Meble biurowe',
      'Stal konstrukcyjna', 'Produkty spożywcze', 'Tekstylia', 'AGD',
      'Kosmetyki', 'Farmaceutyki', 'Drewno konstrukcyjne', 'Części samochodowe',
      'E-commerce / paczki', 'Okna PCV', 'Artykuły papiernicze', 'Materiały budowlane',
      'Opakowania kartonowe', 'Napoje', 'Nawozy', 'Rury stalowe',
    ];

    const sources = ['TRANS_EU', 'TRANS_EU', 'TRANS_EU', 'TRANS_EU', 'MANUAL', 'MANUAL', 'MANUAL', 'TIMOCOM', 'TIMOCOM', 'TIMOCOM'] as const;
    // Status distribution: 40% new, 20% accepted, 15% completed, 10% rejected, 10% in_transit, 5% expired
    const statuses: Array<'NEW' | 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'IN_TRANSIT' | 'EXPIRED'> = [];
    for (let i = 0; i < 40; i++) statuses.push('NEW');
    for (let i = 0; i < 20; i++) statuses.push('ACCEPTED');
    for (let i = 0; i < 15; i++) statuses.push('COMPLETED');
    for (let i = 0; i < 10; i++) statuses.push('REJECTED');
    for (let i = 0; i < 10; i++) statuses.push('IN_TRANSIT');
    for (let i = 0; i < 5; i++) statuses.push('EXPIRED');

    const publishStatuses = ['none', 'none', 'none', 'draft', 'published', 'published', 'none', 'failed', 'none', 'none'];

    // Seeded random — deterministic
    function seededRandom(seed: number) {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    }

    const bulkOffers: any[] = [];
    for (let i = 0; i < 100; i++) {
      const route = routes[i % routes.length];
      const statusIdx = i % statuses.length;
      const status = statuses[statusIdx];
      const source = sources[i % sources.length];
      const cargo = cargoTypes[i % cargoTypes.length];
      const contractor = allContractors[i % allContractors.length];

      // Spread created_at over 90 days
      const daysAgo = Math.floor(seededRandom(i * 7 + 3) * 90);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - daysAgo);
      createdAt.setHours(Math.floor(seededRandom(i * 13 + 5) * 14) + 6, Math.floor(seededRandom(i * 17) * 60), 0, 0);

      const pickupDate = new Date(createdAt);
      pickupDate.setDate(pickupDate.getDate() + Math.floor(seededRandom(i * 23 + 1) * 7) + 1);

      // Price: 2.50-6.50 PLN/km → convert to EUR (~4.5 PLN/EUR)
      const plnPerKm = 2.5 + seededRandom(i * 31 + 2) * 4.0;
      const priceEur = Math.round((route.km * plnPerKm / 4.5) * 100) / 100;

      const weightKg = 8000 + Math.floor(seededRandom(i * 41 + 7) * 16000);

      const costs = calcCosts(priceEur, route.km);
      const isAssigned = ['ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'COMPLETED'].includes(status);

      bulkOffers.push(withCoords({
        companyId: company.id,
        externalId: `BULK-${String(i + 1).padStart(3, '0')}`,
        source,
        status,
        pickupCity: route.from,
        pickupCountry: route.fc,
        deliveryCity: route.to,
        deliveryCountry: route.tc,
        pickupDate,
        distanceKm: route.km,
        price: priceEur,
        currency: 'EUR',
        cargoType: cargo,
        weightKg,
        lengthM: 8 + Math.floor(seededRandom(i * 53) * 6),
        contractorId: contractor.id,
        publishStatus: publishStatuses[i % publishStatuses.length],
        createdAt,
        ...(isAssigned && { assignedToId: i % 2 === 0 ? d0 : d1, assignedAt: createdAt }),
        ...costs,
      }));
    }

    await prisma.offer.createMany({ data: bulkOffers, skipDuplicates: true });
    console.log(`✅ Bulk offers: ${bulkOffers.length} routes`);
  } else {
    console.log(`⏭️  Bulk offers: already there (${bulkOfferCount}), skipped`);
  }

  // ── 12. LTL offers (15 part loads, ACCEPTED) ─────────────────────────────
  const ltlOfferCount = await prisma.offer.count({
    where: { companyId: company.id, externalId: { startsWith: 'LTL-' } },
  });

  if (ltlOfferCount < 15) {
    const ltlOffers = [
      { id: 'LTL-001', from: 'Poznań', fc: 'PL', to: 'Hamburg', tc: 'DE', km: 620, w: 3000, m: 2.0, cargo: 'Palety EUR 120x80, stackable, 8 szt.' },
      { id: 'LTL-002', from: 'Poznań', fc: 'PL', to: 'Hannover', tc: 'DE', km: 560, w: 2500, m: 1.5, cargo: 'Elektronika — TV LCD, karton na palecie, delikatne' },
      { id: 'LTL-003', from: 'Poznań', fc: 'PL', to: 'Berlin', tc: 'DE', km: 280, w: 4000, m: 3.0, cargo: 'Kosmetyki — kartony 60x40x40, 24 szt. na palecie' },
      { id: 'LTL-004', from: 'Warszawa', fc: 'PL', to: 'München', tc: 'DE', km: 1000, w: 5000, m: 3.5, cargo: 'AGD — pralki i zmywarki, palety 120x80' },
      { id: 'LTL-005', from: 'Warszawa', fc: 'PL', to: 'Stuttgart', tc: 'DE', km: 900, w: 2000, m: 1.0, cargo: 'Farmaceutyki — kontrola temp. +15/+25°C, suche' },
      { id: 'LTL-006', from: 'Wrocław', fc: 'PL', to: 'Frankfurt', tc: 'DE', km: 650, w: 6000, m: 4.0, cargo: 'Meble biurowe — biurka i krzesła, niestackowane' },
      { id: 'LTL-007', from: 'Wrocław', fc: 'PL', to: 'Köln', tc: 'DE', km: 750, w: 3500, m: 2.5, cargo: 'Tekstylia — bele na paletach, stackable' },
      { id: 'LTL-008', from: 'Gdańsk', fc: 'PL', to: 'Rotterdam', tc: 'NL', km: 1200, w: 4500, m: 3.0, cargo: 'Chemia przemysłowa — beczki 200L na palecie, ADR kl. 8' },
      { id: 'LTL-009', from: 'Gdańsk', fc: 'PL', to: 'Amsterdam', tc: 'NL', km: 1250, w: 2000, m: 1.5, cargo: 'E-commerce — paczki skompletowane, 15 palet' },
      { id: 'LTL-010', from: 'Kraków', fc: 'PL', to: 'Wien', tc: 'AT', km: 440, w: 7000, m: 4.5, cargo: 'Stal — rury stalowe Ø50mm, wiązki 6m, ciężkie' },
      { id: 'LTL-011', from: 'Kraków', fc: 'PL', to: 'Budapest', tc: 'HU', km: 480, w: 3000, m: 2.0, cargo: 'Części auto — silniki i skrzynie biegów, palety' },
      { id: 'LTL-012', from: 'Katowice', fc: 'PL', to: 'Praha', tc: 'CZ', km: 350, w: 5500, m: 3.5, cargo: 'Drewno — deski heblowane, wiązki paletowane' },
      { id: 'LTL-013', from: 'Łódź', fc: 'PL', to: 'Paris', tc: 'FR', km: 1400, w: 4000, m: 2.5, cargo: 'Okna PCV — stojaki A-frame, delikatne, niestackowane' },
      { id: 'LTL-014', from: 'Szczecin', fc: 'PL', to: 'Copenhagen', tc: 'DK', km: 380, w: 3000, m: 2.0, cargo: 'Produkty spożywcze suche — konserwy, palety EUR' },
      { id: 'LTL-015', from: 'Rzeszów', fc: 'PL', to: 'Bratislava', tc: 'SK', km: 350, w: 2500, m: 1.5, cargo: 'Tekstylia — odzież na wieszakach, wózki odzieżowe' },
    ];

    const ltlData = ltlOffers.map((ltl) => {
      const plnPerKm = 3.0 + Math.random() * 2.0;
      const priceEur = Math.round((ltl.km * plnPerKm / 4.5) * 100) / 100;
      const costs = calcCosts(priceEur, ltl.km);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - Math.floor(Math.random() * 14));
      return withCoords({
        companyId: company.id,
        externalId: ltl.id,
        source: 'MANUAL' as const,
        status: 'ACCEPTED' as const,
        pickupCity: ltl.from,
        pickupCountry: ltl.fc,
        deliveryCity: ltl.to,
        deliveryCountry: ltl.tc,
        pickupDate: daysFromNow(Math.floor(Math.random() * 7) + 1),
        distanceKm: ltl.km,
        price: priceEur,
        currency: 'EUR',
        cargoType: ltl.cargo,
        weightKg: ltl.w,
        lengthM: ltl.m,
        publishStatus: 'none',
        createdAt,
        ...costs,
      });
    });

    await prisma.offer.createMany({ data: ltlData, skipDuplicates: true });
    console.log(`✅ LTL offers: ${ltlData.length} part loads`);
  } else {
    console.log(`⏭️  LTL offers: already there (${ltlOfferCount}), skipped`);
  }

  // ── 12b. Coordinates of seed offers created without upsert ─────────────────
  // Blocks 6, 11 and 12 are skipped on an existing database — here their
  // coordinates are overwritten from the map, so a repeated seed gives a clean
  // demo on an old database too. The base offer without an externalId (MANUAL,
  // ASSIGNED) cannot be matched here; it does not take part in LTL anyway (status ≠ NEW).
  {
    const n = await refreshSeedCoords(prisma, company.id, ['TE-', 'TC-', 'BULK-', 'LTL-']);
    console.log(`✅ Seed offer coordinates refreshed: ${n}`);
  }

  // ── 13. Notifications (20) ────────────────────────────────────────────────
  const notifCount = await prisma.notification.count({ where: { companyId: company.id } });
  if (notifCount < 20) {
    const d0 = createdDispatchers[0].id;
    const d1 = createdDispatchers[1].id;

    const notifTypes: Array<'NEW_OFFER' | 'URGENT' | 'RELOAD' | 'RETURN' | 'RISK_ALERT' | 'VEHICLE_INSPECTION_EXPIRY' | 'VEHICLE_INSURANCE_EXPIRY' | 'VEHICLE_MAINTENANCE'> = [
      'NEW_OFFER', 'NEW_OFFER', 'URGENT', 'RELOAD', 'RETURN',
      'RISK_ALERT', 'VEHICLE_INSPECTION_EXPIRY', 'VEHICLE_INSURANCE_EXPIRY',
      'VEHICLE_MAINTENANCE', 'NEW_OFFER',
    ];

    const notifData = [];
    for (let i = 0; i < 20; i++) {
      const type = notifTypes[i % notifTypes.length];
      const daysAgo = Math.floor(Math.random() * 30);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - daysAgo);

      const titles: Record<string, string> = {
        NEW_OFFER: 'Nowa oferta na trasie PL→DE',
        URGENT: 'Pilne zlecenie — załadunek jutro!',
        RELOAD: 'Doładunek dostępny: Poznań→Hamburg',
        RETURN: 'Ładunek powrotny: Berlin→Warszawa',
        RISK_ALERT: 'Ostrzeżenie: niska marża na ofercie',
        VEHICLE_INSPECTION_EXPIRY: 'Przegląd techniczny wygasa za 14 dni',
        VEHICLE_INSURANCE_EXPIRY: 'Ubezpieczenie OC wygasa za 30 dni',
        VEHICLE_MAINTENANCE: 'Zaplanowany serwis pojazdu WA 12345',
      };
      const messages: Record<string, string> = {
        NEW_OFFER: `Znaleziono nową ofertę pasującą do Twoich kryteriów. Sprawdź szczegóły.`,
        URGENT: `Pilne zlecenie wymaga natychmiastowej reakcji. Termin załadunku: jutro 06:00.`,
        RELOAD: `Dostępny doładunek na trasie Poznań→Hamburg. Wolne 4.5m, 6t.`,
        RETURN: `Ładunek powrotny z Berlina do Warszawy. Cena: 1600 EUR.`,
        RISK_ALERT: `Marża na ofercie BULK-${String(i + 1).padStart(3, '0')} wynosi poniżej 5%. Rozważ renegocjację.`,
        VEHICLE_INSPECTION_EXPIRY: `Pojazd WA 12345 — przegląd techniczny wygasa 28.03.2026.`,
        VEHICLE_INSURANCE_EXPIRY: `Pojazd KR 11111 — polisa OC wygasa 15.04.2026.`,
        VEHICLE_MAINTENANCE: `Zaplanowany serwis pojazdu WA 12345 na 20.03.2026 (wymiana klocków).`,
      };

      notifData.push({
        companyId: company.id,
        userId: i % 2 === 0 ? d0 : d1,
        type,
        title: titles[type] || 'Powiadomienie',
        message: messages[type] || 'Szczegóły w systemie.',
        isRead: i < 12, // first 12 read, rest unread
        createdAt,
      });
    }

    await prisma.notification.createMany({ data: notifData });
    console.log(`✅ Notifications: ${notifData.length}`);
  } else {
    console.log(`⏭️  Notifications: already there (${notifCount}), skipped`);
  }

  // ── 13b. Demo drivers (fleet planning) ───────────────────────────────────
  // Definitions in seed-drivers.ts. Drivers are not overwritten (they may have
  // been changed on screen); a vehicle is assigned only when free (single
  // crew). Statuses are refreshed on every seed to the week of the seed clock
  // (like the LTL demo).
  {
    for (const { vehicleId, ...driver } of SEED_DRIVERS) {
      await prisma.driver.upsert({ where: { id: driver.id }, update: {}, create: { ...driver, companyId: company.id } });
      if (vehicleId) {
        const taken = await prisma.driver.findFirst({ where: { vehicleId }, select: { id: true } });
        if (!taken) await prisma.driver.update({ where: { id: driver.id }, data: { vehicleId } });
      }
    }
    const statuses = seedDriverStatuses(seedNow());
    for (const { id, recentWeeklyRests, ...status } of statuses) {
      const data = { ...status, recentWeeklyRests: recentWeeklyRests ?? Prisma.DbNull };
      await prisma.driverStatus.upsert({ where: { id }, update: data, create: { id, ...data } });
    }
    console.log(`✅ Demo drivers: ${SEED_DRIVERS.length} (statuses: ${statuses.length}, week from ${statuses[0].weeklyRestEndedAt.toISOString().slice(0, 10)})`);
  }

  // ── 14. No "AI analysis" of offers: the OfferAnalysis table (results that no
  // code computed) is removed by migration 20261005140000_drop_offer_analysis.

  console.log('\n🎉 Seed finished!');
  console.log('─────────────────────────────────────────');
  console.log('Test accounts:');
  console.log('  Admin:        admin@spedytor.example.com / Admin1234!');
  console.log('  Dispatcher 1: jan.kowalski@spedytor.example.com / Disp1234!');
  console.log('  Dispatcher 2: anna.nowak@spedytor.example.com / Disp1234!');
  console.log('─────────────────────────────────────────');
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
