import React from 'react';
import { useRoadData } from '../context/RoadDataContext';
import { 
  Box, 
  Map, 
  BarChart3, 
  FileSpreadsheet, 
  Bot, 
  FileText, 
  Layers, 
  Calendar,
  Sparkles
} from 'lucide-react';

export default function Header() {
  const { 
    activeTab, 
    setActiveTab, 
    isAiAssistantOpen, 
    setIsAiAssistantOpen 
  } = useRoadData();

  return (
    <header className="glass-panel sticky top-0 z-40 border-b border-slate-800/80 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
      {/* Branding & Logo */}
      <div className="flex items-center space-x-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 ring-1 ring-white/20">
          <Box className="h-5 w-5 text-white animate-pulse-subtle" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400 font-[Outfit]">
              ROAD<span className="text-cyan-400">BIM</span> 4D/5D TWIN
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-full">
              100 KM HIGHWAY
            </span>
          </div>
          <p className="text-xs text-slate-400 font-medium">Infrastructure Road Progress & Layer Analytics Platform</p>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="flex items-center bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('3D_BIM')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
            activeTab === '3D_BIM'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Box className="h-4 w-4" />
          <span>Interactive 3D BIM</span>
        </button>

        <button
          onClick={() => setActiveTab('GIS_MAP')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
            activeTab === 'GIS_MAP'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Map className="h-4 w-4" />
          <span>GIS & Google Earth Map</span>
        </button>

        <button
          onClick={() => setActiveTab('ANALYTICS')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
            activeTab === 'ANALYTICS'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          <span>Analytics & EVM</span>
        </button>

        <button
          onClick={() => setActiveTab('EXCEL_IMPORT')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
            activeTab === 'EXCEL_IMPORT'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
          <span>Excel Import</span>
        </button>
      </nav>

      {/* AI Assistant & Director Presentation Actions */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setIsAiAssistantOpen(!isAiAssistantOpen)}
          className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-purple-600/30 via-indigo-600/30 to-purple-600/30 border border-purple-500/40 text-purple-300 text-xs font-semibold hover:border-purple-400 hover:text-white transition-all shadow-lg shadow-purple-500/10"
        >
          <Sparkles className="h-4 w-4 text-purple-400 animate-spin-slow" />
          <span>AI Query Assistant</span>
        </button>
      </div>
    </header>
  );
}
