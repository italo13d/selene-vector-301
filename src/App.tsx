import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Satellite, Radio, Zap, Clock, Sun, Globe, ChevronRight,
  MapPin, Gauge, Activity, Eye, EyeOff, Info, X
} from 'lucide-react';
import { PolarHorizonChart } from './components/PolarHorizonChart';
import LunarOrbitalGlobe from './components/LunarOrbitalGlobe';
import { SiteRankingTable } from './components/SiteRankingTable';
import {
  getSiteTelemetry, getCustomCoordTelemetry, getAllSites,
  type LaunchOffset, type SiteData, type SiteTelemetry, type TelemetryPoint
} from './lib/orbitalPhysics';
import { runAHPTOPSIS, DEFAULT_WEIGHTS, type AHPWeights, type SiteRankingEntry } from './lib/ahpTopsis';
import { exportTimelineCSV } from './lib/exportDossier';

type AppMode = 'flight-director' | 'explorer';

const LAUNCH_OFFSETS: { label: string; value: LaunchOffset }[] = [
  { label: 'Nominal +0d', value: '+0d' },
  { label: 'Delay +7d', value: '+7d' },
  { label: 'Delay +14d', value: '+14d' },
  { label: 'Delay +30d', value: '+30d' },
];

type MissionProgramTag = 'Apollo' | 'Artemis III' | 'CLPS';
type CountdownAlertState = 'nominal' | 'warning' | 'critical';
type GuidedExperimentId = 'pole-vs-apollo-11' | 'launch-delay-14d' | 'steep-crater-veto';

const MISSION_PROGRAM_STYLES: Record<MissionProgramTag, { background: string; border: string; color: string }> = {
  Apollo: { background: '#06B6D41F', border: '#06B6D455', color: '#67E8F9' },
  'Artemis III': { background: '#F59E0B1F', border: '#F59E0B55', color: '#FCD34D' },
  CLPS: { background: '#3B82F61F', border: '#3B82F655', color: '#93C5FD' },
};

const COUNTDOWN_INTERVAL_HOURS = 2;
const MAX_PINNED_COMPARE_SITES = 2;
const COMPARISON_WINDOW_POINTS = 169;

type DeltaDirection = 'benefit' | 'cost';

function sanitizeComparedSiteIds(siteIds: string[], sites: SiteData[]): string[] {
  return siteIds
    .filter((siteId, index, arr) => (
      arr.indexOf(siteId) === index
      && sites.some((site) => site.id === siteId)
    ))
    .slice(0, MAX_PINNED_COMPARE_SITES);
}

function formatDelta(
  value: number | undefined,
  baseline: number | undefined,
  direction: DeltaDirection,
  decimals: number,
  suffix = ''
): { label: string; color: string } {
  if (value === undefined || baseline === undefined) {
    return { label: 'Δ --', color: '#F8FAFC40' };
  }

  const threshold = Math.pow(10, -decimals) / 2;
  const rawDelta = value - baseline;
  const normalizedDelta = Math.abs(rawDelta) < threshold ? 0 : rawDelta;
  const sign = normalizedDelta > 0 ? '+' : '';
  const label = `Δ ${sign}${normalizedDelta.toFixed(decimals)}${suffix}`;

  if (normalizedDelta === 0) {
    return { label, color: '#F8FAFC40' };
  }

  const positiveOutcome = direction === 'benefit'
    ? normalizedDelta > 0
    : normalizedDelta < 0;

  return {
    label,
    color: positiveOutcome ? '#22C55E' : '#EF4444',
  };
}

function deriveMissionProgramTag(site: SiteData & { mission_program?: string | null }): MissionProgramTag {
  const missionProgram = (site.mission_program ?? '').toLowerCase();
  const category = site.category.toLowerCase();
  const name = site.name.toLowerCase();

  if (missionProgram.includes('apollo') || name.includes('apollo')) return 'Apollo';
  if (missionProgram.includes('artemis') || category.includes('artemis')) return 'Artemis III';
  if (missionProgram.includes('clps') || category.includes('clps') || category.includes('rover')) return 'CLPS';

  return 'CLPS';
}

function getHorizonElevationAtAzimuth(az: number, horizonProfile: number[]): number {
  const idx = Math.round((((az % 360) + 360) % 360) / 5) % 72;
  return horizonProfile[idx] ?? 0;
}

function getCountdownTransitionHours(
  points: TelemetryPoint[],
  startIndex: number,
  key: 'sun_visible' | 'earth_visible',
  fromVisible: boolean,
  toVisible: boolean,
  horizonProfile: number[],
  body: 'sun' | 'earth'
): number | null {
  for (let i = startIndex; i < points.length - 1; i++) {
    if (points[i][key] === fromVisible && points[i + 1][key] === toVisible) {
      const fromPoint = points[i];
      const toPoint = points[i + 1];
      const fromEl = body === 'sun' ? fromPoint.sun_el : fromPoint.earth_el;
      const toEl = body === 'sun' ? toPoint.sun_el : toPoint.earth_el;
      const fromAz = body === 'sun' ? fromPoint.sun_az : fromPoint.earth_az;
      const toAz = body === 'sun' ? toPoint.sun_az : toPoint.earth_az;
      const fromDelta = fromEl - getHorizonElevationAtAzimuth(fromAz, horizonProfile);
      const toDelta = toEl - getHorizonElevationAtAzimuth(toAz, horizonProfile);
      const denominator = fromDelta - toDelta;
      const crossingFraction = Math.abs(denominator) > 1e-6
        ? Math.min(1, Math.max(0, fromDelta / denominator))
        : 1;
      return (i - startIndex + crossingFraction) * COUNTDOWN_INTERVAL_HOURS;
    }
  }
  return null;
}

// Lunar horizon emblem SVG
const LunarEmblem: React.FC = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <circle cx="20" cy="20" r="18" fill="none" stroke="#1E293B" strokeWidth="1.5" />
    {/* Moon silhouette */}
    <circle cx="20" cy="20" r="12" fill="#090D16" stroke="#3B82F6" strokeWidth="1" />
    {/* Horizon line */}
    <line x1="8" y1="20" x2="32" y2="20" stroke="#1E293B" strokeWidth="0.5" />
    {/* Terrain peaks */}
    <polyline points="8,20 11,16 14,18 17,13 20,16 23,14 26,18 29,16 32,20" fill="none" stroke="#3B82F6" strokeWidth="1.2" strokeLinejoin="round" />
    {/* Sun dot */}
    <circle cx="30" cy="12" r="3" fill="#F59E0B" opacity="0.9" />
    {/* Earth dot */}
    <circle cx="10" cy="10" r="2" fill="#06B6D4" opacity="0.8" />
    {/* Stars */}
    <circle cx="15" cy="8" r="0.5" fill="#F8FAFC" opacity="0.6" />
    <circle cx="25" cy="6" r="0.4" fill="#F8FAFC" opacity="0.5" />
    <circle cx="33" cy="9" r="0.4" fill="#F8FAFC" opacity="0.4" />
  </svg>
);

// T-Minus countdown card
const TMinusCard: React.FC<{
  label: string;
  hours: number;
  color: string;
  icon: React.ReactNode;
  alertState?: CountdownAlertState;
}> = ({ label, hours, color, icon, alertState = 'nominal' }) => {
  const h = Math.floor(Math.abs(hours));
  const m = Math.floor((Math.abs(hours) - h) * 60);

  const palette = alertState === 'critical'
    ? {
      background: '#EF444420',
      border: '#EF4444AA',
      label: '#FCA5A5',
      value: '#FECACA',
      shadow: '0 0 18px #EF444455',
    }
    : alertState === 'warning'
      ? {
        background: '#F59E0B20',
        border: '#F59E0BAA',
        label: '#FCD34D',
        value: '#FEF3C7',
        shadow: '0 0 16px #F59E0B55',
      }
      : {
        background: '#090D16',
        border: `${color}30`,
        label: `${color}80`,
        value: color,
        shadow: 'none',
      };

  return (
    <div
      className="flex flex-col gap-1 p-4 rounded-lg"
      style={{ background: palette.background, border: `1px solid ${palette.border}`, boxShadow: palette.shadow }}
    >
      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: palette.label }}>
        {icon}
        {label}
      </div>
      <div className="font-mono font-bold text-2xl" style={{ color: palette.value, letterSpacing: '0.08em' }}>
        T-{h.toString().padStart(3, '0')}:{m.toString().padStart(2, '0')}
      </div>
      <div className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>hrs:min</div>
    </div>
  );
};

