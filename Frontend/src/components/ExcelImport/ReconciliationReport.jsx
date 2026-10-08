import React from 'react';
import { STRATEGY, STRATEGY_LABEL, STRATEGY_CONFIDENCE } from '../../utils/ifcResolver';
import {
  Link2, MapPin, AlertTriangle, Compass, Boxes, ArrowRight,
} from 'lucide-react';

/**
 * Phase 2 output, shown before the import is committed: which model element every
 * progress row bound to, and how confident that binding is.
 *
 * The point of the panel is that a weak match stays visible. A row matched by
 * position looks different from one matched by GlobalId, so a stale reference
 * cannot quietly become a green segment in the 3D view.
 */

const STRATEGY_STYLE = {
  [STRATEGY.GUID]: { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', bar: 'bg-emerald-500' },
  [STRATEGY.GROUP]: { chip: 'bg-teal-500/15 text-teal-300 border-teal-500/30', bar: 'bg-teal-500' },
  [STRATEGY.POSITION]: { chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30', bar: 'bg-amber-500' },
  [STRATEGY.NAME]: { chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30', bar: 'bg-orange-500' },
  [STRATEGY.NONE]: { chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30', bar: 'bg-rose-500' },
};

const ORDER = [STRATEGY.GUID, STRATEGY.GROUP, STRATEGY.POSITION, STRATEGY.NAME, STRATEGY.NONE];

const DIRECTION_NOTE = {
  anchors: 'derived from the GlobalIds that matched',
  site: 'taken from the IfcSite coordinate',
  assumed: 'assumed — nothing in the data settles it',
};

export default function ReconciliationReport({ resolution }) {
  if (!resolution) return null;
  const { report, matches, direction } = resolution;
  const { counts, coverage } = report;

  const conflict = resolution.issues.find((i) => i.code === 'resolve.direction-conflict');
  const ambiguous = resolution.issues.find((i) => i.code === 'resolve.direction-ambiguous');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white">Model reconciliation</h3>
        <span className="text-[11px] text-slate-500">
          {counts.total - counts.none} of {counts.total} rows bound · {coverage.covered} of {coverage.elements} elements covered
        </span>
      </div>

      {/* strategy mix, as a single proportional bar */}
      <div>
        <div className="flex h-2 rounded-full overflow-hidden bg-slate-800">
          {ORDER.map((s) => (
            counts[s] > 0 && (
              <div
                key={s}
                className={STRATEGY_STYLE[s].bar}
                style={{ width: `${(counts[s] / counts.total) * 100}%` }}
                title={`${STRATEGY_LABEL[s]}: ${counts[s]}`}
              />
            )
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {ORDER.map((s) => (
            counts[s] > 0 && (
              <span key={s} className={`px-2 py-0.5 rounded border text-[10px] font-bold ${STRATEGY_STYLE[s].chip}`}>
                {counts[s]} · {STRATEGY_LABEL[s]}
                {STRATEGY_CONFIDENCE[s] && <span className="ml-1 opacity-60">{STRATEGY_CONFIDENCE[s]}</span>}
              </span>
            )
          ))}
        </div>
      </div>

      {/* direction — the one inference that can silently invert the whole road */}
      {report.chainageToSegment.length > 0 && (
        <div className={`rounded-xl border p-3 space-y-2 ${
          conflict || ambiguous ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-900/60 border-slate-800'
        }`}>
          <div className="flex items-center gap-2">
            <Compass className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-[11px] font-bold text-slate-200">Chainage direction</span>
            <span className="text-[10px] text-slate-500">
              {DIRECTION_NOTE[direction.source]}
              {direction.ambiguous && ' · ambiguous'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            {report.chainageToSegment.map((c) => (
              <span key={c.chainageId} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                ch{c.chainageId}
                <ArrowRight className="inline h-3 w-3 mx-1 text-slate-600" />
                <span className="text-cyan-400">seg {c.segmentIndex}</span>
                {c.startM !== null && (
                  <span className="ml-1 text-slate-500">{c.startM}–{c.endM} m</span>
                )}
              </span>
            ))}
          </div>

          {(conflict || ambiguous) && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{(conflict || ambiguous).message}</span>
            </p>
          )}
        </div>
      )}

      {/* per-row bindings */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-80 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] sticky top-0">
            <tr>
              <th className="p-2.5">Row</th>
              <th className="p-2.5">Matched by</th>
              <th className="p-2.5">Segment</th>
              <th className="p-2.5">Model element(s)</th>
              <th className="p-2.5">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 text-slate-300">
            {matches.map((m) => (
              <tr key={m.row.key} className="hover:bg-slate-800/40">
                <td className="p-2.5 font-mono whitespace-nowrap">
                  ch{m.row.chainageId} <span className="text-cyan-400 font-bold">{m.row.layerCode}</span>
                </td>
                <td className="p-2.5">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${STRATEGY_STYLE[m.strategy].chip}`}>
                    {STRATEGY_LABEL[m.strategy]}
                  </span>
                </td>
                <td className="p-2.5 font-mono tabular-nums text-slate-400">
                  {m.segmentIndex ?? '—'}
                </td>
                <td className="p-2.5 font-mono text-[11px]">
                  {m.elements.length
                    ? m.elements.map((e) => (
                        <div key={e.expressID} className="truncate max-w-[18rem]" title={e.globalId || ''}>
                          {e.name || `#${e.expressID}`}
                        </div>
                      ))
                    : <span className="text-rose-400">no element</span>}
                </td>
                <td className="p-2.5 text-[10px] text-slate-500">{m.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* elements nobody claimed */}
      {report.uncoveredElements.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Boxes className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-200">
              {report.uncoveredElements.length} model element{report.uncoveredElements.length === 1 ? '' : 's'} with no progress row
            </span>
            <span className="text-[10px] text-slate-500">these stay untinted</span>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-400">
            {report.uncoveredElements.slice(0, 24).map((e) => (
              <span key={e.expressID} className="px-1.5 py-0.5 rounded bg-slate-800/80">
                {e.name || `#${e.expressID}`}
                {e.segmentIndex !== null && <span className="text-slate-600"> · seg {e.segmentIndex}</span>}
              </span>
            ))}
            {report.uncoveredElements.length > 24 && (
              <span className="px-1.5 py-0.5 text-slate-500">+{report.uncoveredElements.length - 24} more</span>
            )}
          </div>
        </div>
      )}

      {/* rows that bound to nothing */}
      {report.unmatchedRows.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-rose-400" />
            <span className="text-[11px] font-bold text-rose-200">
              {report.unmatchedRows.length} row{report.unmatchedRows.length === 1 ? '' : 's'} bound to nothing
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-rose-300/80">
            {report.unmatchedRows.map((r) => (
              <span key={`${r.chainageId}-${r.layerCode}`} className="px-1.5 py-0.5 rounded bg-rose-500/10">
                ch{r.chainageId} · {r.layerCode} · {r.ifcRef || 'no LayerId'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
