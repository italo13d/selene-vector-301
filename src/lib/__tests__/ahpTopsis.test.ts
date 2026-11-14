import { describe, it, expect } from 'vitest';
import { runAHPTOPSIS, DEFAULT_WEIGHTS } from '../../lib/ahpTopsis';

describe('AHP-TOPSIS engine invariants', () => {
  it('Nobile Rim 1 slope > 15 should trigger slope_veto', () => {
    const rankings = runAHPTOPSIS('+0d', DEFAULT_WEIGHTS);
    const n = rankings.find((r) => r.site.id === 'nobile-rim-1');
    expect(n).toBeDefined();
    expect(n!.slope_veto).toBeTruthy();
  });

  it('Any site with max_continuous_eclipse_hours > 24 triggers battery_risk', () => {
    const rankings = runAHPTOPSIS('+0d', DEFAULT_WEIGHTS);
    const risky = rankings.filter((r) => r.max_continuous_eclipse_hours > 24);
    for (const r of risky) {
      expect(r.battery_risk).toBeTruthy();
    }
  });

  it('Changing weights re-ranks sites and keeps closeness coefficients within [0,1]', () => {
    const base = runAHPTOPSIS('+0d', DEFAULT_WEIGHTS);
    const flipped = runAHPTOPSIS('+0d', { solar_uptime_pct: 0.1, dte_uptime_pct: 0.1, max_slope_deg: 0.6, psr_distance_km: 0.2 });
    // Scores within [0,1]
    for (const r of base) {
      expect(r.topsis_score).toBeGreaterThanOrEqual(0);
      expect(r.topsis_score).toBeLessThanOrEqual(1);
    }
    for (const r of flipped) {
      expect(r.topsis_score).toBeGreaterThanOrEqual(0);
      expect(r.topsis_score).toBeLessThanOrEqual(1);
    }
    // Ranks should differ in ordering for at least one site
    const baseOrder = base.map((r) => r.site.id).join(',');
    const flippedOrder = flipped.map((r) => r.site.id).join(',');
    expect(baseOrder === flippedOrder).toBeFalsy();
  });
});
