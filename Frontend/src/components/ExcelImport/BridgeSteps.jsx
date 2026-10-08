import React, { useMemo, useRef, useState } from 'react';
import {
  Upload, Loader2, X, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, AlertTriangle,
  Info, Database, FileSpreadsheet, Link2,
} from 'lucide-react';
import { LEVEL } from '../../utils/excelImport';
import { APPROVAL_LABEL, APPROVAL_STATUS } from '../../utils/bridgeImport';
import { STATUS_COLORS, UNBOUND_COLOR } from '../../utils/roadTextures';

/**
 * The bridge half of the import wizard: one register workbook, then a review of exactly
 * what it will colour.
 *
 * The review leads with the model, not the sheet. Thirty-odd rows is the register; the
 * handful that name a GUID are what anyone opening this wants to check, so they can be
 * filtered to directly, and every row says which element it lands on — or that it lands
 * on nothing, which is the mistake worth catching before it is saved.
 */

const APPROVAL_TONE = { approved: 'ok', rejected: 'late', pending: undefined };

/** The literal colour the element takes — the same hex the 3D tint and the map use. */
const swatch = (approval) => STATUS_COLORS[APPROVAL_STATUS[approval]] || UNBOUND_COLOR;

const LEVEL_STYLE = {
  [LEVEL.ERROR]: { icon: AlertCircle, colour: 'var(--late)', tone: 'late', label: 'error' },
  [LEVEL.WARNING]: { icon: AlertTriangle, colour: 'var(--active)', tone: 'active', label: 'warning' },
  [LEVEL.INFO]: { icon: Info, colour: 'var(--text-faint)', tone: undefined, label: 'note' },
};

const EXPECTED_COLUMNS = [
  'Item No.', 'Item Description', 'UoM', 'Location', 'Executed Quantity',
  'RFI No.', 'Date', 'Bill No.', 'Remarks', 'IFC GUID', 'Approval',
];

/* ------------------------------------------------------------------ workbook */