const CUSTOM_HORIZON_NOTICE = 'Idealized Spherical Horizon (0° flat terrain — LRO LOLA 72-sector mask unavailable for arbitrary coordinates)';
const NOMINAL_SURFACE_WINDOW_NOTICE = 'Nominal CLPS / Artemis Surface Window (14 Earth Days / 336h — half synodic lunar day, pre-lunar-night operations)';

const ScientificTransparencyBadge: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`rounded-lg border px-3 py-2 ${className ?? ''}`}
    style={{ background: '#1E293B80', borderColor: '#F59E0B55' }}
  >
    <div className="text-xs font-mono font-bold leading-snug" style={{ color: '#F59E0B' }}>
      {CUSTOM_HORIZON_NOTICE}
    </div>
    <div className="mt-1 text-xs font-mono leading-snug" style={{ color: '#F8FAFCB3' }}>
      Polar lighting and solar uptime may be overestimated versus LOLA-surveyed sites because local crater-rim masking is unavailable.
    </div>
  </div>
);

// 14-day timeline bar component
const TimelineBar: React.FC<{ points: Array<{ sun_visible: boolean; earth_visible: boolean }>; onScrub: (idx: number) => void; currentIdx: number }> = ({
  points,
  onScrub,
  currentIdx,
}) => {
  const displayPoints = points.slice(0, 169); // 14 days at 2-hour intervals (T+0h..T+336h)
  const activeIdx = Math.max(0, Math.min(currentIdx, Math.max(displayPoints.length - 1, 0)));
  const needleLeftPct = displayPoints.length > 0
    ? ((activeIdx + 0.5) / displayPoints.length) * 100
    : 0;

  return (
    <div>
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="space-y-1">
          <span className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>14-DAY POWER + DTE TIMELINE</span>
          <div
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ color: '#F8FAFCB3', background: '#1E293B', border: '1px solid #3B82F640', maxWidth: 560, lineHeight: 1.35 }}
          >
            {NOMINAL_SURFACE_WINDOW_NOTICE}
          </div>
        </div>
        <span className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>{points.length} points @ 2hr</span>
      </div>
      <div className="relative">
        <div
          className="flex gap-px cursor-pointer rounded overflow-hidden"
          style={{ height: 24 }}
          role="slider"
          aria-label="Timeline scrubber"
          aria-valuenow={activeIdx}
          aria-valuemin={0}
          aria-valuemax={displayPoints.length - 1}
        >
          {displayPoints.map((p, i) => {
            let color = '#1E293B'; // eclipse
            if (p.sun_visible && p.earth_visible) color = '#22c55e';
            else if (p.sun_visible) color = '#F59E0B';
            else if (p.earth_visible) color = '#06B6D4';

            return (
              <div
                key={i}
                onClick={() => onScrub(i)}
                className="flex-1"
                style={{
                  background: color,
                  minWidth: 2,
                  border: i === activeIdx ? '1px solid #FFFFFF' : '1px solid transparent',
                  boxSizing: 'border-box',
                  zIndex: i === activeIdx ? 20 : 1,
                }}
                title={`T+${(i * 2).toString().padStart(3, '0')}h — Solar: ${p.sun_visible ? 'ON' : 'OFF'}, DTE: ${p.earth_visible ? 'ON' : 'OFF'}`}
              />
            );
          })}
        </div>
        {displayPoints.length > 0 && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(${needleLeftPct}% - 1px)`,
              width: 2,
              background: '#FFFFFF',
              boxShadow: '0 0 0 1px #090D16, 0 0 12px #FFFFFF99',
              zIndex: 30,
            }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 text-xs font-mono" style={{ color: '#F8FAFC30' }}>
        <span>T+0h</span>
        <span>T+{Math.min(points.length * 2, 336)}h (14d)</span>
      </div>
      {/* Legend */}
      <div className="flex gap-3 mt-2 text-xs font-mono flex-wrap">
        {[
          { color: '#22c55e', label: 'Solar + DTE' },
          { color: '#F59E0B', label: 'Solar Only' },
          { color: '#06B6D4', label: 'DTE Only' },
          { color: '#1E293B', label: 'Eclipse' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ color: '#F8FAFC60' }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const ComparisonWindowStrip: React.FC<{ points: TelemetryPoint[] }> = ({ points }) => {
  const displayPoints = points.slice(0, COMPARISON_WINDOW_POINTS);

  return (
    <div>
      <div className="text-[10px] font-mono mb-1" style={{ color: '#F8FAFC60' }}>336H WINDOW STRIP</div>
      <div
        className="flex gap-px rounded overflow-hidden"
        style={{ height: 10 }}
        aria-label="336 hour solar and DTE strip"
      >
        {displayPoints.map((point, idx) => {
          let color = '#FB7185';
          let label = 'Blackout';

          if (point.sun_visible && point.earth_visible) {
            color = '#10B981';
            label = 'Solar + DTE';
          } else if (point.earth_visible) {
            color = '#06B6D4';
            label = 'DTE Only';
          }

          return (
            <span
              key={`${point.t}-${idx}`}
              className="flex-1"
              style={{ background: color, minWidth: 1 }}
              title={`T+${(idx * 2).toString().padStart(3, '0')}h - ${label}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono" style={{ color: '#F8FAFC40' }}>
        <span>T+000h</span>
        <span>T+336h</span>
      </div>
    </div>
  );
};

