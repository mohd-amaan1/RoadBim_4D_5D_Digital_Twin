import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, Loader2, AlertTriangle, RotateCcw, CheckCircle2, MapPin, Info,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { station } from './rfiVocabulary';

/**
 * Raise an RFI — offer completed work for inspection before it is covered up.
 *
 * Two things shape this form:
 *
 *   * **Chainage is a dropdown, never a number box.** Chainages are fixed by the model and
 *     the workbook; the app partitions and colours them but cannot invent one. A typed
 *     value could land between two partitions, where nothing can be tinted and no
 *     inspection could ever be placed.
 *   * **Almost everything else is optional.** A field engineer is given a complete stretch
 *     of chainage, not a priced line item.
 *
 * The BOQ fields are deliberately inert. There is no bill of quantities in this system, and
 * they carry free text only so the shape of a priced RFI is visible to the team and a real
 * bill can be wired in later. The PAVEMENT LAYER is the separate field that actually
 * decides what changes colour — conflating the two would make a commercial reference drive
 * a physical drawing.
 */

const EMPTY = {
  title: '',
  description: '',
  chainageFromId: '',
  chainageToId: '',
  layerId: '',
  componentRef: '',
  subComponentRef: '',
  quantity: '',
  locationText: '',
  side: 'na',
  requiredInspectionAt: '',
  assignedToUserId: '',
};

const SIDES = [
  { value: 'na', label: 'Not applicable' },
  { value: 'LHS', label: 'Left-hand side' },
  { value: 'RHS', label: 'Right-hand side' },
  { value: 'both', label: 'Both sides' },
];

