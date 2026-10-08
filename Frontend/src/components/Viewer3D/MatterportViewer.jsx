import React, { useState } from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { Camera, MapPin, Search, Layers, ExternalLink, RefreshCw, Sparkles, Navigation, Monitor, Eye, Globe } from 'lucide-react';
import HotspotModal from './HotspotModal';
import IfcRoadMap from './IfcRoadMap';

export default function MatterportViewer() {
  const { matterportModelId, setMatterportModelId, setSelectedKmSection, setActiveTab, viewEngineMode, setViewEngineMode, ifcSummary, ifcFileName } = useRoadData();
  // Corridor plan extracted from an uploaded IFC (null when the model carries no georeference)
  const roadPath = ifcSummary?.roadPath || null;
  const [modelInput, setModelInput] = useState(matterportModelId || '2s37Wkr2ZCV');
  const [activeHotspot, setActiveHotspot] = useState(null);
  const [selectedScanLocation, setSelectedScanLocation] = useState('KM_042');

  const scanLocations = [
    { 
      id: 'KM_014', 
      km: 14,
      title: 'KM 014+500 Subgrade Foundation Zone', 
      status: 'Approved',
      streetViewUrl: 'https://maps.google.com/maps?q=28.6139,77.2090&layer=c&cbll=28.6139,77.2090&cbp=12,20,0,0,0&output=svembed',
      imageUrl: 'https://images.unsplash.com/photo-1590496793929-36417d3117de?auto=format&fit=crop&w=1600&q=80',
      description: 'Subgrade earthwork density test verified at 98.4% compaction factor with nuclear density gauge.'
    },
    { 
      id: 'KM_042', 
      km: 42,
      title: 'KM 042+200 Highway Paver Equipment Delay Zone', 
      status: 'Action Required',
      streetViewUrl: 'https://maps.google.com/maps?q=28.5355,77.3910&layer=c&cbll=28.5355,77.3910&cbp=12,20,0,0,0&output=svembed',
      imageUrl: 'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=1600&q=80',
      description: 'Dense Bituminous Macadam (DBM) paver breakdown caused 4-hour bitumen temperature drop. Re-compaction mandated.'
    },
    { 
      id: 'KM_068', 
      km: 68,
      title: 'KM 068+000 Expressway Flyover Overpass Scan', 
      status: 'Verified',
      streetViewUrl: 'https://maps.google.com/maps?q=28.4595,77.0266&layer=c&cbll=28.4595,77.0266&cbp=12,20,0,0,0&output=svembed',
      imageUrl: 'https://images.unsplash.com/photo-1508873696983-2df515122519?auto=format&fit=crop&w=1600&q=80',
      description: 'High-resolution flyover corridor scan verifying Granular Sub-Base (GSB) slope angles.'
    }
  ];

  const currentScan = scanLocations.find(s => s.id === selectedScanLocation) || scanLocations[1];

  const handleLoadModel = (e) => {
    e.preventDefault();
    if (modelInput.trim()) {
      setMatterportModelId(modelInput.trim());
      setViewEngineMode('MATTERPORT_IFRAME');
    }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-[#131924] to-[#0B0F17] p-6 rounded-2xl border border-slate-800 shadow-2xl">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
              FREE REALITY CAPTURE ENGINE
            </span>
            <span className="text-xs text-slate-500 font-bold">|</span>
            <span className="text-xs font-bold text-slate-200">Site Reality Capture & 360° Inspection</span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-extrabold text-white font-[Outfit] mt-1.5">
            100 KM Road 360° Street View & Site Inspection
          </h2>
          <p className="text-sm text-slate-300 font-medium mt-1">
            Free, zero-cost 360° road reality inspection using HD photogrammetry canvas, Google Street View, and drone corridor scans.
          </p>
        </div>

        {/* Engine Switcher Buttons */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setViewEngineMode('GOOGLE_EARTH')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
              viewEngineMode === 'GOOGLE_EARTH' ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Globe className="h-4 w-4 text-slate-950 animate-pulse" />
            <span>Google Earth 3D View</span>
          </button>

          <button
            onClick={() => setViewEngineMode('STREET_VIEW')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
              viewEngineMode === 'STREET_VIEW' ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Camera className="h-4 w-4" />
            <span>Google Street View 360°</span>
          </button>

          <button
            onClick={() => setViewEngineMode('CANVAS_360')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
              viewEngineMode === 'CANVAS_360' ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Eye className="h-4 w-4" />
            <span>360° HD Photo Canvas</span>
          </button>

          <button
            onClick={() => setViewEngineMode('MATTERPORT_IFRAME')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
              viewEngineMode === 'MATTERPORT_IFRAME' ? 'bg-cyan-500 text-slate-950 shadow-md font-extrabold' : 'text-slate-300 hover:text-white'
            }`}
          >
            <Monitor className="h-4 w-4" />
            <span>Matterport Cloud</span>
          </button>
        </div>
      </div>

      {/* Main Viewport Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left 3 Columns: Active Engine Canvas */}
        <div className="lg:col-span-3 viewport-panel relative rounded-2xl overflow-hidden glass-panel border border-slate-800 shadow-2xl">
          
          {/* ENGINE 0a: Corridor extracted from the uploaded IFC, drawn over satellite imagery.
              A Google Maps embed can only place one pin, so the road plan needs a real map layer. */}
          {viewEngineMode === 'GOOGLE_EARTH' && roadPath && (
            <IfcRoadMap
              roadPath={roadPath}
              fileName={ifcFileName}
              onFlyToBim={() => {
                setSelectedKmSection({ km: 0 });
                setActiveTab('3D_BIM');
              }}
            />
          )}

          {/* ENGINE 0b: Google Earth 3D Satellite & Terrain Globe View */}
          {viewEngineMode === 'GOOGLE_EARTH' && !roadPath && (
            <div className="w-full h-full relative bg-slate-950 flex flex-col">
              <iframe
                src={`https://maps.google.com/maps?q=${currentScan.id === 'KM_014' ? '28.6139,77.2090' : currentScan.id === 'KM_042' ? '28.5355,77.3910' : '28.4595,77.0266'}&t=k&z=17&ie=UTF8&iwloc=&output=embed`}
                title="Google Earth 3D Satellite Viewport"
                className="w-full h-full border-0 z-10 relative"
                allowFullScreen=""
                loading="lazy"
              />

              {/* Bottom Interactive Google Earth Control Bar */}
              <div className="absolute bottom-4 left-4 right-4 bg-slate-950/90 backdrop-blur-xl p-3.5 rounded-2xl border border-cyan-500/40 z-20 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    <Globe className="h-5 w-5 animate-spin-slow" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white font-[Outfit]">{currentScan.title}</h4>
                    <p className="text-[11px] text-slate-400 font-mono">Google Earth 3D GPS: 28.5355° N, 77.3910° E | Altitude: 216m ASL</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <a
                    href={`https://earth.google.com/web/@28.5355,77.3910,216a,1000d,35y,0h,45t,0r`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-cyan-500/40 text-xs font-bold transition-all flex items-center space-x-1.5 shadow-md"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Launch Google Earth Web 3D</span>
                  </a>

                  <button
                    onClick={() => {
                      setSelectedKmSection({ km: currentScan.km });
                      setActiveTab('3D_BIM');
                    }}
                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-extrabold transition-all flex items-center space-x-1.5 shadow-lg"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    <span>Fly to BIM Twin</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ENGINE 1: 360° HD Photogrammetry Canvas */}
          {viewEngineMode === 'CANVAS_360' && (
            <div className="relative w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden">
              <img 
                src={currentScan.imageUrl} 
                alt={currentScan.title} 
                className="w-full h-full object-cover opacity-90 filter contrast-105 transition-all duration-700 hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-slate-950/40" />

              {/* Interactive Mattertag Hotspots Overlay */}
              <div 
                onClick={() => setActiveHotspot({
                  km: currentScan.km,
                  title: currentScan.title,
                  imageUrl: currentScan.imageUrl,
                  description: currentScan.description
                })}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer group pointer-events-auto"
              >
                <div className="relative flex items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-16 w-16 rounded-full bg-cyan-400 opacity-75"></span>
                  <div className="relative px-5 py-3 rounded-2xl bg-slate-950/95 border-2 border-cyan-400 text-cyan-300 font-mono text-xs font-extrabold flex items-center space-x-2.5 shadow-2xl group-hover:scale-110 transition-transform">
                    <Camera className="h-5 w-5 text-cyan-400 animate-pulse" />
                    <span>Mattertag Hotspot: View Quality Log</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ENGINE 2: Google Street View Live 360° Embed */}
          {viewEngineMode === 'STREET_VIEW' && (
            <div className="w-full h-full relative bg-slate-950">
              <iframe
                src={currentScan.streetViewUrl}
                title="Google Street View 360 Road Viewport"
                className="w-full h-full border-0 z-10 relative"
                allowFullScreen=""
                loading="lazy"
              />
            </div>
          )}

          {/* ENGINE 3: Matterport Cloud Embed */}
          {viewEngineMode === 'MATTERPORT_IFRAME' && (
            <div className="w-full h-full relative">
              <iframe
                src={`https://my.matterport.com/show/?m=${matterportModelId || '2s37Wkr2ZCV'}&play=1&qs=1&brand=0&gt=1&hr=1`}
                title="Matterport 360 Road Scan Viewport"
                className="w-full h-full border-0 z-10 relative"
                allow="fullscreen; accelerometer; magnetometer; gyroscope"
              />
            </div>
          )}

          {/* Top Floating Viewport Header Badge — the corridor map draws its own readout */}
          <div className={`absolute top-4 left-4 right-4 items-center justify-between pointer-events-none z-20 ${
            viewEngineMode === 'GOOGLE_EARTH' && roadPath ? 'hidden' : 'flex'
          }`}>
            <div className="bg-slate-950/90 backdrop-blur-md px-4 py-2 rounded-xl border border-slate-800 text-xs font-mono font-bold text-cyan-400 flex items-center space-x-2 shadow-xl">
              <Globe className="h-4 w-4 text-cyan-400" />
              <span>Station View: {currentScan.title}</span>
            </div>

            <button
              onClick={() => {
                setSelectedKmSection({ km: currentScan.km });
                setActiveTab('3D_BIM');
              }}
              className="pointer-events-auto px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-extrabold transition-all shadow-xl shadow-cyan-500/20"
            >
              Sync to 3D BIM Model ➔
            </button>
          </div>
        </div>

        {/* Right 1 Column: Station Selector */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-4 shadow-xl flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Layers className="h-5 w-5 text-cyan-400" />
              <h3 className="text-base font-extrabold text-white font-[Outfit]">Corridor Station Scans</h3>
            </div>

            <div className="space-y-3">
              {scanLocations.map((scan) => (
                <button
                  key={scan.id}
                  onClick={() => {
                    setSelectedScanLocation(scan.id);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all space-y-1.5 ${
                    selectedScanLocation === scan.id
                      ? 'bg-slate-900 border-cyan-500/80 shadow-lg shadow-cyan-500/10'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-white font-[Outfit]">{scan.title}</span>
                    <span className={`px-2 py-0.5 text-[10px] rounded ${
                      scan.status === 'Action Required' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {scan.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{scan.description}</p>
                </button>
              ))}
            </div>

            {/* Custom Matterport / Google Street View URL Input */}
            <form onSubmit={handleLoadModel} className="pt-2 space-y-2 border-t border-slate-800">
              <label className="text-xs font-mono font-bold text-slate-300 block">Load Custom Scan ID / Matterport URL:</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder="Paste Matterport ID (e.g. 2s37Wkr2ZCV)"
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 flex-1"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md"
                >
                  Load
                </button>
              </div>
            </form>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 space-y-2.5 shadow-md">
            <div className="flex items-center justify-between font-bold border-b border-slate-800 pb-2">
              <span className="text-white font-[Outfit]">Station {currentScan.id.replace('_', ' ')} Sub-Surface Data</span>
              <span className="text-cyan-400 font-mono">5 Layers</span>
            </div>
            
            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between items-center bg-slate-950 p-1.5 rounded border border-slate-800">
                <span className="text-slate-300">L5 • BC (50 mm):</span>
                <span className="text-cyan-300 font-bold">{currentScan.km < 40 ? '100% Done' : '18% In-Progress'}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-1.5 rounded border border-slate-800">
                <span className="text-slate-300">L4 • DBM (100 mm):</span>
                <span className="text-rose-400 font-bold">{currentScan.km < 40 ? '100% Done' : (currentScan.km === 42 ? '38% Delayed' : '60% In-Progress')}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-1.5 rounded border border-slate-800">
                <span className="text-slate-300">L3 • WMM (250 mm):</span>
                <span className="text-cyan-300 font-bold">{currentScan.km < 40 ? '100% Done' : '62% In-Progress'}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-1.5 rounded border border-slate-800">
                <span className="text-slate-300">L2 • GSB (200 mm):</span>
                <span className="text-cyan-300 font-bold">{currentScan.km < 40 ? '100% Done' : '84% In-Progress'}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-1.5 rounded border border-slate-800">
                <span className="text-slate-300">L1 • SUB (500 mm):</span>
                <span className="text-emerald-400 font-bold">100% Completed</span>
              </div>
            </div>

            <button
              onClick={() => {
                setSelectedKmSection({ km: currentScan.km });
                setActiveTab('3D_BIM');
              }}
              className="w-full py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-extrabold transition-all shadow-md mt-2 flex items-center justify-center space-x-1"
            >
              <span>Sync to 3D BIM Model ➔</span>
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Hotspot Modal */}
      {activeHotspot && (
        <HotspotModal hotspot={activeHotspot} onClose={() => setActiveHotspot(null)} />
      )}
    </div>
  );
}
