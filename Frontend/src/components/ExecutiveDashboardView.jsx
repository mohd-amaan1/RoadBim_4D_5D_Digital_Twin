import React from 'react';
import ExecutiveKPICards from './Dashboard/ExecutiveKPICards';
import ChainageHeatmap from './Dashboard/ChainageHeatmap';
import RoadBIMViewer from './Viewer3D/RoadBIMViewer';
import LayerExplorer from './Viewer3D/LayerExplorer';
import TimelineScrubber from './Timeline4D/TimelineScrubber';
import AnalyticsSection from './Dashboard/AnalyticsSection';
import TrackerDashboard from './Dashboard/TrackerDashboard';
import { useRoadData } from '../context/RoadDataContext';
import { isTrackerPackage } from '../modules/bridgeTracker/constants';

export default function ExecutiveDashboardView() {
  const { activePackage } = useRoadData();
  // A tracker package's figures come from the tracker, not from road workbooks.
  if (isTrackerPackage(activePackage)) return <TrackerDashboard />;
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Top Banner Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-[#131924] to-[#0B0F17] p-6 rounded-2xl border border-slate-800/90 shadow-2xl">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              EXECUTIVE BOARD BRIEFING
            </span>
            <span className="text-xs text-slate-500 font-bold">|</span>
            <span className="text-xs font-bold text-slate-200">100 KM Highway Corridor</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-extrabold text-white font-[Outfit] mt-1.5">
            Highway Infrastructure 4D/5D Digital Twin
          </h2>
          <p className="text-sm text-slate-300 font-medium mt-1">
            Real-time parametric BIM monitoring, sub-surface layer inspection, live Excel ingestion, and EVM cost analytics.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right">
            <span className="text-xs text-slate-300 block font-mono font-bold">PROJECT HEALTH INDEX</span>
            <span className="text-xl font-extrabold text-emerald-400 font-[Outfit]">EXCELLENT (96.4%)</span>
          </div>
        </div>
      </div>

      {/* 1. Executive KPI Cards Bar */}
      <ExecutiveKPICards />

      {/* 2. 3D BIM Model Viewport + Layer Cut-Section Explorer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RoadBIMViewer />
        </div>
        <div>
          <LayerExplorer />
        </div>
      </div>

      {/* 3. 0 to 100 KM Interactive Chainage Heatmap */}
      <ChainageHeatmap />

      {/* 4. 4D Timeline Construction Simulator */}
      <TimelineScrubber />

      {/* 5. Analytics & EVM Cost Matrix */}
      <AnalyticsSection />
    </div>
  );
}
