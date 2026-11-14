// src/lib/exportDossier.ts
// Mission dossier export utilities (CSV + JSON)

import { type SiteRankingEntry } from './ahpTopsis';
import { type SiteTelemetry } from './orbitalPhysics';

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportRankingCSV(entries: SiteRankingEntry[], offset: string): void {
  const headers = [
    'Rank',
    'Site ID',
    'Site Name',
    'Category',
    'Latitude (°)',
    'Longitude (°)',
    'Altitude (km)',
    'Solar Uptime (%)',
    'DTE Uptime (%)',
    'Max Slope (°)',
    'PSR Distance (km)',
    'Max Continuous Eclipse (hr)',
    'TOPSIS Score',
    'Slope Veto (CSA)',
    'Battery Risk (CSA)',
    'Launch Offset',
  ];

  const rows = entries.map((e) => [
    e.rank,
    e.site.id,
    `"${e.site.name}"`,
    `"${e.site.category}"`,
    e.site.lat.toFixed(4),
    e.site.lon.toFixed(4),
    e.site.alt_km.toFixed(2),
    e.solar_uptime_pct.toFixed(2),
    e.dte_uptime_pct.toFixed(2),
    e.max_slope_deg.toFixed(2),
    e.psr_distance_km.toFixed(2),
    e.max_continuous_eclipse_hours.toFixed(1),
    e.topsis_score.toFixed(4),
    e.slope_veto ? 'YES' : 'NO',
    e.battery_risk ? 'YES' : 'NO',
    offset,
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(csv, `selene-vector-301-ranking-${offset}-${timestamp}.csv`, 'text/csv');
}

export function exportRankingJSON(entries: SiteRankingEntry[], offset: string): void {
  const dossier = {
    generated_at: new Date().toISOString(),
    mission: 'Selene Vector 301',
    launch_offset: offset,
    source: 'NASA JPL Horizons + LRO LOLA',
    csa_constraints: {
      slope_veto_threshold_deg: 15.0,
      battery_risk_eclipse_hours: 24,
    },
    ahp_topsis: {
      normalization: 'vector',
      ranking_criterion: 'closeness_coefficient_C_star',
    },
    sites: entries.map((e) => ({
      rank: e.rank,
      id: e.site.id,
      name: e.site.name,
      category: e.site.category,
      lat: e.site.lat,
      lon: e.site.lon,
      alt_km: e.site.alt_km,
      description: e.site.description,
      criteria: {
        solar_uptime_pct: parseFloat(e.solar_uptime_pct.toFixed(2)),
        dte_uptime_pct: parseFloat(e.dte_uptime_pct.toFixed(2)),
        max_slope_deg: e.max_slope_deg,
        psr_distance_km: e.psr_distance_km,
        max_continuous_eclipse_hours: parseFloat(e.max_continuous_eclipse_hours.toFixed(1)),
      },
      csa_flags: {
        slope_veto: e.slope_veto,
        battery_risk: e.battery_risk,
      },
      topsis_score: parseFloat(e.topsis_score.toFixed(4)),
    })),
  };

  const json = JSON.stringify(dossier, null, 2);
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(json, `selene-vector-301-dossier-${offset}-${timestamp}.json`, 'application/json');
}

export function exportTimelineCSV(telemetry: SiteTelemetry): void {
  const headers = [
    'Time (UTC)',
    'Sun Azimuth (°)',
    'Sun Elevation (°)',
    'Earth Azimuth (°)',
    'Earth Elevation (°)',
    'Sun Visible',
    'Earth Visible',
    'Solar Efficiency (%)',
  ];

  const rows = telemetry.points.map((p) => [
    `"${p.t}"`,
    p.sun_az.toFixed(4),
    p.sun_el.toFixed(4),
    p.earth_az.toFixed(4),
    p.earth_el.toFixed(4),
    p.sun_visible ? 'YES' : 'NO',
    p.earth_visible ? 'YES' : 'NO',
    p.solar_eff_pct.toFixed(2),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const siteId = telemetry.site.id.replace(/[^a-z0-9-]/g, '');
  const timestamp = new Date().toISOString().slice(0, 10);
  downloadFile(csv, `selene-vector-301-timeline-${siteId}-${telemetry.offset}-${timestamp}.csv`, 'text/csv');
}
