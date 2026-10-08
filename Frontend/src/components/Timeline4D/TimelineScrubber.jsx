import React, { useEffect } from 'react';
import { useRoadData } from '../../context/RoadDataContext';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';

export default function TimelineScrubber() {
  const { 
    timelineMonth, 
    setTimelineMonth, 
    isTimelinePlaying, 
    setIsTimelinePlaying,
    setSliceKm
  } = useRoadData();

  useEffect(() => {
    let interval;
    if (isTimelinePlaying) {
      interval = setInterval(() => {
        setTimelineMonth(prev => {
          if (prev >= 24) {
            setIsTimelinePlaying(false);
            return 24;
          }
          const next = prev + 1;
          setSliceKm(Math.min(100, Math.round((next / 24) * 100)));
          return next;
        });
      }, 750);
    }
    return () => clearInterval(interval);
  }, [isTimelinePlaying]);

  const monthLabels = [
    "Jan '25", "Feb '25", "Mar '25", "Apr '25", "May '25", "Jun '25",
    "Jul '25", "Aug '25", "Sep '25", "Oct '25", "Nov '25", "Dec '25",
    "Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26",
    "Jul '26", "Aug '26", "Sep '26", "Oct '26", "Nov '26", "Dec '26"
  ];

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800/90 space-y-4 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 glow-cyan">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-extrabold text-white text-base font-[Outfit]">4D Construction Timeline Simulator</h4>
            <p className="text-xs text-slate-300 font-medium">Replay layer-by-layer road progress over 24 months</p>
          </div>
        </div>

        {/* Timeline Controls */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => setIsTimelinePlaying(!isTimelinePlaying)}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-extrabold transition-all shadow-lg shadow-cyan-500/20"
          >
            {isTimelinePlaying ? (
              <>
                <Pause className="h-4 w-4" />
                <span>Pause 4D</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                <span>Play Timeline</span>
              </>
            )}
          </button>

          <button
            onClick={() => {
              setTimelineMonth(1);
              setSliceKm(5);
              setIsTimelinePlaying(false);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-all border border-slate-700"
            title="Reset to Month 1"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <div className="px-4 py-2 bg-slate-900 border border-slate-800 text-cyan-400 rounded-xl font-mono font-extrabold text-xs shadow-md">
            {monthLabels[timelineMonth - 1] || "Month 14"} (Month {timelineMonth}/24)
          </div>
        </div>
      </div>

      {/* Scrubber Slider */}
      <div className="space-y-2 pt-1">
        <input
          type="range"
          min="1"
          max="24"
          value={timelineMonth}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            setTimelineMonth(val);
            setSliceKm(Math.min(100, Math.round((val / 24) * 100)));
          }}
          className="w-full h-2.5 bg-slate-900 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />

        <div className="flex justify-between text-xs font-mono font-bold text-slate-300 pt-1">
          <span>Month 01 (Earthwork Start)</span>
          <span>Month 12 (Sub-Base Target)</span>
          <span>Month 24 (100 KM Asphalt Handover)</span>
        </div>
      </div>
    </div>
  );
}
