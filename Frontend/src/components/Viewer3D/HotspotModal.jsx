import React from 'react';
import { X, Camera, ShieldCheck, MapPin, User, Calendar } from 'lucide-react';

export default function HotspotModal({ hotspot, onClose }) {
  if (!hotspot) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl space-y-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-2">
            <Camera className="h-5 w-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white font-[Outfit]">{hotspot.title}</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Photo Image Display */}
        <div className="relative h-64 w-full bg-slate-950">
          <img 
            src={hotspot.imageUrl} 
            alt={hotspot.title} 
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-3 left-3 bg-slate-950/85 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-700 text-xs font-mono text-cyan-400 flex items-center space-x-1.5">
            <MapPin className="h-3.5 w-3.5 text-cyan-400" />
            <span>Chainage KM {hotspot.km}+000</span>
          </div>
        </div>

        {/* Inspection Details */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">{hotspot.description}</p>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
            <div className="flex items-center space-x-2 text-slate-400">
              <User className="h-4 w-4 text-cyan-400" />
              <span>Inspector: <strong className="text-white">Er. R. K. Sharma</strong></span>
            </div>
            <div className="flex items-center space-x-2 text-slate-400">
              <Calendar className="h-4 w-4 text-cyan-400" />
              <span>Date: <strong className="text-white">August 04, 2026</strong></span>
            </div>
          </div>
        </div>

        {/* Footer Action */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all shadow-lg shadow-cyan-500/20"
          >
            Close Hotspot View
          </button>
        </div>
      </div>
    </div>
  );
}
