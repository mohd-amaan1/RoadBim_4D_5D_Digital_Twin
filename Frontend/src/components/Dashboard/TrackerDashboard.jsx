import React from 'react';
import {
  Construction, CheckCircle2, AlertTriangle, ShieldAlert, Boxes, Loader2, ArrowRight,
  FileSpreadsheet, Box, Map as MapIcon, Database,
} from 'lucide-react';
import { useRoadData } from '../../context/RoadDataContext';
import { useTrackerSummary } from '../../modules/bridgeTracker/useTrackerSummary';
import { KpiCard } from './ExecutiveKPICards';

/**
 * The dashboard of a Palashbari tracker package.
 *
 * Every figure is the tracker's own — the same counts its legend shows, the same issues,
 * the same sums its acceptance tests check — so the two screens can never disagree. None
 * of it is a percentage complete: the register lists what has been built, not the full
 * scope in quantities, so the honest measures are counts against known totals (1,116
 * segments, 25 piers) and metres actually billed.
 */

const nf = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-IN'));
const when = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export default function TrackerDashboard() {
  const { activePackage, setActiveTab } = useRoadData();
  const { summary: s, status, error } = useTrackerSummary(activePackage?.id, true);
  const openTracker = () => setActiveTab('BRIDGE_TRACKER');

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="glass-panel p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-chip" data-tone="accent"><Construction className="h-3 w-3" /> RFI tracker</span>
            {s?.ipc?.bill && <span className="ui-chip" data-tone="ok">{s.ipc.bill}</span>}
            {s?.ipc?.period && <span className="text-xs text-[var(--text-muted)] font-semibold">{s.ipc.period}</span>}
          </div>
          <h2 className="text-2xl lg:text-3xl font-extrabold text-white font-[Outfit] mt-2">
            Palashbari–Sualkuchi Extradosed Bridge
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            What Schedule 4 says has been built, checked against the order the work must happen in.
          </p>
        </div>
        <button onClick={openTracker} className="ui-btn ui-btn-primary">
          Open the tracker <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {status === 'loading' && !s && (
        <div className="glass-panel p-6 flex items-center gap-3 text-sm text-[var(--text-muted)] font-semibold">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
          Reading the model, the register and the latest IPC…
        </div>
      )}
      {status === 'error' && !s && (
        <div className="glass-panel p-6 text-sm text-[var(--late)]">{error}</div>
      )}

      {s && !s.ipc && (
        <div className="glass-panel p-6 text-sm text-[var(--text-muted)]">
          No IPC workbook has been uploaded yet, so there is nothing to report. Upload the
          model, the register and the monthly IPC in the tracker.
        </div>
      )}

      {s?.numbering?.assumed && (
        <div className="glass-panel p-4 flex items-start gap-3 border border-[rgba(251,191,74,.3)]">
          <AlertTriangle className="h-5 w-5 text-[var(--active)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--text)]">
            The model is drawn as <b>P{s.numbering.piers[0]}–P{s.numbering.piers[1]}</b>, an assumption: the
            register numbers it P{s.numbering.register[0]}–P{s.numbering.register[1]}, past the end of the
            bridge. The figures below depend on it. Confirm which piers the IFC covers in the tracker's Settings.
          </p>
        </div>
      )}

      {s?.counts && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <KpiCard
              label="Built in the model"
              icon={CheckCircle2}
              accent="emerald"
              value={nf(s.counts.built)}
              unit="keys"
              footer={`${nf(s.counts.yard)} cast in yard · ${nf(s.counts.notYet)} not yet · of ${nf(s.model?.keys)} keyed`}
            />
            <KpiCard
              label="RFI not raised"
              icon={ShieldAlert}
              accent="slate"
              value={nf(s.counts.notRaised)}
              badge={s.counts.notRaised ? 'Must exist' : 'None'}
              badgeTone={s.counts.notRaised
                ? 'bg-red-500/15 text-red-300 border-red-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'}
              footer="Later work is billed, so these must exist — but they have no RFI"
            />
            <KpiCard
              label="Data issues"
              icon={AlertTriangle}
              accent="slate"
              value={nf(s.issues.total)}
              badge={`${s.issues.bySev.High} High`}
              badgeTone={s.issues.bySev.High
                ? 'bg-red-500/15 text-red-300 border-red-500/30'
                : 'bg-slate-700/40 text-slate-300 border-slate-600/50'}
              footer={`${s.issues.bySev.Medium} Medium · ${s.issues.bySev.Low} Low · ${s.issues.bySev.Info} Info · ${nf(s.counts.issue)} model keys outlined`}
            />
            <KpiCard
              label="Segments cast"
              icon={Boxes}
              accent="cyan"
              value={nf(s.progress.segments.cast)}
              unit={`/ ${nf(s.progress.segments.total)}`}
              footer={`${nf(s.progress.segments.erected)} erected · ${nf(s.progress.segments.stressed)} stressed · ${nf(s.progress.segments.deck)} deck complete`}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section className="glass-panel p-5 space-y-4 xl:col-span-2">
              <h3 className="ui-label">Model, as the tracker colours it</h3>
              <StateBar counts={s.counts} />
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Fact label="Well lifts cast & sunk" value={nf(s.progress.wells.lifts)} detail={`${nf(s.progress.wells.steiningM)} m net steining`} />
                <Fact label="Bottom plugs · well caps" value={`${s.progress.wells.plugs} · ${s.progress.wells.caps}`} detail="of 25 piers" />
                <Fact label="Lower pylon" value={`${nf(s.progress.lowerPylonM)} m`} detail={`${s.progress.pierTables} pier tables`} />
                <Fact label="RFIs with no model element" value={nf(s.counts.noModel)} detail="listed in the tracker's Issues" />
              </dl>
            </section>

            <section className="glass-panel p-5 space-y-3">
              <h3 className="ui-label">RFI not raised</h3>
              {s.notRaised.length === 0 && <p className="text-sm text-[var(--text-muted)]">None — every element the sequence rules require has its RFI.</p>}
              <ul className="space-y-2.5">
                {s.notRaised.slice(0, 8).map((r) => (
                  <li key={r.key} className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--line)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-[var(--late)]">{r.key}</span>
                      <span className="text-[10px] font-mono text-[var(--text-faint)]">{r.rule}{r.modelled ? '' : ' · not modelled'}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{r.why}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="glass-panel p-5">
            <h3 className="ui-label mb-3">What the figures are read from</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <Source icon={Box} label="IFC model" file={s.files.ifc} detail={s.model ? `${nf(s.model.elements)} elements · modules ${s.model.modelled.join(', ') || '—'}` : null} />
              <Source icon={Database} label="Mapping register" file={s.files.register} detail={s.model ? `${nf(s.model.noKey)} drawn elements without a key` : null} />
              <Source icon={FileSpreadsheet} label="Monthly IPC" file={s.files.ipc} detail={s.ipc ? `${nf(s.ipc.rows)} Schedule 4 rows · ${s.ipc.unlinked} unlinked · ${s.files.ipcCount} uploaded` : null} />
              <Source icon={MapIcon} label="Alignment" file={s.files.alignment} detail={s.model ? `drawing modules ${s.model.modules.join(', ')}` : null} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const STATE_BAR = [
  ['built', 'Built', 'var(--idle)'],
  ['yard', 'Cast in yard', 'var(--active)'],
  ['notYet', 'Not yet', 'var(--violet)'],
  ['notRaised', 'RFI not raised', 'var(--late)'],
  ['reversed', 'Reversed', '#7A2323'],
];

function StateBar({ counts }) {
  const total = STATE_BAR.reduce((s, [k]) => s + (counts[k] || 0), 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surface-3)]">
        {STATE_BAR.map(([k, , c]) => (counts[k] ? <div key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: c }} title={`${counts[k]}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {STATE_BAR.map(([k, label, c]) => (
          <span key={k} className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            {label} <b className="text-[var(--text)] font-mono">{(counts[k] || 0).toLocaleString('en-IN')}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value, detail }) {
  return (
    <div>
      <dt className="text-[11px] text-[var(--text-faint)] font-semibold">{label}</dt>
      <dd className="text-xl font-extrabold text-white font-[Outfit] mt-0.5">{value}</dd>
      {detail && <dd className="text-[11px] text-[var(--text-muted)]">{detail}</dd>}
    </div>
  );
}

function Source({ icon: Icon, label, file, detail }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--line)] p-3 min-w-0">
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-faint)] font-semibold">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-sm font-bold text-[var(--text)] truncate mt-1">{file?.name || 'Not uploaded'}</div>
      {(file?.at || file?.by) && (
        <div className="text-[11px] text-[var(--text-muted)]">{when(file.at)}{file.by ? ` · ${file.by}` : ''}</div>
      )}
      {detail && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{detail}</div>}
    </div>
  );
}
