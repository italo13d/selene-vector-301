// src/components/PolarHorizonChart.tsx
import React, { useState, useCallback } from 'react';
import { type TelemetryPoint, type SiteData } from '../lib/orbitalPhysics';

interface PolarHorizonChartProps {
  site: SiteData;
  points: TelemetryPoint[];
  currentPointIndex?: number;
}

const SVG_SIZE = 480;
const CENTER = SVG_SIZE / 2;
const OUTER_R = 200;

function toCartesian(angleDeg: number, radiusPct: number): [number, number] {
  // 0° = North = top, clockwise
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const r = OUTER_R * radiusPct;
  return [CENTER + r * Math.cos(rad), CENTER + r * Math.sin(rad)];
}

function elevationToRadius(elDeg: number, maxEl: number = 10): number {
  // Maps elevation: negative = inside circle (below horizon)
  // 0 = on the circle, positive = inside (visible)
  // We show -5° to +10° range
  const minEl = -5;
  const range = maxEl - minEl;
  const clamped = Math.max(minEl, Math.min(maxEl, elDeg));
  return 1 - (clamped - minEl) / range;
}

function buildHorizonPolygon(profile: number[]): string {
  const points: string[] = [];
  for (let i = 0; i < 72; i++) {
    const az = i * 5;
    const el = profile[i];
    const r = elevationToRadius(el, 15);
    const [x, y] = toCartesian(az, r);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_AZ = [0, 45, 90, 135, 180, 225, 270, 315];

export const PolarHorizonChart: React.FC<PolarHorizonChartProps> = ({
  site,
  points,
  currentPointIndex = 0,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; label: string } | null>(null);

  const profile = site.horizon_profile_deg;
  const horizonPolygon = buildHorizonPolygon(profile);

  // Build sun and earth trajectory paths using raw azimuths and adjusted elevations
  const buildPath = useCallback((key: 'sun' | 'earth'): string => {
    if (points.length === 0) return '';
    return points.map((p, i) => {
      const az = key === 'sun' ? p.sun_az : p.earth_az;
      const el = key === 'sun' ? p.sun_el : p.earth_el;
      const r = elevationToRadius(el, 15);
      const clampedR = Math.max(0.05, Math.min(0.98, r));
      const [x, y] = toCartesian(az, clampedR);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
  }, [points]);

  const currentPoint = points[currentPointIndex];

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    // No-op for now; individual markers handle hover
    void e;
  };

  return (
    <div className="relative w-full" style={{ background: '#131B2E', borderRadius: 12, padding: 16 }}>
      <div className="text-xs font-mono mb-2" style={{ color: '#F8FAFC80' }}>
        360° TERRAIN-AWARE HORIZON MAP — {site.name.toUpperCase()}
      </div>
      <svg
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        style={{ width: '100%', maxWidth: SVG_SIZE, height: 'auto', display: 'block', margin: '0 auto' }}
        onMouseMove={handleSvgMouseMove}
        onMouseLeave={() => setHoveredPoint(null)}
        role="img"
        aria-label={`Polar horizon chart for ${site.name}`}
      >
        {/* Background */}
        <circle cx={CENTER} cy={CENTER} r={OUTER_R} fill="#090D16" stroke="#1E293B" strokeWidth={1} />

        {/* Elevation rings at 0°, 5°, 10° */}
        {[0.25, 0.5, 0.75, 1.0].map((frac, i) => (
          <circle
            key={i}
            cx={CENTER}
            cy={CENTER}
            r={OUTER_R * frac}
            fill="none"
            stroke="#1E293B"
            strokeWidth={0.5}
            strokeDasharray="4 4"
          />
        ))}

        {/* Cardinal direction spokes */}
        {COMPASS_AZ.map((az) => {
          const [x1, y1] = toCartesian(az, 0.05);
          const [x2, y2] = toCartesian(az, 1.0);
          return (
            <line
              key={az}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="#1E293B"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Terrain horizon silhouette */}
        <polygon
          points={horizonPolygon}
          fill="rgba(59, 130, 246, 0.15)"
          stroke="#3B82F6"
          strokeWidth={1.5}
        />

        {/* Sun trajectory arc */}
        {points.length > 0 && (
          <path
            d={buildPath('sun')}
            fill="none"
            stroke="#F59E0B"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}

        {/* Earth libration track */}
        {points.length > 0 && (
          <path
            d={buildPath('earth')}
            fill="none"
            stroke="#06B6D4"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 3"
            opacity={0.75}
          />
        )}

        {/* Current point markers */}
        {currentPoint && (() => {
          const sunR = Math.max(0.05, Math.min(0.98, elevationToRadius(currentPoint.sun_el, 15)));
          const earthR = Math.max(0.05, Math.min(0.98, elevationToRadius(currentPoint.earth_el, 15)));
          const [sx, sy] = toCartesian(currentPoint.sun_az, sunR);
          const [ex, ey] = toCartesian(currentPoint.earth_az, earthR);
          return (
            <>
              <circle
                cx={sx} cy={sy} r={6}
                fill={currentPoint.sun_visible ? '#F59E0B' : '#F59E0B40'}
                stroke="#F59E0B"
                strokeWidth={1.5}
                role="img"
                aria-label={`Sun position: az ${currentPoint.sun_az.toFixed(1)}° el ${currentPoint.sun_el.toFixed(1)}°`}
              >
                <title>Sun: az {currentPoint.sun_az.toFixed(1)}° el {currentPoint.sun_el.toFixed(1)}° — {currentPoint.sun_visible ? 'VISIBLE' : 'BELOW HORIZON'}</title>
              </circle>
              <circle
                cx={ex} cy={ey} r={5}
                fill={currentPoint.earth_visible ? '#06B6D4' : '#06B6D440'}
                stroke="#06B6D4"
                strokeWidth={1.5}
                role="img"
                aria-label={`Earth position: az ${currentPoint.earth_az.toFixed(1)}° el ${currentPoint.earth_el.toFixed(1)}°`}
              >
                <title>Earth: az {currentPoint.earth_az.toFixed(1)}° el {currentPoint.earth_el.toFixed(1)}° — {currentPoint.earth_visible ? 'VISIBLE' : 'BELOW HORIZON'}</title>
              </circle>
            </>
          );
        })()}

        {/* Center cross */}
        <line x1={CENTER - 6} y1={CENTER} x2={CENTER + 6} y2={CENTER} stroke="#1E293B" strokeWidth={1} />
        <line x1={CENTER} y1={CENTER - 6} x2={CENTER} y2={CENTER + 6} stroke="#1E293B" strokeWidth={1} />

        {/* Compass labels */}
        {COMPASS.map((label, i) => {
          const az = COMPASS_AZ[i];
          const [x, y] = toCartesian(az, 1.12);
          return (
            <text
              key={label}
              x={x} y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fontFamily="JetBrains Mono, monospace"
              fontWeight={label === 'N' ? 700 : 400}
              fill={label === 'N' ? '#F8FAFC' : '#F8FAFC80'}
            >
              {label}
            </text>
          );
        })}

        {/* Elevation ring labels */}
        {[
          { r: 0.25, label: '10°' },
          { r: 0.5, label: '5°' },
          { r: 0.75, label: '0°' },
          { r: 1.0, label: '-5°' },
        ].map(({ r, label }) => (
          <text
            key={label}
            x={CENTER + 4}
            y={CENTER - OUTER_R * r + 4}
            fontSize={8}
            fontFamily="JetBrains Mono, monospace"
            fill="#F8FAFC40"
          >
            {label}
          </text>
        ))}

        {/* Hover tooltip */}
        {hoveredPoint && (
          <g>
            <rect
              x={hoveredPoint.x + 8}
              y={hoveredPoint.y - 20}
              width={120}
              height={22}
              fill="#131B2E"
              stroke="#1E293B"
              rx={4}
            />
            <text
              x={hoveredPoint.x + 14}
              y={hoveredPoint.y - 5}
              fontSize={9}
              fontFamily="JetBrains Mono, monospace"
              fill="#F8FAFC"
            >
              {hoveredPoint.label}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-3 justify-center text-xs" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        <span className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 24, height: 2, background: '#3B82F6', borderRadius: 1 }} />
          <span style={{ color: '#F8FAFC80' }}>Terrain Horizon</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 24, height: 2, background: '#F59E0B', borderRadius: 1 }} />
          <span style={{ color: '#F8FAFC80' }}>Sun Path</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span style={{ display: 'inline-block', width: 24, height: 2, background: '#06B6D4', borderRadius: 1, borderTop: '1px dashed #06B6D4' }} />
          <span style={{ color: '#F8FAFC80' }}>Earth Track</span>
        </span>
      </div>
    </div>
  );
};

export default PolarHorizonChart;
