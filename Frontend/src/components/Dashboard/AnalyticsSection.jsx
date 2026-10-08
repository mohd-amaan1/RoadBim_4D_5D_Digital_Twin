import React from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { Layers, TrendingUp, ShieldCheck } from 'lucide-react';
import ReportExporter from '../Reports/ReportExporter';
import SegmentMatrix from './SegmentMatrix';

export default function AnalyticsSection() {
  const { executiveSummary, dashboard } = useRoadData();
  const modelMode = Boolean(dashboard?.modelMode);

  // In model mode the layer matrix comes from the IFC; percentages stay "—" until Excel.
  const modelLayerStats = modelMode
    ? dashboard.layers.map((l) => ({
        code: l.code,
        layerName: l.name,
        thicknessMm: l.thicknessMm,
        progressPercent: l.progressPercent,
        status: l.status,
        materialType: l.materialType,
        boundElements: l.boundElements,
        matchedRows: l.matchedRows,
      }))
    : null;

  const money = (v) => (v === null || v === undefined ? '—' : `$${(v / 1e6).toFixed(2)}M`);

  const layerStats = executiveSummary?.layerBreakdown || [
    { code: 'SUB', name: 'Subgrade Earthwork', thickness: 500, percent: 100, status: 'Completed', color: 'from-emerald-500 to-teal-400' },
    { code: 'GSB', name: 'Granular Sub-Base (GSB)', thickness: 200, percent: 84, status: 'In-Progress', color: 'from-cyan-500 to-blue-500' },
    { code: 'WMM', name: 'Wet Mix Macadam (WMM)', thickness: 250, percent: 62, status: 'In-Progress', color: 'from-blue-500 to-indigo-500' },
    { code: 'DBM', name: 'Dense Bituminous Macadam (DBM)', thickness: 100, percent: 38, status: 'Delayed', color: 'from-amber-500 to-rose-500' },
    { code: 'BC', name: 'Bituminous Concrete (BC Surface)', thickness: 50, percent: 18, status: 'Active', color: 'from-purple-500 to-indigo-600' },
  ];

  // Dynamic EVM Costs from Backend
  const pv = (executiveSummary.totalBudgetPlan / 1000000).toFixed(1);
  const ac = (executiveSummary.totalBudgetSpent / 1000000).toFixed(1);
  const ev = (executiveSummary.earnedValue / 1000000).toFixed(1);
  const cv = (executiveSummary.costVariance / 1000000).toFixed(1);
  const cvPercent = ((executiveSummary.costVariance / executiveSummary.totalBudgetPlan) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Header Bar with 1-Click PDF Report Export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white font-[Outfit]">Road Progress & 5D Cost Analytics</h2>
          <p className="text-xs text-slate-300 font-medium mt-0.5">
            {modelMode
              ? dashboard.binding?.mode === 'element'
                ? `Layer matrix read from the IFC · progress bound to ${dashboard.binding.covered} of ${dashboard.binding.elements} model elements`
                : 'Layer matrix read from the IFC — progress and cost await an Excel upload'
              : 'Layer completion matrix, S-curve trends, and cost variance across 100 KM'}
          </p>
        </div>
        <ReportExporter />
      </div>

      {modelMode && dashboard.segments?.length > 0 && (
        <SegmentMatrix segments={dashboard.segments} binding={dashboard.binding} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Layer Matrix & Thickness Progress */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 space-y-6 shadow-xl border border-slate-800/90">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Layers className="h-5 w-5 text-cyan-400" />
              <h3 className="text-base font-extrabold text-white font-[Outfit]">Layer-by-Layer Progress Breakdown</h3>
            </div>
            <span className="text-xs font-mono font-extrabold text-cyan-300 bg-cyan-500/20 px-3 py-1 rounded border border-cyan-500/40">
              Total Structural Depth: {modelMode ? `${dashboard.totalThicknessMm.toLocaleString()} mm` : '1,100 mm'}
            </span>
          </div>

          <div className="space-y-4">
            {modelMode ? modelLayerStats.map((layer) => {
              const hasProgress = layer.progressPercent !== null && layer.progressPercent !== undefined;
              return (
                <div key={layer.code + layer.layerName} className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="font-mono font-bold px-2.5 py-1 rounded bg-slate-800 text-cyan-400 text-xs shrink-0">{layer.code}</span>
                      <span className="font-extrabold text-white text-sm truncate">{layer.layerName}</span>
                      <span className="text-slate-300 font-medium text-xs shrink-0">({layer.thicknessMm} mm)</span>
                    </div>
                    <div className="flex items-center space-x-3 shrink-0">
                      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${
                        !hasProgress ? 'bg-slate-700/40 text-slate-300 border-slate-600/50'
                          : layer.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : layer.status === 'Delayed' ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      }`}>
                        {hasProgress ? layer.status : 'Awaiting Excel'}
                      </span>
                      <span className="font-extrabold text-white font-[Outfit] text-base">
                        {hasProgress ? `${layer.progressPercent}%` : '—'}
                      </span>
                      {layer.boundElements > 0 && (
                        <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                          {layer.boundElements} el
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 font-mono truncate">{layer.materialType}</p>

                  <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
                    <div
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 h-3 rounded-full transition-all duration-1000"
                      style={{ width: `${hasProgress ? layer.progressPercent : 0}%` }}
                    />
                  </div>
                </div>
              );
            }) : layerStats.map((layer) => (
              <div key={layer.code || layer.layerName} className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between text-xs">
                  <div className="flex items-center space-x-2.5">
                    <span className="font-mono font-bold px-2.5 py-1 rounded bg-slate-800 text-cyan-400 text-xs">{layer.code || layer.layerName?.substring(0,3)}</span>
                    <span className="font-extrabold text-white text-sm">{layer.layerName || layer.name}</span>
                    <span className="text-slate-300 font-medium text-xs">({layer.thicknessMm || layer.thickness} mm)</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                      (layer.progressPercent || layer.percent) === 100 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      (layer.status === 'Delayed' || layer.delayedKm > 0) ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {layer.status || ((layer.progressPercent || layer.percent) === 100 ? 'Completed' : 'In-Progress')}
                    </span>
                    <span className="font-extrabold text-white font-[Outfit] text-base">{layer.progressPercent || layer.percent}%</span>
                  </div>
                </div>

                <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
                  <div 
                    className={`bg-gradient-to-r ${layer.color || 'from-cyan-500 to-blue-500'} h-3 rounded-full transition-all duration-1000`} 
                    style={{ width: `${layer.progressPercent || layer.percent}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Dynamic S-Curve & EVM Cost Summary from Backend */}
        <div className="glass-panel rounded-2xl p-6 space-y-6 flex flex-col justify-between shadow-xl border border-slate-800/90">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              <h3 className="text-base font-extrabold text-white font-[Outfit]">S-Curve & EVM Variance</h3>
            </div>

            {modelMode ? (
              <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-300">Planned Value (PV)</span>
                  <span className="font-bold text-white text-sm">{money(dashboard.pv)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-300">Earned Value (EV)</span>
                  <span className="font-bold text-emerald-400 text-sm">{money(dashboard.ev)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-300">Actual Cost (AC)</span>
                  <span className="font-bold text-cyan-400 text-sm">{money(dashboard.ac)}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-300">Schedule Index (SPI)</span>
                  <span className="font-bold text-white text-sm">{dashboard.spi ?? '—'}</span>
                </div>
                <div className="border-t border-slate-800 pt-3 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200">Cost Variance (CV)</span>
                  <span className={`font-extrabold font-[Outfit] text-base ${
                    dashboard.cv === null ? 'text-slate-300' : dashboard.cv >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {dashboard.cv === null ? '—' : `${dashboard.cv >= 0 ? '+' : ''}${money(dashboard.cv)}`}
                  </span>
                </div>
              </div>
            ) : (
            <div className="bg-slate-900/90 rounded-xl p-4 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-300">Planned Value (PV)</span>
                <span className="font-bold text-white text-sm">${pv} Million</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-300">Earned Value (EV)</span>
                <span className="font-bold text-emerald-400 text-sm">${ev} Million</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-slate-300">Actual Cost (AC)</span>
                <span className="font-bold text-cyan-400 text-sm">${ac} Million</span>
              </div>
              <div className="border-t border-slate-800 pt-3 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200">Cost Variance (CV)</span>
                <span className="font-extrabold text-emerald-400 font-[Outfit] text-base">+${cv} Million (+{cvPercent}%)</span>
              </div>
            </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-100 space-y-1">
            <div className="flex items-center space-x-1.5 font-bold text-cyan-300">
              <ShieldCheck className="h-4 w-4" />
              <span> Key Takeaway</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-200 opacity-95">
              {modelMode
                ? (dashboard.hasCostData
                    ? `Cost Performance Index (CPI) is ${dashboard.cpi ?? '—'}, derived from the Budget_Cost and Actual_Cost columns of the uploaded sheet.`
                    : 'Earned-value metrics need Budget_Cost and Actual_Cost columns in the Excel sheet. An IFC design model carries no cost data.')
                : `The project is performing under budget with a Cost Performance Index (CPI) of ${executiveSummary.cpi}. 4D simulation indicates total 100 KM completion by Q3 2026.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
