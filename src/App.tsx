import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Satellite, Radio, Zap, Mountain, Clock, Sun, Globe, ChevronRight,
  MapPin, Gauge, Activity, Eye, EyeOff
} from 'lucide-react';
import { PolarHorizonChart } from './components/PolarHorizonChart';
import LunarOrbitalGlobe from './components/LunarOrbitalGlobe';
import { SiteRankingTable } from './components/SiteRankingTable';
import {
  getSiteTelemetry, getCustomCoordTelemetry, getAllSites,
  type LaunchOffset, type SiteData, type SiteTelemetry
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
}> = ({ label, hours, color, icon }) => {
  const h = Math.floor(Math.abs(hours));
  const m = Math.floor((Math.abs(hours) - h) * 60);
  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg" style={{ background: '#090D16', border: `1px solid ${color}30` }}>
      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: `${color}80` }}>
        {icon}
        {label}
      </div>
      <div className="font-mono font-bold text-2xl" style={{ color, letterSpacing: '0.08em' }}>
        T-{h.toString().padStart(3, '0')}:{m.toString().padStart(2, '0')}
      </div>
      <div className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>hrs:min</div>
    </div>
  );
};

// 14-day timeline bar component
const TimelineBar: React.FC<{ points: Array<{ sun_visible: boolean; earth_visible: boolean }>; onScrub: (idx: number) => void; currentIdx: number }> = ({
  points,
  onScrub,
  currentIdx,
}) => {
  const displayPoints = points.slice(0, 168); // ~14 days at 2hr intervals
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono" style={{ color: '#F8FAFC60' }}>14-DAY POWER + DTE TIMELINE</span>
        <span className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>{points.length} points @ 2hr</span>
      </div>
      <div
        className="flex gap-px cursor-pointer rounded overflow-hidden"
        style={{ height: 24 }}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuenow={currentIdx}
        aria-valuemin={0}
        aria-valuemax={displayPoints.length - 1}
      >
         {displayPoints.map((p, i) => {
           // Determine base color for the slot
           let color = '#1E293B'; // eclipse
           if (p.sun_visible && p.earth_visible) color = '#22c55e'; // both = green
           else if (p.sun_visible) color = '#F59E0B'; // solar only = amber
           else if (p.earth_visible) color = '#06B6D4'; // DTE only = cyan
           else color = '#1E293B'; // eclipse uses the same slate as the legend

           return (
             <div
               key={i}
               onClick={() => onScrub(i)}
               className={`flex-1 ${i === currentIdx ? 'ring-2 ring-white z-10' : ''}`}
               style={{
                 background: color,
                 minWidth: 2,
               }}
               title={`T+${(i * 2).toString().padStart(3, '0')}h — Solar: ${p.sun_visible ? 'ON' : 'OFF'}, DTE: ${p.earth_visible ? 'ON' : 'OFF'}`}
             />
           );
         })}
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

// Explorer Mode insights
const ExplorerMode: React.FC<{ rankings: SiteRankingEntry[]; offset: LaunchOffset }> = ({ rankings, offset: _offset }) => {
  const topSite = rankings.find((e) => !e.slope_veto);
  const apollo = rankings.find((e) => e.site.id === 'apollo-11');

  return (
    <div className="space-y-6">
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
              DTE uptime: <strong style={{ color: '#06B6D4' }}>{topSite.dte_uptime_pct.toFixed(1)}%</strong> ·
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
                  <div style={{ color: '#F8FAFC80' }}>DTE: <span style={{ color: '#06B6D4' }}>{apollo.dte_uptime_pct.toFixed(1)}%</span></div>
                  <div style={{ color: '#F8FAFC80' }}>PSR: <span style={{ color: '#3B82F6' }}>{apollo.psr_distance_km.toFixed(0)} km</span></div>
                </div>
              </div>
              {topSite && (
                <div className="p-3 rounded-lg" style={{ background: '#090D16', border: '1px solid #F59E0B80' }}>
                  <div className="text-xs font-mono mb-1" style={{ color: '#F59E0B' }}>BEST POLAR SITE</div>
                  <div className="text-xs font-mono space-y-1">
                    <div style={{ color: '#F8FAFC80' }}>Solar: <span style={{ color: '#F59E0B' }}>{topSite.solar_uptime_pct.toFixed(1)}%</span></div>
                    <div style={{ color: '#F8FAFC80' }}>DTE: <span style={{ color: '#06B6D4' }}>{topSite.dte_uptime_pct.toFixed(1)}%</span></div>
                    <div style={{ color: '#F8FAFC80' }}>PSR: <span style={{ color: '#3B82F6' }}>{topSite.psr_distance_km.toFixed(1)} km</span></div>
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

  const sites = useMemo(() => getAllSites(), []);

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
  const [compareActive, setCompareActive] = useState(false);
  const [compareTargetId, setCompareTargetId] = useState<string>(() => {
    // default to apollo-11 if present, otherwise first other site
    const ap = getAllSites().find((s) => s.id === 'apollo-11');
    if (ap) return ap.id;
    const other = getAllSites().find((s) => s.id !== selectedSiteId);
    return other?.id ?? selectedSiteId;
  });

  const compareTelemetry = useMemo(() => {
    try {
      return getSiteTelemetry(compareTargetId, offset);
    } catch {
      return null;
    }
  }, [compareTargetId, offset]);
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
    const id = setInterval(() => {
      setTimelineIdx((i) => {
        const next = (i + 1) % 168;
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
  }, [playing, playSpeed]);

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
            <div className="space-y-1">
              {sites.map((site) => {
                const isSelected = site.id === selectedSiteId && !customCoords.active;
                const isVetoed = site.max_slope_deg > 15;
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
                </div>
                <div className="flex items-center gap-2">
                  {displaySite.max_slope_deg > 15 && (
                    <span className="px-2 py-1 rounded text-xs font-mono font-bold" style={{ background: '#EF44441A', color: '#EF4444', border: '1px solid #EF444440' }}>
                      ⛔ CSA VETO — SLOPE {displaySite.max_slope_deg}°
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
              <div className="p-3 mt-2 rounded-lg" style={{ background: '#090D16', border: '1px solid #1E293B' }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-heading" style={{ color: '#F8FAFC' }}>Compare Sites</div>
                  <div>
                    <label className="text-xs font-mono" style={{ color: '#F8FAFC60', marginRight: 8 }}>
                      <input type="checkbox" checked={compareActive} onChange={(e) => setCompareActive(e.target.checked)} />
                    </label>
                  </div>
                </div>
                {compareActive && (
                  <div>
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'relative' }}>
                        <button
                          aria-label="Compare target select"
                          onClick={() => setCompareActive((c) => !c)}
                          className="px-2 py-1 text-xs"
                          style={{ background: '#090D16', border: '1px solid #1E293B', color: '#E2E8F0' }}
                        >
                          {sites.find((s) => s.id === compareTargetId)?.name ?? 'Select site'}
                        </button>
                        {compareActive && (
                          <div role="listbox" style={{ position: 'absolute', zIndex: 50, marginTop: 6, background: '#090D16', border: '1px solid #1E293B', padding: 8, minWidth: 180, borderRadius: 8 }}>
                            {sites.filter((s) => s.id !== displaySite.id).map((s) => (
                              <button key={s.id} onClick={() => { setCompareTargetId(s.id); setCompareActive(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'transparent', color: '#E2E8F0', border: 'none', borderRadius: 6 }}>
                                {s.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {compareTelemetry && (
                      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                        <div style={{ border: '1px solid #1E293B', padding: 8 }}>
                          <div style={{ color: '#F8FAFC80' }}>Current Site</div>
                          <div style={{ color: '#F8FAFC' }}>{displaySite.name}</div>
                          <div style={{ color: '#F8FAFC80' }}>Solar Uptime: <strong style={{ color: '#F59E0B' }}>{telemetry?.solar_uptime_pct.toFixed(1)}%</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>DTE Uptime: <strong style={{ color: '#06B6D4' }}>{telemetry?.dte_uptime_pct.toFixed(1)}%</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>Max Eclipse: <strong style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#F8FAFC' }}>{telemetry?.max_continuous_eclipse_hours.toFixed(1)}h</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>Slope: <strong style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#F8FAFC' }}>{displaySite.max_slope_deg.toFixed(1)}°</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>CSA Veto: <strong style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#06B6D4' }}>{displaySite.max_slope_deg > 15 ? 'YES' : 'NO'}</strong></div>
                        </div>
                        <div style={{ border: '1px solid #1E293B', padding: 8 }}>
                          <div style={{ color: '#F8FAFC80' }}>Compare Site</div>
                          <div style={{ color: '#F8FAFC' }}>{compareTelemetry.site.name}</div>
                          <div style={{ color: '#F8FAFC80' }}>Solar Uptime: <strong style={{ color: '#F59E0B' }}>{compareTelemetry.solar_uptime_pct.toFixed(1)}%</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>DTE Uptime: <strong style={{ color: '#06B6D4' }}>{compareTelemetry.dte_uptime_pct.toFixed(1)}%</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>Max Eclipse: <strong style={{ color: compareTelemetry.max_continuous_eclipse_hours > 24 ? '#EF4444' : '#F8FAFC' }}>{compareTelemetry.max_continuous_eclipse_hours.toFixed(1)}h</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>Slope: <strong style={{ color: compareTelemetry.site.max_slope_deg > 15 ? '#EF4444' : '#F8FAFC' }}>{compareTelemetry.site.max_slope_deg.toFixed(1)}°</strong></div>
                          <div style={{ color: '#F8FAFC80' }}>CSA Veto: <strong style={{ color: compareTelemetry.site.max_slope_deg > 15 ? '#EF4444' : '#06B6D4' }}>{compareTelemetry.site.max_slope_deg > 15 ? 'YES' : 'NO'}</strong></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Two-column: polar chart + telemetry */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Polar chart */}
                <div>
                  {telemetry && (
                    <PolarHorizonChart
                      site={displaySite as SiteData}
                      points={telemetry.points}
                      currentPointIndex={timelineIdx}
                    />
                  )}
                </div>
                <div>
                  <LunarOrbitalGlobe
                    sites={sites}
                    selectedSiteId={selectedSiteId}
                    onSiteSelect={handleSiteSelect}
                    customLat={customCoords.active ? parseFloat(customCoords.lat || '0') : undefined}
                    customLon={customCoords.active ? parseFloat(customCoords.lon || '0') : undefined}
                    timelineIdx={timelineIdx}
                    telemetryPoints={telemetry?.points ?? []}
                  />
                </div>

                {/* Operational telemetry */}
                <div className="space-y-4">
                  {/* T-Minus cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <TMinusCard
                      label={telemetry && telemetry.sun_countdown.state === 'SUNLIT' ? 'T-MINUS SUNSET' : 'T-MINUS SUNRISE'}
                      hours={telemetry ? (telemetry.sun_countdown.state === 'SUNLIT' ? telemetry.sun_countdown.t_minus_sunset_hours : (telemetry.sun_countdown.t_minus_sunrise_hours ?? 0)) : 0}
                      color="#F59E0B"
                      icon={<Sun size={12} />}
                    />
                    <TMinusCard
                      label={telemetry && telemetry.dte_countdown.state === 'DTE_ACTIVE' ? 'T-MINUS EARTHSET' : 'T-MINUS EARTHRISE'}
                      hours={telemetry ? (telemetry.dte_countdown.state === 'DTE_ACTIVE' ? telemetry.dte_countdown.t_minus_earthset_hours : (telemetry.dte_countdown.t_minus_earthrise_hours ?? 0)) : 0}
                      color="#06B6D4"
                      icon={<Globe size={12} />}
                    />
                  </div>

                  {/* Current point telemetry */}
                  {currentPoint && (
                    <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                      <div className="text-xs font-mono mb-3" style={{ color: '#F8FAFC60' }}>CURRENT TELEMETRY — {currentPoint.t}</div>
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
                        <div>
                          <div className="text-xs font-mono mb-1" style={{ color: '#F8FAFC60' }}>TERRAIN SLOPE</div>
                          <div className="flex items-center gap-2">
                            <Mountain size={16} style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#22c55e' }} />
                            <span className="font-mono font-bold" style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#22c55e' }}>
                              {displaySite.max_slope_deg.toFixed(1)}°
                            </span>
                          </div>
                          <div className="mt-1 text-xs font-mono" style={{ color: displaySite.max_slope_deg > 15 ? '#EF4444' : '#F8FAFC60' }}>
                            {displaySite.max_slope_deg > 15 ? '⛔ CSA SAFETY VETO' : '✓ CSA SAFE (< 15°)'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Mission summary */}
                  <div className="p-4 rounded-lg" style={{ background: '#131B2E', border: '1px solid #1E293B' }}>
                    <div className="text-xs font-mono mb-3" style={{ color: '#F8FAFC60' }}>MISSION WINDOW SUMMARY</div>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Solar Uptime', value: `${telemetry?.solar_uptime_pct.toFixed(1) ?? '--'}%`, color: '#F59E0B', icon: <Zap size={12} /> },
                        { label: 'DTE Uptime', value: `${telemetry?.dte_uptime_pct.toFixed(1) ?? '--'}%`, color: '#06B6D4', icon: <Satellite size={12} /> },
                        { label: 'Max Eclipse', value: `${telemetry?.max_continuous_eclipse_hours.toFixed(0) ?? '--'}h`, color: telemetry && telemetry.max_continuous_eclipse_hours > 24 ? '#EF4444' : '#F8FAFC', icon: <Clock size={12} /> },
                        { label: 'PSR Distance', value: `${displaySite.psr_distance_km.toFixed(1)} km`, color: '#3B82F6', icon: <Activity size={12} /> },
                      ].map(({ label, value, color, icon }) => (
                        <div key={label} className="flex items-center gap-2">
                          <span style={{ color }}>{icon}</span>
                          <div>
                            <div className="text-xs font-mono" style={{ color: '#F8FAFC40' }}>{label}</div>
                            <div className="font-mono font-bold text-sm" style={{ color }}>{value}</div>
                          </div>
                        </div>
                      ))}
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
                      onClick={() => exportTimelineCSV(telemetry)}
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
                    onClick={() => setOffset(value)}
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

              <ExplorerMode rankings={rankings} offset={offset} />
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
