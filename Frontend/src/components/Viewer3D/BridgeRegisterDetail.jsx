import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { APPROVAL_LABEL, APPROVAL_STATUS } from '../../utils/bridgeImport';
import { STATUS_COLORS, UNBOUND_COLOR } from '../../utils/roadTextures';

/**
 * Everything the bridge register says about a clicked element, in the inspector.
 *
 * Laid out in the sheet's own column order and under the sheet's own column names, so it
 * reads like the Excel row it came from. The RFI numbers and their dates are two parallel
 * lists in the sheet — one reference per line, one date per line — so they are shown
 * paired, which is how anyone checking an approval actually reads them.
 */

const colourOf = (approval) => STATUS_COLORS[APPROVAL_STATUS[approval]] || UNBOUND_COLOR;
const listOf = (text) => String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);

export default function BridgeRegisterDetail({ rows = [] }) {
  return (
    <div className="pt-3 border-t border-slate-800 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-extrabold text-white text-xs">
          <FileSpreadsheet className="h-4 w-4 text-cyan-400" /> Bridge register
        </span>
        {rows.length > 1 && <span className="text-[10px] font-mono text-slate-400">{rows.length} rows</span>}
      </div>

      {rows.length === 0 && (
        <p className="text-slate-400 leading-relaxed">
          No row in the register names this element, so it is pending and shown as modelled.
        </p>
      )}

      {/* More than one row naming one element is allowed, and worth seeing — the colour
          follows the least-finished of them. */}
      {rows.length > 1 && (
        <p className="text-[11px] text-slate-400">
          Several rows name this element; its colour follows the least-finished of them.
        </p>
      )}

      {rows.map((row) => <RegisterRow key={row.key ?? row.id ?? row.rowNumber} row={row} />)}
    </div>
  );
}

function RegisterRow({ row }) {
  const colour = colourOf(row.approval);
  const refs = listOf(row.rfiRefs);
  const dates = listOf(row.rfiDates);
  const rfis = Array.from({ length: Math.max(refs.length, dates.length) }, (_, i) => [refs[i], dates[i]]);
  const quantity = row.executedQuantity === null || row.executedQuantity === undefined
    ? null
    : String(row.executedQuantity);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-extrabold text-white text-sm leading-tight">
            {row.remarks || row.description || `Row ${row.rowNumber}`}
          </div>
          {row.rowNumber !== null && row.rowNumber !== undefined && (
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">sheet row {row.rowNumber}</div>
          )}
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold"
          style={{ color: colour, background: `${colour}1f`, borderColor: `${colour}59` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
          {APPROVAL_LABEL[row.approval] || 'Pending'}
        </span>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
        <Field label="Item No." value={row.itemNo} mono />
        <Field label="Item Description" value={row.description} />
        <Field label="UoM" value={row.uom} />
        <Field label="Location" value={row.location} />
        <Field label="Executed Quantity" value={quantity} mono />
      </dl>

      {rfis.length > 0 && (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-900 text-slate-500 text-[10px] uppercase font-mono">
              <tr>
                <th className="text-left px-2 py-1 font-bold">RFI No. / Letter No. / Period</th>
                <th className="text-right px-2 py-1 font-bold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rfis.map(([ref, date], i) => (
                <tr key={i}>
                  <td className="px-2 py-1 font-mono text-slate-200">{ref || '—'}</td>
                  <td className="px-2 py-1 font-mono text-slate-400 text-right whitespace-nowrap">{date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
        <Field label="Bill No." value={row.billNo} mono />
        <Field label="Remarks" value={row.remarks} />
        <Field label="IFC GUID" value={row.ifcGlobalId} mono />
        <Field label="Approval" value={row.approvalText || 'Pending — no verdict yet'} />
      </dl>
    </div>
  );
}

function Field({ label, value, mono }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd
        className={`${empty ? 'text-slate-600' : 'text-slate-100'} ${
          mono ? 'font-mono text-[11px] break-all' : 'font-semibold break-words'
        }`}
      >
        {empty ? '—' : value}
      </dd>
    </>
  );
}
