import React, { useState } from 'react';
import { FileText, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { buildExecutivePdf } from '../../utils/executivePdf';

/**
 * Builds the executive summary from what the database holds at the moment of the click.
 *
 * Everything is fetched fresh — packages, their progress rows, and the full RFI register —
 * rather than read from whatever screens happen to be loaded, so the PDF is a statement of
 * record, not a screenshot of the session. The old version of this button printed invented
 * demo figures; nothing here is invented, and a package with no data says so in print.
 */

/** The register is paged; the report needs all of it, so follow the pages to the end. */
async function fetchAllRfis(projectCode) {
  const first = await api.listRfis(projectCode, { page: 1, pageSize: 200 });
  const items = [...(first.items || [])];
  const pages = Math.ceil((first.total || 0) / (first.pageSize || 200));
  for (let page = 2; page <= pages; page++) {
    const next = await api.listRfis(projectCode, { page, pageSize: 200 });
    items.push(...(next.items || []));
  }
  return items;
}

export default function ReportExporter() {
  const { activeProject, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const exportPdf = async () => {
    if (busy) return;
    if (!activeProject) {
      setError('Open a project first.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const [packages, rfis] = await Promise.all([
        api.listPackages(activeProject.code),
        fetchAllRfis(activeProject.code),
      ]);
      if (!packages.length) throw new Error('This project has no packages to report on.');

      // Each package's own rows, fetched together. The progress endpoint already
      // excludes superseded rows, so the totals only count live data.
      const perPackage = await Promise.all(
        packages.map(async (pkg) => {
          const [chainages, layers, progress] = await Promise.all([
            api.getPackageChainages(pkg.id),
            api.getPackageLayers(pkg.id),
            api.getPackageProgress(pkg.id),
          ]);
          return { pkg, chainages, layers, progress };
        }),
      );

      const { doc, fileName } = buildExecutivePdf({
        project: activeProject,
        user,
        generatedAt: new Date(),
        packages: perPackage,
        rfis,
      });
      doc.save(fileName);
    } catch (err) {
      setError(err.message || 'The report could not be generated.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <button
        onClick={exportPdf}
        disabled={busy}
        className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-500/20"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
        <span>{busy ? 'Building report…' : 'Export PDF Executive Summary'}</span>
      </button>
      {error && (
        <p className="flex items-start gap-1.5 text-[11px] font-semibold text-red-400" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {error}
        </p>
      )}
    </div>
  );
}
