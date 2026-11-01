'use client';

import { useEffect, useRef } from 'react';

// Decodes the OSRM format: "lat1,lon1;lat2,lon2;..."
function decodeOsrmPolyline(polyline: string): [number, number][] {
  if (!polyline || typeof polyline !== 'string') return [];
  // Check whether this is the OSRM format (contains semicolons and commas)
  if (polyline.includes(';') && polyline.includes(',')) {
    return polyline.split(';')
      .filter(p => p.trim())
      .map(p => {
        const [lat, lon] = p.split(',').map(Number);
        return [lat, lon] as [number, number];
      })
      .filter(([lat, lon]) => !isNaN(lat) && !isNaN(lon));
  }
  // Other formats are not produced by the API (the route provider is OSRM).
  return [];
}

const ROUTE_COLORS = ['#16a34a', '#2563eb', '#ea580c', '#8b5cf6', '#d97706', '#e11d48'];

export interface RouteMapRoute {
  polyline: string;
  sections?: { polyline?: string }[];
  label: string;
  distanceKm: number;
  costs: { totalCostPLN: number | null };
}

interface RouteMapProps {
  routes: RouteMapRoute[];
  activeIndex: number;
  onSelectRoute: (index: number) => void;
  originCoords: [number, number] | null;
  destCoords: [number, number] | null;
  originLabel?: string;
  destLabel?: string;
}

function decodeRoute(route: RouteMapRoute): [number, number][] {
  try {
    // Try all section polylines first for complete route
    if (route.sections && route.sections.length > 0) {
      const allPoints: [number, number][] = [];
      for (const section of route.sections) {
        const pl = section.polyline;
        if (Array.isArray(pl)) {
          allPoints.push(...(pl as [number, number][]));
        } else if (typeof pl === 'string' && pl) {
          allPoints.push(...decodeOsrmPolyline(pl));
        }
      }
      if (allPoints.length > 0) return allPoints;
    }
    // Fallback: route-level polyline
    const rp = route.polyline;
    if (Array.isArray(rp)) return rp as [number, number][];
    if (typeof rp === 'string' && rp) return decodeOsrmPolyline(rp);
    return [];
  } catch {
    return [];
  }
}

export default function RouteMapClient({
  routes,
  activeIndex,
  onSelectRoute,
  originCoords,
  destCoords,
  originLabel,
  destLabel,
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: any;
    let cancelled = false;

    (async () => {
      // Dynamic import — leaflet only on client
      const L = (await import('leaflet')).default;

      // Inject leaflet CSS if not already present
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (cancelled || !containerRef.current) return;

      // Create map
      map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      // Decode all routes
      const decodedRoutes = routes.map(decodeRoute);

      // Draw inactive routes first (thinner, dashed)
      decodedRoutes.forEach((positions, i) => {
        if (positions.length === 0 || i === activeIndex) return;
        const line = L.polyline(positions, {
          color: ROUTE_COLORS[i] || '#6b7280',
          weight: 3,
          opacity: 0.4,
          dashArray: '8 6',
        }).addTo(map);
        line.bindTooltip(
          `${routes[i].label}: ${routes[i].distanceKm} km, ${routes[i].costs.totalCostPLN ?? '—'} PLN`,
          { sticky: true },
        );
        line.on('click', () => onSelectRoute(i));
      });

      // Draw active route on top (thicker, solid)
      const activePositions = decodedRoutes[activeIndex] || [];
      if (activePositions.length > 0) {
        const activeLine = L.polyline(activePositions, {
          color: ROUTE_COLORS[activeIndex] || '#16a34a',
          weight: 6,
          opacity: 0.85,
        }).addTo(map);
        activeLine.bindTooltip(
          `${routes[activeIndex].label}: ${routes[activeIndex].distanceKm} km, ${routes[activeIndex].costs.totalCostPLN ?? '—'} PLN`,
          { sticky: true },
        );
      }

      // Markers with emoji divIcons (no icon image issues)
      const startIcon = L.divIcon({
        html: '<span style="font-size:24px">🟢</span>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const endIcon = L.divIcon({
        html: '<span style="font-size:24px">🔴</span>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      if (originCoords) {
        L.marker(originCoords, { icon: startIcon })
          .addTo(map)
          .bindTooltip(`A: ${originLabel || 'Start'}`, {
            permanent: true,
            direction: 'top',
            offset: [0, -14],
          });
      }
      if (destCoords) {
        L.marker(destCoords, { icon: endIcon })
          .addTo(map)
          .bindTooltip(`B: ${destLabel || 'Cel'}`, {
            permanent: true,
            direction: 'top',
            offset: [0, -14],
          });
      }

      // Fit bounds
      if (activePositions.length >= 2) {
        const bounds = L.latLngBounds(activePositions);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      } else if (originCoords && destCoords) {
        map.fitBounds(L.latLngBounds([originCoords, destCoords]), {
          padding: [40, 40],
        });
      } else {
        map.setView([52.23, 21.01], 6);
      }
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
        mapRef.current = null;
      }
    };
  }, [routes, activeIndex, originCoords, destCoords, originLabel, destLabel, onSelectRoute]);

  return <div ref={containerRef} className="w-full h-full rounded-xl" style={{ minHeight: '500px' }} />;
}
