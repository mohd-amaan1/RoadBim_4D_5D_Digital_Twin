import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers, Satellite, Map as MapIcon, Mountain, Split, Compass,
  AlertTriangle, Crosshair, Info,
} from 'lucide-react';
import { useRoadData } from '../../context/RoadDataContext';
import { statusColor, STATUS_COLORS, UNBOUND_COLOR } from '../../utils/roadTextures';
import {
  buildGeoTransform, elementFootprint, centrelineLatLngs, explodeOffsets,
} from '../../utils/georeference';
import { APPROVAL_LABEL } from '../../utils/bridgeImport';

/**
 * Plan-view counterpart to the 3D cross-section.
 *
 * Every modelled element is drawn as its own footprint, coloured by the status of the
 * progress row bound to it — so the map and the viewer are showing the same data through
 * the same palette, and a segment that reads delayed in one reads delayed in the other.
 *
 * Two things are deliberately visible rather than smoothed over:
 *
 *   * **Which georeference is being used.** The IfcSite coordinate and the chainage
 *     coordinates put this road in different places; the source can be switched and the
 *     gap is stated in metres.
 *   * **How each element was bound.** A footprint matched by position is outlined
 *     differently from one matched by GlobalId.
 */

/**
 * Tiles are spread over mt0-mt3. A browser opens about six connections per host, so a
 * single hostname both serialises the fetches and draws rate-limiting — which showed up
 * as a batch of failed tiles and grey gaps that never filled in.
 */
const SUBDOMAINS = ['0', '1', '2', '3'];

