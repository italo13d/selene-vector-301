// src/lib/orbitalPhysics.ts
// Orbital physics and ephemeris processing for Selene Vector 301

import ephemerisData from '../data/ephemeris.json';
import sitesData from '../data/sites.json';

export type LaunchOffset = '+0d' | '+7d' | '+14d' | '+30d';

export interface EphemerisPoint {
  t: string;
  sun_az: number;
  sun_el: number;
  earth_az: number;
  earth_el: number;
}

export interface SiteData {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  alt_km: number;
  max_slope_deg: number;
  psr_distance_km: number;
  description: string;
  horizon_profile_deg: number[];
}

export interface TelemetryPoint {
  t: string;
  sun_az: number;
  sun_el: number;
  earth_az: number;
  earth_el: number;
  sun_visible: boolean;
  earth_visible: boolean;
  solar_eff_pct: number;
}

export interface SiteTelemetry {
  site: SiteData;
  offset: LaunchOffset;
  start_date: string;
  source: string;
  points: TelemetryPoint[];
  solar_uptime_pct: number;
  dte_uptime_pct: number;
  max_continuous_eclipse_hours: number;
  t_minus_sunset_hours: number;
  t_minus_earthset_hours: number;
  avg_solar_eff_pct: number;
}

export interface CustomCoordTelemetry extends Omit<SiteTelemetry, 'site'> {
  site: Omit<SiteData, 'horizon_profile_deg'> & { horizon_profile_deg: number[] };
}

function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function getHorizonElevation(az: number, horizonProfile: number[]): number {
  const idx = Math.round((((az % 360) + 360) % 360) / 5) % 72;
  return horizonProfile[idx];
}

function computeSolarEff(sun_el: number, sun_visible: boolean): number {
  return sun_visible ? Math.max(0, Math.sin(radians(sun_el)) * 100) : 0;
}

function computeSphericalHorizon(alt_km: number): number {
  return -degrees(Math.acos(1737.4 / (1737.4 + Math.max(0, alt_km))));
}

function buildHorizonProfileFromAlt(alt_km: number): number[] {
  const h = computeSphericalHorizon(alt_km);
  return Array(72).fill(h);
}

function processPoints(
  rawPoints: EphemerisPoint[],
  horizonProfile: number[]
): TelemetryPoint[] {
  return rawPoints.map((p) => {
    const horizonEl_sun = getHorizonElevation(p.sun_az, horizonProfile);
    const horizonEl_earth = getHorizonElevation(p.earth_az, horizonProfile);
    const sun_visible = p.sun_el > horizonEl_sun;
    const earth_visible = p.earth_el > horizonEl_earth;
    const solar_eff_pct = computeSolarEff(p.sun_el, sun_visible);
    return { ...p, sun_visible, earth_visible, solar_eff_pct };
  });
}

function computeMaxContinuousEclipseHours(points: TelemetryPoint[]): number {
  // Points are 2-hour intervals
  const INTERVAL_HOURS = 2;
  let maxEclipse = 0;
  let currentEclipse = 0;
  for (const p of points) {
    if (!p.sun_visible) {
      currentEclipse += INTERVAL_HOURS;
      if (currentEclipse > maxEclipse) maxEclipse = currentEclipse;
    } else {
      currentEclipse = 0;
    }
  }
  return maxEclipse;
}

function computeTMinusSunset(points: TelemetryPoint[]): number {
  // Find hours until next sun-down from first visible point
  const INTERVAL_HOURS = 2;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].sun_visible && !points[i + 1].sun_visible) {
      return (points.length - 1 - i) * INTERVAL_HOURS;
    }
  }
  // If always visible, return total duration
  return points.length * INTERVAL_HOURS;
}

function computeTMinusEarthset(points: TelemetryPoint[]): number {
  const INTERVAL_HOURS = 2;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].earth_visible && !points[i + 1].earth_visible) {
      return (points.length - 1 - i) * INTERVAL_HOURS;
    }
  }
  return points.length * INTERVAL_HOURS;
}

function computeUptimePct(points: TelemetryPoint[], key: 'sun_visible' | 'earth_visible'): number {
  if (points.length === 0) return 0;
  const count = points.filter((p) => p[key]).length;
  return (count / points.length) * 100;
}