export function BridgeWorkbookStep({
  file, result, reading, dragging, onDragChange, onFile, onRemove, onBack, onNext, canReview,
}) {
  const inputRef = useRef(null);
  const counts = result?.counts;
  const errors = (result?.issues || []).filter((i) => i.level === LEVEL.ERROR);

  // One register per bridge. Dropping several takes the first rather than guessing which
  // of them was meant, and the chip below names the one that was read.
  const take = (list) => {
    const first = Array.from(list || [])[0];
    if (first) onFile(first);
  };

  return (
    <section className="glass-panel p-6 space-y-5 animate-slide-up">
      <div className="space-y-1">
        <h3 className="text-base font-extrabold font-[Outfit]">Add the bridge register</h3>
        <p className="text-xs text-[var(--text-muted)] max-w-2xl">
          A bridge needs one workbook. Each row is an activity — a lift, a segment, a cap — and a row
          that names an <span className="font-mono">IFC GUID</span> colours that element by its Approval:
          approved turns it green, rejected red. Rows with no GUID or no verdict are pending, and the
          model keeps its own look there.
        </p>
      </div>

      <label
        className="ui-drop"
        data-active={dragging}
        data-filled={Boolean(file)}
        onDragOver={(e) => { e.preventDefault(); onDragChange(true); }}
        onDragLeave={() => onDragChange(false)}
        onDrop={(e) => { e.preventDefault(); onDragChange(false); take(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
      >
        {reading
          ? <Loader2 className="h-9 w-9 text-[var(--accent)] animate-spin" />
          : <Upload className="h-9 w-9 text-[var(--accent)]" />}
        <span className="text-sm font-bold">
          {reading ? 'Reading the register…' : file ? 'Replace the register' : 'Drop the bridge register (.xlsx)'}
        </span>
        <span className="text-xs text-[var(--text-faint)]">One file · IFC GUID and Approval columns required</span>
      </label>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => { take(e.target.files); e.target.value = ''; }}
      />

      {file && (
        <div className="flex flex-wrap gap-2">
          <span className="ui-chip font-mono">
            <FileSpreadsheet className="h-3 w-3" />
            {file.name}
            {result?.sheetName && <span className="text-[var(--text-faint)]">· {result.sheetName}</span>}
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="text-[var(--text-faint)] hover:text-[var(--late)]"
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-1.5">
          {errors.map((e, i) => (
            <p key={i} className="flex items-start gap-2 text-xs font-semibold text-[var(--late)]" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> {e.message}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Count label="register rows" value={counts?.rows} />
        <Count label="name a model element" value={counts?.withGuid} colour="var(--accent)" />
        <Count label="approved · green" value={counts?.approved} colour={STATUS_COLORS.Completed} />
        <Count label="rejected · red" value={counts?.rejected} colour={STATUS_COLORS.Delayed} />
        <Count label="pending · unchanged" value={counts?.pending} />
      </div>

      <p className="text-[11px] text-[var(--text-faint)]">
        Columns read: {EXPECTED_COLUMNS.join(' · ')}. Only IFC GUID and Approval are required; the rest
        are kept as the record behind each colour. Headers are matched loosely, so spacing and case do not matter.
      </p>

      <div className="flex justify-between gap-2 pt-1">
        <button className="ui-btn ui-btn-ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Model
        </button>
        <button className="ui-btn ui-btn-primary" disabled={!canReview} onClick={onNext}>
          Review {counts?.rows ? `${counts.rows} rows` : ''} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- review */

export function BridgeReviewStep({
  result, preview, issues, canCommit, blockedReason, saving, saveError, packageCode,
  onBack, onCommit,
}) {
  const [filter, setFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState(null);

  const matchByGuid = useMemo(() => {
    const map = new Map();
    for (const m of preview?.matches || []) map.set(m.row.guid, m);
    return map;
  }, [preview]);

  const counts = result.counts;
  const colouring = preview?.report?.colouring || null;

  const levelCounts = {
    [LEVEL.ERROR]: issues.filter((i) => i.level === LEVEL.ERROR).length,
    [LEVEL.WARNING]: issues.filter((i) => i.level === LEVEL.WARNING).length,
    [LEVEL.INFO]: issues.filter((i) => i.level === LEVEL.INFO).length,
  };
  const visibleIssues = issues.filter((i) => !levelFilter || i.level === levelFilter);

  const filters = [
    { key: 'all', label: 'All', n: counts.rows },
    { key: 'linked', label: 'Named in model', n: counts.withGuid },
    { key: 'approved', label: 'Approved', n: counts.approved },
    { key: 'rejected', label: 'Rejected', n: counts.rejected },
    { key: 'pending', label: 'Pending', n: counts.pending },
  ];

  const rows = result.items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'linked') return Boolean(item.ifcGlobalId);
    return item.approval === filter;
  });

  return (
    <section className="space-y-5 animate-slide-up">
      {/* ---- verdict ---- */}
      <div className={`glass-panel p-5 flex items-start gap-3 border-l-2 ${
        canCommit ? 'border-l-[var(--ok)]' : 'border-l-[var(--late)]'
      }`}>
        {canCommit
          ? <CheckCircle2 className="h-5 w-5 text-[var(--ok)] shrink-0 mt-0.5" />
          : <AlertCircle className="h-5 w-5 text-[var(--late)] shrink-0 mt-0.5" />}
        <div className="text-sm space-y-1">
          <div className="font-bold">
            {levelCounts[LEVEL.ERROR] > 0
              ? `${levelCounts[LEVEL.ERROR]} error${levelCounts[LEVEL.ERROR] === 1 ? '' : 's'} must be fixed before anything is written.`
              : blockedReason || `${counts.rows} register rows, ready to import into ${packageCode}.`}
          </div>
          {canCommit && (
            <div className="text-xs text-[var(--text-muted)]">
              {colouring ? (
                <>
                  On the model:{' '}
                  <span style={{ color: STATUS_COLORS.Completed }} className="font-bold">{colouring.green} green</span>
                  {' · '}
                  <span style={{ color: STATUS_COLORS.Delayed }} className="font-bold">{colouring.red} red</span>
                  {colouring.pending > 0 && ` · ${colouring.pending} named but still pending`}
                  {` · the other ${colouring.untouched} element${colouring.untouched === 1 ? '' : 's'} keep their own look.`}
                </>
              ) : (
                'No model is loaded, so nothing is coloured yet. The GUIDs are saved and colour the model as soon as one is added.'
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- validation ---- */}
      {issues.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold mr-1">Validation</h3>
            {[LEVEL.ERROR, LEVEL.WARNING, LEVEL.INFO].map((level) => {
              const { icon: Icon, tone, label } = LEVEL_STYLE[level];
              const n = levelCounts[level];
              if (!n) return null;
              const active = levelFilter === level;
              return (
                <button
                  key={level}
                  onClick={() => setLevelFilter(active ? null : level)}
                  className="ui-chip"
                  data-tone={tone}
                  style={active ? { outline: '1px solid currentColor', outlineOffset: 1 } : undefined}
                >
                  <Icon className="h-3 w-3" /> {n} {label}{n === 1 ? '' : 's'}
                </button>
              );
            })}
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--line)] divide-y divide-[var(--line)] max-h-56 overflow-y-auto custom-scrollbar">
            {visibleIssues.map((issue, i) => {
              const { icon: Icon, colour } = LEVEL_STYLE[issue.level] || LEVEL_STYLE[LEVEL.INFO];
              return (
                <div key={`${issue.code}-${i}`} className="flex items-start gap-2.5 p-2.5 text-[11px]">
                  <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: colour }} />
                  <div className="min-w-0">
                    <span>{issue.message}</span>
                    <span className="ml-2 font-mono text-[10px] text-[var(--text-faint)]">{issue.code}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- the register ---- */}
      <div className="glass-panel p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 text-[var(--accent)]" />
          <h3 className="text-sm font-bold mr-1">Register</h3>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`ui-btn py-1 text-[11px] ${filter === f.key ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
            >
              {f.label} <span className="font-mono opacity-70">{f.n}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--line)] max-h-[30rem] overflow-y-auto custom-scrollbar">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--surface-2)] text-[var(--text-faint)] uppercase font-mono text-[10px] sticky top-0">
              <tr>
                <th className="p-2.5">Row</th>
                <th className="p-2.5">Item</th>
                <th className="p-2.5">Activity</th>
                <th className="p-2.5">Qty</th>
                <th className="p-2.5">RFI</th>
                <th className="p-2.5">Approval</th>
                <th className="p-2.5">Model element</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((item) => (
                <RegisterRow
                  key={item.key}
                  item={item}
                  match={item.ifcGlobalId ? matchByGuid.get(item.ifcGlobalId) : null}
                  hasModel={Boolean(preview)}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-[var(--text-faint)]">No rows in this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- commit ---- */}
      <div className="flex flex-wrap justify-between gap-2">
        <button className="ui-btn ui-btn-ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> Workbook
        </button>
        <div className="flex items-center gap-2">
          {saveError && <span className="text-xs text-[var(--late)]">{saveError}</span>}
          <button className="ui-btn ui-btn-primary" disabled={!canCommit || saving} onClick={onCommit}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : packageCode ? `Import into ${packageCode}` : 'Import'}
          </button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------- bits */

function RegisterRow({ item, match, hasModel }) {
  const refs = (item.rfiRefs || '').split('\n').filter(Boolean);
  const quantity = item.executedQuantity === null || item.executedQuantity === undefined
    ? '—'
    : `${item.executedQuantity}${item.uom ? ` ${item.uom}` : ''}`;

  let element;
  if (!item.ifcGlobalId) {
    element = <span className="text-[var(--text-faint)]">—</span>;
  } else if (!hasModel) {
    element = <span className="text-[var(--text-faint)]" title="Binds when a model is loaded">{item.ifcGlobalId}</span>;
  } else if (!match) {
    element = (
      <span className="text-[var(--late)]" title={item.ifcGlobalId}>
        not in the model · {item.ifcGlobalId}
      </span>
    );
  } else {
    element = (
      <div className="space-y-0.5">
        {match.elements.map((e) => (
          <div key={e.expressID} className="truncate max-w-[16rem]" title={e.globalId || ''}>
            {e.name || `#${e.expressID}`}
          </div>
        ))}
        {match.note && <div className="text-[10px] text-[var(--text-faint)]">{match.note}</div>}
      </div>
    );
  }

  return (
    <tr className="align-top hover:bg-[var(--surface-2)]">
      <td className="p-2.5 font-mono text-[var(--text-faint)] tabular-nums">{item.rowNumber}</td>
      <td className="p-2.5 font-mono whitespace-nowrap">{item.itemNo || '—'}</td>
      <td className="p-2.5 min-w-[14rem]">
        <div className="font-semibold text-[var(--text)]">{item.remarks || '—'}</div>
        {item.description && (
          <div className="text-[10px] text-[var(--text-faint)] truncate max-w-[22rem]" title={item.description}>
            {item.description}
          </div>
        )}
      </td>
      <td className="p-2.5 font-mono tabular-nums whitespace-nowrap">{quantity}</td>
      <td className="p-2.5 font-mono text-[11px] whitespace-nowrap" title={refs.join('\n')}>
        {refs[0] || '—'}
        {refs.length > 1 && <span className="text-[var(--text-faint)]"> +{refs.length - 1}</span>}
      </td>
      <td className="p-2.5">
        <span className="ui-chip" data-tone={APPROVAL_TONE[item.approval]}>
          <span className="h-2 w-2 rounded-full" style={{ background: swatch(item.approval) }} />
          {APPROVAL_LABEL[item.approval] || 'Pending'}
        </span>
      </td>
      <td className="p-2.5 font-mono text-[11px]">{element}</td>
    </tr>
  );
}

function Count({ label, value, colour }) {
  const known = value !== undefined && value !== null;
  return (
    <div className="ui-slot">
      <div
        className="text-xl font-extrabold font-mono tabular-nums leading-none"
        style={known && colour ? { color: colour } : undefined}
      >
        {known ? value : '—'}
      </div>
      <div className="text-[10px] text-[var(--text-faint)] leading-snug">{label}</div>
    </div>
  );
}
