import { describe, it, expect } from 'vitest';
import { getSiteTelemetry, getCustomCoordTelemetry, getAllSites } from '../../lib/orbitalPhysics';
import sitesData from '../../data/sites.json';
import { computeBatteryTrajectory } from '../../lib/orbitalPhysics';

describe('Orbital physics invariants', () => {
  it('Shackleton rim (+0d) should be sunlit: high solar and moderate DTE uptime', () => {
    const telemetry = getSiteTelemetry('shackleton-rim', '+0d');
    // Solar uptime should be very high for a rim peak
    expect(telemetry.solar_uptime_pct).toBeGreaterThanOrEqual(70);
    // Direct-to-Earth (DTE) uptime should be decent for rim sites
    expect(telemetry.dte_uptime_pct).toBeGreaterThanOrEqual(45);

    // Check the horizon profile calibration: most values should be near-zero
    const site = (sitesData as any[]).find((s) => s.id === 'shackleton-rim');
    expect(site).toBeTruthy();
    const hp: number[] = site.horizon_profile_deg;
    const withinRange = hp.filter((v) => v >= -1.5 && v <= 1.2).length;
    // Allow a few narrow peaks, but the bulk should sit inside the target band
    expect(withinRange).toBeGreaterThanOrEqual(60);
  });

  it('Apollo-11 equatorial baseline (+0d) should have ~50% solar uptime and near-100% DTE', () => {
    const telemetry = getSiteTelemetry('apollo-11', '+0d');
    // Allow a reasonable band around the expected ~50% for this dataset
    expect(telemetry.solar_uptime_pct).toBeGreaterThanOrEqual(35);
    expect(telemetry.solar_uptime_pct).toBeLessThanOrEqual(75);
    expect(telemetry.dte_uptime_pct).toBeGreaterThanOrEqual(95);
  });

  it('Spherical horizon fallback at alt_km=0 is ~0°, at 4.8 km approx -4.25°', () => {
    const t0 = getCustomCoordTelemetry(0, 0, 0, '+0d');
    const h0 = t0.site.horizon_profile_deg[0];
    expect(Math.abs(h0)).toBeLessThan(0.2);

    const t48 = getCustomCoordTelemetry(0, 0, 4.8, '+0d');
    const h48 = t48.site.horizon_profile_deg[0];
    // Approximately -4.25 degrees (allow small tolerance)
    expect(Math.abs(h48 + 4.25)).toBeLessThan(0.3);
  });

  it('Telemetry countdown invariant: when initial sun is eclipsed, report ECLIPSED and t_minus_sunrise_hours', () => {
    // Find a site whose first telemetry point is eclipsed (sun_visible === false)
    const sites = getAllSites();
    let found = false;
    for (const s of sites) {
      const t = getSiteTelemetry(s.id, '+0d');
      if (t.points[0] && !t.points[0].sun_visible) {
        // The telemetry object must include a sun_countdown union with state 'ECLIPSED'
        // We check by presence of the ECLIPSED property (t_minus_sunrise_hours) and that the other (sunset) is not used
        // Type-assert using any to inspect runtime
        const anyT = t as any;
        expect(anyT.sun_countdown).toBeDefined();
        if (anyT.sun_countdown.state === 'ECLIPSED') {
          // Can be null if eclipsed for the remainder of the window
          expect(Object.prototype.hasOwnProperty.call(anyT.sun_countdown, 't_minus_sunrise_hours')).toBeTruthy();
          found = true;
          break;
        }
      }
    }
    // Ensure we found at least one eclipsed-case to validate
    expect(found).toBeTruthy();
  });

  it('REQ-CSA-02: battery trajectory drops below 20% after >24h continuous eclipse', () => {
    // Create synthetic telemetry points with 13 consecutive eclipse intervals (13*2=26h)
    const points: any[] = [];
    for (let i = 0; i < 169; i++) {
      points.push({ sun_visible: i < 5 ? true : false, solar_eff_pct: i < 5 ? 50 : 0 });
    }
    const soc = computeBatteryTrajectory(points as any, 85);
    // After 13 eclipse intervals, SoC should have fallen below 20
    // Find index at which eclipse stretch length >=13 starts
    const start = 5;
    const idx = start + 13 - 1;
    expect(soc[idx]).toBeLessThan(20);
  });
});