export function getSiteTelemetry(siteId: string, offset: LaunchOffset): SiteTelemetry {
  const sites = sitesData as SiteData[];
  const site = sites.find((s) => s.id === siteId);
  if (!site) throw new Error(`Site ${siteId} not found`);

  const ephemeris = ephemerisData as Record<string, Record<string, { start_date: string; source: string; points: EphemerisPoint[] }>>;
  const siteEphemeris = ephemeris[siteId]?.[offset];
  if (!siteEphemeris) throw new Error(`Ephemeris not found for ${siteId} ${offset}`);

  const points = processPoints(siteEphemeris.points, site.horizon_profile_deg);
  const solar_uptime_pct = computeUptimePct(points, 'sun_visible');
  const dte_uptime_pct = computeUptimePct(points, 'earth_visible');
  const max_continuous_eclipse_hours = computeMaxContinuousEclipseHours(points);
  const t_minus_sunset_hours = computeTMinusSunset(points);
  const t_minus_earthset_hours = computeTMinusEarthset(points);
  const avg_solar_eff_pct = points.reduce((sum, p) => sum + p.solar_eff_pct, 0) / points.length;

  return {
    site,
    offset,
    start_date: siteEphemeris.start_date,
    source: siteEphemeris.source,
    points,
    solar_uptime_pct,
    dte_uptime_pct,
    max_continuous_eclipse_hours,
    t_minus_sunset_hours,
    t_minus_earthset_hours,
    avg_solar_eff_pct,
  };
}

export function getAllSiteIds(): string[] {
  return (sitesData as SiteData[]).map((s) => s.id);
}

export function getAllSites(): SiteData[] {
  return sitesData as SiteData[];
}

export function getCustomCoordTelemetry(
  lat: number,
  lon: number,
  alt_km: number,
  offset: LaunchOffset
): CustomCoordTelemetry {
  const horizonProfile = buildHorizonProfileFromAlt(alt_km);
  const h_deg_val = computeSphericalHorizon(alt_km);

  // Build a synthetic site
  const site: SiteData = {
    id: 'custom',
    name: `Custom (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
    category: 'Custom Coordinates',
    lat,
    lon,
    alt_km,
    max_slope_deg: 0,
    psr_distance_km: 0,
    description: `User-defined coordinates. Spherical horizon dip: ${h_deg_val.toFixed(2)}°`,
    horizon_profile_deg: horizonProfile,
  };

  // Use the nearest real site's ephemeris as a proxy for orbital geometry
  // (In a real system, we'd query JPL Horizons for these coords)
  const ephemeris = ephemerisData as Record<string, Record<string, { start_date: string; source: string; points: EphemerisPoint[] }>>;

  // Find the real site closest in latitude
  const sites = sitesData as SiteData[];
  const nearest = sites.reduce((best, s) => {
    const d = Math.abs(s.lat - lat) + Math.abs(s.lon - lon);
    const bd = Math.abs(best.lat - lat) + Math.abs(best.lon - lon);
    return d < bd ? s : best;
  });

  const siteEphemeris = ephemeris[nearest.id]?.[offset];
  if (!siteEphemeris) throw new Error(`Ephemeris not found for ${nearest.id} ${offset}`);

  const points = processPoints(siteEphemeris.points, horizonProfile);
  const solar_uptime_pct = computeUptimePct(points, 'sun_visible');
  const dte_uptime_pct = computeUptimePct(points, 'earth_visible');
  const max_continuous_eclipse_hours = computeMaxContinuousEclipseHours(points);
  const t_minus_sunset_hours = computeTMinusSunset(points);
  const t_minus_earthset_hours = computeTMinusEarthset(points);
  const avg_solar_eff_pct = points.reduce((sum, p) => sum + p.solar_eff_pct, 0) / points.length;

  return {
    site,
    offset,
    start_date: siteEphemeris.start_date,
    source: siteEphemeris.source + ' (nearest site proxy)',
    points,
    solar_uptime_pct,
    dte_uptime_pct,
    max_continuous_eclipse_hours,
    t_minus_sunset_hours,
    t_minus_earthset_hours,
    avg_solar_eff_pct,
  };
}

export { degrees, radians };
