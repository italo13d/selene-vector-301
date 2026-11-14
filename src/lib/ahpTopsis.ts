// src/lib/ahpTopsis.ts
// AHP-TOPSIS multicriteria decision analysis for Selene Vector 301

import { getAllSites, getSiteTelemetry, type LaunchOffset, type SiteData, type SiteTelemetry } from './orbitalPhysics';

export interface AHPWeights {
  solar_uptime_pct: number;  // Benefit, default 0.35
  dte_uptime_pct: number;    // Benefit, default 0.25
  max_slope_deg: number;     // Cost,    default 0.25
  psr_distance_km: number;   // Cost,    default 0.15
}

export const DEFAULT_WEIGHTS: AHPWeights = {
  solar_uptime_pct: 0.35,
  dte_uptime_pct: 0.25,
  max_slope_deg: 0.25,
  psr_distance_km: 0.15,
};

export interface SiteRankingEntry {
  site: SiteData;
  telemetry: SiteTelemetry;
  // Raw criteria values
  solar_uptime_pct: number;
  dte_uptime_pct: number;
  max_slope_deg: number;
  psr_distance_km: number;
  // CSA flags
  slope_veto: boolean;    // max_slope_deg > 15.0
  battery_risk: boolean;  // max_continuous_eclipse_hours > 24
  max_continuous_eclipse_hours: number;
  // TOPSIS scores
  topsis_score: number;   // Closeness coefficient C* (0-1, higher is better)
  rank: number;
}

function l2Norm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
}

export function runAHPTOPSIS(
  offset: LaunchOffset,
  weights: AHPWeights = DEFAULT_WEIGHTS
): SiteRankingEntry[] {
  const sites = getAllSites();

  // Gather telemetry for each site
  const telemetries: SiteTelemetry[] = sites.map((s) => getSiteTelemetry(s.id, offset));

  // Build the decision matrix: [n_sites x 4_criteria]
  // Criteria: solar_uptime_pct, dte_uptime_pct, max_slope_deg, psr_distance_km
  const matrix = telemetries.map((t, i) => ({
    solar_uptime_pct: t.solar_uptime_pct,
    dte_uptime_pct: t.dte_uptime_pct,
    max_slope_deg: sites[i].max_slope_deg,
    psr_distance_km: sites[i].psr_distance_km,
    max_continuous_eclipse_hours: t.max_continuous_eclipse_hours,
  }));

  // Vector normalization
  const solarNorm = l2Norm(matrix.map((r) => r.solar_uptime_pct));
  const dteNorm = l2Norm(matrix.map((r) => r.dte_uptime_pct));
  const slopeNorm = l2Norm(matrix.map((r) => r.max_slope_deg));
  const psrNorm = l2Norm(matrix.map((r) => r.psr_distance_km));

  const normalized = matrix.map((r) => ({
    solar: solarNorm > 0 ? r.solar_uptime_pct / solarNorm : 0,
    dte: dteNorm > 0 ? r.dte_uptime_pct / dteNorm : 0,
    slope: slopeNorm > 0 ? r.max_slope_deg / slopeNorm : 0,
    psr: psrNorm > 0 ? r.psr_distance_km / psrNorm : 0,
  }));

  // Weighted normalized matrix
  const weighted = normalized.map((r) => ({
    solar: r.solar * weights.solar_uptime_pct,
    dte: r.dte * weights.dte_uptime_pct,
    slope: r.slope * weights.max_slope_deg,
    psr: r.psr * weights.psr_distance_km,
  }));

  // Ideal best and worst
  // solar & dte: benefit → ideal best = max, ideal worst = min
  // slope & psr: cost → ideal best = min, ideal worst = max
  const idealBest = {
    solar: Math.max(...weighted.map((r) => r.solar)),
    dte: Math.max(...weighted.map((r) => r.dte)),
    slope: Math.min(...weighted.map((r) => r.slope)),
    psr: Math.min(...weighted.map((r) => r.psr)),
  };
  const idealWorst = {
    solar: Math.min(...weighted.map((r) => r.solar)),
    dte: Math.min(...weighted.map((r) => r.dte)),
    slope: Math.max(...weighted.map((r) => r.slope)),
    psr: Math.max(...weighted.map((r) => r.psr)),
  };

  // Distance to ideal best and worst
  const scores = weighted.map((r) => {
    const dPlus = Math.sqrt(
      (r.solar - idealBest.solar) ** 2 +
      (r.dte - idealBest.dte) ** 2 +
      (r.slope - idealBest.slope) ** 2 +
      (r.psr - idealBest.psr) ** 2
    );
    const dMinus = Math.sqrt(
      (r.solar - idealWorst.solar) ** 2 +
      (r.dte - idealWorst.dte) ** 2 +
      (r.slope - idealWorst.slope) ** 2 +
      (r.psr - idealWorst.psr) ** 2
    );
    const topsis_score = dPlus + dMinus > 0 ? dMinus / (dPlus + dMinus) : 0;
    return topsis_score;
  });

  // Build result entries
  const entries: SiteRankingEntry[] = sites.map((site, i) => ({
    site,
    telemetry: telemetries[i],
    solar_uptime_pct: matrix[i].solar_uptime_pct,
    dte_uptime_pct: matrix[i].dte_uptime_pct,
    max_slope_deg: site.max_slope_deg,
    psr_distance_km: site.psr_distance_km,
    slope_veto: site.max_slope_deg > 15.0,
    battery_risk: matrix[i].max_continuous_eclipse_hours > 24,
    max_continuous_eclipse_hours: matrix[i].max_continuous_eclipse_hours,
    topsis_score: scores[i],
    rank: 0,
  }));

  // Sort by TOPSIS score descending, vetoed sites go last
  entries.sort((a, b) => {
    if (a.slope_veto && !b.slope_veto) return 1;
    if (!a.slope_veto && b.slope_veto) return -1;
    return b.topsis_score - a.topsis_score;
  });

  // Assign ranks
  entries.forEach((e, i) => { e.rank = i + 1; });

  return entries;
}
