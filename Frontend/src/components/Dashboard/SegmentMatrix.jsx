import React from 'react';
import { Grid3x3, Link2 } from 'lucide-react';

/**
 * Chainage x layer matrix, available only once progress rows are bound to model
 * elements. Code matching alone cannot tell one segment of a layer from another,
 * so before phase 2 there was nothing to put in these cells.
 */

const CELL = {
  Completed: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40',
  'In-Progress': 'bg-cyan-500/25 text-cyan-300 border-cyan-500/40',
  Delayed: 'bg-rose-500/25 text-rose-300 border-rose-500/40',
  'Not Started': 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

const STRATEGY_DOT = {
  guid: 'bg-emerald-400',
  group: 'bg-teal-400',
  position: 'bg-amber-400',
  name: 'bg-orange-400',
};

export default function SegmentMatrix({ segments, binding }) {
  if (!segments?.length) return null;

  // Column order follows the pavement stack, top layer first
  const codes = [...new Set(segments.flatMap((s) => s.layers.map((l) => l.layerCode)))];

  return (
    <div className="glass-panel rounded-2xl p-6 space-y-4 shadow-xl border border-slate-800/90">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Grid3x3 className="h-5 w-5 text-cyan-400" />
          <h3 className="text-base font-extrabold text-white font-[Outfit]">Progress by Chainage &amp; Layer</h3>
        </div>
        {binding?.mode === 'element' && (
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
            <Link2 className="h-3.5 w-3.5 text-cyan-400" />
            {binding.covered}/{binding.elements} elements bound · {binding.resolvedPercent}% of rows
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-separate border-spacing-1">
          <thead>
            <tr className="text-slate-400 uppercase font-mono text-[10px]">
              <th className="p-2">Chainage</th>
              {codes.map((c) => <th key={c} className="p-2 text-center">{c}</th>)}
              <th className="p-2 text-center">Segment</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((seg) => (
              <tr key={seg.chainageId}>
                <td className="p-2 font-mono font-bold text-slate-200 whitespace-nowrap">
                  ch{seg.chainageId}
                  {seg.segmentIndex !== null && seg.segmentIndex !== undefined && (
                    <span className="ml-1.5 text-[10px] font-normal text-slate-500">seg {seg.segmentIndex}</span>
                  )}
                </td>

                {codes.map((code) => {
                  const cell = seg.layers.find((l) => l.layerCode === code);
                  if (!cell) {
                    return <td key={code} className="p-2 text-center text-slate-700 font-mono">—</td>;
                  }
                  return (
                    <td key={code} className="p-0">
                      <div
                        className={`relative rounded-lg border px-2 py-1.5 text-center font-mono font-bold tabular-nums ${
                          CELL[cell.status] || 'bg-slate-800/40 text-slate-500 border-slate-700/40'
                        }`}
                        title={`${cell.status || 'no status'} · matched by ${cell.strategy}`}
                      >
                        {cell.progressPercent === null ? '—' : `${cell.progressPercent}%`}
                        <span
                          className={`absolute top-1 right-1 h-1.5 w-1.5 rounded-full ${STRATEGY_DOT[cell.strategy] || 'bg-slate-600'}`}
                        />
                      </div>
                    </td>
                  );
                })}

                <td className="p-2 text-center">
                  <span className="font-extrabold text-white font-[Outfit] tabular-nums">
                    {seg.progressPercent === null ? '—' : `${seg.progressPercent}%`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        <span className="font-bold uppercase tracking-wide">Matched by</span>
        {Object.entries(STRATEGY_DOT).map(([k, cls]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}
