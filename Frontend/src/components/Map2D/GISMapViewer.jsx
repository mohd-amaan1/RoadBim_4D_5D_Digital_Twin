import React, { useEffect, useRef, useState } from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { Navigation, Layers, Compass, CheckCircle2, Clock, AlertTriangle, Download, ExternalLink, X, Box, Camera, Sparkles, Globe, Map as MapIcon, Mountain, Eye } from 'lucide-react';

export default function GISMapViewer() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);

  const { setSelectedKmSection, setActiveTab, progressData, setViewEngineMode, gisTileLayer, setGisTileLayer } = useRoadData();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [show3DGlobeModal, setShow3DGlobeModal] = useState(false);
  
  // Selected GIS Station Data State for Deep Data Inspection Drawer
  const [selectedStationData, setSelectedStationData] = useState(null);

  // Map Tile Configurations including Google Earth & CartoDB
  const tileConfigs = {
    GOOGLE_HYBRID: {
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      maxZoom: 20,
      attribution: '&copy; Google Earth Hybrid Satellite'
    },
    GOOGLE_SATELLITE: {
      url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      maxZoom: 20,
      attribution: '&copy; Google Earth HD Imagery'
    },
    GOOGLE_TERRAIN: {
      url: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
      maxZoom: 20,
      attribution: '&copy; Google Earth Terrain & Topography'
    },
    CARTO_DARK: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }
  };

  // Helper to switch Leaflet tile layer dynamically
  const changeTileLayer = (layerKey) => {
    if (!mapInstanceRef.current || !window.L) return;
    const map = mapInstanceRef.current;
    const L = window.L;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const config = tileConfigs[layerKey] || tileConfigs.GOOGLE_HYBRID;
    const newLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
      subdomains: config.subdomains || 'abc'
    }).addTo(map);

    tileLayerRef.current = newLayer;
    if (setGisTileLayer) setGisTileLayer(layerKey);
  };

  useEffect(() => {
    let isMounted = true;

    const initMap = () => {
      if (!mapContainerRef.current) return;
      if (mapInstanceRef.current) return;

      if (window.L) {
        const L = window.L;

        // Create Leaflet Map centered around 100 KM alignment
        const map = L.map(mapContainerRef.current, {
          center: [28.6139, 77.2090],
          zoom: 11,
          zoomControl: true
        });
        mapInstanceRef.current = map;

        // Initial Google Earth Hybrid Satellite Tile Layer
        const initialKey = gisTileLayer && tileConfigs[gisTileLayer] ? gisTileLayer : 'GOOGLE_HYBRID';
        const config = tileConfigs[initialKey];
        const initialLayer = L.tileLayer(config.url, {
          attribution: config.attribution,
          maxZoom: config.maxZoom,
          subdomains: config.subdomains || 'abc'
        }).addTo(map);
        tileLayerRef.current = initialLayer;

        // Helper for curved highway route coordinates
        const getCurvedHighwayPoint = (km) => {
          const baseLat = 28.5355;
          const baseLng = 77.3910;
          
          // Realistic smooth S-curve highway corridor bends
          const latBend = Math.sin(km * 0.055) * 0.035 + (km * 0.0068);
          const lngBend = Math.cos(km * 0.045) * 0.028 + (km * 0.0055);

          return [
            Number((baseLat + latBend).toFixed(5)),
            Number((baseLng + lngBend).toFixed(5))
          ];
        };

        // Draw 100 KM Curved Highway Polyline Alignment (Vibrant Cyan with Outer Glow)
        const polylinePoints = [];
        for (let i = 0; i <= 100; i += 1) {
          polylinePoints.push(getCurvedHighwayPoint(i));
        }

        // Outer glow path for satellite visibility
        const glowPolyline = L.polyline(polylinePoints, {
          color: '#0284C7',
          weight: 12,
          opacity: 0.6,
          className: 'cursor-pointer'
        }).addTo(map);

        // Core line path
        const corePolyline = L.polyline(polylinePoints, {
          color: '#38BDF8',
          weight: 6,
          opacity: 0.95,
          className: 'cursor-pointer'
        }).addTo(map);

        const handlePointClick = (kmVal, coords) => {
          const roundedKm = Math.round(kmVal);
          const isDone = roundedKm < 40;
          const isDelayed = roundedKm >= 40 && roundedKm < 65 && roundedKm % 3 === 0;

          setSelectedStationData({
            km: roundedKm,
            kmLabel: `KM ${String(roundedKm).padStart(3, '0')}+${(kmVal % 1 * 1000).toFixed(0).padStart(3, '0')}`,
            lat: coords[0],
            lng: coords[1],
            baseElev: (120.5 + roundedKm * 0.45).toFixed(3),
            topElev: (121.6 + roundedKm * 0.45).toFixed(3),
            overallStatus: isDone ? 'Completed' : (isDelayed ? 'Delayed' : 'In-Progress'),
            layers: [
              { code: 'BC', name: 'Bituminous Concrete (BC Surface)', thicknessMm: 50, mat: 'Asphalt wearing course for smooth ride & water sealing', progress: isDone ? 100 : 18, status: isDone ? 'Completed' : 'In-Progress', color: '#38BDF8' },
              { code: 'DBM', name: 'Dense Bituminous Macadam (DBM)', thicknessMm: 100, mat: 'Structural load-bearing dense asphalt layer', progress: isDone ? 100 : (isDelayed ? 38 : 60), status: isDone ? 'Completed' : (isDelayed ? 'Delayed' : 'In-Progress'), color: '#F43F5E' },
              { code: 'WMM', name: 'Wet Mix Macadam (WMM Base)', thicknessMm: 250, mat: 'Bound crushed aggregate base course', progress: isDone ? 100 : 62, status: isDone ? 'Completed' : 'In-Progress', color: '#6366F1' },
              { code: 'GSB', name: 'Granular Sub-Base (GSB Layer)', thicknessMm: 200, mat: 'Granular sub-base drainage & load distribution layer', progress: isDone ? 100 : 84, status: isDone ? 'Completed' : 'In-Progress', color: '#0EA5E9' },
              { code: 'SUB', name: 'Subgrade Earthwork (SUB)', thicknessMm: 500, mat: 'Compacted natural subgrade earthwork foundation CBR > 8%', progress: 100, status: 'Completed', color: '#F59E0B' }
            ]
          });

          if (setSelectedKmSection) {
            setSelectedKmSection({ km: roundedKm });
          }
        };

        // Click event anywhere along the road polyline
        corePolyline.on('click', (e) => {
          const latlng = e.latlng;
          // Find closest station KM
          let closestKm = 0;
          let minDist = Infinity;
          polylinePoints.forEach((pt, idx) => {
            const dist = Math.hypot(pt[0] - latlng.lat, pt[1] - latlng.lng);
            if (dist < minDist) {
              minDist = dist;
              closestKm = idx;
            }
          });
          handlePointClick(closestKm, [latlng.lat.toFixed(4), latlng.lng.toFixed(4)]);
        });

        // Add 10 KM Station Markers along curved route
        for (let i = 0; i <= 100; i += 10) {
          const coords = getCurvedHighwayPoint(i);
          const lat = coords[0];
          const lng = coords[1];

          const statusColor = i < 40 ? '#10B981' : (i < 70 ? '#F59E0B' : '#64748B');
          const marker = L.circleMarker([lat, lng], {
            radius: 11,
            fillColor: statusColor,
            color: '#FFFFFF',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.95
          }).addTo(map);

          marker.bindTooltip(`<b>KM ${String(i).padStart(3, '0')}+000 Station</b><br/>GPS: ${lat}° N, ${lng}° E<br/><span style="color:${statusColor};font-weight:bold;">Click to inspect 5-layer progress</span>`, {
            permanent: false,
            direction: 'top',
            className: 'bg-slate-900 text-white font-mono text-xs border border-slate-700 px-2 py-1 rounded shadow-xl'
          });

          marker.on('click', () => {
            handlePointClick(i, [lat, lng]);
          });
        }

        if (isMounted) setMapLoaded(true);
      }
    };

    if (window.L) {
      initMap();
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    }

    return () => {
      isMounted = false;
    };
  }, []);

  const handleExportSectionData = (station) => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(station, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `3D-DMS_Station_${station.kmLabel.replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="viewport-panel relative w-full rounded-2xl overflow-hidden glass-panel border border-slate-800/90 shadow-2xl">
      {/* 2D GIS Map Container */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Interactive Vector GIS Corridor Fallback View */}
      {!mapLoaded && (
        <div className="absolute inset-0 bg-slate-950 p-6 flex flex-col justify-between z-0">
          <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2 text-cyan-400 font-bold">
              <Navigation className="h-5 w-5" />
              <span className="text-base font-extrabold text-white font-[Outfit]">2D GIS Highway Alignment Map</span>
            </div>
            <span className="px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 font-mono font-bold text-xs border border-cyan-500/40">
              100 KM Corridor
            </span>
          </div>

          <div className="relative flex-1 flex items-center justify-center p-8">
            <svg className="w-full h-48" viewBox="0 0 1000 200" fill="none">
              <path 
                d="M 50 100 Q 250 30, 500 120 T 950 80" 
                stroke="#38BDF8" 
                strokeWidth="8" 
                strokeLinecap="round"
                className="drop-shadow-[0_0_15px_rgba(56,189,248,0.6)]"
              />
              
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((km, i) => {
                const cx = 50 + (i * 90);
                const cy = 100 + Math.sin(i) * 30;
                const statusColor = km < 40 ? '#10B981' : (km < 70 ? '#F59E0B' : '#64748B');
                return (
                  <g key={km} className="cursor-pointer group" onClick={() => { 
                    setSelectedKmSection({ km }); 
                    setSelectedStationData({
                      km: km,
                      kmLabel: `KM ${String(km).padStart(3, '0')} Station`,
                      lat: (28.6139 + (km * 0.009)).toFixed(4),
                      lng: (77.2090 + (km * 0.007)).toFixed(4),
                      status: km < 40 ? 'Completed' : (km < 70 ? 'In-Progress' : 'Scheduled'),
                      layers: [
                        { code: 'BC', name: 'Bituminous Concrete', thickness: '50 mm', progress: km < 40 ? 100 : 18 },
                        { code: 'DBM', name: 'Dense Bituminous Macadam', thickness: '100 mm', progress: km < 40 ? 100 : 38 },
                        { code: 'WMM', name: 'Wet Mix Macadam', thickness: '250 mm', progress: km < 40 ? 100 : 62 },
                        { code: 'GSB', name: 'Granular Sub-Base', thickness: '200 mm', progress: km < 40 ? 100 : 84 },
                        { code: 'SUB', name: 'Subgrade Earthwork', thickness: '500 mm', progress: 100 },
                      ]
                    });
                  }}>
                    <circle cx={cx} cy={cy} r="10" fill={statusColor} stroke="#FFFFFF" strokeWidth="2" className="transition-transform group-hover:scale-125" />
                    <text x={cx} y={cy + 25} fill="#94A3B8" fontSize="11" fontWeight="bold" textAnchor="middle">KM {km}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-slate-800">
            <span>Click any station marker above to inspect 5-layer sub-surface details & export CSV data</span>
            <span className="text-cyan-400 font-bold">GIS Coordinates: 28.6139° N, 77.2090° E</span>
          </div>
        </div>
      )}

      {/* Floating Google Earth Map Layer Switcher Toolbar */}
      <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-md p-1.5 rounded-2xl border border-slate-800 flex items-center space-x-1.5 z-20 shadow-2xl">
        <button
          onClick={() => changeTileLayer('GOOGLE_HYBRID')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
            gisTileLayer === 'GOOGLE_HYBRID' || !gisTileLayer
              ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          title="Google Earth Satellite + Road Hybrid View"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>Google Earth Hybrid</span>
        </button>

        <button
          onClick={() => changeTileLayer('GOOGLE_SATELLITE')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
            gisTileLayer === 'GOOGLE_SATELLITE'
              ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          title="Pure High-Resolution Google Earth Satellite Imagery"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>Google Earth HD</span>
        </button>

        <button
          onClick={() => changeTileLayer('GOOGLE_TERRAIN')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
            gisTileLayer === 'GOOGLE_TERRAIN'
              ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          title="Google Earth Physical Terrain & Topography"
        >
          <Mountain className="h-3.5 w-3.5" />
          <span>Google Terrain</span>
        </button>

        <button
          onClick={() => changeTileLayer('CARTO_DARK')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
            gisTileLayer === 'CARTO_DARK'
              ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800'
          }`}
          title="CartoDB Dark Vector Map"
        >
          <MapIcon className="h-3.5 w-3.5" />
          <span>Dark Vector</span>
        </button>

        <div className="w-[1px] h-6 bg-slate-800 mx-1" />

        <button
          onClick={() => {
            setViewEngineMode('GOOGLE_EARTH');
            setActiveTab('MATTERPORT');
          }}
          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-extrabold transition-all flex items-center space-x-1.5 shadow-lg shadow-indigo-500/20"
        >
          <Globe className="h-3.5 w-3.5 text-cyan-300 animate-pulse" />
          <span>Google Earth 3D Globe ➔</span>
        </button>
      </div>

      {/* Floating Header Info Box */}
      <div className="absolute top-4 left-4 bg-slate-900/95 backdrop-blur-md p-4 rounded-xl border border-slate-800 text-xs space-y-1.5 shadow-2xl max-w-md z-20">
        <div className="flex items-center space-x-2 text-cyan-400 font-extrabold text-sm">
          <Globe className="h-4.5 w-4.5" />
          <span>Google Earth Satellite Road Corridor</span>
        </div>
        <p className="text-slate-300 text-xs leading-relaxed font-medium">
          Real Google Earth HD Satellite & Hybrid imagery. Click any station marker on the map to inspect full 5-layer sub-surface data or launch Google Earth 3D globe.
        </p>
      </div>

      {/* Connected 2D GIS + 3D BIM Live Data Inspector Drawer */}
      {selectedStationData && (
        <div className="absolute top-16 right-4 bg-slate-900/95 backdrop-blur-2xl p-5 rounded-2xl border border-cyan-500/50 shadow-2xl space-y-4 w-96 text-xs z-30 animate-slide-up">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Layers className="h-5 w-5 text-cyan-400" />
              <div>
                <h4 className="font-extrabold text-white font-[Outfit] text-sm">{selectedStationData.kmLabel}</h4>
                <p className="text-[11px] text-slate-400 font-mono">GPS: {selectedStationData.lat}° N, {selectedStationData.lng}° E</p>
              </div>
            </div>
            <button onClick={() => setSelectedStationData(null)} className="p-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Station RL Telemetry Bar */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[11px] font-mono">
            <div>
              <span className="text-slate-400 block text-[10px]">Finished Top RL:</span>
              <span className="font-bold text-emerald-400">{selectedStationData.topElev || '140.500'} m RL</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Base Terrain RL:</span>
              <span className="font-bold text-amber-400">{selectedStationData.baseElev || '139.400'} m RL</span>
            </div>
          </div>

          {/* Layer Progress Matrix */}
          <div className="space-y-2 max-h-[38%] overflow-y-auto pr-1 custom-scrollbar">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">5-Layer Sub-Surface Cross-Section Data</span>
            {selectedStationData.layers.map((layer) => {
              const isDone = layer.status === 'Completed' || layer.progress >= 100;
              const isDelayed = layer.status === 'Delayed';

              let badgeStyle = 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
              if (isDone) badgeStyle = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
              else if (isDelayed) badgeStyle = 'bg-rose-500/20 text-rose-300 border-rose-500/40';

              return (
                <div key={layer.code} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <div className="flex items-center space-x-1.5 min-w-0 pr-1">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: layer.color || '#38BDF8' }} />
                      <span className="text-white truncate font-[Outfit]">{layer.name}</span>
                    </div>
                    <span className="text-cyan-300 font-mono text-[11px] shrink-0">{layer.thicknessMm || layer.thickness} mm</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className={`px-2 py-0.5 rounded-full border font-bold ${badgeStyle}`}>
                      {isDone ? '100% Completed' : `${layer.progress}% ${layer.status}`}
                    </span>
                    <span className="text-slate-400 font-mono">{layer.mat ? layer.mat.slice(0, 30) + '...' : ''}</span>
                  </div>

                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-1.5 rounded-full transition-all ${
                        isDone ? 'bg-emerald-500' : isDelayed ? 'bg-rose-500' : 'bg-cyan-500'
                      }`} 
                      style={{ width: `${layer.progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setSelectedKmSection({ km: selectedStationData.km });
                  setActiveTab('3D_BIM');
                }}
                className="py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold text-xs flex items-center justify-center space-x-1.5 shadow-lg"
              >
                <Box className="h-4 w-4" />
                <span>Fly to 3D BIM</span>
              </button>

              <button
                onClick={() => {
                  setSelectedKmSection({ km: selectedStationData.km });
                  setViewEngineMode('GOOGLE_EARTH');
                  setActiveTab('MATTERPORT');
                }}
                className="py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-lg"
              >
                <Globe className="h-4 w-4 text-cyan-300" />
                <span>Google Earth 3D</span>
              </button>
            </div>

            <button
              onClick={() => {
                setSelectedKmSection({ km: selectedStationData.km });
                setViewEngineMode('STREET_VIEW');
                setActiveTab('MATTERPORT');
              }}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center space-x-1.5 border border-slate-700"
            >
              <Camera className="h-4 w-4 text-cyan-400" />
              <span>Google Street View 360°</span>
            </button>

            <button
              onClick={() => handleExportSectionData(selectedStationData)}
              className="w-full py-2 rounded-xl bg-slate-950 hover:bg-slate-900 text-cyan-400 font-bold text-xs flex items-center justify-center space-x-1.5 border border-cyan-500/30"
            >
              <Download className="h-4 w-4" />
              <span>Export Station JSON/CSV Data</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
