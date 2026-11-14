import { describe, it, expect } from 'vitest';
import { getSiteTelemetry, getCustomCoordTelemetry, getAllSites } from '../../lib/orbitalPhysics';
import { runAHPTOPSIS } from '../../lib/ahpTopsis';

describe('REQ-ASTRO-01..REQ-EXP-01 mapping tests', () => {
  it('REQ-ASTRO-01: Ephemeris window must be 169 points and horizon profiles 72 sectors', () => {
    const sites = getAllSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(Array.isArray(s.horizon_profile_deg)).toBeTruthy();
      expect(s.horizon_profile_deg.length).toBe(72);
    }
    // pick a site and ensure telemetry points length is 169 for +0d
    const t = getSiteTelemetry(sites[0].id, '+0d');
    expect(t.points.length).toBe(169);
  });

  it('REQ-ASTRO-02: Solar efficiency formula', () => {
    const t = getSiteTelemetry('apollo-11', '+0d');
    const p = t.points[0];
    // compute expected
    const expected = p.sun_visible ? Math.max(0, Math.sin((p.sun_el * Math.PI) / 180) * 100) : 0;
    expect(Math.abs(p.solar_eff_pct - expected)).toBeLessThan(1e-6);
  });

  it('REQ-ASTRO-03: Custom coordinate spherical horizon fallback', () => {
    const t0 = getCustomCoordTelemetry(0, 0, 0, '+0d');
    expect(t0.site.horizon_profile_deg.length).toBe(72);
    expect(Math.abs(t0.site.horizon_profile_deg[0])).toBeLessThan(0.2);
    const t48 = getCustomCoordTelemetry(0, 0, 4.8, '+0d');
    expect(Math.abs(t48.site.horizon_profile_deg[0] + 4.25)).toBeLessThan(0.3);
  });

  it('REQ-CSA-01 and REQ-TOPSIS-01: slope veto & battery risk flags present and scores in [0,1]', () => {
    const rankings = runAHPTOPSIS('+0d');
    expect(rankings.length).toBeGreaterThan(0);
    for (const r of rankings) {
      expect(r.topsis_score).toBeGreaterThanOrEqual(0);
      expect(r.topsis_score).toBeLessThanOrEqual(1);
      if (r.site.id === 'nobile-rim-1') expect(r.slope_veto).toBeTruthy();
      if (r.max_continuous_eclipse_hours > 24) expect(r.battery_risk).toBeTruthy();
    }
  });
});
