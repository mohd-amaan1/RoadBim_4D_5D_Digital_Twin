import React from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { MapPin } from 'lucide-react';

export default function ChainageHeatmap() {
  const { setSelectedKmSection, setSliceKm, dashboard } = useRoadData();
  const modelMode = Boolean(dashboard?.modelMode);

  // Section count follows the uploaded model's actual length (min 1) instead of a fixed 100
  const totalKm = modelMode
    ? Math.max(1, Math.ceil(dashboard.corridorLengthM / 1000))
    : 100;

  const getKmStatusColor = (km) => {
    // Uploaded model with no progress data yet — everything is genuinely unknown
    if (modelMode && dashboard.awaitingExcel) {
      return 'bg-slate-800 text-slate-400 hover:bg-slate-700 border-slate-700 border-dashed';
    }
    if (km < 40) return 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 border-emerald-400/50 shadow-emerald-500/20';
    if (km < 70) {
      if (km % 4 === 0) return 'bg-rose-500 text-white hover:bg-rose-400 border-rose-400/50 shadow-rose-500/20 animate-pulse';
      return 'bg-amber-500 text-slate-950 hover:bg-amber-400 border-amber-400/50 shadow-amber-500/20';
    }
    if (km < 85) return 'bg-blue-500 text-white hover:bg-blue-400 border-blue-400/50 shadow-blue-500/20';
    return 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700';
  };

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800/90 space-y-3 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-2">
          <MapPin className="h-5 w-5 text-cyan-400" />
          <span className="font-extrabold text-white text-base font-[Outfit]">
            {modelMode
              ? `Chainage Progress Heatmap (${totalKm} section${totalKm > 1 ? 's' : ''} from model)`
              : '100 KM Chainage Progress Heatmap (KM 000 - KM 100)'}
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-4 text-xs font-bold">
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block glow-emerald"></span>
            <span className="text-slate-200">Completed</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-full bg-amber-500 inline-block glow-amber"></span>
            <span className="text-slate-200">In-Progress</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-full bg-rose-500 inline-block glow-rose"></span>
            <span className="text-slate-200">Delayed</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-3 w-3 rounded-full bg-slate-700 inline-block"></span>
            <span className="text-slate-200">Not Started</span>
          </div>
        </div>
      </div>

      {/* 100 Blocks Heatmap Grid */}
      <div className="km-heatmap-grid pt-1">
        {Array.from({ length: totalKm }).map((_, km) => (
          <button
            key={km}
            onClick={() => {
              setSelectedKmSection({
                km: km,
                kmLabel: `KM ${String(km).padStart(3, '0')} - KM ${String(km + 1).padStart(3, '0')}`,
                status: km < 40 ? 'Completed' : (km % 4 === 0 ? 'Delayed' : 'In-Progress')
              });
              setSliceKm(km);
            }}
            title={`KM ${km}: Click to inspect section and slice 3D model`}
            className={`h-7 rounded-md border text-xs font-mono font-bold flex items-center justify-center transition-all duration-200 hover:scale-110 shadow-sm ${getKmStatusColor(km)}`}
          >
            {km}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-300 text-right font-medium pt-1">
        {modelMode && dashboard.awaitingExcel
          ? 'No progress data in an IFC model — upload an Excel sheet to colour these sections'
          : 'Click any kilometer block above to set 3D section cut plane & inspect layer details'}
      </p>
    </div>
  );
}
