import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRoadData } from '../../context/RoadDataContext';
import PackageDialog from '../Packages/PackageDialog';
import {
  FolderOpen, Plus, LogOut, Loader2, ShieldCheck, Eye, X, Database, Link2,
  Boxes, Pencil, ShieldAlert, FileSpreadsheet, AlertTriangle,
} from 'lucide-react';
import { isTrackerPackage } from '../../modules/bridgeTracker/constants';
import { useTrackerSummary } from '../../modules/bridgeTracker/useTrackerSummary';

const ROLE_TONE = { Owner: 'violet', Contributor: 'accent', Viewer: undefined };

/** A package with no chainages and no model contributes nothing to the map. A tracker
 *  package keeps its data in the tracker, so road emptiness says nothing about it. */
const isEmpty = (pkg) => !isTrackerPackage(pkg) && !pkg?.chainageCount && !pkg?.activeModel;

/**
 * Project selector and session controls.
 *
 * Which project is active decides which rows the entire app reads, so it sits in front of
 * the user rather than in a menu — together with what is currently loaded from the
 * database, because "is this real data or am I looking at nothing" is the first question
 * anyone asks on opening the app.
 *
 * It is one row that never wraps, and it stays put while the page scrolls. Both matter for
 * the same reason: this bar says which project and package everything below it belongs to,
 * so it must still be readable at the bottom of a long register.
 */
