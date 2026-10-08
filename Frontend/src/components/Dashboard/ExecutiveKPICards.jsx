import React from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { CheckCircle2, Clock, AlertTriangle, DollarSign, TrendingUp, Boxes, Layers, Ruler } from 'lucide-react';
import { display, formatLength } from '../../utils/dashboardMetrics';

/*
 * Full literal class strings per accent — Tailwind (and the Play CDN) resolve class
 * names statically, so an interpolated `bg-${accent}-500/10` would generate nothing.
 */
const ACCENTS = {
  cyan: { border: 'hover:border-cyan-500/50', icon: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 glow-cyan' },
  emerald: { border: 'hover:border-emerald-500/50', icon: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 glow-emerald' },
  blue: { border: 'hover:border-blue-500/50', icon: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  slate: { border: 'hover:border-slate-600/60', icon: 'bg-slate-700/30 text-slate-400 border-slate-600/40' },
};

/** Shared card shell so both the demo and model-driven variants stay visually identical. */
export function KpiCard({ label, icon: Icon, accent = 'cyan', value, unit, badge, badgeTone, footer, children }) {
  const tone = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div className={`glass-card rounded-2xl p-5 border border-slate-800/90 transition-all duration-300 shadow-xl hover:shadow-2xl ${tone.border}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">{label}</span>
        <div className={`p-2.5 rounded-xl border ${tone.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-3xl lg:text-4xl font-extrabold text-white font-[Outfit] leading-none">
          {value}
          {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
        </span>
        {badge && (
          <span className={`text-xs font-extrabold px-2.5 py-1 rounded-md border shrink-0 ${badgeTone}`}>
            {badge}
          </span>
        )}
      </div>
      {children}
      {footer && <p className="mt-2 text-xs font-semibold text-slate-300">{footer}</p>}
    </div>
  );
}

const AWAITING = 'bg-slate-700/40 text-slate-300 border-slate-600/50';

export default function ExecutiveKPICards() {
  const { progressData, dashboard } = useRoadData();

  // ----------------------------------------------------------------------
  // Model mode — figures derived from the uploaded IFC, "—" for the rest
  // ----------------------------------------------------------------------
  if (dashboard?.modelMode) {
    const { value: lengthValue, unit: lengthUnit } = formatLength(dashboard.corridorLengthM);
    const awaiting = dashboard.awaitingExcel;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Corridor Length"
          icon={Ruler}
          accent="cyan"
          value={lengthValue}
          unit={lengthUnit}
          badge="From IFC"
          badgeTone="bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
          footer={`Modelled width ${display(dashboard.corridorWidthM, { digits: 1, suffix: ' m' })}`}
        />

        <KpiCard
          label="Modelled Elements"
          icon={Boxes}
          accent="cyan"
          value={dashboard.elementCount.toLocaleString()}
          badge="From IFC"
          badgeTone="bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
          footer={Object.entries(dashboard.summary.elementTypeCounts)
            .map(([type, count]) => `${type} x${count}`)
            .join(', ')}
        />

        <KpiCard
          label="Pavement Depth"
          icon={Layers}
          accent="cyan"
          value={display(dashboard.totalThicknessMm, { digits: 0 })}
          unit="mm"
          badge={`${dashboard.layerCount} layers`}
          badgeTone="bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
          footer="Summed from IFC material layer sets"
        />

        <KpiCard
          label="Overall Progress"
          icon={awaiting || dashboard.bridge ? Clock : CheckCircle2}
          accent={awaiting || dashboard.bridge ? 'slate' : 'emerald'}
          value={display(dashboard.overallProgressPercent, { digits: 1, suffix: '%' })}
          badge={awaiting ? 'Awaiting Excel'
            : dashboard.bridge ? 'Not in register'
            : dashboard.binding?.mode === 'element' ? 'Bound to model' : 'From Excel'}
          badgeTone={awaiting || dashboard.bridge ? AWAITING : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}
          footer={
            awaiting
              ? 'Not present in an IFC design model'
              : dashboard.bridge
                ? 'Needs planned quantities — the register lists executed work only'
              : dashboard.binding?.mode === 'element'
                ? `${display(dashboard.activeZones)} active | ${display(dashboard.delayFlags)} delayed | ${dashboard.binding.covered}/${dashboard.binding.elements} elements`
                : `${display(dashboard.activeZones)} active | ${display(dashboard.delayFlags)} delayed`
          }
        />

        <KpiCard
          label="Cost Index (CPI)"
          icon={DollarSign}
          accent={dashboard.cpi === null ? 'slate' : 'blue'}
          value={display(dashboard.cpi, { digits: 2 })}
          badge={dashboard.cpi === null ? 'Awaiting Excel' : 'From Excel'}
          badgeTone={dashboard.cpi === null ? AWAITING : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}
          footer={
            dashboard.cpi === null
              ? 'Needs Budget_Cost / Actual_Cost columns'
              : `EV ${display(dashboard.ev / 1e6, { digits: 2, suffix: 'M' })} / AC ${display(dashboard.ac / 1e6, { digits: 2, suffix: 'M' })}`
          }
        />
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // Demo mode — unchanged behaviour when no model has been uploaded
  // ----------------------------------------------------------------------
  const totalKmTarget = 100;
  const completedKm = progressData.filter(p => p.layerCode === 'BC' && p.status === 'Completed').length || 42;
  const inProgressKm = progressData.filter(p => p.layerCode === 'BC' && p.status === 'In-Progress').length || 28;
  const delayedKm = progressData.filter(p => p.status === 'Delayed').length || 8;

  const spi = 0.96;
  const cpi = 1.04;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {/* 1. Linear KM Progress */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800/90 hover:border-cyan-500/50 transition-all duration-300 shadow-xl hover:shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">Total Linear KM</span>
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 glow-cyan">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl lg:text-4xl font-extrabold text-white font-[Outfit]">{completedKm} <span className="text-sm font-normal text-slate-400">/ 100 KM</span></span>
          <span className="text-xs font-extrabold text-emerald-400 bg-emerald-500/20 px-2.5 py-1 rounded-md border border-emerald-500/30">{(completedKm / totalKmTarget * 100).toFixed(0)}% Done</span>
        </div>
        <div className="mt-3 w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
          <div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-2 rounded-full" style={{ width: `${(completedKm / totalKmTarget * 100)}%` }}></div>
        </div>
      </div>

      {/* 2. In-Progress Sections */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800/90 hover:border-amber-500/50 transition-all duration-300 shadow-xl hover:shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">Active Work Zones</span>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 glow-amber">
            <Clock className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl lg:text-4xl font-extrabold text-white font-[Outfit]">{inProgressKm} <span className="text-sm font-normal text-slate-400">KM</span></span>
          <span className="text-xs font-extrabold text-amber-400 bg-amber-500/20 px-2.5 py-1 rounded-md border border-amber-500/30">2 Shifts</span>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-300">Subgrade &amp; GSB compaction active</p>
      </div>

      {/* 3. Delayed Hotspots */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800/90 hover:border-rose-500/50 transition-all duration-300 shadow-xl hover:shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">Delay Flags</span>
          <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/30 glow-rose">
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl lg:text-4xl font-extrabold text-rose-400 font-[Outfit]">{delayedKm} <span className="text-sm font-normal text-slate-400">Sec</span></span>
          <span className="text-xs font-extrabold text-rose-400 bg-rose-500/20 px-2.5 py-1 rounded-md border border-rose-500/30">Critical</span>
        </div>
        <p className="mt-2 text-xs font-semibold text-rose-300">KM 040-048 Bitumen Machinery</p>
      </div>

      {/* 4. Schedule Performance Index (SPI) */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800/90 hover:border-emerald-500/50 transition-all duration-300 shadow-xl hover:shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">Schedule Index (SPI)</span>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 glow-emerald">
            <TrendingUp className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl lg:text-4xl font-extrabold text-white font-[Outfit]">{spi}</span>
          <span className="text-xs font-extrabold text-emerald-400 bg-emerald-500/20 px-2.5 py-1 rounded-md border border-emerald-500/30">On Track</span>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-300">Target SPI &gt;= 0.95 (Earned Value)</p>
      </div>

      {/* 5. Cost Performance Index (CPI) */}
      <div className="glass-card rounded-2xl p-5 border border-slate-800/90 hover:border-blue-500/50 transition-all duration-300 shadow-xl hover:shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">Cost Index (CPI)</span>
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-3xl lg:text-4xl font-extrabold text-white font-[Outfit]">{cpi}</span>
          <span className="text-xs font-extrabold text-blue-400 bg-blue-500/20 px-2.5 py-1 rounded-md border border-blue-500/30">+4% Savings</span>
        </div>
        <p className="mt-2 text-xs font-semibold text-slate-300">5D Budget Spent $42.5M / $44.2M</p>
      </div>
    </div>
  );
}
