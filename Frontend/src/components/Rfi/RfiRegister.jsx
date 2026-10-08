import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Loader2, ArrowRight, UserPlus, Layers, Factory, MapPin, Ruler,
  Boxes, ScanEye, AlertTriangle, ClipboardList,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  STAGE_LABEL, STAGE_STYLE, formatDateTime, ago,
} from './rfiVocabulary';

/**
 * The RFI register.
 *
 * Project-scoped rather than package-scoped: a resident engineer works across every
 * package on the job, so splitting the list by contract would mean checking three screens
 * to answer "what is waiting on me".
 *
 * The status chip is rendered exactly as the server composed it. Rebuilding it here is how
 * the register and the detail screen end up disagreeing about the same record.
 */

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My inspections' },
  { key: 'raised', label: 'Raised by me' },
  { key: 'overdue', label: 'Overdue' },
];

export default function RfiRegister({ onOpen }) {
  const { activeProject, packages, canEdit } = useAuth();

  const [tab, setTab] = useState('all');
  const [packageId, setPackageId] = useState('');
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assigning, setAssigning] = useState(null); // rfi id
  const [engineers, setEngineers] = useState([]);

  // Typing must not fire a request per keystroke
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const query = useMemo(() => ({
    packageId: packageId || undefined,
    stage: stage || undefined,
    search: debounced || undefined,
    assignedToMe: tab === 'mine',
    raisedByMe: tab === 'raised',
    overdueOnly: tab === 'overdue',
    pageSize: 50,
  }), [packageId, stage, debounced, tab]);

  const load = useCallback(async () => {
    if (!activeProject) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      setData(await api.listRfis(activeProject.code, query));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeProject, query]);

  useEffect(() => { load(); }, [load]);

  // The engineer picker is the same list the raise form uses; loaded once per package set
  useEffect(() => {
    const first = packages?.[0];
    if (!first?.id) { setEngineers([]); return; }
    let cancelled = false;
    api.getRfiFormOptions(first.id)
      .then((o) => { if (!cancelled) setEngineers(o.engineers || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [packages]);

  const assign = async (rfiId, userId) => {
    try {
      await api.assignRfi(rfiId, userId === '' ? null : Number(userId));
      setAssigning(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!activeProject) {
    return <Panel><Empty>Select a project to see its inspection requests.</Empty></Panel>;
  }

  const items = data?.items || [];

  return (
    <div className="space-y-4 animate-slide-up">
      {/* ---- filters ---- */}
      <div className="glass-panel p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1.5">
            <span className="ui-label">Package</span>
            <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="ui-select">
              <option value="">All packages</option>
              {(packages || []).map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Status</span>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="ui-select">
              <option value="">Any status</option>
              {Object.entries(STAGE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 sm:col-span-2">
            <span className="ui-label">Search</span>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Number, title, BOQ reference or location…"
                className="ui-input pl-9"
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`ui-btn py-1.5 text-xs ${tab === t.key ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">
            {loading
              ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> loading…</span>
              : `${data?.total ?? 0} request${(data?.total ?? 0) === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {error && (
        <p className="glass-panel p-3 flex items-start gap-2 text-xs font-semibold text-[var(--late)]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" /> {error}
        </p>
      )}

      {/* ---- cards ---- */}
      {!loading && items.length === 0 && (
        <Panel>
          <Empty>
            No requests match. {canEdit && 'Raise one from the Raise RFI tab.'}
          </Empty>
        </Panel>
      )}

      <div className="space-y-3">
        {items.map((card) => (
          <RfiCard
            key={card.id}
            card={card}
            engineers={engineers}
            canEdit={canEdit}
            assigning={assigning === card.id}
            onAssignOpen={() => setAssigning(assigning === card.id ? null : card.id)}
            onAssign={(userId) => assign(card.id, userId)}
            onOpen={() => onOpen?.(card.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- card */

function RfiCard({ card, engineers, canEdit, assigning, onAssignOpen, onAssign, onOpen }) {
  const style = STAGE_STYLE[card.stageKey] || {};

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex">
        {/* A stripe in the stage's own colour — the same hex the chainage takes on the map */}
        <span className="w-1 shrink-0" style={{ background: style.dot }} aria-hidden="true" />

        <div className="flex-1 min-w-0 p-4 space-y-3">
          {/* header row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-1 rounded-md bg-[var(--surface-3)] border border-[var(--line-strong)]">
              {card.rfiNo}
            </span>
            <span className="ui-chip" data-tone={style.tone}>{card.statusLabel}</span>
            {card.assignedToName
              ? <span className="ui-chip"><ScanEye className="h-3 w-3" /> {card.assignedToName}</span>
              : <span className="ui-chip" data-tone="active">Unassigned</span>}

            <div className="ml-auto flex items-center gap-2">
              {canEdit && (
                <button onClick={onAssignOpen} className="ui-btn ui-btn-ghost py-1.5 text-xs">
                  <UserPlus className="h-3.5 w-3.5" /> {card.assignedToName ? 'Reassign' : 'Assign'}
                </button>
              )}
              <button onClick={onOpen} className="ui-btn ui-btn-primary py-1.5 text-xs">
                View detail <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <h3 className="text-sm font-bold text-[var(--text)]">{card.title}</h3>

          {/* facts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2.5">
            <Fact icon={Boxes} label="Package" value={`${card.packageCode} · ${card.packageName}`} />
            <Fact icon={Factory} label="Contractor" value={card.contractorName || '—'} />
            <Fact icon={MapPin} label="Location" value={card.locationText || '—'} />
            <Fact icon={Ruler} label="Quantity"
              value={card.quantity === null || card.quantity === undefined ? '—' : `${card.quantity} m`} />
            <Fact icon={Layers} label="Layer"
              value={card.layerCode ? `${card.layerCode}${card.layerName ? ` · ${card.layerName}` : ''}` : 'Whole cross-section'} />
            <Fact icon={ClipboardList} label="BOQ ref"
              value={[card.componentRef, card.subComponentRef].filter(Boolean).join(' / ') || '—'} />
            <Fact icon={MapPin} label="Chainage" value={card.chainageLabel} mono />
            <Fact icon={ScanEye} label="Raised by" value={card.raisedByName || '—'} />
          </div>

          {/* the contractual clock */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-faint)] font-mono pt-1 border-t border-[var(--line)]">
            <span>raised {card.submittedAt ? formatDateTime(card.submittedAt) : '—'}</span>
            {card.dueAt && (
              <span className={card.isOverdue ? 'text-[var(--late)] font-bold' : ''}>
                due {formatDateTime(card.dueAt)}
                {card.isOverdue ? ` · ${ago(card.dueAt)}` : ''}
              </span>
            )}
            {card.inspectedAt && <span>inspected {formatDateTime(card.inspectedAt)}</span>}
          </div>

          {assigning && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--line)]">
              <span className="ui-label">Assign to field engineer</span>
              <select
                defaultValue={card.assignedToUserId ?? ''}
                onChange={(e) => onAssign(e.target.value)}
                className="ui-select w-auto min-w-[14rem] py-1.5 text-xs"
              >
                <option value="">Nobody — leave unassigned</option>
                {engineers.map((e) => (
                  <option key={e.userId} value={e.userId}>
                    {e.displayName} · {e.role}
                    {e.openAssignedCount > 0 ? ` (${e.openAssignedCount} open)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--text-faint)]" />
      <div className="min-w-0">
        <div className="ui-label">{label}</div>
        <div className={`text-xs text-[var(--text-muted)] truncate ${mono ? 'font-mono' : ''}`} title={value}>
          {value}
        </div>
      </div>
    </div>
  );
}

function Panel({ children }) {
  return <div className="glass-panel p-4">{children}</div>;
}

function Empty({ children }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[var(--text-muted)] p-6 justify-center">
      <ClipboardList className="h-4 w-4 text-[var(--accent)]" /> {children}
    </p>
  );
}
