// src/components/SiteRankingTable.tsx
import React, { useState, useCallback } from 'react';
import { ChevronUp, ChevronDown, Download, AlertTriangle, ShieldAlert, Info } from 'lucide-react';
import { type SiteRankingEntry, type AHPWeights, DEFAULT_WEIGHTS } from '../lib/ahpTopsis';
import { exportRankingCSV, exportRankingJSON } from '../lib/exportDossier';

interface SiteRankingTableProps {
  entries: SiteRankingEntry[];
  offset: string;
  weights: AHPWeights;
  onWeightsChange: (weights: AHPWeights) => void;
  onSiteSelect: (siteId: string) => void;
  selectedSiteId: string;
}

interface WeightSliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}

const WeightSlider: React.FC<WeightSliderProps> = ({ label, value, onChange, color }) => (
  <div className="flex flex-col gap-1">
    <div className="flex justify-between items-center">
      <span className="text-xs font-mono" style={{ color: '#F8FAFC80' }}>{label}</span>
      <span className="text-xs font-mono font-bold" style={{ color }}>{(value * 100).toFixed(0)}%</span>
    </div>
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      aria-label={`Weight for ${label}`}
      className="w-full h-1 rounded appearance-none cursor-pointer"
      style={{ accentColor: color }}
    />
  </div>
);