const TILES = {
  HYBRID: { label: 'Satellite + roads', icon: Satellite, url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', maxZoom: 21, attribution: '&copy; Google' },
  SATELLITE: { label: 'Satellite', icon: MapIcon, url: 'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 21, attribution: '&copy; Google' },
  TERRAIN: { label: 'Terrain', icon: Mountain, url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', maxZoom: 20, attribution: '&copy; Google' },
};

/** A weaker match gets a dashed, thinner outline so it never passes for an exact one. */
const STROKE_BY_STRATEGY = {
  guid: { weight: 1.6, dashArray: null },
  group: { weight: 1.6, dashArray: null },
  position: { weight: 2, dashArray: '5,4' },
  name: { weight: 2, dashArray: '2,4' },
};

const fmt = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);
const money = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

export default function LayerPlanMap() {
  const {
    ifcSummary, projectImport, resolution, dashboard,
    packageViews, packageViewsStatus, activePackage,
  } = useRoadData();

  // A callback ref rather than useRef: the panel renders an empty state until a model and
  // a transform exist, so the map node appears *after* mount. A [] effect reading a ref
  // would find null and never create the map at all.
  const [container, setContainer] = useState(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const overlayRef = useRef(null);
  // Holds the number of packages the view was last fitted to, so a package that
  // finishes parsing later re-arms the fit instead of being left off-screen.
  const fittedRef = useRef(-1);

  const [tileKey, setTileKey] = useState('HYBRID');
  const [activeLayers, setActiveLayers] = useState(null); // null = all
  const [exploded, setExploded] = useState(false);
  const [geoSource, setGeoSource] = useState('auto');
  const [failed, setFailed] = useState(false);
  // Flipped once the map and its overlay group exist. The draw effect needs it: the map is
  // now built when its container appears, which is *after* the data effects have already
  // run — without this they never fire again and the overlay stays empty.
  const [mapReady, setMapReady] = useState(false);

  /**
   * Every package in the project, each carrying its own georeference.
   *
   * A package is placed by its own IfcSite coordinate, or by fitting its own imported
   * chainage coordinates — both absolute positions on the earth. So packages land where
   * the survey says they are and cannot stack on one another, which is exactly why the
   * whole project can be drawn on one map here but not in the 3D viewer, whose scene is
   * in model metres.
   *
   * Falls back to the active package alone while the siblings are still parsing, so the
   * map draws something immediately instead of staying blank.
   */
  const views = useMemo(() => {
    if (packageViews?.length) return packageViews;
    if (!ifcSummary) return [];
    return [{
      packageId: activePackage?.id ?? null,
      code: activePackage?.code || '—',
      name: activePackage?.name || '',
      summary: ifcSummary,
      chainages: projectImport?.chainages || [],
      resolution,
    }];
  }, [packageViews, ifcSummary, projectImport, resolution, activePackage]);

  /**
   * With several packages, the chainage fit is the placement that can tell them apart.
   *
   * IfcSite belongs to the FILE, not the package — two packages cut from the same design
   * model carry the identical site coordinate, so preferring it would stack them on one
   * spot however different their workbooks are. The imported chainage coordinates are the
   * per-package signal, which is exactly why they separate correctly.
   *
   * A single package keeps the old preference: IfcSite is exact when it is the only road
   * on the map, and there is nothing to disambiguate.
   */
  const autoPrefer = views.length > 1 ? 'chainage-fit' : 'auto';
  const effectivePrefer = geoSource === 'auto' ? autoPrefer : geoSource;

  const placed = useMemo(
    () => views
      .map((v) => ({
        ...v,
        transform: v.summary
          ? buildGeoTransform({
            summary: v.summary,
            chainages: v.chainages || [],
            resolution: v.resolution,
            prefer: effectivePrefer,
          })
          : null,
      }))
      .filter((v) => v.transform && v.summary?.alignment),
    [views, effectivePrefer]
  );

  /**
   * Packages that have chainage coordinates but nothing to draw yet — imported workbooks,
   * no model uploaded. Their stations still belong on the map: it is how you see that a
   * package exists and where, before its geometry arrives.
   */
  const markerOnly = useMemo(
    () => views.filter(
      (v) => !v.summary?.alignment && (v.chainages || []).some((c) => c.latitude != null && c.longitude != null),
    ),
    [views],
  );

  /**
   * Two packages landing on the same spot is almost always a shared IfcSite with no
   * chainage fit available to separate them. Saying so beats drawing them on top of each
   * other and letting it look like one road.
   */
  const collisions = useMemo(() => {
    const seen = [];
    const hits = [];
    for (const v of placed) {
      const a = v.summary.alignment;
      const [lat, lng] = v.transform.toLeaflet({ x: a.minM, z: a.crossCentreM });
      for (const s of seen) {
        // ~1e-4 degrees is roughly 11 m — closer than two packages ever legitimately start.
        if (Math.abs(s.lat - lat) < 1e-4 && Math.abs(s.lng - lng) < 1e-4) hits.push([s.code, v.code]);
      }
      seen.push({ lat, lng, code: v.code });
    }
    return hits;
  }, [placed]);

  // The first placed package drives the header readout and the recentre button.
  const primary = placed[0] || null;
  const transform = primary?.transform || null;
  const alignment = primary?.summary?.alignment || null;
  const elementTotal = views.reduce((n, v) => n + (v.summary?.elementIndex?.length || 0), 0);
  const boundTotal = views.reduce((n, v) => n + (v.resolution?.report?.coverage?.covered || 0), 0);

  // Layer pills span every package: SUB in one is SUB in the other, and a filter that only
  // knew the active package would silently leave its siblings drawn.
  const layerCodes = useMemo(() => {
    const order = new Map();
    const codes = new Set();
    for (const v of views) {
      (v.summary?.layers || []).forEach((l, i) => {
        if (!order.has(l.code)) order.set(l.code, i);
      });
      for (const e of v.summary?.elementIndex || []) {
        if (e.layerCode) codes.add(e.layerCode);
      }
    }
    return [...codes].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [views]);

  const offsets = useMemo(
    () => (exploded ? explodeOffsets(layerCodes, alignment?.crossWidthM || 8) : {}),
    [exploded, layerCodes, alignment]
  );

  const thicknessByCode = useMemo(() => {
    const map = {};
    for (const l of dashboard?.layers || []) map[l.code] = l;
    return map;
  }, [dashboard]);

  // --- create the map when its container exists ---
  useEffect(() => {
    const L = window.L;
    if (!L) { setFailed(true); return; }
    if (!container || mapRef.current) return;

    // Open directly on the road. Starting at a country-wide view and then fitting to the
    // model made Leaflet fetch tiles for every zoom level in between — around fourteen
    // pyramids of tiles to show a sixty-metre road, which is what made this slow.
    const centre = initialCentre(transform, alignment);

    const map = L.map(container, {
      scrollWheelZoom: true,
      attributionControl: true,
      center: centre.latlng,
      zoom: centre.zoom,
      // Footprints render into one canvas instead of one SVG node each, which matters for
      // a model with thousands of elements.
      preferCanvas: true,
    });
    mapRef.current = map;

    tileRef.current = makeTileLayer(L, TILES.HYBRID).addTo(map);
    tileRef.current._roadbimKey = "HYBRID";
    overlayRef.current = L.layerGroup().addTo(map);
    setMapReady(true);

    // Leaflet measures its container once, at creation. This panel is inside a flex column
    // that has not settled at that moment — and the tab it lives in animates in — so the
    // measurement is short and only that rectangle ever gets tiles. Re-measuring on every
    // container resize is what stops the map rendering cropped.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);

    // One more pass after the first paint, for the case where the panel is laid out in the
    // same frame the map is created.
    const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      overlayRef.current = null;
      fittedRef.current = -1;
      setMapReady(false);
    };
  }, [container]);

  // --- basemap ---
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    // The map is created with HYBRID already attached; tearing it down and re-adding the
    // identical layer on mount would throw away tiles that are already loading.
    if (tileRef.current?._roadbimKey === tileKey) return;

    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = makeTileLayer(L, TILES[tileKey]).addTo(map);
    tileRef.current._roadbimKey = tileKey;
  }, [tileKey, container]);

  // --- redraw the overlay whenever anything it depends on changes ---
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    const group = overlayRef.current;
    if (!L || !map || !group || (!placed.length && !markerOnly.length)) return;

    group.clearLayers();
    const bounds = [];

    // Packages with stations but no geometry yet. Hollow markers, so they never read as
    // built work — they say "this package is here", nothing more.
    for (const view of markerOnly) {
      for (const c of view.chainages || []) {
        if (c.latitude == null || c.longitude == null) continue;
        L.circleMarker([c.latitude, c.longitude], {
          radius: 4, color: '#64748B', weight: 2, fillColor: '#0B0F17', fillOpacity: 0.6, dashArray: '2,2',
        })
          .bindTooltip(
            esc(`${view.code} · ${c.kmLabel || `Chainage ${c.id}`} — no model uploaded`),
            { direction: 'top', offset: [0, -6] },
          )
          .addTo(group);
        bounds.push([c.latitude, c.longitude]);
      }
    }

    // One pass per package. Each uses its own transform, so two packages hundreds of
    // kilometres apart both land correctly without any shared frame.
    for (const view of placed) {
      const vAlignment = view.summary.alignment;
      const vElements = view.summary.elementIndex || [];

      // centreline
      const spine = centrelineLatLngs(vAlignment, view.transform, vAlignment.crossCentreM);
      if (spine.length) {
        L.polyline(spine, { color: '#38BDF8', weight: 1.5, opacity: 0.8, dashArray: '8,6' })
          .bindTooltip(esc(`${view.code} · ${view.name}`), { sticky: true })
          .addTo(group);
        bounds.push(...spine);
      }

      // one polygon per element
      for (const element of vElements) {
        if (activeLayers && !activeLayers.has(element.layerCode)) continue;

        const ring = elementFootprint(element, view.transform, offsets[element.layerCode] || 0);
        if (!ring) continue;

        const match = view.resolution?.byExpressID?.get(element.expressID) || null;
        const row = match?.row || null;
        const status = row?.status || null;
        const stroke = STROKE_BY_STRATEGY[match?.strategy] || { weight: 1, dashArray: '1,3' };
        const colour = statusColor(status);

        const polygon = L.polygon(ring, {
          color: colour,
          weight: stroke.weight,
          dashArray: stroke.dashArray,
          opacity: 0.95,
          fillColor: colour,
          fillOpacity: status ? 0.42 : 0.16,
        }).addTo(group);

        const layer = thicknessByCode[element.layerCode];
        polygon.bindPopup(
          popupHtml({ element, row, match, layer, packageCode: view.code, packageName: view.name }),
          { maxWidth: 320 },
        );
        bounds.push(...ring);
      }

      // chainage markers
      for (const c of view.chainages || []) {
        if (c.latitude == null || c.longitude == null) continue;
        L.circleMarker([c.latitude, c.longitude], {
          radius: 5, color: '#0B0F17', weight: 2, fillColor: '#38BDF8', fillOpacity: 1,
        })
          .bindTooltip(
            esc(`${view.code} · ${c.kmLabel || `Chainage ${c.id}`}`),
            { direction: 'top', offset: [0, -6] },
          )
          .addTo(group);
        bounds.push([c.latitude, c.longitude]);
      }
    }

    // Fit once per set of packages. Re-fitting on every toggle would yank the view out
    // from under the user mid-inspection, but a package that finishes parsing after the
    // first fit must still be brought into view — so the count is what re-arms it.
    if (bounds.length && fittedRef.current !== placed.length + markerOnly.length) {
      // Fitting against a stale container size is what produced the cropped view
      map.invalidateSize({ animate: false });
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 19, animate: false });
      fittedRef.current = placed.length + markerOnly.length;
    }
  }, [mapReady, placed, markerOnly, activeLayers, offsets, thicknessByCode]);

  /** Frames every package, not just the one under the cursor. */
  const recentre = () => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map || !placed.length) return;

    const corners = [];
    for (const v of placed) {
      const a = v.summary.alignment;
      corners.push(v.transform.toLeaflet({ x: a.minM, z: a.crossMinM }));
      corners.push(v.transform.toLeaflet({ x: a.maxM, z: a.crossMaxM }));
    }
    map.invalidateSize({ animate: false });
    map.fitBounds(L.latLngBounds(corners), { padding: [40, 40], maxZoom: 19, animate: false });
  };

  const toggleLayer = (code) => {
    setActiveLayers((current) => {
      const next = new Set(current ?? layerCodes);
      if (next.has(code)) next.delete(code); else next.add(code);
      if (next.size === 0 || next.size === layerCodes.length) return null;
      return next;
    });
  };

  const isOn = (code) => !activeLayers || activeLayers.has(code);

  // ------------------------------------------------------------------ empty states

  if (!views.length) {
    return (
      <Panel>
        <Empty
          title="No model loaded"
          body="Upload an IFC model to a package, and its layers will appear here in plan view alongside the 3D cross-section."
        />
      </Panel>
    );
  }

  if (!placed.length && !markerOnly.length) {
    return (
      <Panel>
        <Empty
          title="This model cannot be placed on a map"
          body="It carries no IfcSite coordinate, and no chainage coordinates have been imported to fit it against. Either would be enough."
        />
      </Panel>
    );
  }

  return (
    <Panel>
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white font-[Outfit]">Layer Plan View</h3>
            <span className="text-xs text-slate-400">
              {placed.length > 1 && (
                <span className="text-cyan-300 font-semibold">{placed.length} packages · </span>
              )}
              {elementTotal} element{elementTotal === 1 ? '' : 's'} across {layerCodes.length} layers
              {boundTotal > 0 && ` · ${boundTotal} bound`}
              {/* Siblings parse one at a time, so say so rather than let the map look done. */}
              {packageViewsStatus === 'loading' && (
                <span className="text-slate-500"> · loading packages…</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(TILES).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <button
                key={key}
                onClick={() => setTileKey(key)}
                title={cfg.label}
                className={`p-1.5 rounded-lg border transition-all ${
                  tileKey === key
                    ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-cyan-400'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
          <button
            onClick={recentre}
            title="Recentre on the model"
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-cyan-400 transition-all"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex flex-wrap items-center gap-2 py-2.5">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Layers</span>
        {layerCodes.map((code) => {
          const layer = thicknessByCode[code];
          return (
            <button
              key={code}
              onClick={() => toggleLayer(code)}
              title={layer ? `${layer.name} · ${layer.thicknessMm} mm` : code}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold transition-all ${
                isOn(code)
                  ? 'bg-slate-800 border-cyan-500/40 text-cyan-300'
                  : 'bg-slate-900/60 border-slate-800 text-slate-600'
              }`}
            >
              {code}
            </button>
          );
        })}
        {activeLayers && (
          <button
            onClick={() => setActiveLayers(null)}
            className="text-[11px] font-bold text-slate-400 hover:text-cyan-400"
          >
            show all
          </button>
        )}

        <span className="w-px h-4 bg-slate-800 mx-1" />

        <button
          onClick={() => setExploded((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all ${
            exploded
              ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-violet-300'
          }`}
          title="Fan the layers apart so the whole stack is visible at once"
        >
          <Split className="h-3.5 w-3.5" /> Exploded
        </button>

        <span className="w-px h-4 bg-slate-800 mx-1" />

        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">Placed by</span>
        <select
          value={geoSource}
          onChange={(e) => setGeoSource(e.target.value)}
          className="bg-slate-900 border border-slate-700 focus:border-cyan-500 text-slate-200 text-[11px] font-mono rounded-lg px-2 py-1 focus:outline-none cursor-pointer"
        >
          {/* With more than one package, Auto means the chainage fit — it is the only
              input that differs per package when they share a design file. */}
          <option value="auto">Auto ({transform?.source || 'none'})</option>
          <option value="ifc-site" disabled={!transform?.available?.ifcSite}>IfcSite coordinate</option>
          <option value="chainage-fit" disabled={!transform?.available?.chainageFit}>Chainage survey fit</option>
        </select>
      </div>

      {/* ---- map ---- */}
      <div className="relative flex-1 rounded-xl overflow-hidden border border-[var(--line)]"
           style={{ minHeight: 'clamp(26rem, 58vh, 48rem)' }}>
        <div ref={setContainer} className="absolute inset-0" />
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 text-xs text-slate-400 p-6 text-center">
            Leaflet could not be loaded, so the plan view is unavailable.
          </div>
        )}
      </div>

      {/* ---- legend + provenance ---- */}
      <div className="pt-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
          {Object.entries(STATUS_COLORS).map(([status, colour]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colour }} />
              {status}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: UNBOUND_COLOR }} />
            no progress row
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" />
            matched by position
          </span>
        </div>

        {/* Packages that are on the map only as stations, because no model is uploaded yet. */}
        {markerOnly.length > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {markerOnly.map((v) => v.code).join(', ')} {markerOnly.length === 1 ? 'has' : 'have'} imported
              chainages but no IFC model, so only the stations are drawn. Upload a model to that package
              and its layers appear here.
            </span>
          </p>
        )}

        {/* Two packages on one spot is a real data problem, not a rendering one. */}
        {collisions.length > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              {collisions.map(([a, b]) => `${a} and ${b}`).join('; ')} are drawn at the same place.
              They share an IfcSite coordinate and no chainage fit could separate them — import chainage
              coordinates for each package, or switch the placement source above.
            </span>
          </p>
        )}

        {transform && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-500">
          <span className="flex items-center gap-1.5">
            <Compass className="h-3 w-3 text-cyan-400" />
            {transform.source === 'ifc-site' ? 'IfcSite anchor' : `survey fit · ${transform.controlCount} control points`}
          </span>
          <span>bearing {transform.rotationDeg.toFixed(1)}°</span>
          <span>scale {transform.scale.toFixed(3)}</span>
          {transform.residualM !== null && <span>rms {transform.residualM.toFixed(1)} m</span>}
          {placed.length > 1 && <span className="text-cyan-400">· {placed.length} packages placed</span>}
        </div>
        )}

        {(transform?.notes || []).map((note, i) => (
          <p
            key={i}
            className={`flex items-start gap-1.5 text-[11px] ${
              note.includes('disagree') || note.includes('apart') || note.includes('stretch')
                ? 'text-amber-300'
                : 'text-slate-500'
            }`}
          >
            {note.includes('disagree') || note.includes('apart') || note.includes('stretch')
              ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              : <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
            <span>{note}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

/**
 * `updateWhenIdle: false` keeps tiles arriving while the map is being dragged, and the
 * larger buffer pre-loads a ring beyond the viewport so panning does not expose grey.
 */
function makeTileLayer(L, cfg) {
  return L.tileLayer(cfg.url, {
    maxZoom: cfg.maxZoom,
    attribution: cfg.attribution,
    subdomains: SUBDOMAINS,
    updateWhenIdle: false,
    keepBuffer: 3,
    // A tile that still fails leaves the previous zoom level showing rather than a hole
    errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  });
}

/**
 * Where to open the map, so no tiles are fetched for a view nobody asked for.
 *
 * Web Mercator resolves to 156543.03 * cos(lat) / 2^z metres per pixel, so the zoom that
 * fits a road of `length` metres into `width` pixels is
 *
 *     z = log2( 156543.03 * cos(lat) * width / (length * padding) )
 *
 * Getting this wrong is not cosmetic: an earlier version opened a 60 m road at zoom 12,
 * and the eight zoom levels of tiles it requested on the way to the real view were all
 * cancelled mid-flight the moment fitBounds ran.
 */
function initialCentre(transform, alignment) {
  if (!transform || !alignment) return { latlng: [20.5937, 78.9629], zoom: 5 };

  const latlng = transform.toLeaflet({
    x: (alignment.minM + alignment.maxM) / 2,
    z: alignment.crossCentreM ?? 0,
  });

  const lengthM = Math.max(alignment.lengthM || 0, 1);
  const cosLat = Math.cos((latlng[0] * Math.PI) / 180);
  const PADDING = 1.4;   // leave a margin, matching what fitBounds does
  const WIDTH_PX = 900;  // a typical panel width; the fit that follows corrects the rest

  const zoom = Math.log2((156543.03 * cosLat * WIDTH_PX) / (lengthM * PADDING));

  return { latlng, zoom: Math.max(3, Math.min(19, Math.round(zoom))) };
}

function Panel({ children }) {
  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl flex flex-col min-h-[34rem]">
      {children}
    </div>
  );
}

function Empty({ title, body }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-2">
      <Layers className="h-8 w-8 text-slate-700" />
      <h3 className="text-sm font-extrabold text-slate-300 font-[Outfit]">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm">{body}</p>
    </div>
  );
}

/**
 * Popup markup. Leaflet takes an HTML string, so every interpolated value is escaped —
 * element names and layer names come from the uploaded file, not from us.
 */
function popupHtml({ element, row, match, layer, packageCode, packageName }) {
  const status = row?.status || null;
  const colour = statusColor(status);
  // A bridge row speaks in verdicts, not construction states — "Rejected", not "Delayed".
  const badge = row?.bridge
    ? APPROVAL_LABEL[row.approval] || 'Pending'
    : status || 'no progress row';

  const line = (label, value) =>
    `<div style="display:flex;justify-content:space-between;gap:1rem">
       <span style="color:#64748b">${esc(label)}</span>
       <span style="color:#e2e8f0;font-weight:600">${esc(value)}</span>
     </div>`;

  return `
    <div style="font-family:ui-sans-serif,system-ui;font-size:12px;line-height:1.5;min-width:15rem">
      <div style="font-weight:800;color:#f1f5f9;margin-bottom:.15rem">${esc(element.name || `Element ${element.expressID}`)}</div>
      <div style="font-family:ui-monospace,monospace;font-size:10px;color:#64748b;margin-bottom:.5rem">
        ${esc(element.globalId || '')}
      </div>

      <div style="display:inline-block;padding:.1rem .5rem;border-radius:.35rem;margin-bottom:.5rem;
                  background:${colour}33;color:${colour};font-weight:700;font-size:11px">
        ${esc(badge)}${!row?.bridge && row?.progressPercent !== null && row?.progressPercent !== undefined ? ` · ${esc(row.progressPercent)}%` : ''}
      </div>

      <div style="display:grid;gap:.15rem">
        ${packageCode ? line('Package', `${packageCode}${packageName ? ` · ${packageName}` : ''}`) : ''}
        ${line('Layer', `${element.layerCode || '—'} · ${element.layerName || '—'}`)}
        ${row && !row.bridge ? line('Chainage', row.chainageId) : ''}
        ${row?.bridge ? bridgeLines(row, line) : ''}
        ${match?.segmentIndex !== null && match?.segmentIndex !== undefined ? line('Segment', match.segmentIndex) : ''}
        ${layer ? line('Thickness', `${fmt(layer.thicknessMm, ' mm')} (${layer.thicknessSource || 'ifc'})`) : ''}
        ${row && !row.bridge ? line('Budget', money(row.budgetCost)) : ''}
        ${row && !row.bridge ? line('Actual', money(row.actualCost)) : ''}
        ${row?.delayDays ? line('Delay', `${row.delayDays} d`) : ''}
        ${row?.plannedEndDate ? line('Planned end', row.plannedEndDate) : ''}
        ${match ? line('Matched by', match.strategy) : ''}
      </div>
    </div>`;
}

/**
 * The register row behind a bridge element: what was built, and the RFIs that decided it.
 * Goes through the same escaping `line()` as everything else — every value here came
 * from an uploaded spreadsheet.
 */
function bridgeLines(row, line) {
  const refs = (row.rfiRefs || '').split('\n').filter(Boolean);
  return [
    row.itemNo ? line('Item', row.itemNo) : '',
    row.remarks ? line('Activity', row.remarks) : '',
    row.description ? line('Work', row.description) : '',
    refs.length ? line('RFI', refs.length > 1 ? `${refs[0]} +${refs.length - 1}` : refs[0]) : '',
    row.billNo ? line('Bill', row.billNo) : '',
    line('Approval', row.approvalText || APPROVAL_LABEL[row.approval] || 'Pending'),
  ].join('');
}
