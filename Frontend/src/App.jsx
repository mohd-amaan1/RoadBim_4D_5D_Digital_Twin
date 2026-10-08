import React from 'react';
import { RoadDataProvider, useRoadData } from './context/RoadDataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import SignInScreen from './components/Auth/SignInScreen';
import ProjectBar from './components/Auth/ProjectBar';
import { Loader2 } from 'lucide-react';
import SidebarNav from './components/SidebarNav';
import ExecutiveDashboardView from './components/ExecutiveDashboardView';
import RoadBIMViewer from './components/Viewer3D/RoadBIMViewer';
import MatterportViewer from './components/Viewer3D/MatterportViewer';
import LayerExplorer from './components/Viewer3D/LayerExplorer';
import LayerPlanMap from './components/Map2D/LayerPlanMap';
import AnalyticsSection from './components/Dashboard/AnalyticsSection';
import ImportWizard from './components/ExcelImport/ImportWizard';
import AIQueryAssistant from './components/AIModal/AIQueryAssistant';
import ChainageHeatmap from './components/Dashboard/ChainageHeatmap';
import TimelineScrubber from './components/Timeline4D/TimelineScrubber';
import RfiRegister from './components/Rfi/RfiRegister';
import RfiDetail from './components/Rfi/RfiDetail';
import RaiseRfiForm from './components/Rfi/RaiseRfiForm';
import { TRACKER_MODULE, TRACKER_HIDDEN_TABS } from './modules/bridgeTracker/constants';

// The tracker carries three.js scenes, SheetJS and its own IFC reader; most sessions never
// open it, so it loads on first visit rather than with the app.
const BridgeTracker = React.lazy(() => import('./modules/bridgeTracker/BridgeTracker'));

function MainAppLayout() {
  const { activeTab, setActiveTab, activePackage } = useRoadData();
  const isTracker = activePackage?.module === TRACKER_MODULE;

  // Leaving the tracker's package leaves its screen too; another package has no tracker.
  // And a tracker package has no road viewer or road importer: the tracker replaces both.
  React.useEffect(() => {
    if (activeTab === 'BRIDGE_TRACKER' && activePackage && !isTracker) setActiveTab('DASHBOARD');
    if (isTracker && TRACKER_HIDDEN_TABS.has(activeTab)) setActiveTab('BRIDGE_TRACKER');
  }, [activeTab, activePackage, isTracker, setActiveTab]);
  // Which RFI is open, if any. Register and detail are one tab rather than two routes:
  // the app has no router, and a tab that silently changes meaning would be worse.
  const [openRfiId, setOpenRfiId] = React.useState(null);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] font-sans selection:bg-[var(--accent)] selection:text-[var(--accent-ink)]">
      {/* 1. Left Sidenavbar Component */}
      <SidebarNav />

      {/* 2. Main Workspace Right Viewport Area */}
      <div className="flex-1 min-w-0 p-6 lg:p-8 space-y-8 overflow-y-auto">
        {activeTab === 'BRIDGE_TRACKER' && isTracker && (
          <React.Suspense
            fallback={(
              <div className="flex items-center gap-3 text-[var(--text-muted)] text-sm font-semibold">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" /> Loading the bridge tracker…
              </div>
            )}
          >
            <BridgeTracker key={activePackage.id} packageId={activePackage.id} />
          </React.Suspense>
        )}

        {activeTab === 'DASHBOARD' && (
          <ExecutiveDashboardView />
        )}

        {activeTab === '3D_BIM' && (
          <div className="space-y-6 animate-slide-up">
            <div className="flex justify-between items-center glass-panel p-4">
              <div>
                <h2 className="text-xl font-bold font-[Outfit]">Interactive 3D BIM Road Viewer</h2>
                <p className="text-xs text-[var(--text-muted)]">Orbit, zoom, slice layers, inspect metadata, and upload raw .IFC files</p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <RoadBIMViewer />
              </div>
              <div>
                <LayerExplorer />
              </div>
            </div>
            <ChainageHeatmap />
            <TimelineScrubber />
          </div>
        )}

        {activeTab === 'MATTERPORT' && (
          <div className="animate-slide-up">
            <MatterportViewer />
          </div>
        )}

        {activeTab === 'GIS_MAP' && (
          <div className="space-y-6 animate-slide-up">
            <div className="flex justify-between items-center glass-panel p-4">
              <div>
                <h2 className="text-xl font-bold font-[Outfit]">GIS & Google Earth Satellite Highway Alignment</h2>
                <p className="text-xs text-[var(--text-muted)]">Synced bidirectionally with Google Earth 3D & 3D BIM twin alignment coordinates</p>
              </div>
            </div>
            {/* Plan view of the modelled layers — the same elements and the same status
                palette as the 3D viewer, drawn on the ground.

                It is the only map here on purpose. The Google Earth panel and the chainage
                heatmap that used to sit below it drew a 100 km corridor across Delhi and a
                block grid coloured by array index — both invented, neither reading a single
                row of project data, and both contradicting this map on the same screen. */}
            <LayerPlanMap />
          </div>
        )}

        {activeTab === 'RFI' && (
          openRfiId
            ? <RfiDetail rfiId={openRfiId} onBack={() => setOpenRfiId(null)} />
            : <RfiRegister onOpen={setOpenRfiId} />
        )}

        {activeTab === 'RFI_RAISE' && (
          <RaiseRfiForm
            onRaised={(result) => {
              // Land on the record just created rather than an empty form: the next thing
              // anyone does is check it says what they meant.
              setOpenRfiId(result.id);
              setActiveTab('RFI');
            }}
          />
        )}

        {activeTab === 'ANALYTICS' && (
          <div className="animate-slide-up">
            <AnalyticsSection />
          </div>
        )}

        {activeTab === 'EXCEL_IMPORT' && (
          <div className="animate-slide-up">
            <ImportWizard />
          </div>
        )}
      </div>

      {/* 3. AI Query Assistant Lightbox Modal */}
      <AIQueryAssistant />
    </div>
  );
}

/**
 * Everything project-scoped sits behind authentication. Project data is only ever read
 * through the API with a bearer token, so there is no signed-out state that shows another
 * tenant's rows.
 */
function AuthenticatedApp() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--text-muted)] text-sm font-semibold">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
          Restoring your session…
        </div>
      </div>
    );
  }

  if (status === 'signedOut') return <SignInScreen />;

  return (
    <RoadDataProvider>
      <div className="min-h-screen flex flex-col">
        <ProjectBar />
        <div className="flex-1 min-h-0">
          <MainAppLayout />
        </div>
      </div>
    </RoadDataProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
