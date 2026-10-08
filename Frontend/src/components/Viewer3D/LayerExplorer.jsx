import React, { useState, useEffect } from 'react';
import { Layers, RefreshCw, Info, ArrowUpRight, ArrowDownRight, ChevronRight, X, BarChart2, Activity, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useRoadData } from '../../context/RoadDataContext';
import { tokenStore, API_BASE } from '../../api/client';

/** Palette used to colour IFC-derived layers, which carry no display colour of their own. */
const IFC_LAYER_COLORS = ['#F59E0B', '#0EA5E9', '#6366F1', '#F43F5E', '#38BDF8', '#10B981', '#8B5CF6', '#EC4899'];

export default function LayerExplorer() {
  const { selectedKmSection, setSelectedKmSection, dashboard } = useRoadData();
  const modelMode = Boolean(dashboard?.modelMode);

  const [activeKm, setActiveKm] = useState(
    selectedKmSection?.km !== undefined ? selectedKmSection.km : 42
  );

  const [layers, setLayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [editThickness, setEditThickness] = useState(100);
  const [editColor, setEditColor] = useState('#38BDF8');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedKmSection?.km !== undefined) {
      setActiveKm(selectedKmSection.km);
    }
  }, [selectedKmSection]);

  // Load layer data dynamically (Attempts Backend API first, then falls back to dataset)
  const loadLayerData = async (km) => {
    // An uploaded model is the source of truth — never overwrite it with demo/API data
    if (modelMode) return;
    setLoading(true);
    try {
      // Relative, token-carrying and ngrok-safe, like every other call. The hardcoded
      // host meant this 401'd for want of a token and pointed at the wrong machine
      // entirely when the app was reached through a tunnel.
      const token = tokenStore.get();
      const response = await fetch(`${API_BASE}/api/RoadProgress/chainage-layers/${km}`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setLayers(data);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      // Gracefully handle offline backend
    }

    setLayers(getFallbackLayers(km));
    setLoading(false);
  };

  useEffect(() => {
    loadLayerData(activeKm);
  }, [activeKm]);

  // Save layer thickness and color update
  const handleSave = (e) => {
    e.preventDefault();
    if (!selectedLayer) return;
    setSaving(true);

    const newThickness = parseInt(editThickness, 10) || 100;
    const targetCode = selectedLayer.layerCode || selectedLayer.code;

    // Local state update & dynamic elevation recalculation for N layers
    setLayers((prevLayers) => {
      const updated = prevLayers.map((item) => {
        const itemCode = item.layerCode || item.code;
        if (itemCode === targetCode) {
          return {
            ...item,
            effectiveThicknessMm: newThickness,
            thicknessMm: newThickness,
            levelColorHex: editColor
          };
        }
        return item;
      });

      const baseElev = updated[0]?.baseTerrainElevation || 120.5 + activeKm * 0.45;
      const bottomUp = [...updated].sort((a, b) => (a.sortOrder || a.layerId || 0) - (b.sortOrder || b.layerId || 0));
      let currentRL = baseElev;

      const recalculatedMap = {};
      bottomUp.forEach((l) => {
        const thicknessM = (l.effectiveThicknessMm || l.thicknessMm || 100) / 1000;
        const layerBase = currentRL;
        const layerTop = currentRL + thicknessM;
        currentRL = layerTop;

        const codeKey = l.layerCode || l.code;
        recalculatedMap[codeKey] = {
          baseLevelMeters: Number(layerBase.toFixed(3)),
          topLevelMeters: Number(layerTop.toFixed(3))
        };
      });

      return updated.map((l) => {
        const codeKey = l.layerCode || l.code;
        if (recalculatedMap[codeKey]) {
          return {
            ...l,
            baseLevelMeters: recalculatedMap[codeKey].baseLevelMeters,
            topLevelMeters: recalculatedMap[codeKey].topLevelMeters
          };
        }
        return l;
      });
    });

    setSaving(false);
    setSelectedLayer(null);
  };

  const buildLayerStack = (km, baseElev, rawLayers) => {
    const sortedBottomUp = [...rawLayers].sort((a, b) => a.id - b.id);
    let currentRL = baseElev;
    const calcMap = {};

    sortedBottomUp.forEach((item) => {
      const thickM = item.thickness / 1000.0;
      const baseM = currentRL;
      const topM = currentRL + thickM;
      currentRL = topM;

      calcMap[item.code] = {
        baseM: Number(baseM.toFixed(3)),
        topM: Number(topM.toFixed(3))
      };
    });

    return rawLayers.map((item) => ({
      chainageKm: km,
      layerId: item.id,
      layerName: item.name,
      layerCode: item.code,
      sortOrder: item.id,
      effectiveThicknessMm: item.thickness,
      thicknessMm: item.thickness,
      materialType: item.mat,
      levelColorHex: item.color,
      status: item.status,
      progressPercent: item.progress,
      baseTerrainElevation: baseElev,
      topLevelMeters: calcMap[item.code]?.topM || 0,
      baseLevelMeters: calcMap[item.code]?.baseM || 0
    }));
  };

  // Dynamic fallback dataset supporting variable levels (4, 5, 6, 7, 8+ levels per chainage)
  const getFallbackLayers = (km) => {
    const baseElev = 120.5 + km * 0.45;

    if (km === 14) {
      // 4 Levels (Light Cut Section)
      return buildLayerStack(km, baseElev, [
        { id: 4, name: 'Bituminous Concrete (BC Surface)', code: 'BC', thickness: 40, mat: 'Asphalt wearing course for smooth surface & sealing', color: '#38BDF8', status: 'Completed', progress: 100 },
        { id: 3, name: 'Dense Bituminous Macadam (DBM)', code: 'DBM', thickness: 80, mat: 'Structural dense asphalt load-bearing layer', color: '#F43F5E', status: 'Completed', progress: 100 },
        { id: 2, name: 'Wet Mix Macadam (WMM Base)', code: 'WMM', thickness: 220, mat: 'Bound aggregate base course layer', color: '#6366F1', status: 'Completed', progress: 100 },
        { id: 1, name: 'Subgrade Earthwork Foundation (SUB)', code: 'SUB', thickness: 450, mat: 'Compacted natural subgrade earthwork CBR > 8%', color: '#F59E0B', status: 'Completed', progress: 100 }
      ]);
    } else if (km === 68) {
      // 7 Levels (Heavy Embankment & High Load Corridor)
      return buildLayerStack(km, baseElev, [
        { id: 7, name: 'Open Graded Friction Course (OGFC)', code: 'OGFC', thickness: 30, mat: 'Porous noise-reduction asphalt friction course', color: '#10B981', status: 'In-Progress', progress: 30 },
        { id: 6, name: 'Bituminous Concrete (BC Surface)', code: 'BC', thickness: 50, mat: 'High stability polymer modified bitumen wearing course', color: '#38BDF8', status: 'In-Progress', progress: 45 },
        { id: 5, name: 'Dense Bituminous Macadam - Binder 2', code: 'DBM-2', thickness: 90, mat: 'Heavy axle load upper binder course', color: '#EC4899', status: 'In-Progress', progress: 60 },
        { id: 4, name: 'Dense Bituminous Macadam - Binder 1', code: 'DBM-1', thickness: 110, mat: 'Primary structural asphalt base course', color: '#F43F5E', status: 'Completed', progress: 100 },
        { id: 3, name: 'Wet Mix Macadam (WMM Base)', code: 'WMM', thickness: 250, mat: 'Crushed stone aggregate base course', color: '#6366F1', status: 'Completed', progress: 100 },
        { id: 2, name: 'Granular Sub-Base (GSB Layer)', code: 'GSB', thickness: 200, mat: 'Subgrade drainage & load distribution layer', color: '#0EA5E9', status: 'Completed', progress: 100 },
        { id: 1, name: 'Stabilized Subgrade Earthwork', code: 'SUB', thickness: 500, mat: 'Compacted earth foundation & embankment fill', color: '#F59E0B', status: 'Completed', progress: 100 }
      ]);
    } else if (km === 80) {
      // 6 Levels (Flyover Ramp & Structure Approach)
      return buildLayerStack(km, baseElev, [
        { id: 6, name: 'Stone Matrix Asphalt (SMA Surface)', code: 'SMA', thickness: 40, mat: 'Polymer-modified gap-graded SMA wearing course', color: '#8B5CF6', status: 'In-Progress', progress: 20 },
        { id: 5, name: 'Bituminous Concrete (BC Layer)', code: 'BC', thickness: 50, mat: 'Dense asphalt wearing course', color: '#38BDF8', status: 'In-Progress', progress: 50 },
        { id: 4, name: 'Dense Bituminous Macadam (DBM)', code: 'DBM', thickness: 100, mat: 'Heavy binder course layer', color: '#F43F5E', status: 'In-Progress', progress: 75 },
        { id: 3, name: 'Wet Mix Macadam (WMM)', code: 'WMM', thickness: 250, mat: 'Bound crushed aggregate macadam', color: '#6366F1', status: 'Completed', progress: 100 },
        { id: 2, name: 'Granular Sub-Base (GSB)', code: 'GSB', thickness: 200, mat: 'Subgrade drainage course', color: '#0EA5E9', status: 'Completed', progress: 100 },
        { id: 1, name: 'Reinforced Earth Foundation', code: 'REF', thickness: 550, mat: 'Geo-grid reinforced earth foundation bed', color: '#F59E0B', status: 'Completed', progress: 100 }
      ]);
    }

    // Default 5 Levels (Standard Pavement Sections like KM 000, 010, 042, 100)
    return buildLayerStack(km, baseElev, [
      { id: 5, name: 'Bituminous Concrete (BC Surface)', code: 'BC', thickness: 50, mat: 'Asphalt wearing course for smooth ride & water sealing', color: '#38BDF8', status: km < 40 ? 'Completed' : 'In-Progress', progress: km < 40 ? 100 : 18 },
      { id: 4, name: 'Dense Bituminous Macadam (DBM)', code: 'DBM', thickness: 100, mat: 'Structural load-bearing dense asphalt layer', color: '#F43F5E', status: km < 40 ? 'Completed' : 'Delayed', progress: km < 40 ? 100 : 38 },
      { id: 3, name: 'Wet Mix Macadam (WMM)', code: 'WMM', thickness: 250, mat: 'Bound crushed aggregate base course', color: '#6366F1', status: km < 40 ? 'Completed' : 'In-Progress', progress: km < 40 ? 100 : 62 },
      { id: 2, name: 'Granular Sub-Base (GSB)', code: 'GSB', thickness: 200, mat: 'Granular sub-base drainage & load distribution layer', color: '#0EA5E9', status: km < 40 ? 'Completed' : 'In-Progress', progress: km < 40 ? 100 : 84 },
      { id: 1, name: 'Subgrade Earthwork (SUB)', code: 'SUB', thickness: 500, mat: 'Compacted earth foundation & subgrade (CBR > 8%)', color: '#F59E0B', status: 'Completed', progress: 100 }
    ]);
  };

  // In model mode the stack comes from the IFC material layer sets; progress/status stay
  // null (rendered "—") until an Excel sheet fills them in.
  const effectiveLayers = modelMode
    ? dashboard.layers.map((layer, index) => ({
        chainageKm: null,
        layerId: layer.sortOrder,
        layerName: layer.name,
        layerCode: layer.code,
        sortOrder: layer.sortOrder,
        effectiveThicknessMm: layer.thicknessMm,
        thicknessMm: layer.thicknessMm,
        materialType: layer.materialType,
        levelColorHex: IFC_LAYER_COLORS[index % IFC_LAYER_COLORS.length],
        status: layer.status,
        progressPercent: layer.progressPercent,
        baseTerrainElevation: dashboard.summary.siteElevationM,
        topLevelMeters: layer.topLevelM,
        baseLevelMeters: layer.baseLevelM,
        instanceCount: layer.instanceCount,
        boundElements: layer.boundElements,
        matchedRows: layer.matchedRows,
        matchStrategies: layer.matchStrategies,
        thicknessSource: layer.thicknessSource,
      }))
    : layers;

  // Sort layers top to bottom (highest sortOrder first)
  const sortedLayers = [...effectiveLayers].sort((a, b) => (b.sortOrder || b.layerId || 0) - (a.sortOrder || a.layerId || 0));

  // Compute total thickness and levels dynamically for N layers
  const totalThicknessMm = sortedLayers.reduce((sum, item) => sum + (item.effectiveThicknessMm || item.thicknessMm || 0), 0);
  const totalThicknessMeters = (totalThicknessMm / 1000).toFixed(2);
  const baseTerrainElev = sortedLayers[0]?.baseTerrainElevation || 120.5 + activeKm * 0.45;
  const topFinishedElev = sortedLayers[0]?.topLevelMeters || baseTerrainElev + totalThicknessMm / 1000;

  const availableChainages = [0, 10, 14, 20, 30, 40, 42, 50, 60, 68, 70, 80, 90, 100];
  const colorPresets = ['#38BDF8', '#F43F5E', '#6366F1', '#0EA5E9', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6'];

  return (
    <div className="glass-panel viewport-panel rounded-2xl p-5 border border-slate-800 flex flex-col justify-between shadow-xl relative select-none">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-extrabold text-white font-[Outfit]">Layer & Level Explorer</h3>
              <span className="text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm">
                {sortedLayers.length} Levels Active
              </span>
            </div>
            <span className="text-xs text-slate-400 font-medium">
              {modelMode ? 'Cross-section read from the uploaded IFC' : 'Live Pavement Elevation Cross-Section'}
            </span>
          </div>
        </div>

        {/* Chainage selection is meaningless for an uploaded model — it has one cross-section */}
        {modelMode ? (
          <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            IFC MATERIAL LAYER SETS
          </span>
        ) : (
        <div className="flex items-center space-x-2">
          <label className="text-xs font-mono font-bold text-slate-400">Chainage:</label>
          <select
            value={activeKm}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              setActiveKm(value);
              if (setSelectedKmSection) setSelectedKmSection({ km: value });
            }}
            className="bg-slate-900 border border-cyan-500/40 text-cyan-300 text-xs font-mono font-bold rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer shadow-md"
          >
            {availableChainages.map((km) => {
              let levelBadge = '(5 Levels)';
              if (km === 14) levelBadge = '(4 Levels)';
              else if (km === 68) levelBadge = '(7 Levels)';
              else if (km === 80) levelBadge = '(6 Levels)';

              return (
                <option key={km} value={km}>
                  KM {String(km).padStart(3, '0')}+000 {levelBadge}
                </option>
              );
            })}
          </select>

          <button
            onClick={() => loadLayerData(activeKm)}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500 text-slate-300 transition-all"
            title="Refresh layers"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
        )}
      </div>

      {/* Reduced Level Telemetry Banner */}
      <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs shrink-0 my-2">
        <div className="flex items-center space-x-2">
          <ArrowUpRight className="h-4 w-4 text-emerald-400" />
          <div>
            <span className="text-slate-400 text-[11px] block font-mono">Finished Top Level:</span>
            <span className="font-mono font-bold text-emerald-400">{topFinishedElev.toFixed(3)} m RL</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <ArrowDownRight className="h-4 w-4 text-amber-400" />
          <div>
            <span className="text-slate-400 text-[11px] block font-mono">Base Terrain Level:</span>
            <span className="font-mono font-bold text-amber-400">{baseTerrainElev.toFixed(3)} m RL</span>
          </div>
        </div>
      </div>

      {/* Single Unified Layer Cross-Section Card List */}
      {loading ? (
        <div className="space-y-2 py-4 flex-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-slate-900 rounded-xl animate-pulse border border-slate-800" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 my-1 custom-scrollbar">
          {sortedLayers.map((layer) => {
            const thickness = layer.effectiveThicknessMm || layer.thicknessMm || 100;
            const code = layer.layerCode || layer.code;
            const color = layer.levelColorHex || '#38BDF8';

            // An IFC carries no progress — keep it genuinely unknown rather than defaulting to 50%
            const hasProgress = layer.progressPercent !== null && layer.progressPercent !== undefined;
            const status = layer.status || (hasProgress ? 'In-Progress' : null);
            const progress = hasProgress ? layer.progressPercent : null;
            const isDone = status === 'Completed' || progress >= 100;
            const isDelayed = status === 'Delayed';

            let statusBadgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
            if (!status) statusBadgeStyle = 'bg-slate-700/40 text-slate-300 border-slate-600/50';
            else if (isDone) statusBadgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
            else if (isDelayed) statusBadgeStyle = 'bg-rose-500/20 text-rose-300 border-rose-500/40';

            return (
              <div
                key={layer.layerId || code}
                className="bg-slate-900/90 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-3.5 pl-4 flex flex-col justify-between space-y-2.5 transition-all relative overflow-hidden group shadow-md"
                style={{
                  background: `linear-gradient(90deg, ${color}22 0%, rgba(15, 23, 42, 0.95) 100%)`
                }}
              >
                {/* Level Color Bar Left Accent */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-2 transition-all group-hover:w-2.5"
                  style={{ backgroundColor: color }}
                />

                {/* LINE 1 (Top): Level Dot + Title + Level/Code Badge (Left) | Thickness mm (Right) */}
                <div className="flex items-center justify-between gap-2 pr-1">
                  <div className="flex items-center space-x-2.5 min-w-0 flex-1 pr-2">
                    <span 
                      className="h-3.5 w-3.5 rounded-full shrink-0 shadow-md ring-2 ring-slate-800"
                      style={{ backgroundColor: color }}
                      title={`Layer Level Display Color: ${color}`}
                    />
                    <span className="text-base font-extrabold text-white font-[Outfit] leading-tight truncate">
                      {layer.layerName || layer.name}
                    </span>
                    <span 
                      className="text-[11px] font-mono font-extrabold px-2 py-0.5 rounded-md border shadow-sm shrink-0"
                      style={{ backgroundColor: `${color}25`, borderColor: `${color}66`, color: '#FFFFFF' }}
                    >
                      L{layer.sortOrder || layer.layerId || ''} • {code}
                    </span>
                  </div>

                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-sm font-mono font-extrabold text-cyan-300">
                      {thickness} mm
                    </span>
                    {layer.thicknessSource === 'ifc' && (
                      <span
                        className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30"
                        title="Taken from the model's IfcMaterialLayerSet, not from the spreadsheet"
                      >
                        IFC
                      </span>
                    )}
                  </span>
                </div>

                {/* LINE 2 (Bottom): Status Badge & Mini Progress Bar (Left) | Action Button (Right) */}
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-800/70">
                  <div className="flex items-center space-x-2.5 flex-1 max-w-[16rem]">
                    {/* Status Badge */}
                    <span className={`inline-flex items-center space-x-1.5 text-xs font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${statusBadgeStyle}`}>
                      {!status ? (
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                      ) : isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : isDelayed ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-cyan-400" />
                      )}
                      <span>
                        {!status ? '— awaiting Excel' : isDone ? '100% Completed' : `${progress}% ${status}`}
                      </span>
                    </span>

                    {/* Mini Visual Progress Track Bar */}
                    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800 hidden sm:block">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isDone ? 'bg-emerald-500 shadow-emerald-500/50' : isDelayed ? 'bg-rose-500 shadow-rose-500/50' : 'bg-cyan-500 shadow-cyan-500/50'
                        }`}
                        style={{ width: `${progress ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {layer.boundElements > 0 && (
                      <span
                        className="text-[10px] font-mono text-slate-400 hidden md:inline"
                        title={`${layer.matchedRows} progress row(s) matched by ${(layer.matchStrategies || []).join(', ')}`}
                      >
                        {layer.boundElements} bound
                      </span>
                    )}
                  <button
                    onClick={() => {
                      setSelectedLayer(layer);
                      setEditThickness(thickness);
                      setEditColor(color);
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-cyan-400 text-xs font-extrabold transition-all border border-slate-700 hover:border-cyan-400 flex items-center space-x-1.5 shadow-sm shrink-0"
                  >
                    <span>Read More & Edit</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-300 shrink-0">
        <div className="flex items-center space-x-1.5">
          <Info className="h-4 w-4 text-cyan-400" />
          <span>Total Cross-Section Levels:</span>
        </div>
        <span className="font-mono font-bold text-cyan-300 text-sm font-[Outfit]">
          {sortedLayers.length} Active Levels ({totalThicknessMm} mm / {totalThicknessMeters} m)
        </span>
      </div>

      {/* Details & Edit Modal Lightbox */}
      {selectedLayer && (() => {
        const modalBaseRL = Number(selectedLayer.baseLevelMeters || 120.5);
        const modalThicknessM = (parseInt(editThickness, 10) || 100) / 1000.0;
        const modalTopRL = modalBaseRL + modalThicknessM;

        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl animate-scale-in">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2.5">
                  <span className="h-4 w-4 rounded-full shadow-md shrink-0" style={{ backgroundColor: editColor }} />
                  <div>
                    <h4 className="text-base font-extrabold text-white font-[Outfit]">
                      {selectedLayer.layerName || selectedLayer.name}
                    </h4>
                    <div className="flex items-center space-x-2 text-xs font-mono text-cyan-400">
                      <span>KM {String(activeKm).padStart(3, '0')}+000</span>
                      <span>•</span>
                      <span>Code: {selectedLayer.layerCode || selectedLayer.code}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedLayer(null)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Reduced Level (RL) Telemetry Box inside Popup */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-3 shadow-inner">
                <div>
                  <span className="text-slate-400 block font-mono text-[11px]">Material Specification:</span>
                  <p className="text-slate-200 font-semibold mt-0.5">{selectedLayer.materialType}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800/80 font-mono">
                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-emerald-500/30">
                    <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Top Level (RL):</span>
                    <span className="text-emerald-400 font-extrabold text-sm block mt-0.5">
                      {modalTopRL.toFixed(3)} m RL
                    </span>
                  </div>

                  <div className="bg-slate-900/90 p-2.5 rounded-lg border border-amber-500/30">
                    <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Base Level (RL):</span>
                    <span className="text-amber-400 font-extrabold text-sm block mt-0.5">
                      {modalBaseRL.toFixed(3)} m RL
                    </span>
                  </div>
                </div>
              </div>

              {/* Specification Edit Form */}
              <form onSubmit={handleSave} className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-bold text-slate-300">Thickness (mm):</label>
                    <span className="font-mono font-extrabold text-cyan-400 text-sm">{editThickness} mm</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="1000"
                    step="10"
                    value={editThickness}
                    onChange={(e) => setEditThickness(e.target.value)}
                    className="w-full h-2.5 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 block">Level Display Color:</label>
                  <div className="flex items-center space-x-3">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-9 w-12 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-xs text-slate-400 font-mono">Presets:</span>
                    {colorPresets.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColor(c)}
                        className={`h-6 w-6 rounded-full border-2 transition-transform ${
                          editColor === c ? 'scale-110 border-white' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSelectedLayer(null)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-colors"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-cyan-500/20 transition-colors"
                  >
                    {saving ? 'Saving Specification...' : 'Save Specification'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
