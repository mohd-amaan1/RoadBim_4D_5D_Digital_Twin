import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { deriveModelMetrics } from '../utils/dashboardMetrics';
import { toProgressRows } from '../utils/excelImport';
import { resolveProgressToModel, STRATEGY_CONFIDENCE } from '../utils/ifcResolver';
import { api, tokenStore, API_BASE } from '../api/client';
import { useAuth } from './AuthContext';
import { adaptImportedDataset, adaptChainages, restoreOrResolve, buildIfcMetadata } from '../utils/persistence';
import { loadBimModelFile } from '../utils/ifcLoader';
import { resolveBridgeToModel } from '../utils/bridgeImport';
import { isTrackerPackage } from '../modules/bridgeTracker/constants';

const RoadDataContext = createContext();

/** The legacy demo endpoints require a token now that they are project-scoped. */
function authFetch(path) {
  const token = tokenStore.get();
  return fetch(API_BASE + path, {
    headers: {
      'ngrok-skip-browser-warning': 'true',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
  });
}

export function RoadDataProvider({ children }) {
  const { activeProject, activePackage, packages } = useAuth();
  const [activeTab, setActiveTab] = useState('DASHBOARD'); // DASHBOARD | 3D_BIM | GIS_MAP | ANALYTICS | EXCEL_IMPORT
  const [activeLayerFilter, setActiveLayerFilter] = useState('ALL'); // ALL, SUB, GSB, WMM, DBM, BC
  const [selectedKmSection, setSelectedKmSection] = useState(null);
  const [timelineMonth, setTimelineMonth] = useState(14); // Month 1 to 24
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false);
  const [sliceKm, setSliceKm] = useState(null); // Cross-section slice plane KM
  const [customIfcLoaded, setCustomIfcLoaded] = useState(false);
  const [ifcFileName, setIfcFileName] = useState('');
  // Parsed BIM model from an uploaded .ifc/.glb/.gltf: { group, meshCount, size, summary, getElementInfo, dispose }
  const [ifcModel, setIfcModel] = useState(null);
  // Data extracted from that model (project, units, georeference, pavement layers…)
  const [ifcSummary, setIfcSummary] = useState(null);
  // True once an Excel sheet has supplied the progress/cost figures the IFC cannot carry
  const [excelApplied, setExcelApplied] = useState(false);
  // Normalised four-table import: { chainages, layers, progress, metrics, issues, counts, ok }
  const [projectImport, setProjectImport] = useState(null);
  // What is currently loaded from PostgreSQL, and how that went
  const [persistence, setPersistence] = useState({ status: 'idle' });
  // Bindings as stored, so a restored session skips re-resolving
  const [storedBindings, setStoredBindings] = useState([]);
  const [activeIfcModelId, setActiveIfcModelId] = useState(null);
  // A bridge package's register: one row per activity, coloured onto the model by IFC GUID
  // and Approval. Empty for road packages.
  const [bridgeItems, setBridgeItems] = useState([]);
  const resolutionRef = useRef(null);
  const [resolutionTick, setResolutionTick] = useState(0);
  const [matterportModelId, setMatterportModelId] = useState('2s37Wkr2ZCV'); // Working public Matterport 360 space ID
  const [viewEngineMode, setViewEngineMode] = useState('GOOGLE_EARTH'); // GOOGLE_EARTH | STREET_VIEW | CANVAS_360 | MATTERPORT_IFRAME
  const [gisTileLayer, setGisTileLayer] = useState('GOOGLE_HYBRID'); // GOOGLE_HYBRID | GOOGLE_SATELLITE | GOOGLE_TERRAIN | CARTO_DARK

  // 100 KM Progress Dataset State
  const [progressData, setProgressData] = useState([]);

  // Executive EVM Summary State (Fetched dynamically from Backend API / SQL Server)
  const [executiveSummary, setExecutiveSummary] = useState({
    totalKmTarget: 100.0,
    totalKmCompleted: 42.0,
    overallProgressPercent: 60.4,
    spi: 0.96,
    cpi: 1.04,
    totalBudgetPlan: 44200000.0,
    totalBudgetSpent: 40800000.0,
    earnedValue: 42500000.0,
    costVariance: 1700000.0,
    delayedSectionsCount: 8,
    layerBreakdown: [
      { code: 'SUB', name: 'Subgrade Earthwork', thickness: 500, percent: 100, status: 'Completed', color: 'from-emerald-500 to-teal-400' },
      { code: 'GSB', name: 'Granular Sub-Base (GSB)', thickness: 200, percent: 84, status: 'In-Progress', color: 'from-cyan-500 to-blue-500' },
      { code: 'WMM', name: 'Wet Mix Macadam (WMM)', thickness: 250, percent: 62, status: 'In-Progress', color: 'from-blue-500 to-indigo-500' },
      { code: 'DBM', name: 'Dense Bituminous Macadam (DBM)', thickness: 100, percent: 38, status: 'Delayed', color: 'from-amber-500 to-rose-500' },
      { code: 'BC', name: 'Bituminous Concrete (BC Surface)', thickness: 50, percent: 18, status: 'Active', color: 'from-purple-500 to-indigo-600' },
    ]
  });

  // Helper function to generate 100 KM road progress fallback data
  const getFallback100KmProgress = () => {
    const list = [];
    const layerCodes = ['SUB', 'GSB', 'WMM', 'DBM', 'BC'];
    for (let km = 0; km < 100; km++) {
      layerCodes.forEach((code, idx) => {
        let status = 'Completed';
        let pct = 100;
        if (km >= 40) {
          if (idx === 4) { status = 'In-Progress'; pct = 18; }
          else if (idx === 3) { status = 'Delayed'; pct = 38; }
          else if (idx === 2) { status = 'In-Progress'; pct = 62; }
          else if (idx === 1) { status = 'In-Progress'; pct = 84; }
          else { status = 'Completed'; pct = 100; }
        }
        list.push({
          km,
          layerCode: code,
          status,
          progressPercent: pct,
          costVariance: km >= 40 ? 12000 : -2500,
          targetDate: '2026-06-30'
        });
      });
    }
    return list;
  };

  // Fetch initial progress data & executive summary from Backend API
  useEffect(() => {
    // 1. Fetch 100 KM Progress Data
    authFetch('/api/RoadProgress')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.chainages) && data.chainages.length > 0) {
          const formatted = [];
          data.chainages.forEach(ch => {
            if (ch.layerProgresses && ch.layerProgresses.length > 0) {
              ch.layerProgresses.forEach(lp => {
                formatted.push({
                  km: ch.chainageStart,
                  layerCode: lp.layer?.code || 'SUB',
                  status: lp.status,
                  progressPercent: lp.progressPercent,
                  costVariance: lp.costVariance,
                  targetDate: lp.plannedEndDate ? lp.plannedEndDate.split('T')[0] : '2026-06-30'
                });
              });
            }
          });
          if (formatted.length > 0) {
            setProgressData(formatted);
            return;
          }
        }
        setProgressData(getFallback100KmProgress());
      })
      .catch(err => {
        console.log("Using built-in 100 KM parametric dataset.");
        setProgressData(getFallback100KmProgress());
      });

    // 2. Fetch Executive Summary EVM Cost Metrics from Backend Analytics Controller
    authFetch('/api/Analytics/executive-summary')
      .then(res => res.json())
      .then(summaryData => {
        if (summaryData) {
          const pv = summaryData.totalBudgetPlan || 44200000;
          const ac = summaryData.totalBudgetSpent || 40800000;
          const ev = summaryData.earnedValue || (pv * (summaryData.overallProgressPercent / 100)) || 42500000;
          const cv = ev - ac;

          setExecutiveSummary({
            totalKmTarget: summaryData.totalKmTarget || 100.0,
            totalKmCompleted: summaryData.totalKmCompleted || 42.0,
            overallProgressPercent: summaryData.overallProgressPercent || 60.4,
            spi: summaryData.spi || 0.96,
            cpi: summaryData.cpi || 1.04,
            totalBudgetPlan: pv,
            totalBudgetSpent: ac,
            earnedValue: ev,
            costVariance: cv,
            delayedSectionsCount: summaryData.delayedSectionsCount || 8,
            layerBreakdown: summaryData.layerBreakdown || executiveSummary.layerBreakdown
          });
        }
      })
      .catch(err => console.log("Using built-in EVM cost metrics."));
  }, []);

  // Disposal is tracked in a ref rather than inside a state updater: StrictMode
  // double-invokes updaters, which would free the previous model's WASM/GPU handles twice.
  const loadedModelRef = useRef(null);

  // Swap in a newly parsed BIM model, releasing the resources of the previous one
  const applyIfcModel = (model, fileName) => {
    if (loadedModelRef.current && loadedModelRef.current !== model) {
      loadedModelRef.current.dispose();
    }
    loadedModelRef.current = model;
    setIfcModel(model);
    setIfcSummary(model?.summary || null);
    setIfcFileName(fileName);
    setCustomIfcLoaded(true);
    // A new model invalidates progress figures that belonged to the previous one
    setExcelApplied(false);
    setProjectImport(null);
  };

  // Drop the uploaded model and fall back to the procedural 100 KM road corridor
  const clearIfcModel = () => {
    if (loadedModelRef.current) loadedModelRef.current.dispose();
    loadedModelRef.current = null;
    setIfcModel(null);
    setIfcSummary(null);
    setIfcFileName('');
    setCustomIfcLoaded(false);
    setExcelApplied(false);
    setProjectImport(null);
  };

  /**
   * Commits a validated four-table import (phase 1). Nothing is applied while the
   * result carries errors — the uploader surfaces them instead.
   */
  const applyProjectImport = (result, bindings) => {
    if (!result?.ok) return false;
    setProjectImport(result);
    setProgressData(toProgressRows(result));
    if (bindings) setStoredBindings(bindings);
    setExcelApplied(true);
    return true;
  };

  const clearProjectImport = () => {
    setProjectImport(null);
    setStoredBindings([]);
    setExcelApplied(false);
  };

  /**
   * Loads everything persisted for one package: its active IFC model (downloaded and
   * parsed exactly as an upload would be), its chainages, layers, progress rows and
   * stored bindings.
   *
   * The working set is scoped to a single package because the resolver binds progress
   * rows to elements of one model. Feeding it a sibling package's rows would have it
   * matching a chainage against geometry that does not contain it.
   *
   * Only source data crosses the wire. Layer roll-ups, the segment matrix, KPIs,
   * resolved thicknesses and every material colour are recomputed here by the same
   * functions that computed them before, so a restored session cannot drift from a
   * freshly imported one.
   */
  const loadPackage = useCallback(async (pkg) => {
    if (!pkg) {
      setPersistence({ status: 'idle' });
      return;
    }

    setPersistence({ status: 'loading' });
    // Cleared up front: the previous package's register must never tint this package's
    // model while the new rows are still in flight.
    setBridgeItems([]);
    const id = pkg.id;

    try {
      const [chainages, layers, progress, models, bridge] = await Promise.all([
        api.getPackageChainages(id),
        api.getPackageLayers(id),
        api.getPackageProgress(id),
        api.listPackageModels(id),
        // A backend that predates bridges is not a reason to fail the whole package load.
        // A tracker package has retired its one-sheet register: the tracker supersedes it,
        // and its old rows must not tint anything. They stay in the database, unread.
        isTrackerPackage(pkg) ? [] : api.getPackageBridgeItems(id).catch(() => []),
      ]);

      const active = models.find((m) => m.isActive) || null;
      let summaryLayers = [];
      let modelName = null;

      // The viewer needs real geometry, so the stored file is fetched and parsed with the
      // same loader an upload uses. Nothing about the rendered scene is persisted.
      if (active) {
        try {
          const response = await api.getModelFile(active.id);
          const blob = await response.blob();
          const file = new File([blob], active.originalFileName, { type: 'application/octet-stream' });
          const model = await loadBimModelFile(file);
          applyIfcModel(model, active.originalFileName);
          summaryLayers = model.summary?.layers || [];
          modelName = active.originalFileName;
        } catch (err) {
          console.warn('[persistence] Could not reload the stored IFC model:', err);
        }
        setActiveIfcModelId(active.id);
      } else {
        setActiveIfcModelId(null);
      }

      let bindings = [];
      if (active) {
        try {
          bindings = (await api.getBindings(pkg.projectId, active.id)).bindings || [];
        } catch (err) {
          console.warn('[persistence] Could not load bindings:', err);
        }
      }

      if (progress.length) {
        const dataset = adaptImportedDataset({ chainages, layers, progress }, summaryLayers);
        setProjectImport(dataset);
        setProgressData(toProgressRows(dataset));
        setStoredBindings(bindings);
        setExcelApplied(true);
      } else {
        setProjectImport(null);
        setStoredBindings([]);
        setExcelApplied(false);
      }

      setBridgeItems(bridge);

      setPersistence({
        status: 'loaded',
        progressCount: progress.length,
        bridgeItemCount: bridge.length,
        chainageCount: chainages.length,
        layerCount: layers.length,
        bindingCount: bindings.length,
        modelName,
        ifcModelId: active?.id ?? null,
        packageId: pkg.id,
        packageCode: pkg.code,
      });
    } catch (err) {
      setPersistence({ status: 'error', error: err.message });
    }
  }, []);

  const reloadProject = useCallback(() => loadPackage(activePackage), [loadPackage, activePackage]);

  /* ------------------------------------------------------------ every package */

  /**
   * The whole project, package by package, for the plan map.
   *
   * Each package is georeferenced independently — from its own IfcSite coordinate, or by
   * fitting its own imported chainage coordinates. Both put it at a real place on the
   * earth, so packages compose on a map without ever needing a shared local frame. That
   * is what makes this tractable in 2D when it is not in the 3D viewer, whose scene is in
   * model metres and would stack two packages on top of each other.
   *
   * Only `summary` is kept. The parsed Three.js group is released immediately: the map
   * draws footprints from the element index, and holding several models' geometry would
   * cost tens of megabytes for something nothing renders.
   */
  const [packageViews, setPackageViews] = useState([]);
  const [packageViewsStatus, setPackageViewsStatus] = useState('idle');

  useEffect(() => {
    if (!activeProject || !packages?.length) {
      setPackageViews([]);
      setPackageViewsStatus('idle');
      return;
    }

    let cancelled = false;
    setPackageViewsStatus('loading');

    (async () => {
      const views = [];

      // Sequential on purpose: each IFC is a synchronous WASM parse, so running them at
      // once would contend for the same core and stall the UI rather than finish sooner.
      for (const pkg of packages) {
        if (cancelled) return;
        try {
          const [models, chainages, layers, progress, bridge] = await Promise.all([
            api.listPackageModels(pkg.id),
            api.getPackageChainages(pkg.id),
            api.getPackageLayers(pkg.id),
            api.getPackageProgress(pkg.id),
            isTrackerPackage(pkg) ? [] : api.getPackageBridgeItems(pkg.id).catch(() => []),
          ]);
          if (cancelled) return;

          // A package with workbooks but no model yet is still included: its chainage
          // stations belong on the map, which is how you see the package exists and where
          // before any geometry arrives.
          const active = models.find((m) => m.isActive);
          let summary = null;

          if (active) {
            const response = await api.getModelFile(active.id);
            const blob = await response.blob();
            const file = new File([blob], active.originalFileName, { type: 'application/octet-stream' });
            const model = await loadBimModelFile(file);
            if (cancelled) { model.dispose(); return; }

            summary = model.summary;
            model.dispose(); // geometry is not needed; the plan view works off the summary
          }

          let bindings = [];
          if (active) {
            try {
              bindings = (await api.getBindings(pkg.projectId, active.id)).bindings || [];
            } catch { /* an unbound package still draws, just untinted */ }
          }

          const dataset = progress.length
            ? adaptImportedDataset({ chainages, layers, progress }, summary?.layers || [])
            : null;

          views.push({
            packageId: pkg.id,
            code: pkg.code,
            name: pkg.name,
            contractorName: pkg.contractorName,
            summary,
            // Falls back to the raw chainages so a package with stations but no progress
            // rows still puts its markers on the map.
            chainages: dataset?.chainages || adaptChainages(chainages),
            // Resolution needs geometry to bind against; without a model there is nothing
            // to resolve onto and the package simply draws untinted.
            // A bridge's register colours it, exactly as it does in the 3D viewer.
            resolution: summary && bridge.length
              ? resolveBridgeToModel({ items: bridge, summary })
              : dataset && summary
                ? restoreOrResolve({
                  progress: dataset.progress,
                  chainages: dataset.chainages,
                  bindings,
                  summary,
                })
                : null,
          });

          // Publish as each one lands, so the first package draws while the rest parse.
          if (!cancelled) setPackageViews([...views]);
        } catch (err) {
          console.warn(`[plan] Could not prepare package ${pkg.code} for the map:`, err);
        }
      }

      if (!cancelled) setPackageViewsStatus('loaded');
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, packages]);

  /**
   * Either order of arrival has to end up in the same place.
   *
   * IFC first, then workbooks: the import already carries its bindings, because the
   * resolver had a model to work against when the payload was built.
   *
   * Workbooks first, then IFC: the rows were stored with nothing to bind to. The resolver
   * runs as soon as the model loads, but that answer only lives in memory — so it is
   * written back here, and the next reload restores it instead of resolving again.
   *
   * The guard is the signature of what was last pushed. Without it, saving bindings would
   * refresh them, which would recompute the resolution, which would save them again.
   */
  const lastSyncedRef = useRef(null);

  useEffect(() => {
    if (!activeProject || !activePackage || !activeIfcModelId || !resolutionRef.current) return;
    const current = resolutionRef.current;

    // A restored resolution came from storage; there is nothing new to write.
    if (current.restored) return;
    if (!current.byExpressID?.size) return;

    const signature = activePackage.id + ':' + activeIfcModelId + ':' + current.byExpressID.size;
    if (lastSyncedRef.current === signature) return;
    lastSyncedRef.current = signature;

    const payload = [];
    for (const match of current.matches) {
      for (const element of match.elements || []) {
        payload.push({
          layerProgressId: match.row.dbId ?? null,
          chainageId: match.row.chainageId,
          layerCode: match.row.layerCode,
          ifcElementGlobalId: element.globalId,
          sourceRef: match.row.ifcRef ?? null,
          sourceRefKind:
            match.strategy === 'group' ? 'group' : match.strategy === 'guid' ? 'element' : 'none',
          strategy: match.strategy,
          confidence: STRATEGY_CONFIDENCE[match.strategy] ?? null,
          segmentIndex: match.segmentIndex ?? null,
        });
      }
    }
    if (!payload.length) return;

    let cancelled = false;
    (async () => {
      try {
        await api.replaceBindings(activeProject.code, activeIfcModelId, payload);
        const fresh = (await api.getBindings(activeProject.code, activeIfcModelId)).bindings || [];
        if (!cancelled) setStoredBindings(fresh);
      } catch (err) {
        // Not fatal: the resolution still drives this session, it just is not saved yet.
        console.warn('[persistence] Could not save the resolved bindings:', err);
        lastSyncedRef.current = null;
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePackage?.id, activeIfcModelId, resolutionTick]);

  // Switching project OR package replaces every piece of scoped state. Keyed on the
  // package: changing project always changes the package with it, so this covers both.
  useEffect(() => {
    if (!activeProject || !activePackage) {
      clearIfcModel();
      setProjectImport(null);
      setBridgeItems([]);
      setStoredBindings([]);
      setExcelApplied(false);
      setPersistence({ status: 'idle' });
      return;
    }
    loadPackage(activePackage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePackage?.id]);

  // The old single-sheet template path lived here: it read a flat progress sheet, guessed a
  // per-kilometre split of costs stated for a whole stretch, and wrote status straight into
  // memory without ever reaching the database.
  //
  // All three of those are now wrong. Status comes from inspections, costs are stated per
  // chainage in the real workbook so nothing needs spreading, and every row goes through
  // the import service where it can be validated and made idempotent.

  // Phase 2: binds each imported progress row onto the model elements it describes.
  // Null until both halves are present — an import with no model, or a model with no
  // import, simply has nothing to resolve.
  // Phase 2/4: bind each progress row onto the model elements it describes.
  // Stored bindings win — they are the answer the resolver already reached and that was
  // reviewed before being saved. Re-resolving happens only when there are none, or when
  // the stored GlobalIds no longer fit the loaded model; restoreOrResolve covers both.
  const roadResolution = useMemo(
    () => {
      if (!ifcSummary || !projectImport?.progress?.length) return null;
      return restoreOrResolve({
        progress: projectImport.progress,
        chainages: projectImport.chainages,
        bindings: storedBindings,
        summary: ifcSummary,
      });
    },
    [ifcSummary, projectImport, storedBindings]
  );

  // Bridge packages: the register's GUIDs and approvals, bound straight onto the model.
  // It comes back in the road resolver's own shape, so the per-element tint, the plan map
  // and the dashboard take it unchanged — approved paints Completed green, rejected paints
  // Delayed red, and pending leaves the element in its own material.
  const bridgeResolution = useMemo(
    () => (ifcSummary && bridgeItems.length
      ? resolveBridgeToModel({ items: bridgeItems, summary: ifcSummary })
      : null),
    [ifcSummary, bridgeItems]
  );

  // A package holding a register is a bridge, and the register decides its colours.
  const resolution = bridgeResolution ?? roadResolution;

  // The binding-sync effect runs before this is declared, so it reads through a ref, and
  // `resolutionTick` is what re-triggers it. ROAD resolutions only: that effect PUTs
  // bindings keyed on progress rows, and a bridge register has none — syncing one would
  // replace the model's stored bindings with an empty set.
  resolutionRef.current = roadResolution;
  useEffect(() => { setResolutionTick((t) => t + 1); }, [roadResolution]);

  // Everything the dashboard shows: real values from the IFC, nulls (rendered "—")
  // for figures only an Excel upload can supply.

  const dashboard = useMemo(
    () => deriveModelMetrics({ ifcSummary, progressData, excelApplied, resolution }),
    [ifcSummary, progressData, excelApplied, resolution]
  );

  return (
    <RoadDataContext.Provider value={{
      activeTab, setActiveTab,
      activeLayerFilter, setActiveLayerFilter,
      selectedKmSection, setSelectedKmSection,
      timelineMonth, setTimelineMonth,
      isTimelinePlaying, setIsTimelinePlaying,
      isAiAssistantOpen, setIsAiAssistantOpen,
      sliceKm, setSliceKm,
      customIfcLoaded, setCustomIfcLoaded,
      ifcFileName, setIfcFileName,
      ifcModel, applyIfcModel, clearIfcModel,
      ifcSummary, excelApplied, dashboard,
      matterportModelId, setMatterportModelId,
      viewEngineMode, setViewEngineMode,
      gisTileLayer, setGisTileLayer,
      progressData,
      projectImport, applyProjectImport, clearProjectImport, resolution,
      persistence, reloadProject, activeIfcModelId, storedBindings, activeProject, activePackage,
      packageViews, packageViewsStatus, bridgeItems, bridgeResolution,
      executiveSummary, setExecutiveSummary
    }}>
      {children}
    </RoadDataContext.Provider>
  );
}

export function useRoadData() {
  return useContext(RoadDataContext);
}
