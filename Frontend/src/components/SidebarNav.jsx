import React from 'react';
import { useRoadData } from '../context/RoadDataContext';
import {
  LayoutDashboard, Box, Map, BarChart3, FileSpreadsheet, Camera,
  Sparkles, Database, Boxes, ClipboardList, ClipboardCheck, Construction,
} from 'lucide-react';
import ReportExporter from './Reports/ReportExporter';
import { TRACKER_MODULE, TRACKER_HIDDEN_TABS } from '../modules/bridgeTracker/constants';
import { useTrackerSummary } from '../modules/bridgeTracker/useTrackerSummary';

/**
 * Primary navigation.
 *
 * Section labels describe what the screen is for rather than restating the product name,
 * and the live badges report what the active project actually holds — a model, saved rows,
 * bound elements — so the state of the data is visible without opening a tab to check.
 */
const NAV = [
  { id: 'DASHBOARD', label: 'Dashboard', hint: 'KPIs and progress', icon: LayoutDashboard },
  { id: '3D_BIM', label: '3D Digital Twin', hint: 'Model and cross-section', icon: Box },
  { id: 'GIS_MAP', label: 'Plan & GIS', hint: 'Layers on the ground', icon: Map },
  { id: 'RFI', label: 'Inspections', hint: 'RFI register', icon: ClipboardList },
  { id: 'RFI_RAISE', label: 'Raise RFI', hint: 'Offer work for inspection', icon: ClipboardCheck },
  { id: 'MATTERPORT', label: 'Site Reality', hint: '360° captures', icon: Camera },
  { id: 'ANALYTICS', label: 'Analytics', hint: 'EVM, SPI and CPI', icon: BarChart3 },
  { id: 'EXCEL_IMPORT', label: 'Data Import', hint: 'Model and workbooks', icon: FileSpreadsheet },
];

/** The Palashbari tracker is its own screen, offered only on the package that is one. */
const TRACKER_NAV = { id: 'BRIDGE_TRACKER', label: 'Bridge RFI Tracker', hint: 'IFC · register · IPC · alignment', icon: Construction };

export default function SidebarNav() {
  const {
    activeTab, setActiveTab, isAiAssistantOpen, setIsAiAssistantOpen,
    dashboard, persistence, ifcSummary, activePackage,
  } = useRoadData();

  const isTracker = activePackage?.module === TRACKER_MODULE;
  const nav = isTracker ? [TRACKER_NAV, ...NAV.filter((i) => !TRACKER_HIDDEN_TABS.has(i.id))] : NAV;
  const { summary: t } = useTrackerSummary(activePackage?.id, isTracker);
  const nf = (n) => Number(n || 0).toLocaleString('en-IN');

  const bound = dashboard?.binding?.mode === 'element' ? dashboard.binding : null;

  return (
    <aside className="w-64 bg-[var(--surface-1)] border-r border-[var(--line)] h-[calc(100vh-3.5rem)] flex flex-col shrink-0 sticky top-14 z-30 select-none">
      {/* ---- brand ---- */}
      <div className="px-5 py-5 border-b border-[var(--line)]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-[10px] grid place-items-center bg-[var(--accent-soft)] border border-[var(--accent-line)]">
            <Box className="h-4.5 w-4.5 text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-extrabold tracking-tight font-[Outfit] leading-none">
              3D-<span className="text-[var(--accent)]">DMS</span>
            </h1>
            <p className="text-[10px] text-[var(--text-faint)] font-mono mt-1">4D / 5D digital twin</p>
          </div>
        </div>
      </div>

      {/* ---- what this project holds ---- */}
      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--line)]">
        {isTracker ? (
          <>
            <StatusLine
              icon={Boxes}
              label={t?.files.ifc?.name || 'No model'}
              detail={t?.model ? `${nf(t.model.keys)} keys · modules ${t.model.modules.join(', ')}` : 'upload it in the tracker'}
              on={Boolean(t?.model)}
            />
            <StatusLine
              icon={Database}
              label={t?.ipc ? `${t.ipc.bill || 'IPC'} · ${nf(t.ipc.rows)} rows` : 'No IPC yet'}
              detail={t?.counts ? `${t.counts.notRaised} RFI not raised · ${nf(t.issues.total)} issues` : 'upload the monthly IPC'}
              on={Boolean(t?.ipc)}
            />
          </>
        ) : (<>
        <StatusLine
          icon={Boxes}
          label={ifcSummary ? `${ifcSummary.elementCount} elements` : 'No model'}
          detail={ifcSummary?.alignment ? `${ifcSummary.alignment.lengthM} m · ${ifcSummary.alignment.segmentCount} segments` : 'upload an IFC'}
          on={Boolean(ifcSummary)}
        />
        <StatusLine
          icon={Database}
          label={persistence?.progressCount
            ? `${persistence.progressCount} progress rows`
            : persistence?.bridgeItemCount
              ? `${persistence.bridgeItemCount} register rows`
              : 'No saved data'}
          detail={bound ? `${bound.covered}/${bound.elements} elements bound` : 'import a workbook'}
          on={Boolean(persistence?.progressCount || persistence?.bridgeItemCount)}
        />
        </>)}
      </div>

      {/* ---- nav ---- */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto custom-scrollbar">
        <div className="px-2 pb-2 ui-label">Workspace</div>
        {nav.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-left transition-colors group relative"
              style={active
                ? { background: 'var(--surface-3)', color: 'var(--text)' }
                : { color: 'var(--text-muted)' }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* A rail rather than a filled gradient: it marks the position without
                  competing with the status colours the content uses. */}
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-full transition-all"
                style={{ height: active ? '1.4rem' : 0, background: 'var(--accent)' }}
              />
              <Icon className="h-4 w-4 shrink-0" style={{ color: active ? 'var(--accent)' : 'inherit' }} />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold leading-tight">{item.label}</span>
                <span className="block text-[10px] text-[var(--text-faint)] leading-tight mt-0.5">{item.hint}</span>
              </span>
            </button>
          );
        })}

        <div className="pt-3">
          <button
            onClick={() => setIsAiAssistantOpen(!isAiAssistantOpen)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] border transition-colors"
            style={{
              borderColor: 'rgba(167,139,250,.25)',
              background: 'rgba(167,139,250,.07)',
              color: 'var(--violet)',
            }}
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-[13px] font-bold">Ask the assistant</span>
          </button>
        </div>
      </nav>

      <div className="p-3 border-t border-[var(--line)]">
        <ReportExporter />
      </div>
    </aside>
  );
}

function StatusLine({ icon: Icon, label, detail, on }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1">
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: on ? 'var(--ok)' : 'var(--text-faint)' }} />
      <div className="min-w-0">
        <div className="text-[11px] font-bold leading-tight" style={{ color: on ? 'var(--text)' : 'var(--text-faint)' }}>
          {label}
        </div>
        <div className="text-[10px] text-[var(--text-faint)] font-mono leading-tight truncate">{detail}</div>
      </div>
    </div>
  );
}
