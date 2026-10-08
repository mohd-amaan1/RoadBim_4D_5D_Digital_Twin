import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Loader2, X, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Create or edit a contract package.
 *
 * Contractor is asked here and nowhere else. A package is let to one contractor, so every
 * RFI raised against it inherits the name — asking again on each request would be data
 * entry that carries no extra information, and two spellings of the same firm.
 *
 * Chainage from/to is the package's stated extent. It is advisory: the chainage rows the
 * workbook imports are what the map actually draws, and they are allowed to disagree.
 */

const EMPTY = {
  name: '',
  code: '',
  contractorName: '',
  contractNo: '',
  description: '',
  chainageFromM: '',
  chainageToM: '',
  inspectionNoticeHours: 24,
};

/** Blank stays blank — an empty box is "not stated", not zero. */
const toNumberOrNull = (value) => {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

export default function PackageDialog({ open, onClose, editing = null }) {
  const { createPackage, updatePackage, activeProject } = useAuth();

  const [fields, setFields] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const firstFieldRef = useRef(null);

  // Reopening for a different package must not show the previous one's values
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFields(editing
      ? {
        name: editing.name || '',
        code: editing.code || '',
        contractorName: editing.contractorName || '',
        contractNo: editing.contractNo || '',
        description: editing.description || '',
        chainageFromM: editing.chainageFromM ?? '',
        chainageToM: editing.chainageToM ?? '',
        inspectionNoticeHours: editing.inspectionNoticeHours ?? 24,
      }
      : EMPTY);
    // Focus lands on the first field so the dialog is usable from the keyboard alone
    const id = requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const name = fields.name.trim();
    const contractor = fields.contractorName.trim();
    if (!name) return setError('Give the package a name.');
    if (!contractor) return setError('Name the contractor. Every RFI raised against this package takes its contractor from here.');

    const from = toNumberOrNull(fields.chainageFromM);
    const to = toNumberOrNull(fields.chainageToM);
    if (from !== null && to !== null && to < from)
      return setError('Chainage to is before chainage from.');

    const payload = {
      name,
      contractorName: contractor,
      contractNo: fields.contractNo.trim() || null,
      description: fields.description.trim() || null,
      chainageFromM: from,
      chainageToM: to,
      inspectionNoticeHours: toNumberOrNull(fields.inspectionNoticeHours) ?? 24,
    };
    // The code is minted from the name on create and never changes afterwards — it is what
    // the RFI number is built from, so a rename must not renumber existing requests.
    if (!editing) payload.code = fields.code.trim() || undefined;

    setBusy(true);
    setError(null);
    try {
      if (editing) await updatePackage(editing.id, payload);
      else await createPackage(payload);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ui-overlay flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit package' : 'Add package'}
        className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
      >
        <header className="flex items-start gap-3">
          <Boxes className="h-5 w-5 text-[var(--accent)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold font-[Outfit]">
              {editing ? `Edit ${editing.code}` : 'Add package'}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {editing
                ? 'The code cannot change — RFI numbers are built from it.'
                : `A contract package under ${activeProject?.name || 'this project'}. It carries its own chainages, layer catalogue, metrics and IFC model.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ui-btn ui-btn-ghost shrink-0 !px-2"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <span className="ui-label">Package name <span className="text-rose-400">*</span></span>
            <input
              ref={firstFieldRef}
              value={fields.name}
              onChange={set('name')}
              placeholder="Khovd – Ulaangom Road: Section 1"
              className="ui-input"
            />
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Code</span>
            <input
              value={editing ? editing.code : fields.code}
              onChange={set('code')}
              disabled={Boolean(editing)}
              placeholder="CW1-1 — from the name if left blank"
              className="ui-input disabled:opacity-60"
            />
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Contractor <span className="text-rose-400">*</span></span>
            <input
              value={fields.contractorName}
              onChange={set('contractorName')}
              placeholder="China Road and Bridge Corporation"
              className="ui-input"
            />
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Contract number</span>
            <input
              value={fields.contractNo}
              onChange={set('contractNo')}
              placeholder="Optional"
              className="ui-input"
            />
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Chainage from</span>
            <input
              type="number"
              value={fields.chainageFromM}
              onChange={set('chainageFromM')}
              placeholder="0"
              className="ui-input"
            />
            <span className="block text-[11px] text-[var(--text-muted)]">
              In metres. 7200 shows as km 7+200.
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Chainage to</span>
            <input
              type="number"
              value={fields.chainageToM}
              onChange={set('chainageToM')}
              placeholder="40000"
              className="ui-input"
            />
            <span className="block text-[11px] text-[var(--text-muted)]">
              Advisory. The imported chainage rows are what the map draws.
            </span>
          </label>

          <label className="space-y-1.5">
            <span className="ui-label">Inspection notice</span>
            <input
              type="number"
              min="1"
              value={fields.inspectionNoticeHours}
              onChange={set('inspectionNoticeHours')}
              className="ui-input"
            />
            <span className="block text-[11px] text-[var(--text-muted)]">
              Hours. An RFI is due this long after it is raised.
            </span>
          </label>

          <label className="space-y-1.5 sm:col-span-2">
            <span className="ui-label">Description</span>
            <textarea
              value={fields.description}
              onChange={set('description')}
              rows={2}
              placeholder="Optional"
              className="ui-input resize-y"
            />
          </label>
        </div>

        {error && (
          <p className="flex items-start gap-2 text-xs font-semibold text-rose-400" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="ui-btn">Cancel</button>
          <button type="submit" disabled={busy} className="ui-btn ui-btn-primary">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? 'Save changes' : 'Add package'}
          </button>
        </footer>
      </form>
    </div>
  );
}
