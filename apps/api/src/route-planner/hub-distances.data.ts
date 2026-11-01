/**
 * Precalculated road distances between top 30 EU transport hubs — fallback cache (Layer 0).
 *
 * Distances are approximate road-km for HGV-suitable routes (motorway preferred).
 * Used as fallback when routing API is unavailable.
 * Estimated driving times assume avg 70 km/h (including rest stops proportional to distance).
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface TransportHub {
  code: string;
  name: string;
  country: string;
  coordinates: { lat: number; lon: number };
  description: string;
}

export interface HubDistance {
  fromHub: string;
  toHub: string;
  distanceKm: number;
  estimatedDrivingMinutes: number;
  tollCountries: string[];
  notes?: string;
}

// ─── Top 30 EU Transport Hubs ────────────────────────────────────────

export const TRANSPORT_HUBS: Record<string, TransportHub> = {
  WAW: { code: 'WAW', name: 'Warszawa', country: 'PL', coordinates: { lat: 52.2297, lon: 21.0122 }, description: 'Central Poland hub, A2/S7/S8 junction' },
  BER: { code: 'BER', name: 'Berlin', country: 'DE', coordinates: { lat: 52.5200, lon: 13.4050 }, description: 'Northeast Germany hub, A10 ring' },
  HAM: { code: 'HAM', name: 'Hamburg', country: 'DE', coordinates: { lat: 53.5511, lon: 9.9937 }, description: 'Major port city, A1/A7 junction' },
  MUC: { code: 'MUC', name: 'München', country: 'DE', coordinates: { lat: 48.1351, lon: 11.5820 }, description: 'South Germany hub, A8/A9/A92' },
  FRA: { code: 'FRA', name: 'Frankfurt am Main', country: 'DE', coordinates: { lat: 50.1109, lon: 8.6821 }, description: 'Central Germany hub, A3/A5 junction' },
  CGN: { code: 'CGN', name: 'Köln', country: 'DE', coordinates: { lat: 50.9375, lon: 6.9603 }, description: 'Rhine corridor, A1/A3/A4 junction' },
  DTM: { code: 'DTM', name: 'Dortmund', country: 'DE', coordinates: { lat: 51.5136, lon: 7.4653 }, description: 'Ruhr area hub, A1/A2/A40' },
  PRG: { code: 'PRG', name: 'Praha', country: 'CZ', coordinates: { lat: 50.0755, lon: 14.4378 }, description: 'Czech hub, D1/D5/D8 junction' },
  VIE: { code: 'VIE', name: 'Wien', country: 'AT', coordinates: { lat: 48.2082, lon: 16.3738 }, description: 'Austria hub, A1/A2/A4 junction' },
  BTS: { code: 'BTS', name: 'Bratislava', country: 'SK', coordinates: { lat: 48.1486, lon: 17.1077 }, description: 'Slovakia hub, D1/D2/D4' },
  BUD: { code: 'BUD', name: 'Budapest', country: 'HU', coordinates: { lat: 47.4979, lon: 19.0402 }, description: 'Hungary hub, M0/M1/M3/M5 ring' },
  BUH: { code: 'BUH', name: 'București', country: 'RO', coordinates: { lat: 44.4268, lon: 26.1025 }, description: 'Romania hub, A1/A2/A3' },
  AMS: { code: 'AMS', name: 'Amsterdam', country: 'NL', coordinates: { lat: 52.3676, lon: 4.9041 }, description: 'Netherlands hub, A1/A2/A4/A10 ring' },
  RTM: { code: 'RTM', name: 'Rotterdam', country: 'NL', coordinates: { lat: 51.9244, lon: 4.4777 }, description: 'Europe\'s largest port, A15/A16/A20' },
  ANR: { code: 'ANR', name: 'Antwerpen', country: 'BE', coordinates: { lat: 51.2194, lon: 4.4025 }, description: 'Major port, E19/E17/E34 junction' },
  BRU: { code: 'BRU', name: 'Bruxelles', country: 'BE', coordinates: { lat: 50.8503, lon: 4.3517 }, description: 'Belgium hub, E40/E19/R0 ring' },
  PAR: { code: 'PAR', name: 'Paris', country: 'FR', coordinates: { lat: 48.8566, lon: 2.3522 }, description: 'France hub, A1/A4/A6/Périphérique' },
  LYO: { code: 'LYO', name: 'Lyon', country: 'FR', coordinates: { lat: 45.7640, lon: 4.8357 }, description: 'Rhône corridor, A6/A7/A43' },
  MRS: { code: 'MRS', name: 'Marseille', country: 'FR', coordinates: { lat: 43.2965, lon: 5.3698 }, description: 'South France port, A7/A51/A55' },
  MAD: { code: 'MAD', name: 'Madrid', country: 'ES', coordinates: { lat: 40.4168, lon: -3.7038 }, description: 'Spain hub, A1/A2/A3/A4/A5/M30 ring' },
  BCN: { code: 'BCN', name: 'Barcelona', country: 'ES', coordinates: { lat: 41.3874, lon: 2.1686 }, description: 'Mediterranean port, AP-7/C-32' },
  MIL: { code: 'MIL', name: 'Milano', country: 'IT', coordinates: { lat: 45.4642, lon: 9.1900 }, description: 'North Italy hub, A1/A4/A7/A8 junction' },
  ROM: { code: 'ROM', name: 'Roma', country: 'IT', coordinates: { lat: 41.9028, lon: 12.4964 }, description: 'Central Italy, A1/A12/GRA ring' },
  LHR: { code: 'LHR', name: 'London', country: 'GB', coordinates: { lat: 51.5074, lon: -0.1278 }, description: 'UK hub, M25 ring, M1/M4/M20' },
  GOT: { code: 'GOT', name: 'Göteborg', country: 'SE', coordinates: { lat: 57.7089, lon: 11.9746 }, description: 'Sweden port, E6/E20/E45' },
  CPH: { code: 'CPH', name: 'København', country: 'DK', coordinates: { lat: 55.6761, lon: 12.5683 }, description: 'Denmark hub, E20/E47/E55' },
  LIS: { code: 'LIS', name: 'Lisboa', country: 'PT', coordinates: { lat: 38.7223, lon: -9.1393 }, description: 'Portugal hub, A1/A2/A5/CREL' },
  ZAG: { code: 'ZAG', name: 'Zagreb', country: 'HR', coordinates: { lat: 45.8150, lon: 15.9819 }, description: 'Croatia hub, A1/A2/A3/A4' },
  SOF: { code: 'SOF', name: 'Sofia', country: 'BG', coordinates: { lat: 42.6977, lon: 23.3219 }, description: 'Bulgaria hub, Trakia/Struma motorways' },
  VNO: { code: 'VNO', name: 'Vilnius', country: 'LT', coordinates: { lat: 54.6872, lon: 25.2797 }, description: 'Lithuania hub, A1/A2 junction' },
};

// ─── Precalculated Distance Matrix (key routes) ─────────────────────

/**
 * Distance matrix: key = "FROM-TO" (sorted alphabetically), value = HubDistance.
 * Only most frequently used routes are precalculated.
 * For routes not in the cache, use routing API or estimate via haversine × 1.3.
 */