export default function ProjectBar() {
  const {
    user, projects, activeProject, selectProject, createProject, signOut,
    packages, activePackage, selectPackage, canEdit, authDisabled,
  } = useAuth();
  const { persistence, dashboard } = useRoadData();
  const isTracker = isTrackerPackage(activePackage);
  const tracker = useTrackerSummary(activePackage?.id, isTracker);
  const t = tracker.summary;

  // null = closed, 'new' = add, or the package being edited
  const [packageDialog, setPackageDialog] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const bound = dashboard?.binding?.mode === 'element' ? dashboard.binding : null;
  // Road progress rows and bridge register rows are both saved data; a bridge package
  // reading "no saved data" after its register was imported would be telling a lie.
  const savedRows = (persistence?.progressCount || 0) + (persistence?.bridgeItemCount || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createProject(name.trim());
      setName('');
      setCreating(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--surface-1)]/90 backdrop-blur-md">
      {/* Three groups that give way in a deliberate order: the status readout goes first,
          then the identity group truncates, and the session controls never move. "Sign out"
          dropping onto a second line is what made the bar look broken — and it is also the
          one control that must always be exactly where it was. */}
      <div className="flex flex-nowrap items-center gap-2.5 h-14 px-6 lg:px-8">

        {/* ---- what you are looking at ---- */}
        <div className="flex items-center gap-2.5 min-w-0">
          <FolderOpen className="h-4 w-4 text-[var(--accent)] shrink-0" />

          <select
            value={activeProject?.code || ''}
            onChange={(e) => selectProject(e.target.value)}
            aria-label="Active project"
            className="ui-select w-auto min-w-[8rem] max-w-[14rem] py-1.5 text-xs font-bold shrink"
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          </select>

          {activeProject?.role && (
            <span className="ui-chip shrink-0 hidden sm:inline-flex" data-tone={ROLE_TONE[activeProject.role]}>
              {activeProject.role === 'Viewer' && <Eye className="h-3 w-3" />}
              {activeProject.role}
            </span>
          )}

          {/* Packages.
              The map always draws every package in the project; this picks the one that
              imports, model uploads and raised RFIs are written into. */}
          {activeProject && (
            <div className="flex items-center gap-1.5 pl-2.5 border-l border-[var(--line)] min-w-0">
              <Boxes className="h-4 w-4 text-[var(--accent)] shrink-0" />

              <select
                value={activePackage?.id ?? ''}
                onChange={(e) => selectPackage(Number(e.target.value))}
                aria-label="Active package"
                className="ui-select w-auto min-w-[8rem] max-w-[13rem] py-1.5 text-xs font-bold shrink"
              >
                {packages.length === 0 && <option value="">No packages yet</option>}
                {packages.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.code} · {k.name}
                  </option>
                ))}
              </select>

              {packages.length > 1 && (
                <span
                  className="ui-chip shrink-0 hidden lg:inline-flex"
                  title="Every package in this project is drawn on the same map."
                >
                  {packages.length} on map
                </span>
              )}

              {activePackage && isEmpty(activePackage) && (
                <span
                  className="ui-chip shrink-0"
                  data-tone="active"
                  title="Import its workbooks and upload a model to put this package on the map."
                >
                  empty
                </span>
              )}

              {canEdit && activePackage && (
                <button
                  onClick={() => setPackageDialog(activePackage)}
                  className="ui-btn ui-btn-ghost py-1.5 !px-1.5 shrink-0"
                  title={'Edit ' + activePackage.code}
                  aria-label={'Edit package ' + activePackage.code}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}

              {canEdit && (
                <button
                  onClick={() => setPackageDialog('new')}
                  className="ui-btn py-1.5 text-xs shrink-0"
                  title="Add a package to this project"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Add package</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ---- what is actually loaded right now ----
            Hidden on narrow viewports rather than allowed to push the session controls off
            the row: it is a readout, and the sidebar carries the same figures. */}
        <div className="hidden xl:flex items-center gap-2 min-w-0 pl-2.5 border-l border-[var(--line)]">
          {isTracker ? (
            <>
              {tracker.status === 'loading' && !t && (
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> reading tracker…
                </span>
              )}
              {t?.ipc?.bill && (
                <span className="ui-chip shrink-0" data-tone="ok" title={t.ipc.period || ''}>
                  <FileSpreadsheet className="h-3 w-3" /> {t.ipc.bill}
                </span>
              )}
              {t?.counts && (
                <span className="ui-chip shrink-0" data-tone={t.counts.notRaised ? 'late' : 'ok'} title="RFIs the sequence rules say must exist, but do not">
                  <ShieldAlert className="h-3 w-3" /> {t.counts.notRaised} not raised
                </span>
              )}
              {t?.issues?.bySev.High > 0 && (
                <span className="ui-chip shrink-0" data-tone="active" title="High-severity data issues in the IPC">
                  <AlertTriangle className="h-3 w-3" /> {t.issues.bySev.High} high
                </span>
              )}
              {t?.files.ifc && (
                <span className="text-[11px] font-mono text-[var(--text-faint)] truncate max-w-[10rem]">{t.files.ifc.name}</span>
              )}
              {tracker.status === 'error' && !t && (
                <span className="text-[11px] text-[var(--late)] truncate max-w-[14rem]">{tracker.error}</span>
              )}
            </>
          ) : (
            <>
            {persistence?.status === 'loading' && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> loading project…
              </span>
            )}
            {persistence?.status === 'loaded' && savedRows > 0 && (
              <>
                <span className="ui-chip shrink-0" data-tone="ok">
                  <Database className="h-3 w-3" /> {savedRows} rows
                </span>
                {bound && (
                  <span className="ui-chip shrink-0" data-tone="violet">
                    <Link2 className="h-3 w-3" /> {bound.covered}/{bound.elements} bound
                  </span>
                )}
                {persistence.modelName && (
                  <span className="text-[11px] font-mono text-[var(--text-faint)] truncate max-w-[10rem]">
                    {persistence.modelName}
                  </span>
                )}
              </>
            )}
            {persistence?.status === 'loaded' && savedRows === 0 && (
              <span className="text-[11px] text-[var(--text-faint)] whitespace-nowrap">
                no saved data — import a workbook
              </span>
            )}
            {persistence?.error && (
              <span className="text-[11px] text-[var(--late)] truncate max-w-[14rem]">{persistence.error}</span>
            )}
            </>
          )}
          {activePackage?.contractorName && (
            <span
              className="text-[11px] text-[var(--text-faint)] truncate max-w-[10rem]"
              title="Contractor for the selected package"
            >
              {activePackage.contractorName}
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0" />

        {/* ---- session ---- */}
        <div className="flex items-center gap-2 shrink-0 pl-2.5 border-l border-[var(--line)]">
          {creating ? (
            <form onSubmit={submit} className="flex items-center gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New project name"
                className="ui-input w-44 py-1.5 text-xs"
              />
              <button type="submit" disabled={busy} className="ui-btn ui-btn-primary py-1.5 text-xs">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setError(null); }}
                className="ui-btn ui-btn-ghost py-1.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {error && <span className="text-[11px] text-[var(--late)] truncate max-w-[12rem]">{error}</span>}
            </form>
          ) : (
            <button onClick={() => setCreating(true)} className="ui-btn py-1.5 text-xs" title="Create a new project">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden md:inline">New project</span>
            </button>
          )}

          <span
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] max-w-[9rem]"
            title={user?.email}
          >
            {user?.isSystemAdmin && (
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--violet)] shrink-0" aria-label="System administrator" />
            )}
            <span className="truncate">{user?.displayName || user?.email}</span>
          </span>

          {/* Signing out is meaningless while the server authenticates every request itself
              — it would clear a token nobody is using and show a sign-in screen that cannot
              be got past. The button is replaced by the reason it is missing, which also
              keeps "this is open to anyone with the link" on screen rather than in a log
              nobody is reading. */}
          {authDisabled ? (
            <span
              className="ui-chip shrink-0"
              data-tone="late"
              title={
                'Sign-in is switched off on the server. Everyone who opens this link acts as '
                + `${user?.displayName || 'the shared account'}, with full access to every `
                + 'project and package. Restore it by setting Auth:Disabled back to false '
                + 'in Backend/appsettings.Development.json and restarting.'
              }
            >
              <ShieldAlert className="h-3 w-3" />
              <span className="hidden sm:inline">Sign-in off</span>
            </span>
          ) : (
            <button onClick={signOut} className="ui-btn ui-btn-ghost py-1.5 text-xs" title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </div>

    </header>

    {/* Deliberately a sibling of the header, not a child. `backdrop-filter` makes an
        element a containing block for fixed-position descendants, so a dialog rendered
        inside this header would resolve `inset: 0` against a 56px strip instead of the
        viewport — a full-screen modal squashed into the top bar. */}
    <PackageDialog
      open={packageDialog !== null}
      editing={packageDialog === 'new' ? null : packageDialog}
      onClose={() => setPackageDialog(null)}
    />
    </>
  );
}
