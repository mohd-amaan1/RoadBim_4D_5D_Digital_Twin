import React, { useEffect, useRef, useState } from 'react';
import { Satellite, Map as MapIcon, Mountain, Crosshair, Compass, Ruler } from 'lucide-react';

/**
 * Satellite map of the uploaded IFC corridor.
 *
 * The Google Maps *embed* used elsewhere can only drop a single pin, so the road
 * outline is drawn with Leaflet instead: a filled ribbon following the modelled
 * plan geometry, a dashed centreline, and chainage markers along it.
 */

const TILES = {
  HYBRID: { label: 'Satellite + Roads', icon: Satellite, url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', maxZoom: 21, attribution: '&copy; Google' },
  SATELLITE: { label: 'Satellite', icon: MapIcon, url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 21, attribution: '&copy; Google' },
  TERRAIN: { label: 'Terrain', icon: Mountain, url: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', maxZoom: 20, attribution: '&copy; Google' },
};

function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-leaflet]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.L));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.dataset.leaflet = 'true';
    script.onload = () => resolve(window.L);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function IfcRoadMap({ roadPath, fileName, onFlyToBim }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileRef = useRef(null);
  const overlayRef = useRef(null);

  const [tileKey, setTileKey] = useState('HYBRID');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // --- create the map once ---
  useEffect(() => {
    let cancelled = false;

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: true,
        });
        mapRef.current = map;

        const cfg = TILES.HYBRID;
        tileRef.current = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution }).addTo(map);

        map.setView([roadPath.anchor.lat, roadPath.anchor.lng], 18);
        setReady(true);
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      tileRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // --- basemap switching ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const cfg = TILES[tileKey] || TILES.HYBRID;
    tileRef.current = window.L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom, attribution: cfg.attribution }).addTo(map);
    tileRef.current.bringToBack();
  }, [tileKey, ready]);

  // --- draw the corridor ---
  useEffect(() => {
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L || !ready || !roadPath) return;

    if (overlayRef.current) map.removeLayer(overlayRef.current);
    const group = L.layerGroup().addTo(map);
    overlayRef.current = group;

    // Road ribbon: a soft outer glow so it stays legible over dark satellite imagery
    L.polygon(roadPath.outline, {
      color: '#0EA5E9', weight: 9, opacity: 0.25, fill: false, lineJoin: 'round',
    }).addTo(group);

    const ribbon = L.polygon(roadPath.outline, {
      color: '#38BDF8', weight: 2, opacity: 0.95,
      fillColor: '#38BDF8', fillOpacity: 0.22, lineJoin: 'round',
    }).addTo(group);

    // Centreline
    L.polyline(roadPath.centreline, { color: '#0B1220', weight: 5, opacity: 0.5 }).addTo(group);
    L.polyline(roadPath.centreline, {
      color: '#E8F7FF', weight: 2, opacity: 0.95, dashArray: '10 9', lineCap: 'round',
    }).addTo(group);

    // Chainage markers
    roadPath.stations.forEach((station, index) => {
      const isEnd = index === 0 || index === roadPath.stations.length - 1;
      L.circleMarker([station.lat, station.lng], {
        radius: isEnd ? 7 : 5,
        color: '#FFFFFF',
        weight: 2,
        fillColor: isEnd ? '#22D3EE' : '#0EA5E9',
        fillOpacity: 1,
      })
        .addTo(group)
        .bindTooltip(station.label, {
          permanent: isEnd,
          direction: 'top',
          offset: [0, -6],
          className: 'ifc-map-chip',
        });
    });

    // Site reference point from IfcSite
    L.circleMarker([roadPath.anchor.lat, roadPath.anchor.lng], {
      radius: 5, color: '#FDE68A', weight: 2, fillColor: '#F59E0B', fillOpacity: 0.9,
    })
      .addTo(group)
      .bindTooltip('IfcSite reference point', { direction: 'bottom', offset: [0, 6], className: 'ifc-map-chip' });

    map.fitBounds(ribbon.getBounds(), { padding: [70, 70], maxZoom: 20 });
  }, [roadPath, ready]);

  // The panel lives in a tab and resizes with the layout — Leaflet needs telling
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ready]);

  const earthUrl = `https://earth.google.com/web/@${roadPath.anchor.lat},${roadPath.anchor.lng},0a,600d,35y,0h,45t,0r`;

  return (
    <div className="relative w-full h-full bg-slate-950">
      <div ref={containerRef} className="w-full h-full z-10" />

      {failed && (
        <div className="absolute inset-0 z-20 flex items-center justify-center text-xs text-slate-400">
          Map tiles could not be loaded (offline?)
        </div>
      )}

      {/* Basemap switcher */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1 bg-slate-950/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-800 shadow-2xl">
        {Object.entries(TILES).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setTileKey(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                tileKey === key ? 'bg-cyan-500 text-slate-950 shadow font-extrabold' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title={cfg.label}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{cfg.label}</span>
            </button>
          );
        })}
      </div>

      {/* Corridor readout */}
      <div className="absolute top-4 left-4 z-20 bg-slate-950/92 backdrop-blur-md rounded-2xl border border-cyan-500/40 shadow-2xl overflow-hidden max-w-sm">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="text-xs font-extrabold text-white font-[Outfit] truncate" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Ruler className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span>{roadPath.lengthM >= 1000 ? `${(roadPath.lengthM / 1000).toFixed(2)} km` : `${roadPath.lengthM} m`} long</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <Ruler className="h-3.5 w-3.5 text-cyan-400 shrink-0 rotate-90" />
            <span>{roadPath.widthM} m wide</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <Compass className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span>True N {roadPath.trueNorthDeg}&deg;</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-300">
            <Crosshair className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span>{roadPath.sampleCount} samples</span>
          </div>
          <div className="col-span-2 text-slate-400 truncate">
            {roadPath.anchor.lat.toFixed(6)}, {roadPath.anchor.lng.toFixed(6)}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-slate-300 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800">
          Corridor plan extracted from the IFC, anchored at the <span className="text-amber-300 font-bold">IfcSite</span> reference point
        </p>
        <div className="flex items-center gap-2">
          <a
            href={earthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded-xl bg-slate-900/95 hover:bg-slate-800 text-cyan-400 border border-cyan-500/40 text-xs font-bold transition-all shadow-lg"
          >
            Open in Google Earth
          </a>
          {onFlyToBim && (
            <button
              onClick={onFlyToBim}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-extrabold transition-all shadow-lg"
            >
              Fly to BIM Twin &#10132;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