export const HUB_DISTANCES: Record<string, HubDistance> = {
  // ─── Warsaw connections ──────────────────────────────────────────
  'BER-WAW': { fromHub: 'BER', toHub: 'WAW', distanceKm: 575, estimatedDrivingMinutes: 390, tollCountries: ['DE', 'PL'] },
  'PRG-WAW': { fromHub: 'PRG', toHub: 'WAW', distanceKm: 680, estimatedDrivingMinutes: 450, tollCountries: ['CZ', 'PL'] },
  'VIE-WAW': { fromHub: 'VIE', toHub: 'WAW', distanceKm: 720, estimatedDrivingMinutes: 480, tollCountries: ['AT', 'CZ', 'PL'], notes: 'Via Brno/Katowice' },
  'BUD-WAW': { fromHub: 'BUD', toHub: 'WAW', distanceKm: 680, estimatedDrivingMinutes: 460, tollCountries: ['HU', 'SK', 'PL'] },
  'HAM-WAW': { fromHub: 'HAM', toHub: 'WAW', distanceKm: 860, estimatedDrivingMinutes: 560, tollCountries: ['DE', 'PL'] },
  'DTM-WAW': { fromHub: 'DTM', toHub: 'WAW', distanceKm: 950, estimatedDrivingMinutes: 600, tollCountries: ['DE', 'PL'] },
  'VNO-WAW': { fromHub: 'VNO', toHub: 'WAW', distanceKm: 580, estimatedDrivingMinutes: 400, tollCountries: ['PL'] },

  // ─── Berlin connections ──────────────────────────────────────────
  'BER-HAM': { fromHub: 'BER', toHub: 'HAM', distanceKm: 290, estimatedDrivingMinutes: 200, tollCountries: ['DE'] },
  'BER-FRA': { fromHub: 'BER', toHub: 'FRA', distanceKm: 545, estimatedDrivingMinutes: 360, tollCountries: ['DE'] },
  'BER-MUC': { fromHub: 'BER', toHub: 'MUC', distanceKm: 585, estimatedDrivingMinutes: 380, tollCountries: ['DE'] },
  'BER-PRG': { fromHub: 'BER', toHub: 'PRG', distanceKm: 350, estimatedDrivingMinutes: 240, tollCountries: ['DE', 'CZ'] },
  'BER-DTM': { fromHub: 'BER', toHub: 'DTM', distanceKm: 490, estimatedDrivingMinutes: 320, tollCountries: ['DE'] },
  'AMS-BER': { fromHub: 'AMS', toHub: 'BER', distanceKm: 650, estimatedDrivingMinutes: 420, tollCountries: ['DE'] },
  'BER-CPH': { fromHub: 'BER', toHub: 'CPH', distanceKm: 470, estimatedDrivingMinutes: 340, tollCountries: ['DE', 'DK'], notes: 'Via Rostock-Gedser or Puttgarden-Rødby ferry' },

  // ─── Hamburg connections ─────────────────────────────────────────
  'CGN-HAM': { fromHub: 'CGN', toHub: 'HAM', distanceKm: 460, estimatedDrivingMinutes: 300, tollCountries: ['DE'] },
  'DTM-HAM': { fromHub: 'DTM', toHub: 'HAM', distanceKm: 310, estimatedDrivingMinutes: 210, tollCountries: ['DE'] },
  'AMS-HAM': { fromHub: 'AMS', toHub: 'HAM', distanceKm: 470, estimatedDrivingMinutes: 310, tollCountries: ['DE'] },
  'CPH-HAM': { fromHub: 'CPH', toHub: 'HAM', distanceKm: 460, estimatedDrivingMinutes: 330, tollCountries: ['DE', 'DK'] },
  'GOT-HAM': { fromHub: 'GOT', toHub: 'HAM', distanceKm: 640, estimatedDrivingMinutes: 440, tollCountries: ['DE', 'DK', 'SE'], notes: 'Via CPH + Øresund Bridge + Storebælt' },

  // ─── Munich connections ──────────────────────────────────────────
  'FRA-MUC': { fromHub: 'FRA', toHub: 'MUC', distanceKm: 390, estimatedDrivingMinutes: 260, tollCountries: ['DE'] },
  'MIL-MUC': { fromHub: 'MIL', toHub: 'MUC', distanceKm: 490, estimatedDrivingMinutes: 340, tollCountries: ['DE', 'AT', 'IT'], notes: 'Via Brenner' },
  'MUC-PRG': { fromHub: 'MUC', toHub: 'PRG', distanceKm: 380, estimatedDrivingMinutes: 260, tollCountries: ['DE', 'CZ'] },
  'MUC-VIE': { fromHub: 'MUC', toHub: 'VIE', distanceKm: 440, estimatedDrivingMinutes: 280, tollCountries: ['DE', 'AT'] },
  'MUC-ZAG': { fromHub: 'MUC', toHub: 'ZAG', distanceKm: 590, estimatedDrivingMinutes: 380, tollCountries: ['DE', 'AT', 'SI', 'HR'], notes: 'Via Salzburg/Karawanken' },

  // ─── Frankfurt connections ───────────────────────────────────────
  'CGN-FRA': { fromHub: 'CGN', toHub: 'FRA', distanceKm: 190, estimatedDrivingMinutes: 140, tollCountries: ['DE'] },
  'DTM-FRA': { fromHub: 'DTM', toHub: 'FRA', distanceKm: 270, estimatedDrivingMinutes: 190, tollCountries: ['DE'] },
  'FRA-PAR': { fromHub: 'FRA', toHub: 'PAR', distanceKm: 590, estimatedDrivingMinutes: 380, tollCountries: ['DE', 'FR'] },

  // ─── Cologne / Dortmund connections ──────────────────────────────
  'BRU-CGN': { fromHub: 'BRU', toHub: 'CGN', distanceKm: 220, estimatedDrivingMinutes: 160, tollCountries: ['BE', 'DE'] },
  'CGN-DTM': { fromHub: 'CGN', toHub: 'DTM', distanceKm: 95, estimatedDrivingMinutes: 75, tollCountries: ['DE'] },
  'ANR-DTM': { fromHub: 'ANR', toHub: 'DTM', distanceKm: 310, estimatedDrivingMinutes: 210, tollCountries: ['BE', 'DE'] },
  'AMS-DTM': { fromHub: 'AMS', toHub: 'DTM', distanceKm: 330, estimatedDrivingMinutes: 220, tollCountries: ['DE'] },

  // ─── Prague connections ──────────────────────────────────────────
  'BTS-PRG': { fromHub: 'BTS', toHub: 'PRG', distanceKm: 330, estimatedDrivingMinutes: 230, tollCountries: ['CZ', 'SK'] },
  'PRG-VIE': { fromHub: 'PRG', toHub: 'VIE', distanceKm: 330, estimatedDrivingMinutes: 230, tollCountries: ['CZ', 'AT'] },

  // ─── Vienna / Bratislava / Budapest ──────────────────────────────
  'BTS-VIE': { fromHub: 'BTS', toHub: 'VIE', distanceKm: 80, estimatedDrivingMinutes: 65, tollCountries: ['AT', 'SK'] },
  'BTS-BUD': { fromHub: 'BTS', toHub: 'BUD', distanceKm: 200, estimatedDrivingMinutes: 140, tollCountries: ['SK', 'HU'] },
  'BUD-VIE': { fromHub: 'BUD', toHub: 'VIE', distanceKm: 280, estimatedDrivingMinutes: 190, tollCountries: ['HU', 'AT'] },
  'BUD-BUH': { fromHub: 'BUD', toHub: 'BUH', distanceKm: 830, estimatedDrivingMinutes: 560, tollCountries: ['HU', 'RO'] },
  'BUD-ZAG': { fromHub: 'BUD', toHub: 'ZAG', distanceKm: 360, estimatedDrivingMinutes: 240, tollCountries: ['HU', 'HR'] },
  'BUH-SOF': { fromHub: 'BUH', toHub: 'SOF', distanceKm: 400, estimatedDrivingMinutes: 280, tollCountries: ['RO', 'BG'] },

  // ─── Benelux connections ─────────────────────────────────────────
  'AMS-RTM': { fromHub: 'AMS', toHub: 'RTM', distanceKm: 80, estimatedDrivingMinutes: 65, tollCountries: [] },
  'ANR-RTM': { fromHub: 'ANR', toHub: 'RTM', distanceKm: 105, estimatedDrivingMinutes: 80, tollCountries: ['BE'] },
  'ANR-BRU': { fromHub: 'ANR', toHub: 'BRU', distanceKm: 55, estimatedDrivingMinutes: 50, tollCountries: ['BE'] },
  'AMS-ANR': { fromHub: 'AMS', toHub: 'ANR', distanceKm: 160, estimatedDrivingMinutes: 120, tollCountries: ['BE'] },
  'AMS-BRU': { fromHub: 'AMS', toHub: 'BRU', distanceKm: 210, estimatedDrivingMinutes: 150, tollCountries: ['BE'] },
  'BRU-PAR': { fromHub: 'BRU', toHub: 'PAR', distanceKm: 310, estimatedDrivingMinutes: 220, tollCountries: ['BE', 'FR'] },
  'RTM-PAR': { fromHub: 'RTM', toHub: 'PAR', distanceKm: 470, estimatedDrivingMinutes: 320, tollCountries: ['BE', 'FR'] },

  // ─── France internal ─────────────────────────────────────────────
  'LYO-PAR': { fromHub: 'LYO', toHub: 'PAR', distanceKm: 465, estimatedDrivingMinutes: 300, tollCountries: ['FR'] },
  'LYO-MRS': { fromHub: 'LYO', toHub: 'MRS', distanceKm: 315, estimatedDrivingMinutes: 200, tollCountries: ['FR'] },
  'MRS-PAR': { fromHub: 'MRS', toHub: 'PAR', distanceKm: 775, estimatedDrivingMinutes: 480, tollCountries: ['FR'] },
  'BCN-LYO': { fromHub: 'BCN', toHub: 'LYO', distanceKm: 640, estimatedDrivingMinutes: 400, tollCountries: ['ES', 'FR'] },
  'LYO-MIL': { fromHub: 'LYO', toHub: 'MIL', distanceKm: 640, estimatedDrivingMinutes: 410, tollCountries: ['FR', 'IT'], notes: 'Via Fréjus or Mont Blanc tunnel' },

  // ─── Spain / Portugal ────────────────────────────────────────────
  'BCN-MAD': { fromHub: 'BCN', toHub: 'MAD', distanceKm: 620, estimatedDrivingMinutes: 390, tollCountries: ['ES'] },
  'LIS-MAD': { fromHub: 'LIS', toHub: 'MAD', distanceKm: 625, estimatedDrivingMinutes: 390, tollCountries: ['PT', 'ES'] },
  'BCN-MRS': { fromHub: 'BCN', toHub: 'MRS', distanceKm: 510, estimatedDrivingMinutes: 320, tollCountries: ['ES', 'FR'] },
  'MAD-PAR': { fromHub: 'MAD', toHub: 'PAR', distanceKm: 1270, estimatedDrivingMinutes: 780, tollCountries: ['ES', 'FR'] },

  // ─── Italy connections ───────────────────────────────────────────
  'MIL-ROM': { fromHub: 'MIL', toHub: 'ROM', distanceKm: 575, estimatedDrivingMinutes: 370, tollCountries: ['IT'] },
  'MIL-VIE': { fromHub: 'MIL', toHub: 'VIE', distanceKm: 850, estimatedDrivingMinutes: 520, tollCountries: ['IT', 'AT'], notes: 'Via Brenner or Tarvisio' },
  'MIL-ZAG': { fromHub: 'MIL', toHub: 'ZAG', distanceKm: 730, estimatedDrivingMinutes: 470, tollCountries: ['IT', 'SI', 'HR'] },

  // ─── UK connections ──────────────────────────────────────────────
  'LHR-PAR': { fromHub: 'LHR', toHub: 'PAR', distanceKm: 460, estimatedDrivingMinutes: 360, tollCountries: ['GB', 'FR'], notes: 'Via Eurotunnel or Calais-Dover ferry' },
  'ANR-LHR': { fromHub: 'ANR', toHub: 'LHR', distanceKm: 360, estimatedDrivingMinutes: 320, tollCountries: ['BE', 'FR', 'GB'], notes: 'Via Calais + Eurotunnel/ferry' },
  'RTM-LHR': { fromHub: 'RTM', toHub: 'LHR', distanceKm: 420, estimatedDrivingMinutes: 360, tollCountries: ['BE', 'FR', 'GB'] },

  // ─── Scandinavia connections ─────────────────────────────────────
  'CPH-GOT': { fromHub: 'CPH', toHub: 'GOT', distanceKm: 310, estimatedDrivingMinutes: 200, tollCountries: ['DK', 'SE'], notes: 'Via Øresund Bridge' },

  // ─── Croatia / Balkans ───────────────────────────────────────────
  'VIE-ZAG': { fromHub: 'VIE', toHub: 'ZAG', distanceKm: 380, estimatedDrivingMinutes: 250, tollCountries: ['AT', 'SI', 'HR'] },
  'SOF-ZAG': { fromHub: 'SOF', toHub: 'ZAG', distanceKm: 760, estimatedDrivingMinutes: 510, tollCountries: ['BG', 'RS', 'HR'] },
  'BUH-VIE': { fromHub: 'BUH', toHub: 'VIE', distanceKm: 1130, estimatedDrivingMinutes: 720, tollCountries: ['RO', 'HU', 'AT'] },
  'SOF-VIE': { fromHub: 'SOF', toHub: 'VIE', distanceKm: 960, estimatedDrivingMinutes: 610, tollCountries: ['BG', 'RS', 'HU', 'AT'] },

  // ─── Lithuania connections ───────────────────────────────────────
  'BER-VNO': { fromHub: 'BER', toHub: 'VNO', distanceKm: 980, estimatedDrivingMinutes: 640, tollCountries: ['DE', 'PL'] },
};