// Explorer Mode insights
const ExplorerMode: React.FC<{
  rankings: SiteRankingEntry[];
  telemetry: SiteTelemetry | null;
  site: SiteData;
  isCustomCoordActive: boolean;
  onRunGuidedExperiment: (experimentId: GuidedExperimentId) => void;
  activeGuidedExperimentId: GuidedExperimentId | null;
  guidedExperimentTakeaway: string | null;
}> = ({
  rankings,
  telemetry,
  site,
  isCustomCoordActive,
  onRunGuidedExperiment,
  activeGuidedExperimentId,
  guidedExperimentTakeaway,
}) => {
  const topSite = rankings.find((e) => !e.slope_veto);
  const apollo = rankings.find((e) => e.site.id === 'apollo-11');
  const missionWindowHours = 336;
  const solarHours = telemetry ? (telemetry.solar_uptime_pct / 100) * missionWindowHours : 0;
  const eclipseHours = telemetry ? Math.max(0, missionWindowHours - solarHours) : 0;
  const dteBlackoutHours = telemetry ? ((100 - telemetry.dte_uptime_pct) / 100) * missionWindowHours : 0;
  const hasBatteryFreezeRisk = telemetry ? telemetry.max_continuous_eclipse_hours > 24 : false;
  const hasSlopeVeto = site.max_slope_deg > 15;

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
        <h3 className="font-heading font-bold text-lg mb-3" style={{ color: '#F8FAFC' }}>
          Mission Story &amp; Survival Brief
        </h3>
        <div className="space-y-3 text-sm leading-relaxed" style={{ color: '#F8FAFCB3' }}>
          <p>
            In this nominal 14-Earth-day surface window, <strong style={{ color: '#F8FAFC' }}>{site.name}</strong> gets
            {' '}
            <strong style={{ color: '#F59E0B' }}>{telemetry ? `${telemetry.solar_uptime_pct.toFixed(1)}% sunlight (~${solarHours.toFixed(0)}h)` : '--'}</strong>
            {' '}
            and
            {' '}
            <strong style={{ color: '#F8FAFC' }}>{telemetry ? `~${eclipseHours.toFixed(0)}h in shadow` : '--'}</strong>.
            Long eclipse stretches can cold-soak exposed hardware toward approximately -170C.
          </p>
          <p style={{ color: hasBatteryFreezeRisk ? '#FCA5A5' : '#F8FAFCB3' }}>
            {telemetry
              ? hasBatteryFreezeRisk
                ? `Warning: maximum continuous eclipse reaches ${telemetry.max_continuous_eclipse_hours.toFixed(1)}h (above the 24h battery-survival limit), increasing freeze risk for batteries and avionics.`
                : `Maximum continuous eclipse is ${telemetry.max_continuous_eclipse_hours.toFixed(1)}h, which remains below the 24h battery-survival warning threshold.`
              : 'Telemetry unavailable for eclipse-risk translation.'}
          </p>
          <p>
            Earth appears to trace a figure-8 (libration analemma) close to the horizon. Even while the lander is stationary,
            crater rims can block that low Earth track and drop line-of-sight radio.
            {' '}
            <strong style={{ color: '#06B6D4' }}>
              {telemetry ? `Expected DTE (Direct-to-Earth) blackout is about ${dteBlackoutHours.toFixed(0)}h in this window (${(100 - telemetry.dte_uptime_pct).toFixed(1)}%).` : 'Direct-to-Earth uptime unavailable.'}
            </strong>
          </p>
          <p style={{ color: hasSlopeVeto ? '#FCA5A5' : '#F8FAFCB3' }}>
            CSA rover mobility limit is 15°. This site is
            {' '}
            <strong style={{ color: hasSlopeVeto ? '#EF4444' : '#22c55e' }}>{site.max_slope_deg.toFixed(1)}°</strong>
            {' '}
            —
            {' '}
            {hasSlopeVeto
              ? 'above the limit, so wheel slip and tip-over risk become operationally unacceptable (hard veto).'
              : 'within limit, lowering tip-over risk during traverses.'}
          </p>
        </div>
        <div
          className="mt-4 pt-3"
          style={{ borderTop: '1px solid #1E293B' }}
        >
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="text-xs font-mono" style={{ color: '#F8FAFC80' }}>Try a Guided Experiment</div>
            <div className="flex flex-wrap gap-2">
              {([
                { id: 'pole-vs-apollo-11', label: '1. Pole vs. Apollo 11' },
                { id: 'launch-delay-14d', label: '2. +14d Launch Delay' },
                { id: 'steep-crater-veto', label: '3. Steep Crater Veto (>15°)' },
              ] as const).map((experiment) => {
                const isActive = activeGuidedExperimentId === experiment.id;
                return (
                  <button
                    key={experiment.id}
                    type="button"
                    onClick={() => onRunGuidedExperiment(experiment.id)}
                    className="px-2.5 py-1.5 rounded text-xs font-mono transition-colors"
                    style={{
                      background: isActive ? '#3B82F6' : '#090D16',
                      border: `1px solid ${isActive ? '#3B82F6' : '#334155'}`,
                      color: isActive ? '#F8FAFC' : '#CBD5E1',
                    }}
                    aria-pressed={isActive}
                  >
                    {experiment.label}
                  </button>
                );
              })}
            </div>
          </div>
          {guidedExperimentTakeaway && (
            <p className="mt-2 text-xs font-mono" style={{ color: '#67E8F9' }}>
              {guidedExperimentTakeaway}
            </p>
          )}
        </div>
        {isCustomCoordActive && <ScientificTransparencyBadge className="mt-4" />}
      </div>

      <div className="p-5 rounded-xl" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
        <h3 className="font-heading font-bold text-lg mb-3" style={{ color: '#F8FAFC' }}>
          🌑 Lunar South Pole — Perpetual Twilight
        </h3>
        <p className="text-sm leading-relaxed mb-4" style={{ color: '#F8FAFC80' }}>
          Sites near the lunar south pole experience <strong style={{ color: '#F59E0B' }}>near-continuous sunlight</strong> —
          the Sun grazes the horizon without setting, delivering steady low-angle illumination
          year-round. This is caused by the Moon's minimal axial tilt (1.54°), which keeps polar
          ridges in permanent or near-permanent daylight.
        </p>
        {topSite && (
          <div className="p-3 rounded-lg" style={{ background: '#090D16', border: '1px solid #F59E0B30' }}>
            <div className="text-xs font-mono mb-1" style={{ color: '#F59E0B' }}>TOP RECOMMENDED SITE</div>
            <div className="font-heading font-bold" style={{ color: '#F8FAFC' }}>{topSite.site.name}</div>
            <div className="text-sm mt-1" style={{ color: '#F8FAFC80' }}>
              Solar uptime: <strong style={{ color: '#F59E0B' }}>{topSite.solar_uptime_pct.toFixed(1)}%</strong> ·
              DTE (Direct-to-Earth) uptime: <strong style={{ color: '#06B6D4' }}>{topSite.dte_uptime_pct.toFixed(1)}%</strong> ·
              AHP-TOPSIS Score: <strong style={{ color: '#F8FAFC' }}>{topSite.topsis_score.toFixed(3)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="p-5 rounded-xl" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
        <h3 className="font-heading font-bold text-lg mb-3" style={{ color: '#F8FAFC' }}>
          🌍 Earth Libration — The Figure-8 Dance
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: '#F8FAFC80' }}>
          From the lunar south pole, Earth appears at a nearly constant azimuth — hovering just
          above the horizon in a slow figure-8 libration pattern. This is because the Moon's
          slight orbital eccentricity and tilt cause Earth to "wobble" in the sky, tracing
          a path called the <em>analemma</em>. For missions at high latitudes, Earth's
          low elevation means it can dip below crater rims, creating brief
          <strong style={{ color: '#06B6D4' }}> communication blackout windows</strong>.
        </p>
      </div>

      <div className="p-5 rounded-xl" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
        <h3 className="font-heading font-bold text-lg mb-3" style={{ color: '#F8FAFC' }}>
          🚀 vs. Apollo 11 — The Equatorial Baseline
        </h3>
        {apollo && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: '#F8FAFC80' }}>
              Apollo 11's Mare Tranquillitatis landing site demonstrates the <strong>equatorial day-night cycle</strong>:
              a sharp ~354-hour (14.75 Earth-day) on/off pattern. The site spends half its lunar day
              in complete darkness — unusable for solar-powered missions.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg" style={{ background: '#090D16', border: '1px solid #3B82F680' }}>
                <div className="text-xs font-mono mb-1" style={{ color: '#3B82F6' }}>APOLLO 11 — EQUATORIAL</div>
                <div className="text-xs font-mono space-y-1">
                  <div style={{ color: '#F8FAFC80' }}>Solar: <span style={{ color: '#F59E0B' }}>{apollo.solar_uptime_pct.toFixed(1)}%</span></div>
                  <div style={{ color: '#F8FAFC80' }}>DTE (Direct-to-Earth): <span style={{ color: '#06B6D4' }}>{apollo.dte_uptime_pct.toFixed(1)}%</span></div>
                  <div style={{ color: '#F8FAFC80' }}>PSR (Permanently Shadowed Region): <span style={{ color: '#3B82F6' }}>{apollo.psr_distance_km.toFixed(0)} km</span></div>
                </div>
              </div>
              {topSite && (
                <div className="p-3 rounded-lg" style={{ background: '#090D16', border: '1px solid #F59E0B80' }}>
                  <div className="text-xs font-mono mb-1" style={{ color: '#F59E0B' }}>BEST POLAR SITE</div>
                  <div className="text-xs font-mono space-y-1">
                    <div style={{ color: '#F8FAFC80' }}>Solar: <span style={{ color: '#F59E0B' }}>{topSite.solar_uptime_pct.toFixed(1)}%</span></div>
                    <div style={{ color: '#F8FAFC80' }}>DTE (Direct-to-Earth): <span style={{ color: '#06B6D4' }}>{topSite.dte_uptime_pct.toFixed(1)}%</span></div>
                    <div style={{ color: '#F8FAFC80' }}>PSR (Permanently Shadowed Region): <span style={{ color: '#3B82F6' }}>{topSite.psr_distance_km.toFixed(1)} km</span></div>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>
              Polar sites provide dramatically better power and comm availability —
              critical for crewed surface operations and rover endurance.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

const ExplorerTelemetryCards: React.FC<{
  currentPoint?: TelemetryPoint;
  site: SiteData;
}> = ({ currentPoint, site }) => {
  const cards = [
    {
      label: 'Solar Efficiency',
      value: currentPoint ? `${currentPoint.solar_eff_pct.toFixed(1)}%` : '--',
      subtitle: 'Low Sun angles can keep charging weak even while sunlight is visible.',
      color: '#F59E0B',
      icon: <Sun size={14} />,
    },
    {
      label: 'DTE (Direct-to-Earth) Link',
      value: currentPoint ? (currentPoint.earth_visible ? 'LINK ACTIVE' : 'BLOCKED') : '--',
      subtitle: 'Crater rims can hide Earth near the horizon and interrupt direct-to-Earth comms.',
      color: currentPoint?.earth_visible ? '#06B6D4' : '#EF4444',
      icon: <Radio size={14} />,
    },
    {
      label: 'Battery SoC (Battery State of Charge)',
      value: currentPoint?.battery_soc_pct !== undefined ? `${currentPoint.battery_soc_pct.toFixed(1)}%` : '--',
      subtitle: 'Long shadow periods force battery-only survival operations.',
      color: currentPoint?.battery_soc_pct !== undefined && currentPoint.battery_soc_pct < 20 ? '#EF4444' : '#22c55e',
      icon: <Gauge size={14} />,
    },
    {
      label: 'PSR (Permanently Shadowed Region) Distance',
      value: `${site.psr_distance_km.toFixed(1)} km`,
      subtitle: 'Closer ice targets are useful, but shadowed terrain raises ops risk.',
      color: '#3B82F6',
      icon: <Activity size={14} />,
    },
  ];

  return (
    <div className="p-4 rounded-xl" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
      <div className="text-xs font-mono mb-3" style={{ color: '#F8FAFC60' }}>EXPLORER TELEMETRY QUICKLOOK</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cards.map(({ label, value, subtitle, color, icon }) => (
          <div key={label} className="p-3 rounded-lg" style={{ background: '#090D16', border: '1px solid #1E293B' }}>
            <div className="flex items-center gap-1.5 text-xs font-mono mb-1" style={{ color: '#F8FAFC80' }}>
              <span style={{ color }}>{icon}</span>
              {label}
            </div>
            <div className="font-mono font-bold text-base" style={{ color }}>{value}</div>
            <div className="text-xs mt-1" style={{ color: '#F8FAFC80' }}>{subtitle}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Custom coordinates panel
interface CustomCoordsState {
  lat: string;
  lon: string;
  alt_km: string;
  active: boolean;
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('flight-director');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('shackleton-rim');
  const [offset, setOffset] = useState<LaunchOffset>('+0d');
  const [weights, setWeights] = useState<AHPWeights>({ ...DEFAULT_WEIGHTS });
  const [timelineIdx, setTimelineIdx] = useState(0);
  const [customCoords, setCustomCoords] = useState<CustomCoordsState>({
    lat: '', lon: '', alt_km: '', active: false,
  });
  const [siteQuery, setSiteQuery] = useState('');
  const [guidedExperimentTakeaway, setGuidedExperimentTakeaway] = useState<string | null>(null);
  const [activeGuidedExperimentId, setActiveGuidedExperimentId] = useState<GuidedExperimentId | null>(null);

  const sites = useMemo(() => getAllSites(), []);
  const highestSlopeVetoSite = useMemo(() => (
    sites
      .filter((site) => site.max_slope_deg > 15)
      .sort((a, b) => b.max_slope_deg - a.max_slope_deg)[0]
    ?? sites.find((site) => site.id === 'faustini-rim-a')
    ?? null
  ), [sites]);

  // Load telemetry for the selected site
  const telemetry: SiteTelemetry | null = useMemo(() => {
    try {
      if (customCoords.active) {
        const lat = parseFloat(customCoords.lat);
        const lon = parseFloat(customCoords.lon);
        const alt = parseFloat(customCoords.alt_km);
        if (!isNaN(lat) && !isNaN(lon) && !isNaN(alt)) {
          return getCustomCoordTelemetry(lat, lon, alt, offset) as unknown as SiteTelemetry;
        }
      }
      return getSiteTelemetry(selectedSiteId, offset);
    } catch {
      return null;
    }
  }, [selectedSiteId, offset, customCoords]);

  // AHP-TOPSIS rankings
  const rankings: SiteRankingEntry[] = useMemo(() => {
    try {
      return runAHPTOPSIS(offset, weights);
    } catch {
      return [];
    }
  }, [offset, weights]);

  const currentPoint = telemetry?.points[timelineIdx];
  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) ?? sites[0],
    [sites, selectedSiteId]
  );

  const countdownStatus = useMemo(() => {
    if (!telemetry || telemetry.points.length === 0) return null;

    const points = telemetry.points;
    const horizonProfile = telemetry.site.horizon_profile_deg;
    const startIndex = Math.max(0, Math.min(timelineIdx, points.length - 1));
    const point = points[startIndex];
    const remainingWindowHours = Math.max(0, (points.length - 1 - startIndex) * COUNTDOWN_INTERVAL_HOURS);

    const tMinusSunset = getCountdownTransitionHours(points, startIndex, 'sun_visible', true, false, horizonProfile, 'sun') ?? remainingWindowHours;
    const tMinusSunrise = getCountdownTransitionHours(points, startIndex, 'sun_visible', false, true, horizonProfile, 'sun') ?? remainingWindowHours;
    const tMinusEarthset = getCountdownTransitionHours(points, startIndex, 'earth_visible', true, false, horizonProfile, 'earth') ?? remainingWindowHours;
    const tMinusEarthrise = getCountdownTransitionHours(points, startIndex, 'earth_visible', false, true, horizonProfile, 'earth') ?? remainingWindowHours;

    const sunState: CountdownAlertState = point.sun_visible
      ? (tMinusSunset < 12 ? 'warning' : 'nominal')
      : 'critical';
    const earthState: CountdownAlertState = point.earth_visible
      ? (tMinusEarthset < 12 ? 'warning' : 'nominal')
      : 'critical';

    return {
      sun: {
        label: point.sun_visible ? 'T-MINUS SUNSET' : 'T-MINUS SUNRISE',
        hours: point.sun_visible ? tMinusSunset : tMinusSunrise,
        state: sunState,
      },
      earth: {
        label: point.earth_visible ? 'T-MINUS EARTHSET' : 'T-MINUS EARTHRISE',
        hours: point.earth_visible ? tMinusEarthset : tMinusEarthrise,
        state: earthState,
      },
    };
  }, [telemetry, timelineIdx]);

  const batteryCriticalInWindow = useMemo(() => {
    if (!telemetry) return false;
    return telemetry.points.some((p) => (p.battery_soc_pct ?? 100) < 20);
  }, [telemetry]);

  const handleSiteSelect = useCallback((id: string) => {
    setSelectedSiteId(id);
    setTimelineIdx(0);
    setCustomCoords((c) => ({ ...c, active: false }));
  }, []);

  const handleCustomApply = () => {
    const lat = parseFloat(customCoords.lat);
    const lon = parseFloat(customCoords.lon);
    const alt = parseFloat(customCoords.alt_km);
    if (!isNaN(lat) && !isNaN(lon) && !isNaN(alt)) {
      setCustomCoords((c) => ({ ...c, active: true }));
      setTimelineIdx(0);
    }
  };

  const displaySite = customCoords.active && telemetry ? telemetry.site : selectedSite;
  const activeSiteId = displaySite.id;
  const isCustomCoordActive = customCoords.active || selectedSiteId === 'custom' || displaySite.id === 'custom';
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [comparedSiteIds, setComparedSiteIds] = useState<string[]>([]);
  const [focusedGlobeSiteId, setFocusedGlobeSiteId] = useState<string>(selectedSiteId);

  const selectedRankingEntry = useMemo(
    () => rankings.find((entry) => entry.site.id === displaySite.id),
    [rankings, displaySite.id]
  );

  const rankingBySiteId = useMemo(
    () => new Map(rankings.map((entry) => [entry.site.id, entry])),
    [rankings]
  );

  const defaultComparedSiteId = useMemo(() => {
    const apollo = sites.find((site) => site.id === 'apollo-11' && site.id !== activeSiteId);
    if (apollo) return apollo.id;
    return sites.find((site) => site.id !== activeSiteId)?.id;
  }, [sites, activeSiteId]);

  useEffect(() => {
    setComparedSiteIds((current) => {
      const sanitized = sanitizeComparedSiteIds(current, sites);
      return sanitized.length === current.length && sanitized.every((id, idx) => id === current[idx])
        ? current
        : sanitized;
    });
  }, [sites]);

  useEffect(() => {
    setFocusedGlobeSiteId((current) => (current === activeSiteId ? current : activeSiteId));
  }, [activeSiteId]);

  const focusGlobeOnSite = useCallback((siteId: string) => {
    if (!siteId) return;
    if (siteId !== activeSiteId && !sites.some((site) => site.id === siteId)) return;
    setFocusedGlobeSiteId(siteId);
  }, [activeSiteId, sites]);

  const focusedGlobeSite = useMemo(
    () => (focusedGlobeSiteId === activeSiteId
      ? displaySite
      : sites.find((site) => site.id === focusedGlobeSiteId) ?? null),
    [focusedGlobeSiteId, activeSiteId, displaySite, sites]
  );

  const availableCompareSites = useMemo(
    () => sites.filter((site) => site.id !== activeSiteId && !comparedSiteIds.includes(site.id)),
    [sites, activeSiteId, comparedSiteIds]
  );

  const comparedSiteDetails = useMemo(
    () => comparedSiteIds
      .map((siteId) => sites.find((site) => site.id === siteId))
      .filter((site): site is SiteData => Boolean(site)),
    [comparedSiteIds, sites]
  );

  const handleCompareToggle = useCallback((nextOpen: boolean) => {
    setIsCompareOpen(nextOpen);
    if (!nextOpen) return;

    setComparedSiteIds((current) => {
      const sanitized = sanitizeComparedSiteIds(current, sites);
      if (sanitized.length > 0) return sanitized;
      return defaultComparedSiteId ? [defaultComparedSiteId] : [];
    });
  }, [defaultComparedSiteId, sites]);

  const handleAddComparedSite = useCallback((siteId: string) => {
    if (!siteId) return;

    setComparedSiteIds((current) => {
      const sanitized = sanitizeComparedSiteIds(current, sites);

      if (
        sanitized.length >= MAX_PINNED_COMPARE_SITES
        || sanitized.includes(siteId)
        || siteId === activeSiteId
        || !sites.some((site) => site.id === siteId)
      ) {
        return sanitized;
      }

      return [...sanitized, siteId];
    });
  }, [activeSiteId, sites]);

  const handleRemoveComparedSite = useCallback((siteId: string) => {
    setComparedSiteIds((current) => current.filter((id) => id !== siteId));
  }, []);

  const handleGuidedExperiment = useCallback((experimentId: GuidedExperimentId) => {
    setActiveGuidedExperimentId(experimentId);

    if (experimentId === 'pole-vs-apollo-11') {
      handleSiteSelect('shackleton-rim');
      setOffset('+0d');
      setTimelineIdx(0);
      setIsCompareOpen(true);
      setComparedSiteIds(() => sanitizeComparedSiteIds(['apollo-11'], sites));
      setGuidedExperimentTakeaway('Validation: Equatorial sunlight can hit ~95% panel efficiency near lunar noon, about 27x stronger than the ~3-4% charging from grazing polar sunlight.');
      return;
    }

    if (experimentId === 'launch-delay-14d') {
      handleSiteSelect('shackleton-rim');
      setOffset('+14d');
      setTimelineIdx(0);
      setGuidedExperimentTakeaway('Validation: A +14d scrub shifts the lunar terminator phase and Earth libration line-of-sight window, moving both power and direct-to-Earth timing.');
      return;
    }

    const vetoSite = highestSlopeVetoSite ?? sites.find((site) => site.id === 'faustini-rim-a') ?? null;
    if (vetoSite) {
      handleSiteSelect(vetoSite.id);
    }
    setGuidedExperimentTakeaway(`Validation: Slopes above 15° (like ${vetoSite ? `${vetoSite.name} at ${vetoSite.max_slope_deg.toFixed(1)}°` : 'this steep crater rim'}) exceed rover stability limits and trigger a tip-over safety veto.`);
  }, [handleSiteSelect, highestSlopeVetoSite, sites]);

  const comparisonSiteColumns = useMemo(() => {
    if (!telemetry) return [];

    const columns = [{
      id: displaySite.id,
      telemetry,
      rankingEntry: selectedRankingEntry,
      isActive: true,
    }];

    comparedSiteIds.forEach((siteId) => {
      if (siteId === activeSiteId) return;

      try {
        const comparedTelemetry = getSiteTelemetry(siteId, offset);
        columns.push({
          id: siteId,
          telemetry: comparedTelemetry,
          rankingEntry: rankingBySiteId.get(siteId),
          isActive: false,
        });
      } catch {
        // Ignore unavailable telemetry entries.
      }
    });

    return columns;
  }, [telemetry, displaySite.id, selectedRankingEntry, comparedSiteIds, offset, rankingBySiteId, activeSiteId]);

  const activeComparisonColumn = comparisonSiteColumns[0];
  // Playback state
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1); // 1x,5x,20x
  const playIntervalRef = useRef<number | null>(null);
  const prevPointRef = useRef<typeof currentPoint | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!playing) return;
    // base tick ms per index at 1x
    const baseMs = 500; // 500ms per 2-hour slot at 1x
    const ms = Math.max(10, Math.round(baseMs / playSpeed));
    const timelineLength = Math.max(1, telemetry?.points.length ?? 169);
    const id = setInterval(() => {
      setTimelineIdx((i) => {
        const next = (i + 1) % timelineLength;
        return next;
      });
    }, ms) as unknown as number;
    playIntervalRef.current = id;
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [playing, playSpeed, telemetry?.points.length]);

  // Watch for transitions to show status banner
  useEffect(() => {
    if (!telemetry) return;
    const prev = prevPointRef.current;
    const curr = telemetry.points[timelineIdx];
    if (prev) {
      if (prev.sun_visible && !curr.sun_visible) {
        setStatusBanner('ECLIPSE');
        setTimeout(() => setStatusBanner(null), 3500);
      }
      if (prev.earth_visible && !curr.earth_visible) {
        setStatusBanner('DTE LOSS OF SIGNAL');
        setTimeout(() => setStatusBanner(null), 3500);
      }
    }
    prevPointRef.current = curr;
  }, [timelineIdx, telemetry]);

  return (
    <div className="min-h-screen" style={{ background: '#090D16', color: '#F8FAFC' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3"
        style={{ background: '#090D16E8', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1E293B' }}
      >
        <div className="flex items-center gap-3">
          <LunarEmblem />
          <div>
            <h1 className="font-heading font-bold text-lg tracking-wider" style={{ color: '#F8FAFC', letterSpacing: '0.12em' }}>
              SELENE VECTOR 301
            </h1>
            <div className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>
              Lunar Landing Site Navigator — 2026 NASA Space Apps Challenge
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Data badge */}
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono"
            style={{ background: '#131B2E', border: '1px solid #3B82F640', color: '#3B82F6' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            NASA JPL Horizons + LRO LOLA
          </div>

          {/* Mode switcher */}
          <div
            className="flex rounded-lg p-0.5 text-xs font-mono"
            style={{ background: '#131B2E', border: '1px solid #1E293B' }}
            role="group"
            aria-label="Application mode"
          >
            <button
              onClick={() => setMode('flight-director')}
              className="px-3 py-1.5 rounded transition-all"
              style={{
                background: mode === 'flight-director' ? '#1E293B' : 'transparent',
                color: mode === 'flight-director' ? '#F8FAFC' : '#F8FAFC60',
              }}
              aria-pressed={mode === 'flight-director'}
            >
              <span className="hidden sm:inline">Flight Director</span>
              <span className="sm:hidden">FD</span>
            </button>
            <button
              onClick={() => setMode('explorer')}
              className="px-3 py-1.5 rounded transition-all"
              style={{
                background: mode === 'explorer' ? '#1E293B' : 'transparent',
                color: mode === 'explorer' ? '#F8FAFC' : '#F8FAFC60',
              }}
              aria-pressed={mode === 'explorer'}
            >
              <span className="hidden sm:inline">Explorer</span>
              <span className="sm:hidden">EX</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex" style={{ minHeight: 'calc(100vh - 65px)' }}>
        {/* Sidebar */}
        <aside
          className="hidden lg:flex flex-col gap-4 p-4 overflow-y-auto"
          style={{ width: 280, background: '#0D1420', borderRight: '1px solid #1E293B', flexShrink: 0 }}
        >
          {/* Site selector */}
          <div>
            <div className="text-xs font-mono mb-2" style={{ color: '#F8FAFC60' }}>LANDING SITE</div>
            <div style={{ marginBottom: 8 }}>
              <input
                aria-label="Filter sites"
                placeholder="Filter sites..."
                value={siteQuery}
                onChange={(e) => setSiteQuery(e.target.value)}
                className="w-full px-2 py-1 rounded text-xs font-mono"
                style={{ background: '#090D16', border: '1px solid #1E293B', color: '#F8FAFC', outline: 'none' }}
              />
            </div>
            <div className="max-h-[290px] overflow-y-auto space-y-1">
              {sites.filter((s) => s.name.toLowerCase().includes(siteQuery.toLowerCase()) || s.id.toLowerCase().includes(siteQuery.toLowerCase())).map((site) => {
                const isSelected = site.id === selectedSiteId && !customCoords.active;
                const isVetoed = site.max_slope_deg > 15;
                const missionProgram = deriveMissionProgramTag(site);
                const missionProgramStyle = MISSION_PROGRAM_STYLES[missionProgram];
                return (
                  <button
                    key={site.id}
                    onClick={() => handleSiteSelect(site.id)}
                    className="w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-center justify-between gap-2"
                    style={{
                      background: isSelected ? '#1E293B' : 'transparent',
                      border: `1px solid ${isSelected ? '#3B82F640' : 'transparent'}`,
                    }}
                    aria-pressed={isSelected}
                  >
                    <div>
                      <div className="text-xs font-heading font-medium" style={{ color: isVetoed ? '#EF444480' : '#F8FAFC' }}>
                        {site.name}
                      </div>
                      <div className="text-xs font-mono" style={{ color: '#F8FAFC40', fontSize: 10 }}>
                        {site.lat.toFixed(2)}°, {site.lon.toFixed(2)}°
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className="px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
                        style={{
                          background: missionProgramStyle.background,
                          border: `1px solid ${missionProgramStyle.border}`,
                          color: missionProgramStyle.color,
                          fontSize: 9,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {missionProgram}
                      </span>
                      {isVetoed && (
                        <span className="text-xs font-mono px-1 rounded" style={{ background: '#EF44441A', color: '#EF4444', fontSize: 9 }}>
                          VETO
                        </span>
                      )}
                      {isSelected && <ChevronRight size={12} style={{ color: '#3B82F6' }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom coordinates */}
          <div style={{ borderTop: '1px solid #1E293B', paddingTop: 16 }}>
            <div className="text-xs font-mono mb-2" style={{ color: '#F8FAFC60' }}>CUSTOM COORDINATES</div>
            <div className="space-y-2">
              {(['lat', 'lon', 'alt_km'] as const).map((field) => (
                <div key={field}>
                  <label className="text-xs font-mono block mb-1" style={{ color: '#F8FAFC40' }} htmlFor={`coord-${field}`}>
                    {field === 'lat' ? 'Latitude (°)' : field === 'lon' ? 'Longitude (°)' : 'Altitude (km)'}
                  </label>
                  <input
                    id={`coord-${field}`}
                    type="number"
                    step="any"
                    value={customCoords[field]}
                    onChange={(e) => setCustomCoords((c) => ({ ...c, [field]: e.target.value, active: false }))}
                    placeholder={field === 'lat' ? '-90 to 90' : field === 'lon' ? '-180 to 180' : '0 to 10'}
                    className="w-full px-2 py-1.5 rounded text-xs font-mono"
                    style={{ background: '#090D16', border: '1px solid #1E293B', color: '#F8FAFC', outline: 'none' }}
                  />
                </div>
              ))}
              <button
                onClick={handleCustomApply}
                className="w-full py-2 rounded text-xs font-mono font-bold transition-opacity hover:opacity-80"
                style={{ background: '#3B82F6', color: '#F8FAFC' }}
                aria-label="Apply custom coordinates"
              >
                <MapPin size={12} className="inline mr-1" />
                Apply Coordinates
              </button>
            </div>
          </div>

          {/* Launch delay */}
          <div style={{ borderTop: '1px solid #1E293B', paddingTop: 16 }}>
            <div className="text-xs font-mono mb-2" style={{ color: '#F8FAFC60' }}>LAUNCH DELAY SIMULATOR</div>
            <div className="grid grid-cols-2 gap-1.5">
              {LAUNCH_OFFSETS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => { setOffset(value); setTimelineIdx(0); }}
                  className="px-2 py-2 rounded text-xs font-mono transition-all"
                  style={{
                    background: offset === value ? '#3B82F6' : '#1E293B',
                    color: offset === value ? '#F8FAFC' : '#F8FAFC80',
                    border: `1px solid ${offset === value ? '#3B82F6' : '#1E293B'}`,
                  }}
                  aria-pressed={offset === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">
          {/* Mobile controls */}
          <div className="lg:hidden mb-4 space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sites.map((site) => (
                <button
                  key={site.id}
                  onClick={() => handleSiteSelect(site.id)}
                  className="whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-mono flex-shrink-0"
                  style={{
                    background: site.id === selectedSiteId && !customCoords.active ? '#1E293B' : '#131B2E',
                    border: `1px solid ${site.id === selectedSiteId && !customCoords.active ? '#3B82F6' : '#1E293B'}`,
                    color: site.max_slope_deg > 15 ? '#EF444480' : '#F8FAFC',
                  }}
                >
                  {site.name.split(' ').slice(0, 2).join(' ')}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {LAUNCH_OFFSETS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => { setOffset(value); setTimelineIdx(0); }}
                  className="flex-1 py-1.5 rounded text-xs font-mono"
                  style={{
                    background: offset === value ? '#3B82F6' : '#1E293B',
                    color: offset === value ? '#F8FAFC' : '#F8FAFC80',
                  }}
                  aria-pressed={offset === value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'flight-director' ? (
            <div className="space-y-6">
              {/* Site header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading font-bold text-xl" style={{ color: '#F8FAFC' }}>
                    {displaySite.name}
                  </h2>
                  <div className="text-xs font-mono mt-1" style={{ color: '#F8FAFC60' }}>
                    {displaySite.category} · {displaySite.lat.toFixed(3)}°N, {displaySite.lon.toFixed(3)}°E · {displaySite.alt_km} km ASL
                  </div>
                  {isCustomCoordActive && <ScientificTransparencyBadge className="mt-2 max-w-3xl" />}
                </div>
                <div className="flex items-center gap-2">
                  {displaySite.max_slope_deg > 15 && (
                    <span className="px-2 py-1 rounded text-xs font-mono font-bold" style={{ background: '#EF44441A', color: '#EF4444', border: '1px solid #EF444440' }}>
                      ⛔ CSA VETO — SLOPE {displaySite.max_slope_deg}°
                    </span>
                  )}
                  {batteryCriticalInWindow && (
                    <span className="px-2 py-1 rounded text-xs font-mono font-bold" style={{ background: '#EF44441A', color: '#FCA5A5', border: '1px solid #EF444440' }}>
                      ⚠ BATTERY CRITICAL — SoC &lt; 20%
                    </span>
                  )}
                  <span className="px-2 py-1 rounded text-xs font-mono" style={{ background: '#1E293B', color: '#F8FAFC80' }}>
                    Offset: {offset}
                  </span>
                </div>
              </div>

              {/* Site description */}
              <div className="p-4 rounded-lg text-sm leading-relaxed" style={{ background: '#131B2E', border: '1px solid #1E293B', color: '#F8FAFC80' }}>
                {displaySite.description}
              </div>
              {/* Compare Sites */}
              <div className="p-4 mt-2 rounded-lg space-y-3" style={{ background: '#090D16', border: '1px solid #1E293B' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-heading" style={{ color: '#F8FAFC' }}>Compare Sites</div>
                    <div className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                      Pin up to 2 sites and compare trade-offs against the active site.
                    </div>
                  </div>
                  <label className="text-xs font-mono flex items-center gap-2" style={{ color: '#F8FAFC80' }}>
                    <input
                      type="checkbox"
                      checked={isCompareOpen}
                      onChange={(e) => handleCompareToggle(e.target.checked)}
                    />
                    Enable
                  </label>
                </div>

                {isCompareOpen && (
                  <div className="space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <select
                        aria-label="Add site to compare"
                        value=""
                        onChange={(e) => handleAddComparedSite(e.target.value)}
                        disabled={comparedSiteIds.length >= MAX_PINNED_COMPARE_SITES || availableCompareSites.length === 0}
                        className="px-2 py-1.5 rounded text-xs font-mono"
                        style={{ background: '#131B2E', border: '1px solid #1E293B', color: '#F8FAFC', minWidth: 240 }}
                      >
                        <option value="">
                          {comparedSiteIds.length >= MAX_PINNED_COMPARE_SITES
                            ? '+ Add site to compare (max 2 pinned)'
                            : '+ Add site to compare'}
                        </option>
                        {availableCompareSites.map((site) => (
                          <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                      </select>

                      <div className="flex flex-wrap gap-2">
                        {comparedSiteDetails.map((site) => (
                          <span
                            key={site.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-mono"
                            style={{ background: '#1E293B', color: '#F8FAFCCC', border: '1px solid #3B82F640' }}
                          >
                            <button
                              type="button"
                              onClick={() => focusGlobeOnSite(site.id)}
                              aria-label={`Focus pinned chip ${site.name} on globe`}
                              className="transition-opacity hover:opacity-80"
                              style={{
                                color: '#F8FAFCCC',
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                              }}
                            >
                              {site.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveComparedSite(site.id)}
                              aria-label={`Remove ${site.name} from comparison`}
                              className="inline-flex items-center justify-center"
                              style={{ color: '#F8FAFC80' }}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        {comparedSiteDetails.length === 0 && (
                          <span className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                            No comparison sites pinned yet.
                          </span>
                        )}
                      </div>
                    </div>

                    {comparisonSiteColumns.length > 0 ? (
                      <div className="space-y-3">
                        <div
                          className="grid gap-3"
                          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}
                        >
                          {comparisonSiteColumns.map((column) => {
                            const slopeVeto = column.telemetry.site.max_slope_deg > 15;
                            const activeTelemetry = activeComparisonColumn?.telemetry;
                            const activeScore = activeComparisonColumn?.rankingEntry?.topsis_score;
                            const isPinnedColumn = !column.isActive;

                            const solarDelta = formatDelta(
                              column.telemetry.solar_uptime_pct,
                              activeTelemetry?.solar_uptime_pct,
                              'benefit',
                              1,
                              '%'
                            );
                            const dteDelta = formatDelta(
                              column.telemetry.dte_uptime_pct,
                              activeTelemetry?.dte_uptime_pct,
                              'benefit',
                              1,
                              '%'
                            );
                            const eclipseDelta = formatDelta(
                              column.telemetry.max_continuous_eclipse_hours,
                              activeTelemetry?.max_continuous_eclipse_hours,
                              'cost',
                              1,
                              'h'
                            );
                            const topsisDelta = formatDelta(
                              column.rankingEntry?.topsis_score,
                              activeScore,
                              'benefit',
                              3
                            );

                            return (
                              <div
                                key={column.id}
                                className="rounded-lg p-3 space-y-2"
                                onClick={isPinnedColumn ? () => focusGlobeOnSite(column.id) : undefined}
                                onKeyDown={isPinnedColumn
                                  ? (event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      focusGlobeOnSite(column.id);
                                    }
                                  }
                                  : undefined}
                                role={isPinnedColumn ? 'button' : undefined}
                                tabIndex={isPinnedColumn ? 0 : undefined}
                                aria-label={isPinnedColumn ? `Focus pinned column ${column.telemetry.site.name} on globe` : undefined}
                                style={{
                                  background: '#131B2E',
                                  border: column.isActive ? '1px solid #3B82F680' : '1px solid #1E293B',
                                  cursor: isPinnedColumn ? 'pointer' : 'default',
                                }}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-[10px] font-mono uppercase tracking-wide" style={{ color: '#F8FAFC60' }}>
                                      {column.isActive ? 'Active Site' : 'Pinned Site'}
                                    </div>
                                    <div className="text-sm font-heading leading-snug" style={{ color: '#F8FAFC' }}>
                                      {column.telemetry.site.name}
                                    </div>
                                  </div>
                                  <span
                                    className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold"
                                    style={{
                                      background: column.isActive ? '#3B82F626' : '#1E293B',
                                      color: column.isActive ? '#93C5FD' : '#F8FAFC99',
                                      border: `1px solid ${column.isActive ? '#3B82F680' : '#334155'}`,
                                    }}
                                  >
                                    {column.isActive ? 'ACTIVE' : 'PINNED'}
                                  </span>
                                </div>

                                <div className="space-y-1.5 text-xs font-mono" style={{ color: '#F8FAFC80' }}>
                                  <div className="flex items-start justify-between gap-2">
                                    <span>Solar Uptime (%)</span>
                                    <div className="text-right">
                                      <div style={{ color: '#F59E0B' }}>{column.telemetry.solar_uptime_pct.toFixed(1)}%</div>
                                      <div className="text-[10px]" style={{ color: column.isActive ? '#F8FAFC40' : solarDelta.color }}>
                                        {column.isActive ? 'Δ baseline' : solarDelta.label}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>DTE Comms Uptime (%)</span>
                                    <div className="text-right">
                                      <div style={{ color: '#06B6D4' }}>{column.telemetry.dte_uptime_pct.toFixed(1)}%</div>
                                      <div className="text-[10px]" style={{ color: column.isActive ? '#F8FAFC40' : dteDelta.color }}>
                                        {column.isActive ? 'Δ baseline' : dteDelta.label}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>Max Continuous Eclipse (h)</span>
                                    <div className="text-right">
                                      <div style={{ color: column.telemetry.max_continuous_eclipse_hours > 24 ? '#EF4444' : '#F8FAFC' }}>
                                        {column.telemetry.max_continuous_eclipse_hours.toFixed(1)}h
                                      </div>
                                      <div className="text-[10px]" style={{ color: column.isActive ? '#F8FAFC40' : eclipseDelta.color }}>
                                        {column.isActive ? 'Δ baseline' : eclipseDelta.label}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>PSR Distance (km)</span>
                                    <strong style={{ color: '#3B82F6' }}>{column.telemetry.site.psr_distance_km.toFixed(1)} km</strong>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>Terrain Slope (°)</span>
                                    <strong style={{ color: slopeVeto ? '#EF4444' : '#F8FAFC' }}>
                                      {column.telemetry.site.max_slope_deg.toFixed(1)}°
                                    </strong>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>CSA Safety</span>
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                      style={{
                                        background: slopeVeto ? '#EF444420' : '#22C55E1F',
                                        border: `1px solid ${slopeVeto ? '#EF444455' : '#22C55E55'}`,
                                        color: slopeVeto ? '#FCA5A5' : '#86EFAC',
                                      }}
                                    >
                                      {slopeVeto ? 'VETO > 15°' : 'SAFE'}
                                    </span>
                                  </div>

                                  <div className="flex items-start justify-between gap-2">
                                    <span>AHP-TOPSIS Score (C*)</span>
                                    <div className="text-right">
                                      <div style={{ color: '#F8FAFC' }}>
                                        {column.rankingEntry ? column.rankingEntry.topsis_score.toFixed(3) : '--'}
                                      </div>
                                      <div className="text-[10px]" style={{ color: column.isActive ? '#F8FAFC40' : topsisDelta.color }}>
                                        {column.isActive ? 'Δ baseline' : topsisDelta.label}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <ComparisonWindowStrip points={column.telemetry.points} />
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex gap-3 text-[10px] font-mono flex-wrap" style={{ color: '#F8FAFC80' }}>
                          {[
                            { label: 'Solar + DTE', color: '#10B981' },
                            { label: 'DTE Only', color: '#06B6D4' },
                            { label: 'Blackout', color: '#FB7185' },
                          ].map((entry) => (
                            <span key={entry.label} className="inline-flex items-center gap-1">
                              <span style={{ width: 9, height: 9, background: entry.color, borderRadius: 2, display: 'inline-block' }} />
                              {entry.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                        Active site telemetry is unavailable for comparison.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mission Control: Polar chart + Lunar Globe card */}
              <div className="space-y-6">
                <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div>
                      {telemetry && (
                        <PolarHorizonChart
                          site={displaySite as SiteData}
                          points={telemetry.points}
                          currentPointIndex={timelineIdx}
                          isCustomCoord={isCustomCoordActive}
                        />
                      )}
                    </div>
                    <div>
                      <LunarOrbitalGlobe
                        sites={sites}
                        selectedSiteId={selectedSiteId}
                        comparedSiteIds={comparedSiteIds}
                        onSiteSelect={handleSiteSelect}
                        onPinnedSiteFocus={focusGlobeOnSite}
                        focusedSite={focusedGlobeSite}
                        customLat={customCoords.active ? parseFloat(customCoords.lat || '0') : undefined}
                        customLon={customCoords.active ? parseFloat(customCoords.lon || '0') : undefined}
                        timelineIdx={timelineIdx}
                        telemetryPoints={telemetry?.points ?? []}
                      />
                    </div>
                  </div>
                </div>

                {/* Telemetry + Countdown cards across full width */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                  <div>
                    <TMinusCard
                      label={countdownStatus?.sun.label ?? 'T-MINUS SUNSET'}
                      hours={countdownStatus?.sun.hours ?? 0}
                      color="#F59E0B"
                      alertState={countdownStatus?.sun.state ?? 'nominal'}
                      icon={<Sun size={12} />}
                    />
                  </div>
                  <div>
                    <TMinusCard
                      label={countdownStatus?.earth.label ?? 'T-MINUS EARTHSET'}
                      hours={countdownStatus?.earth.hours ?? 0}
                      color="#06B6D4"
                      alertState={countdownStatus?.earth.state ?? 'nominal'}
                      icon={<Globe size={12} />}
                    />
                  </div>
                  <div>
                    {/* Current point telemetry */}
                    {currentPoint ? (
                      <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                        <div className="text-xs font-mono mb-3" style={{ color: '#F8FAFC60' }}>CURRENT TELEMETRY — {currentPoint.t}</div>
                        {isCustomCoordActive && <ScientificTransparencyBadge className="mb-3" />}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs font-mono mb-1" style={{ color: '#F8FAFC60' }}>SOLAR EFFICIENCY</div>
                            <div className="font-mono font-bold text-2xl" style={{ color: '#F59E0B' }}>
                              {currentPoint.solar_eff_pct.toFixed(1)}%
                            </div>
                            <div className="w-full h-1.5 rounded-full mt-1" style={{ background: '#1E293B' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${currentPoint.solar_eff_pct}%`, background: '#F59E0B' }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-mono mb-1" style={{ color: '#F8FAFC60' }}>SUN STATUS</div>
                            <div className="flex items-center gap-2">
                              {currentPoint.sun_visible
                                ? <Eye size={16} style={{ color: '#F59E0B' }} />
                                : <EyeOff size={16} style={{ color: '#EF4444' }} />}
                              <span className="font-mono font-bold" style={{ color: currentPoint.sun_visible ? '#F59E0B' : '#EF4444' }}>
                                {currentPoint.sun_visible ? 'VISIBLE' : 'ECLIPSED'}
                              </span>
                            </div>
                            <div className="mt-1 text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                              Az: {currentPoint.sun_az.toFixed(1)}° El: {currentPoint.sun_el.toFixed(2)}°
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-mono mb-1" style={{ color: '#F8FAFC60' }}>EARTH / DTE</div>
                            <div className="flex items-center gap-2">
                              {currentPoint.earth_visible
                                ? <Radio size={16} style={{ color: '#06B6D4' }} />
                                : <Radio size={16} style={{ color: '#EF4444' }} />}
                              <span className="font-mono font-bold" style={{ color: currentPoint.earth_visible ? '#06B6D4' : '#EF4444' }}>
                                {currentPoint.earth_visible ? 'LINK ACTIVE' : 'NO SIGNAL'}
                              </span>
                            </div>
                            <div className="mt-1 text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                              Az: {currentPoint.earth_az.toFixed(1)}° El: {currentPoint.earth_el.toFixed(2)}°
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-mono mb-1" style={{ color: '#F8FAFC60' }}>ROVER BATTERY (SoC)</div>
                            <div className="font-mono font-bold text-2xl" style={{ color: currentPoint.battery_soc_pct && currentPoint.battery_soc_pct < 20 ? '#EF4444' : '#22c55e' }}>
                              {currentPoint.battery_soc_pct?.toFixed(1) ?? '--'}%
                            </div>
                            <div className="w-full h-2 rounded-full mt-2" style={{ background: '#1E293B' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${currentPoint.battery_soc_pct ?? 0}%`, background: currentPoint.battery_soc_pct && currentPoint.battery_soc_pct < 20 ? '#EF4444' : '#22c55e' }}
                              />
                            </div>
                            {currentPoint.battery_soc_pct !== undefined && currentPoint.battery_soc_pct < 20 && (
                              <div className="mt-1 text-xs font-mono" style={{ color: '#EF4444' }}>CRITICAL — Survival threshold breached</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                        <div className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>No telemetry available</div>
                      </div>
                    )}
                  </div>
                  <div>
                    {/* Mission summary */}
                    <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                      <div className="text-xs font-mono mb-3" style={{ color: '#F8FAFC60' }}>MISSION WINDOW SUMMARY</div>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Solar Uptime', value: `${telemetry?.solar_uptime_pct.toFixed(1) ?? '--'}%`, color: '#F59E0B', icon: <Zap size={12} /> },
                          { label: 'DTE Uptime', value: `${telemetry?.dte_uptime_pct.toFixed(1) ?? '--'}%`, color: '#06B6D4', icon: <Satellite size={12} /> },
                          {
                            label: 'Max Eclipse',
                            value: `${telemetry?.max_continuous_eclipse_hours.toFixed(0) ?? '--'}h`,
                            color: telemetry && telemetry.max_continuous_eclipse_hours > 24 ? '#EF4444' : '#F8FAFC',
                            icon: <Clock size={12} />,
                            hint: 'Equatorial sites can face ~14 Earth-day lunar nights, while south-pole crater rims create terrain-driven shadow cycles.',
                          },
                          { label: 'PSR Distance', value: `${displaySite.psr_distance_km.toFixed(1)} km`, color: '#3B82F6', icon: <Activity size={12} /> },
                        ].map(({ label, value, color, icon, hint }) => (
                          <div key={label} className="flex items-center gap-2">
                            <span style={{ color }}>{icon}</span>
                            <div>
                              <div className="text-xs font-mono flex items-center gap-1" style={{ color: '#F8FAFC40' }}>
                                <span>{label}</span>
                                {hint && (
                                  <button
                                    type="button"
                                    title={hint}
                                    aria-label={`${label} info: ${hint}`}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#F8FAFC80',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: 0,
                                      cursor: 'help',
                                    }}
                                  >
                                    <Info size={11} />
                                  </button>
                                )}
                              </div>
                              <div className="font-mono font-bold text-sm" style={{ color }}>{value}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline bar */}
              {telemetry && (
                <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPlaying((p) => !p)}
                        className="px-2 py-1 rounded text-xs font-mono"
                        style={{ background: '#1E293B', color: '#F8FAFC' }}
                        aria-label="Play Toggle"
                      >
                        {playing ? 'Pause' : 'Play'}
                      </button>
                      <div className="flex items-center gap-1">
                        {([1, 5, 20] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => setPlaySpeed(s)}
                            className="px-2 py-1 rounded text-xs font-mono"
                            style={{ background: playSpeed === s ? '#3B82F6' : '#1E293B', color: '#F8FAFC' }}
                            aria-label={`Speed ${s}x`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ color: '#F8FAFC60' }} className="text-xs font-mono">{telemetry.points.length} points @ 2hr</div>
                  </div>
                  <TimelineBar
                    points={telemetry.points}
                    onScrub={(i) => { setTimelineIdx(i); setPlaying(false); }}
                    currentIdx={timelineIdx}
                  />
                  {statusBanner && (
                    <div data-testid="status-banner" className="mt-2 p-2 rounded text-sm font-bold" style={{ background: '#EF44441A', color: '#EF4444' }}>
                      {statusBanner}
                    </div>
                  )}
                  <div className="mt-3 flex justify-between items-center">
                    <span className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>
                      Scrub: T+{(timelineIdx * 2).toString().padStart(3, '0')}h — {telemetry.points[timelineIdx]?.t ?? '--'}
                    </span>
                    <button
                      onClick={() => exportTimelineCSV(telemetry, selectedRankingEntry ? {
                        topsis_score: selectedRankingEntry.topsis_score,
                        slope_veto: selectedRankingEntry.slope_veto,
                        battery_risk: selectedRankingEntry.battery_risk,
                      } : undefined)}
                      className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded hover:opacity-80 transition-opacity"
                      style={{ background: '#1E293B', color: '#F59E0B', border: '1px solid #F59E0B30' }}
                      aria-label="Export timeline as CSV"
                    >
                      <Gauge size={10} />
                      Export Timeline
                    </button>
                  </div>
                </div>
              )}

              {/* Ranking table */}
              <SiteRankingTable
                entries={rankings}
                offset={offset}
                weights={weights}
                onWeightsChange={setWeights}
                onSiteSelect={handleSiteSelect}
                selectedSiteId={selectedSiteId}
              />
            </div>
          ) : (
            /* Explorer Mode */
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="mb-4">
                <h2 className="font-heading font-bold text-xl mb-1" style={{ color: '#F8FAFC' }}>Explorer Mode</h2>
                <p className="text-sm" style={{ color: '#F8FAFC60' }}>
                  Plain-language insights into lunar polar site advantages for the 2026 Artemis missions.
                </p>
              </div>

              {/* Mobile launch selector for explorer mode */}
              <div className="flex gap-1.5 flex-wrap">
                {LAUNCH_OFFSETS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => { setOffset(value); setTimelineIdx(0); }}
                    className="px-3 py-1.5 rounded text-xs font-mono"
                    style={{
                      background: offset === value ? '#3B82F6' : '#1E293B',
                      color: offset === value ? '#F8FAFC' : '#F8FAFC80',
                    }}
                    aria-pressed={offset === value}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <ExplorerMode
                rankings={rankings}
                telemetry={telemetry}
                site={displaySite}
                isCustomCoordActive={isCustomCoordActive}
                onRunGuidedExperiment={handleGuidedExperiment}
                activeGuidedExperimentId={activeGuidedExperimentId}
                guidedExperimentTakeaway={guidedExperimentTakeaway}
              />
              <ExplorerTelemetryCards
                currentPoint={currentPoint}
                site={displaySite}
              />
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer
        className="px-6 py-3 text-center text-xs font-mono"
        style={{ borderTop: '1px solid #1E293B', color: '#F8FAFC30' }}
      >
        Selene Vector 301 · 2026 NASA Space Apps Challenge · Data: NASA JPL Horizons + LRO LOLA · Zero atmospheric refraction (APPARENT=AIRLESS)
      </footer>
    </div>
  );
}