export default function RaiseRfiForm({ onRaised }) {
  const { activeProject, activePackage, canEdit } = useAuth();

  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState(EMPTY);
  const [busy, setBusy] = useState(null); // 'draft' | 'submit'
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Options belong to a package, so switching package must not leave the previous
  // package's chainages selectable.
  useEffect(() => {
    if (!activePackage?.id) { setOptions(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFields(EMPTY);
    setDone(null);

    api.getRfiFormOptions(activePackage.id)
      .then((o) => { if (!cancelled) setOptions(o); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [activePackage?.id]);

  const chainages = options?.chainages || [];

  // A range needs both ends, and the "to" list only offers partitions at or after the
  // "from" — an inverted range is a data-entry slip the form should not allow at all.
  const toOptions = useMemo(() => {
    if (!fields.chainageFromId) return chainages;
    const from = chainages.find((c) => String(c.id) === String(fields.chainageFromId));
    if (!from) return chainages;
    return chainages.filter((c) => c.startM >= from.startM);
  }, [chainages, fields.chainageFromId]);

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  /** Picking a start defaults the end to the same partition — the common case is one. */
  const setFrom = (e) => {
    const value = e.target.value;
    setFields((f) => {
      const from = chainages.find((c) => String(c.id) === String(value));
      const currentTo = chainages.find((c) => String(c.id) === String(f.chainageToId));
      const keepTo = from && currentTo && currentTo.startM >= from.startM;
      return { ...f, chainageFromId: value, chainageToId: keepTo ? f.chainageToId : value };
    });
  };

  const selectedFrom = chainages.find((c) => String(c.id) === String(fields.chainageFromId));
  const selectedTo = chainages.find((c) => String(c.id) === String(fields.chainageToId));

  const submit = useCallback(async (submitNow) => {
    if (busy) return;
    setError(null);

    if (!fields.title.trim()) return setError('Describe the work being offered.');
    if (!fields.chainageFromId || !fields.chainageToId)
      return setError('Choose the chainage range this request covers.');

    // A negative id is an IFC segment with no chainage row behind it. Storing one would
    // point the RFI at something that does not exist in the database.
    if (Number(fields.chainageFromId) < 0 || Number(fields.chainageToId) < 0) {
      return setError(
        'These chainages come from the model geometry, not an imported workbook. '
        + 'Import Road_chainage.xlsx for this package before raising RFIs against it.',
      );
    }

    const payload = {
      title: fields.title.trim(),
      description: fields.description.trim() || null,
      chainageFromId: Number(fields.chainageFromId),
      chainageToId: Number(fields.chainageToId),
      layerId: fields.layerId ? Number(fields.layerId) : null,
      componentRef: fields.componentRef.trim() || null,
      subComponentRef: fields.subComponentRef.trim() || null,
      quantity: fields.quantity === '' ? null : Number(fields.quantity),
      locationText: fields.locationText.trim() || null,
      side: fields.side,
      requiredInspectionAt: fields.requiredInspectionAt
        ? new Date(fields.requiredInspectionAt).toISOString()
        : null,
      assignedToUserId: fields.assignedToUserId ? Number(fields.assignedToUserId) : null,
      submitNow,
    };

    setBusy(submitNow ? 'submit' : 'draft');
    try {
      const result = await api.raiseRfi(activePackage.id, payload);
      setDone(result);
      setFields(EMPTY);
      // The preview number is now stale — the one just minted consumed it.
      api.getRfiFormOptions(activePackage.id).then(setOptions).catch(() => {});
      onRaised?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [busy, fields, activePackage, onRaised]);

  /* ------------------------------------------------------------------ guards */

  if (!activeProject) return <Shell><Note>Select a project first.</Note></Shell>;
  if (!activePackage?.id) {
    return (
      <Shell>
        <Note>
          This project has no package yet. An RFI is raised against a package — add one from
          the bar above.
        </Note>
      </Shell>
    );
  }
  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading this package's chainages…
        </div>
      </Shell>
    );
  }
  if (!canEdit) {
    return <Shell><Note>You have Viewer access to {activeProject.name}, so you cannot raise requests.</Note></Shell>;
  }
  if (options && chainages.length === 0) {
    return (
      <Shell>
        <Note>
          {options.packageCode} has no chainages. Import its Road_chainage workbook — an RFI
          has to name a chainage that exists, so there is nothing to offer until then.
        </Note>
      </Shell>
    );
  }

  const segmentsOnly = chainages.length > 0 && chainages.every((c) => c.source === 'ifc');

  return (
    <Shell>
      <div className="space-y-5">
        {/* ---- context strip: what this request will belong to ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ReadOnly label="Project" value={activeProject.name} />
          <ReadOnly label="Package" value={`${options?.packageCode} · ${options?.packageName}`} />
          <ReadOnly label="Contractor" value={options?.contractorName || '—'} />
          <ReadOnly label="RFI number" value={options?.nextRfiNo || '—'} mono
            hint="Generated on submit" />
        </div>

        {segmentsOnly && (
          <p className="flex items-start gap-2 text-xs text-[var(--active)]">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            These chainages were recovered from the model geometry, not an imported workbook.
            Import Road_chainage.xlsx for this package before raising RFIs against it.
          </p>
        )}

        {/* ---- the work ---- */}
        <Field label="Work description" required>
          <input
            value={fields.title}
            onChange={set('title')}
            placeholder="Subgrade preparation, km 7+200 – 7+800"
            className="ui-input"
          />
        </Field>

        {/* The pavement layer. This is the field that decides what changes colour. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Pavement layer"
            hint="Leave as the whole cross-section to offer every layer at these chainages."
          >
            <select value={fields.layerId} onChange={set('layerId')} className="ui-select">
              <option value="">Whole cross-section — all layers</option>
              {(options?.layers || []).map((l) => (
                <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Quantity" hint="Optional. In metres.">
            <input
              type="number"
              value={fields.quantity}
              onChange={set('quantity')}
              placeholder="—"
              className="ui-input"
            />
          </Field>
        </div>

        {/* ---- BOQ, not wired to anything ---- */}
        <fieldset className="rounded-lg border border-dashed border-[var(--line-strong)] p-4 space-y-3">
          <legend className="px-2 flex items-center gap-2">
            <span className="ui-label">Bill of quantities</span>
            <span className="ui-chip">not connected</span>
          </legend>
          <p className="text-[11px] text-[var(--text-muted)] -mt-1">
            There is no BOQ in this system yet. These are free text, so the shape of a priced
            RFI is visible and a real bill can be wired in later without changing the record.
            They do not affect the map.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Component (bill item)" hint="Optional.">
              <input
                value={fields.componentRef}
                onChange={set('componentRef')}
                placeholder="e.g. 8 · Burgatai River Bridge"
                className="ui-input"
              />
            </Field>

            <Field label="Sub-component (bill sub-item)" hint="Optional.">
              <input
                value={fields.subComponentRef}
                onChange={set('subComponentRef')}
                placeholder="e.g. 8.07 · Waterproof coating"
                className="ui-input"
              />
            </Field>
          </div>
        </fieldset>

        {/* ---- where: the fixed partitions ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Chainage from" required>
            <select value={fields.chainageFromId} onChange={setFrom} className="ui-select">
              <option value="">Choose a chainage…</option>
              {chainages.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}{c.sectionName ? ` · ${c.sectionName}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Chainage to" required hint="Same as from, unless the work spans several.">
            <select value={fields.chainageToId} onChange={set('chainageToId')} className="ui-select">
              <option value="">Choose a chainage…</option>
              {toOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}{c.sectionName ? ` · ${c.sectionName}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {selectedFrom && selectedTo && (
          <p className="flex items-center gap-2 text-xs text-[var(--text-muted)] font-mono">
            <MapPin className="h-3.5 w-3.5 text-[var(--accent)]" />
            km {station(selectedFrom.startM)} – {station(selectedTo.endM)}
            <span className="text-[var(--text-faint)]">
              · {Math.round(selectedTo.endM - selectedFrom.startM)} m
            </span>
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Location" hint="Optional landmark.">
            <input
              value={fields.locationText}
              onChange={set('locationText')}
              placeholder="Near the Myangad turnoff"
              className="ui-input"
            />
          </Field>

          <Field label="Side">
            <select value={fields.side} onChange={set('side')} className="ui-select">
              {SIDES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>

          <Field
            label="Inspection date requested"
            hint={`Optional. Otherwise due ${options?.inspectionNoticeHours ?? 24} h after raising.`}
          >
            <input
              type="datetime-local"
              value={fields.requiredInspectionAt}
              onChange={set('requiredInspectionAt')}
              className="ui-input"
            />
          </Field>
        </div>

        <Field
          label="Assign field engineer"
          hint="Optional. Only field engineers are listed — they are the only people who can inspect."
        >
          <select value={fields.assignedToUserId} onChange={set('assignedToUserId')} className="ui-select sm:max-w-md">
            <option value="">Nobody yet</option>
            {(options?.engineers || []).map((e) => (
              <option key={e.userId} value={e.userId}>
                {e.displayName} · {e.role}
                {e.openAssignedCount > 0 ? ` (${e.openAssignedCount} open)` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Notes" hint="Optional.">
          <textarea
            value={fields.description}
            onChange={set('description')}
            rows={2}
            className="ui-input resize-y"
            placeholder="Anything the inspecting engineer should know before attending."
          />
        </Field>

        {error && (
          <p className="flex items-start gap-2 text-xs font-semibold text-[var(--late)]" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            {error}
          </p>
        )}

        {done && (
          <p className="flex items-start gap-2 text-xs font-semibold text-[var(--ok)]">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" />
            {done.status === 'draft'
              ? 'Saved as a draft. It keeps no number until you raise it.'
              : `Raised as ${done.rfiNo}.`}
          </p>
        )}

        {/* ---- actions ---- */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--line)]">
          <span className="text-[11px] text-[var(--text-muted)] mr-auto">
            A draft can be edited; once raised it cannot.
          </span>
          <button
            type="button"
            onClick={() => { setFields(EMPTY); setError(null); setDone(null); }}
            className="ui-btn ui-btn-ghost py-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => submit(false)}
            className="ui-btn py-1.5 text-xs"
          >
            {busy === 'draft' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save as draft
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => submit(true)}
            className="ui-btn ui-btn-primary py-1.5 text-xs"
          >
            {busy === 'submit'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <CheckCircle2 className="h-3.5 w-3.5" />}
            Raise and submit
          </button>
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ chrome */

function Shell({ children }) {
  return (
    <div className="space-y-4 animate-slide-up">
      <div className="glass-panel p-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-[Outfit]">Raise RFI</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Offer completed work for inspection before it is covered up.
            </p>
          </div>
        </div>
      </div>
      <div className="glass-panel p-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="ui-label">
        {label}{required && <span className="text-[var(--late)]"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-[var(--text-faint)]">{hint}</span>}
    </label>
  );
}

function ReadOnly({ label, value, hint, mono }) {
  return (
    <div className="space-y-1.5">
      <span className="ui-label">{label}</span>
      <div className={`ui-input bg-[var(--surface-2)] text-[var(--text-muted)] truncate ${mono ? 'font-mono' : ''}`}
        title={value}>
        {value}
      </div>
      {hint && <span className="block text-[11px] text-[var(--text-faint)]">{hint}</span>}
    </div>
  );
}

function Note({ children }) {
  return (
    <p className="flex items-start gap-2 text-sm text-[var(--text-muted)] p-6">
      <Info className="h-4 w-4 shrink-0 mt-0.5 text-[var(--accent)]" />
      <span>{children}</span>
    </p>
  );
}