// ─── Lookup helpers ──────────────────────────────────────────────────

/**
 * Get hub info by code.
 */
export function getHub(code: string): TransportHub | undefined {
  return TRANSPORT_HUBS[code.toUpperCase()];
}

/**
 * Look up precalculated distance between two hubs.
 * Keys are stored alphabetically sorted, so "WAW-BER" and "BER-WAW" both work.
 */
export function getHubDistance(fromCode: string, toCode: string): HubDistance | undefined {
  const a = fromCode.toUpperCase();
  const b = toCode.toUpperCase();
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  return HUB_DISTANCES[key];
}

/**
 * Estimate distance between two coordinates using haversine × correction factor.
 * Used when no precalculated distance exists.
 * Road correction factor: 1.3 (roads are ~30% longer than straight line).
 */
export function estimateRoadDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  correctionFactor: number = 1.3,
): { distanceKm: number; estimatedDrivingMinutes: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const straightLineKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadKm = Math.round(straightLineKm * correctionFactor);
  const drivingMinutes = Math.round(roadKm / 70 * 60); // avg 70 km/h

  return { distanceKm: roadKm, estimatedDrivingMinutes: drivingMinutes };
}

/**
 * Find nearest hub to given coordinates.
 */
export function findNearestHub(lat: number, lon: number): TransportHub {
  let nearest: TransportHub = TRANSPORT_HUBS.WAW;
  let minDist = Infinity;

  for (const hub of Object.values(TRANSPORT_HUBS)) {
    const dist = estimateRoadDistance(lat, lon, hub.coordinates.lat, hub.coordinates.lon, 1.0).distanceKm;
    if (dist < minDist) {
      minDist = dist;
      nearest = hub;
    }
  }

  return nearest;
}

/**
 * Find distance between any two hubs — cached first, then estimated.
 */
export function getOrEstimateDistance(
  fromCode: string,
  toCode: string,
): HubDistance {
  const cached = getHubDistance(fromCode, toCode);
  if (cached) return cached;

  const from = getHub(fromCode);
  const to = getHub(toCode);

  if (!from || !to) {
    return {
      fromHub: fromCode,
      toHub: toCode,
      distanceKm: 0,
      estimatedDrivingMinutes: 0,
      tollCountries: [],
      notes: 'Unknown hub code(s)',
    };
  }

  const est = estimateRoadDistance(
    from.coordinates.lat, from.coordinates.lon,
    to.coordinates.lat, to.coordinates.lon,
  );

  return {
    fromHub: fromCode,
    toHub: toCode,
    distanceKm: est.distanceKm,
    estimatedDrivingMinutes: est.estimatedDrivingMinutes,
    tollCountries: [from.country, to.country].filter((c, i, arr) => arr.indexOf(c) === i),
    notes: 'Estimated via haversine (no cached route)',
  };
}