export const SiteRankingTable: React.FC<SiteRankingTableProps> = ({
  entries,
  offset,
  weights,
  onWeightsChange,
  onSiteSelect,
  selectedSiteId,
}) => {
  const [sortKey, setSortKey] = useState<keyof SiteRankingEntry | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: keyof SiteRankingEntry) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const setWeight = useCallback(
    (key: keyof AHPWeights, value: number) => {
      onWeightsChange({ ...weights, [key]: value });
    },
    [weights, onWeightsChange]
  );

  const totalWeight = Object.values(weights).reduce((s, v) => s + v, 0);

  const sorted = [...entries].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return 0;
  });

  const SortIcon: React.FC<{ col: keyof SiteRankingEntry }> = ({ col }) => (
    sortKey === col
      ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
      : <span style={{ opacity: 0.3 }}><ChevronUp size={12} /></span>
  );

  return (
    <div style={{ background: '#131B2E', borderRadius: 12, padding: 20, border: '1px solid #1E293B' }}>
      {/* Weight sliders */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-heading font-semibold" style={{ color: '#F8FAFC' }}>
            AHP-TOPSIS Weight Configuration
          </h3>
          <button
            onClick={() => onWeightsChange({ ...DEFAULT_WEIGHTS })}
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ background: '#1E293B', color: '#F8FAFC80', border: '1px solid #1E293B' }}
            aria-label="Reset weights to defaults"
          >
            Reset
          </button>
        </div>
        {Math.abs(totalWeight - 1) > 0.01 && (
          <div className="text-xs font-mono mb-2 px-2 py-1 rounded" style={{ background: '#EF44441A', color: '#EF4444', border: '1px solid #EF444440' }}>
            ⚠ Weights sum to {(totalWeight * 100).toFixed(0)}% (should be 100%)
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <WeightSlider label="Solar Uptime" value={weights.solar_uptime_pct} onChange={(v) => setWeight('solar_uptime_pct', v)} color="#F59E0B" />
          <WeightSlider label="DTE Uptime" value={weights.dte_uptime_pct} onChange={(v) => setWeight('dte_uptime_pct', v)} color="#06B6D4" />
          <WeightSlider label="Max Slope" value={weights.max_slope_deg} onChange={(v) => setWeight('max_slope_deg', v)} color="#EF4444" />
          <WeightSlider label="PSR Distance" value={weights.psr_distance_km} onChange={(v) => setWeight('psr_distance_km', v)} color="#3B82F6" />
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => exportRankingCSV(entries, offset)}
          className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded transition-opacity hover:opacity-80"
          style={{ background: '#1E293B', color: '#F59E0B', border: '1px solid #F59E0B40' }}
          aria-label="Export ranking as CSV"
        >
          <Download size={12} />
          Export CSV
        </button>
        <button
          onClick={() => exportRankingJSON(entries, offset)}
          className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded transition-opacity hover:opacity-80"
          style={{ background: '#1E293B', color: '#06B6D4', border: '1px solid #06B6D440' }}
          aria-label="Export ranking as JSON"
        >
          <Download size={12} />
          Export JSON
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1E293B' }}>
              {(
                [
                  { key: 'rank', label: 'Rank' },
                  { key: null, label: 'Site' },
                  { key: 'solar_uptime_pct', label: 'Solar %' },
                  { key: 'dte_uptime_pct', label: 'DTE %' },
                  { key: 'max_slope_deg', label: 'Slope°' },
                  { key: 'psr_distance_km', label: 'PSR km' },
                  { key: 'topsis_score', label: 'C* Score' },
                  { key: null, label: 'CSA Status' },
                ] as Array<{ key: keyof SiteRankingEntry | null; label: string }>
              ).map(({ key, label }) => (
                <th
                  key={label}
                  onClick={() => key && handleSort(key)}
                  className={`text-left py-2 px-3 ${key ? 'cursor-pointer hover:opacity-80 select-none' : ''}`}
                  style={{ color: '#F8FAFC60', fontWeight: 500 }}
                  scope="col"
                >
                  <span className="flex items-center gap-1">
                    {label}
                    {key && <SortIcon col={key} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => {
              const isSelected = entry.site.id === selectedSiteId;
              const isVetoed = entry.slope_veto;
              return (
                <tr
                  key={entry.site.id}
                  onClick={() => onSiteSelect(entry.site.id)}
                  className="cursor-pointer transition-all"
                  style={{
                    background: isSelected ? '#1E293B' : 'transparent',
                    borderBottom: '1px solid #1E293B30',
                    opacity: isVetoed ? 0.6 : 1,
                  }}
                  aria-selected={isSelected}
                  role="row"
                >
                  <td className="py-2 px-3">
                    <span
                      className="font-bold text-sm"
                      style={{ color: isVetoed ? '#EF4444' : entry.rank <= 2 ? '#F59E0B' : '#F8FAFC' }}
                    >
                      #{entry.rank}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <div style={{ color: '#F8FAFC', fontWeight: 600 }}>{entry.site.name}</div>
                    <div style={{ color: '#F8FAFC60', fontSize: 10 }}>{entry.site.category}</div>
                  </td>
                  <td className="py-2 px-3">
                    <span style={{ color: '#F59E0B' }}>{entry.solar_uptime_pct.toFixed(1)}%</span>
                  </td>
                  <td className="py-2 px-3">
                    <span style={{ color: '#06B6D4' }}>{entry.dte_uptime_pct.toFixed(1)}%</span>
                  </td>
                  <td className="py-2 px-3">
                    <span style={{ color: entry.max_slope_deg > 15 ? '#EF4444' : '#F8FAFC' }}>
                      {entry.max_slope_deg.toFixed(1)}°
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span style={{ color: '#3B82F6' }}>{entry.psr_distance_km.toFixed(1)}</span>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      <div
                        className="rounded-sm"
                        style={{
                          width: `${Math.max(4, entry.topsis_score * 60)}px`,
                          height: 8,
                          background: isVetoed ? '#EF4444' : `hsl(${entry.topsis_score * 120}, 80%, 50%)`,
                          transition: 'width 0.3s ease',
                        }}
                      />
                      <span style={{ color: '#F8FAFC80' }}>{entry.topsis_score.toFixed(3)}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {entry.slope_veto && (
                        <span
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                          style={{ background: '#EF44441A', color: '#EF4444', border: '1px solid #EF444440' }}
                          title="CSA Safety Veto: slope > 15°"
                        >
                          <ShieldAlert size={10} />
                          VETO
                        </span>
                      )}
                      {entry.battery_risk && (
                        <span
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                          style={{ background: '#F59E0B1A', color: '#F59E0B', border: '1px solid #F59E0B40' }}
                          title="Battery risk: eclipse > 24 hours"
                        >
                          <AlertTriangle size={10} />
                          BATT
                        </span>
                      )}
                      {!entry.slope_veto && !entry.battery_risk && (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs"
                          style={{ background: '#06B6D41A', color: '#06B6D4', border: '1px solid #06B6D440' }}
                        >
                          NOMINAL
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs font-mono flex items-center gap-1.5" style={{ color: '#F8FAFC40' }}>
        <Info size={10} />
        Vector-normalized AHP-TOPSIS. C* = closeness coefficient (0–1, higher = better). Click a row to inspect site.
      </div>
    </div>
  );
};

export default SiteRankingTable;
