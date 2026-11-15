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
  battery_soc_pct?: number; // optional until computed
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
  // Discriminated unions for countdown states
  sun_countdown: { state: 'SUNLIT'; t_minus_sunset_hours: number } | { state: 'ECLIPSED'; t_minus_sunrise_hours: number | null };
  dte_countdown: { state: 'DTE_ACTIVE'; t_minus_earthset_hours: number } | { state: 'NO_SIGNAL'; t_minus_earthrise_hours: number | null };
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

// Compute a deterministic battery state-of-charge trajectory for a sequence of telemetry points.
// - start_soc_pct: initial SoC at t=0
// - charge model: when sun_visible, charge proportional to solar_eff_pct; when eclipsed, discharge at ~3.2%/hr
export function computeBatteryTrajectory(points: TelemetryPoint[], start_soc_pct = 85): number[] {
  const INTERVAL_HOURS = 2;
  const soc: number[] = [];
  let current = start_soc_pct;
  // Defines per-hour rates
  const discharge_per_hr = 3.2; // percent per hour when eclipsed
  // charging efficiency factor: full sun (100% eff) charges at 4%/hr (tunable)
  const charge_per_hr_at_full_sun = 4.0;

  for (const p of points) {
    if (p.sun_visible) {
      const charge_rate_hr = (p.solar_eff_pct / 100) * charge_per_hr_at_full_sun;
      current = current + charge_rate_hr * INTERVAL_HOURS;
    } else {
      current = current - discharge_per_hr * INTERVAL_HOURS;
    }
    // clamp 0-100
    current = Math.max(0, Math.min(100, current));
    soc.push(current);
  }
  return soc;
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

function computeTMinusSunsetFrom(points: TelemetryPoint[], startIndex = 0): number | null {
  const INTERVAL_HOURS = 2;
  for (let i = startIndex; i < points.length - 1; i++) {
    if (points[i].sun_visible && !points[i + 1].sun_visible) {
      return (i + 1 - startIndex) * INTERVAL_HOURS;
    }
  }
  // No upcoming sunset in window
  return null;
}

function computeTMinusSunriseFrom(points: TelemetryPoint[], startIndex = 0): number | null {
  const INTERVAL_HOURS = 2;
  for (let i = startIndex; i < points.length - 1; i++) {
    if (!points[i].sun_visible && points[i + 1].sun_visible) {
      return (i + 1 - startIndex) * INTERVAL_HOURS;
    }
  }
  return null;
}

function computeTMinusEarthsetFrom(points: TelemetryPoint[], startIndex = 0): number | null {
  const INTERVAL_HOURS = 2;
  for (let i = startIndex; i < points.length - 1; i++) {
    if (points[i].earth_visible && !points[i + 1].earth_visible) {
      return (i + 1 - startIndex) * INTERVAL_HOURS;
    }
  }
  return null;
}

function computeTMinusEarthriseFrom(points: TelemetryPoint[], startIndex = 0): number | null {
  const INTERVAL_HOURS = 2;
  for (let i = startIndex; i < points.length - 1; i++) {
    if (!points[i].earth_visible && points[i + 1].earth_visible) {
      return (i + 1 - startIndex) * INTERVAL_HOURS;
    }
  }
  return null;
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
  let siteEphemeris = ephemeris[siteId]?.[offset];
  // Fallback: for South Pole sites (lat < -60) without a dedicated ephemeris, use the Shackleton reference ephemeris
  if (!siteEphemeris && site.lat < -60) {
    const proxy = ephemeris['shackleton-rim']?.[offset];
    if (proxy) {
      siteEphemeris = {
        start_date: proxy.start_date,
        source: proxy.source + ' (proxy: shackleton-rim)',
        points: proxy.points,
      };
    }
  }
  if (!siteEphemeris) throw new Error(`Ephemeris not found for ${siteId} ${offset}`);

  const points = processPoints(siteEphemeris.points, site.horizon_profile_deg);
  // Compute battery trajectory for real sites as well; ensure T+000h SoC starts at 85.0
  const batteryTrajectory = computeBatteryTrajectory(points, 85);
  // Ensure T+000h SoC is the declared start percentage (85.0) and subsequent points follow the trajectory
  if (points.length > 0) {
    (points[0] as TelemetryPoint).battery_soc_pct = 85;
    for (let i = 1; i < points.length; i++) {
      (points[i] as TelemetryPoint).battery_soc_pct = batteryTrajectory[i - 1];
    }
  }
  const solar_uptime_pct = computeUptimePct(points, 'sun_visible');
  const dte_uptime_pct = computeUptimePct(points, 'earth_visible');
  const max_continuous_eclipse_hours = computeMaxContinuousEclipseHours(points);
  // Build discriminated countdown states based on the initial point
  let sun_countdown: SiteTelemetry['sun_countdown'];
  if (points[0].sun_visible) {
    const tm = computeTMinusSunsetFrom(points, 0);
    // If no sunset in-window, cap to window duration (T+336h == (points.length-1)*2)
    const capped = (points.length - 1 - 0) * 2;
    sun_countdown = { state: 'SUNLIT', t_minus_sunset_hours: tm === null ? capped : tm };
  } else {
    const tm = computeTMinusSunriseFrom(points, 0);
    sun_countdown = { state: 'ECLIPSED', t_minus_sunrise_hours: tm };
  }

  let dte_countdown: SiteTelemetry['dte_countdown'];
  if (points[0].earth_visible) {
    const tm = computeTMinusEarthsetFrom(points, 0);
    const capped = (points.length - 1 - 0) * 2;
    dte_countdown = { state: 'DTE_ACTIVE', t_minus_earthset_hours: tm === null ? capped : tm };
  } else {
    const tm = computeTMinusEarthriseFrom(points, 0);
    dte_countdown = { state: 'NO_SIGNAL', t_minus_earthrise_hours: tm };
  }
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
    sun_countdown,
    dte_countdown,
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
  const avg_solar_eff_pct = points.reduce((sum, p) => sum + p.solar_eff_pct, 0) / points.length;

  // Compute battery trajectory and attach to points
  const batteryTrajectory = computeBatteryTrajectory(points, 85);
  if (points.length > 0) {
    (points[0] as TelemetryPoint).battery_soc_pct = 85;
    for (let i = 1; i < points.length; i++) {
      (points[i] as TelemetryPoint).battery_soc_pct = batteryTrajectory[i - 1];
    }
  }

  // Discriminated countdown states for custom site (based on initial point)
  let sun_countdown: SiteTelemetry['sun_countdown'];
  if (points[0].sun_visible) {
    const tm = computeTMinusSunsetFrom(points, 0);
    sun_countdown = { state: 'SUNLIT', t_minus_sunset_hours: tm === null ? points.length * 2 : tm };
  } else {
    const tm = computeTMinusSunriseFrom(points, 0);
    sun_countdown = { state: 'ECLIPSED', t_minus_sunrise_hours: tm };
  }

  let dte_countdown: SiteTelemetry['dte_countdown'];
  if (points[0].earth_visible) {
    const tm = computeTMinusEarthsetFrom(points, 0);
    dte_countdown = { state: 'DTE_ACTIVE', t_minus_earthset_hours: tm === null ? points.length * 2 : tm };
  } else {
    const tm = computeTMinusEarthriseFrom(points, 0);
    dte_countdown = { state: 'NO_SIGNAL', t_minus_earthrise_hours: tm };
  }

  return {
    site,
    offset,
    start_date: siteEphemeris.start_date,
    source: siteEphemeris.source + ' (nearest site proxy)',
    points,
    solar_uptime_pct,
    dte_uptime_pct,
    max_continuous_eclipse_hours,
    sun_countdown,
    dte_countdown,
    avg_solar_eff_pct,
  };
}

export { degrees, radians };
