import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, FileSpreadsheet, ClipboardCheck, CheckCircle2, AlertCircle, AlertTriangle,
  Info, Upload, Download, X, Loader2, ArrowRight, ArrowLeft, Ruler, Layers,
  MapPin, Link2, RotateCcw, Database,
} from 'lucide-react';
import { useRoadData } from '../../context/RoadDataContext';
import { useAuth } from '../../context/AuthContext';
import { downloadSampleExcelTemplate } from '../../utils/excelGenerator';
import { importWorkbookFiles, SHEET_KIND, SHEET_LABEL, LEVEL } from '../../utils/excelImport';
import { resolveProgressToModel } from '../../utils/ifcResolver';
import { buildImportPayload, hashFile, buildIfcMetadata } from '../../utils/persistence';
import { loadBimModelFile } from '../../utils/ifcLoader';
import { api } from '../../api/client';
import ReconciliationReport from './ReconciliationReport';
import { BridgeWorkbookStep, BridgeReviewStep } from './BridgeSteps';
import { importBridgeWorkbook, buildBridgePayload, resolveBridgeToModel } from '../../utils/bridgeImport';

/**
 * Project Data Import.
 *
 * The model and the workbooks can arrive in either order, so the steps are navigable
 * rather than sequential: a project that already has a model opens on the workbook step,
 * and one that has data but no model can add the model later and have the bindings
 * resolved and saved then.
 *
 * Nothing is written until every row validates. The review step shows exactly what will
 * be stored and, when a model is present, what each row will bind to.
 */

const STEPS = [
  { key: 'model', label: 'Model', icon: Boxes },
  { key: 'workbooks', label: 'Workbooks', icon: FileSpreadsheet },
  { key: 'review', label: 'Review', icon: ClipboardCheck },
  { key: 'done', label: 'Imported', icon: CheckCircle2 },
];

const SLOTS = [
  { kind: SHEET_KIND.CHAINAGES, hint: 'Road_chainage.xlsx', icon: MapPin, required: false,
    blurb: 'Stations with coordinates. Needed to place the road on a map.' },
  { kind: SHEET_KIND.LAYERS, hint: 'RoadLayer.xlsx', icon: Layers, required: false,
    blurb: 'The layer catalogue: codes, names and nominal thicknesses.' },
  { kind: SHEET_KIND.PROGRESS, hint: 'LayerProgress.xlsx', icon: ClipboardCheck, required: true,
    blurb: 'Cost, planned dates and the GlobalId binding, per chainage and layer. '
         + 'Its status column is the baseline — inspections decide the live one.' },
  { kind: SHEET_KIND.METRICS, hint: 'ProjectMetric.xlsx', icon: Database, required: false,
    blurb: 'The roll-up as the sheet reported it. Kept as an audit snapshot.' },
];

const LEVEL_STYLE = {
  [LEVEL.ERROR]: { icon: AlertCircle, tone: 'late', label: 'error' },
  [LEVEL.WARNING]: { icon: AlertTriangle, tone: 'active', label: 'warning' },
  [LEVEL.INFO]: { icon: Info, tone: undefined, label: 'note' },
};

const SOURCE_TONE = { ifc: 'violet', excel: 'active', catalogue: undefined };
const dash = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);

export default function ImportWizard() {
  const {
    ifcSummary, ifcFileName, applyIfcModel, projectImport, persistence,
    applyProjectImport, reloadProject, setActiveTab, dashboard, bridgeResolution,
  } = useRoadData();
  const { activeProject, activePackage, canEdit } = useAuth();

  const hasModel = Boolean(ifcSummary);
  const hasStoredData = (persistence?.progressCount || 0) > 0;
  const packageIsBridge = (persistence?.bridgeItemCount || 0) > 0;

  // Land on the step that still needs attention rather than always starting at one
  const [step, setStep] = useState(hasModel ? 'workbooks' : 'model');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelError, setModelError] = useState(null);
  const [dragging, setDragging] = useState(null);

  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [reading, setReading] = useState(false);
  const [levelFilter, setLevelFilter] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // ---- bridge mode ----
  //
  // A bridge package takes ONE register workbook instead of the four road sheets. The
  // switch opens already on for a package that holds a register, so re-importing a bridge
  // never starts on the wrong form — and it can still be flipped either way.
  const [bridgeMode, setBridgeMode] = useState(packageIsBridge);
  const [bridgeFile, setBridgeFile] = useState(null);
  const [bridgeResult, setBridgeResult] = useState(null);

  useEffect(() => { setBridgeMode(packageIsBridge); }, [activePackage?.id, packageIsBridge]);

  const modelInputRef = useRef(null);
  const bookInputRef = useRef(null);

  /* ------------------------------------------------------------ model step */

  const handleModel = useCallback(async (file) => {
    if (!file) return;
    setModelError(null);
    setModelBusy(true);
    setModelProgress(0);
    await new Promise((r) => requestAnimationFrame(r));

    try {
      const model = await loadBimModelFile(file, setModelProgress);
      applyIfcModel(model, file.name);

      // Guarded on the id, not on the object being truthy: a package that arrived without
      // one would otherwise pass and put the literal string "undefined" in the request
      // path, which the server can only answer with a 404 about a package that never was.
      if (activePackage?.id && canEdit && model.summary) {
        await api.uploadModel(activePackage.id, file, buildIfcMetadata(model.summary));
        await reloadProject();
      }
      setStep('workbooks');
    } catch (err) {
      setModelError(err?.message || 'Could not read this file. Is it a valid IFC or glTF model?');
    } finally {
      setModelBusy(false);
      setModelProgress(0);
    }
  }, [activePackage, canEdit, applyIfcModel, reloadProject]);

  /* -------------------------------------------------------- workbook step */

  const readBooks = useCallback(async (incoming) => {
    const merged = [...files];
    for (const f of incoming) {
      const i = merged.findIndex((m) => m.name === f.name);
      if (i >= 0) merged[i] = f; else merged.push(f);
    }
    setFiles(merged);
    setSaveResult(null);
    setSaveError(null);
    setLevelFilter(null);

    if (!merged.length) { setResult(null); return; }

    setReading(true);
    try {
      setResult(await importWorkbookFiles(merged, { ifcLayers: ifcSummary?.layers || [] }));
    } catch (err) {
      setResult({
        ok: false, chainages: [], layers: [], progress: [], metrics: null, sheetsSeen: [],
        reconciliation: { map: new Map(), issues: [], rolesMatched: 0 },
        counts: { chainages: 0, layers: 0, progress: 0, metrics: 0, errors: 1, warnings: 0, infos: 0 },
        issues: [{ level: LEVEL.ERROR, code: 'import.failed', message: err.message }],
      });
    } finally {
      setReading(false);
    }
  }, [files, ifcSummary]);

  const removeFile = async (name) => {
    const next = files.filter((f) => f.name !== name);
    setFiles(next);
    setSaveResult(null);
    if (!next.length) { setResult(null); return; }
    // Re-validate the remaining set: dropping a workbook can turn a clean import into a
    // failing one (a progress row whose chainage sheet just left, say).
    setReading(true);
    try {
      setResult(await importWorkbookFiles(next, { ifcLayers: ifcSummary?.layers || [] }));
    } finally {
      setReading(false);
    }
  };

  /* ------------------------------------------------------------ bridge */

  const toggleBridge = () => {
    // The two forms read different files, so nothing chosen for one carries into the other.
    setBridgeMode((on) => !on);
    setFiles([]);
    setResult(null);
    setBridgeFile(null);
    setBridgeResult(null);
    setSaveResult(null);
    setSaveError(null);
    setLevelFilter(null);
    if (step === 'review' || step === 'done') setStep(hasModel ? 'workbooks' : 'model');
  };

  const readBridge = useCallback(async (file) => {
    if (!file) return;
    setBridgeFile(file);
    setSaveResult(null);
    setSaveError(null);
    setReading(true);
    try {
      setBridgeResult(await importBridgeWorkbook(file));
    } finally {
      setReading(false);
    }
  }, []);

  const removeBridge = () => {
    setBridgeFile(null);
    setBridgeResult(null);
    setSaveResult(null);
  };

  /* ------------------------------------------------------------ derived */

  const found = useMemo(() => new Set(result?.sheetsSeen || []), [result]);

  const preview = useMemo(
    () => (ifcSummary && result?.progress?.length
      ? resolveProgressToModel({ progress: result.progress, chainages: result.chainages, summary: ifcSummary })
      : null),
    [ifcSummary, result]
  );

  const allIssues = useMemo(
    () => [...(result?.issues || []), ...(preview?.issues || [])],
    [result, preview]
  );

  const counts = useMemo(() => ({
    [LEVEL.ERROR]: allIssues.filter((i) => i.level === LEVEL.ERROR).length,
    [LEVEL.WARNING]: allIssues.filter((i) => i.level === LEVEL.WARNING).length,
    [LEVEL.INFO]: allIssues.filter((i) => i.level === LEVEL.INFO).length,
  }), [allIssues]);

  const visibleIssues = useMemo(
    () => allIssues.filter((i) => !levelFilter || i.level === levelFilter),
    [allIssues, levelFilter]
  );

  const reconciled = useMemo(
    () => (result?.reconciliation ? [...result.reconciliation.map.entries()] : []),
    [result]
  );

  const canCommit = Boolean(result?.ok) && counts[LEVEL.ERROR] === 0 && canEdit && Boolean(activePackage?.id);

  // What the register will colour, previewed against the loaded model before anything is
  // saved — the same function the viewer runs after the import.
  const bridgePreview = useMemo(
    () => (bridgeMode && ifcSummary && bridgeResult?.items?.length
      ? resolveBridgeToModel({ items: bridgeResult.items, summary: ifcSummary })
      : null),
    [bridgeMode, ifcSummary, bridgeResult]
  );

  const bridgeIssues = useMemo(
    () => [...(bridgeResult?.issues || []), ...(bridgePreview?.issues || [])],
    [bridgeResult, bridgePreview]
  );

  const bridgeErrors = bridgeIssues.filter((i) => i.level === LEVEL.ERROR).length;
  const canCommitBridge = Boolean(bridgeResult?.ok) && bridgeErrors === 0 && canEdit && Boolean(activePackage?.id);
  const bridgeBlocked = !activeProject ? 'Select or create a project before importing.'
    : !activePackage ? 'This project has no package yet. Add one first — a register is imported into a package.'
    : !canEdit ? `You have Viewer access to ${activeProject.name}, so this import cannot be saved.`
    : null;

  /* ------------------------------------------------------------- commit */

  const commit = async () => {
    if (!canCommit || saving) return;

    // The flat single-sheet template used to be applied straight into memory here, never
    // reaching the database. Every import now goes through the same service, so it is
    // validated, idempotent, and cannot leave the screen showing rows nothing persisted.
    if (result.legacySheet && !result.progress.length) {
      setSaveError(
        'This is the old single-sheet template. Upload the four workbooks instead — '
        + 'Road_chainage, RoadLayer, LayerProgress and ProjectMetric.',
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const hashes = {};
      for (const file of files) hashes[file.name] = await hashFile(file);

      const sheets = (result.sheetsSeen || []).map((kind, i) => ({
        fileName: files[i]?.name || `sheet-${i + 1}`,
        name: SHEET_LABEL[kind],
        kind,
        rows: { length: {
          [SHEET_KIND.CHAINAGES]: result.counts.chainages,
          [SHEET_KIND.LAYERS]: result.counts.layers,
          [SHEET_KIND.PROGRESS]: result.counts.progress,
          [SHEET_KIND.METRICS]: result.counts.metrics,
        }[kind] ?? 0 },
      }));

      const payload = buildImportPayload({ result, resolution: preview, sheets, hashes });
      setSaveResult(await api.createImport(activePackage.id, payload, files));

      applyProjectImport(result);
      await reloadProject();
      setStep('done');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const commitBridge = async () => {
    if (!canCommitBridge || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const contentSha256 = await hashFile(bridgeFile);
      const payload = buildBridgePayload({ result: bridgeResult, contentSha256 });
      setSaveResult(await api.createBridgeImport(activePackage.id, payload, bridgeFile));

      // The register is read back from the server rather than applied from memory, so
      // what the model shows next is what was actually stored.
      await reloadProject();
      setStep('done');
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startOver = () => {
    setFiles([]);
    setResult(null);
    setBridgeFile(null);
    setBridgeResult(null);
    setSaveResult(null);
    setSaveError(null);
    setStep(hasModel ? 'workbooks' : 'model');
  };

  /* ------------------------------------------------------------- render */

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const stepState = (key, i) => (key === step ? 'current' : i < stepIndex ? 'done' : 'todo');
  const canReview = bridgeMode
    ? Boolean(bridgeResult?.items?.length)
    : Boolean(result?.progress?.length || result?.legacySheet);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <Header
        activeProject={activeProject}
        activePackage={activePackage}
        hasModel={hasModel}
        hasStoredData={hasStoredData}
        persistence={persistence}
        bridgeMode={bridgeMode}
        onToggleBridge={toggleBridge}
        busy={saving || reading}
      />

      {/* ---------------- stepper ---------------- */}
      <nav className="glass-panel px-5 py-3 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const state = stepState(s.key, i);
          const reachable = s.key === 'model' || s.key === 'workbooks'
            || (s.key === 'review' && canReview)
            || (s.key === 'done' && Boolean(saveResult));
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <span className="ui-step-rail" />}
              <button
                className="ui-step"
                data-state={state}
                disabled={!reachable}
                onClick={() => reachable && setStep(s.key)}
              >
                <span className="ui-step-dot">
                  {state === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:flex items-center gap-1.5 whitespace-nowrap">
                  <Icon className="h-3.5 w-3.5" /> {s.key === 'workbooks' && bridgeMode ? 'Workbook' : s.label}
                </span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* ---------------- step 1: model ---------------- */}
      {step === 'model' && (
        <section className="glass-panel p-6 space-y-4 animate-slide-up">
          <StepHead
            title="Start with the model"
            body="The IFC defines what exists — every element, layer and station the workbooks will attach to. You can skip it and add it later; progress imported first is bound as soon as a model arrives."
          />

          {hasModel ? (
            <div className="ui-slot" data-state="filled">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Boxes className="h-5 w-5 text-[var(--ok)] shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-[var(--text)] truncate">{ifcFileName || 'Model loaded'}</div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono">
                      {ifcSummary.elementCount} elements · {ifcSummary.layers?.length || 0} layers
                      {ifcSummary.alignment && ` · ${ifcSummary.alignment.segmentCount} segments · ${ifcSummary.alignment.lengthM} m`}
                      {ifcSummary.latitude != null && ' · georeferenced'}
                    </div>
                  </div>
                </div>
                <button className="ui-btn" onClick={() => modelInputRef.current?.click()} disabled={modelBusy}>
                  <RotateCcw className="h-3.5 w-3.5" /> Replace
                </button>
              </div>
            </div>
          ) : (
            <label
              className="ui-drop"
              data-active={dragging === 'model'}
              onDragOver={(e) => { e.preventDefault(); setDragging('model'); }}
              onDragLeave={() => setDragging(null)}
              onDrop={(e) => { e.preventDefault(); setDragging(null); handleModel(e.dataTransfer.files?.[0]); }}
              onClick={() => modelInputRef.current?.click()}
            >
              {modelBusy
                ? <Loader2 className="h-9 w-9 text-[var(--accent)] animate-spin" />
                : <Boxes className="h-9 w-9 text-[var(--accent)]" />}
              <span className="text-sm font-bold">
                {modelBusy ? `Parsing model… ${modelProgress}%` : 'Drop an .ifc, .glb or .gltf model'}
              </span>
              <span className="text-xs text-[var(--text-faint)]">
                Parsed in the browser; the file is archived with the project.
              </span>
            </label>
          )}

          <input
            ref={modelInputRef}
            type="file"
            accept=".ifc,.glb,.gltf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; handleModel(f); }}
          />

          {modelError && <Banner tone="late" icon={AlertCircle}>{modelError}</Banner>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="ui-btn ui-btn-ghost" onClick={() => setStep('workbooks')}>
              {hasModel ? 'Continue' : 'Skip for now'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* ---------------- step 2: workbooks ---------------- */}
      {step === 'workbooks' && bridgeMode && (
        <BridgeWorkbookStep
          file={bridgeFile}
          result={bridgeResult}
          reading={reading}
          dragging={dragging === 'bridge'}
          onDragChange={(on) => setDragging(on ? 'bridge' : null)}
          onFile={readBridge}
          onRemove={removeBridge}
          onBack={() => setStep('model')}
          onNext={() => setStep('review')}
          canReview={canReview}
        />
      )}

      {step === 'workbooks' && !bridgeMode && (
        <section className="glass-panel p-6 space-y-5 animate-slide-up">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <StepHead
              title="Add the workbooks"
              body="Drop all four together, in any order, as separate files or one multi-sheet book. Each is identified by its columns, not its filename."
            />
            <button className="ui-btn" onClick={downloadSampleExcelTemplate}>
              <Download className="h-3.5 w-3.5" /> Sample template
            </button>
          </div>

          <label
            className="ui-drop"
            data-active={dragging === 'books'}
            data-filled={files.length > 0}
            onDragOver={(e) => { e.preventDefault(); setDragging('books'); }}
            onDragLeave={() => setDragging(null)}
            onDrop={(e) => { e.preventDefault(); setDragging(null); readBooks(Array.from(e.dataTransfer.files || [])); }}
            onClick={() => bookInputRef.current?.click()}
          >
            {reading
              ? <Loader2 className="h-9 w-9 text-[var(--accent)] animate-spin" />
              : <Upload className="h-9 w-9 text-[var(--accent)]" />}
            <span className="text-sm font-bold">
              {reading ? 'Reading workbooks…' : files.length ? 'Add or replace workbooks' : 'Drop your .xlsx files'}
            </span>
            <span className="text-xs text-[var(--text-faint)]">Chainages · Layers · Progress · Metrics</span>
          </label>

          <input
            ref={bookInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            className="hidden"
            onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; readBooks(f); }}
          />

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f) => (
                <span key={f.name} className="ui-chip font-mono">
                  {f.name}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                    className="text-[var(--text-faint)] hover:text-[var(--late)]"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SLOTS.map(({ kind, hint, icon: Icon, required, blurb }) => {
              const hit = found.has(kind);
              const n = {
                [SHEET_KIND.CHAINAGES]: result?.counts.chainages,
                [SHEET_KIND.LAYERS]: result?.counts.layers,
                [SHEET_KIND.PROGRESS]: result?.counts.progress,
                [SHEET_KIND.METRICS]: result?.counts.metrics,
              }[kind];

              return (
                <div key={kind} className="ui-slot" data-state={hit ? 'filled' : required && result ? 'missing' : 'empty'}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold">
                      <Icon className={`h-3.5 w-3.5 ${hit ? 'text-[var(--ok)]' : 'text-[var(--text-faint)]'}`} />
                      {SHEET_LABEL[kind]}
                    </span>
                    {hit
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ok)]" />
                      : <span className="text-[10px] font-bold text-[var(--text-faint)]">{required ? 'required' : 'optional'}</span>}
                  </div>
                  <div className="text-xl font-extrabold font-mono tabular-nums leading-none">
                    {hit ? n : '—'}
                    <span className="ml-1 text-[10px] font-normal text-[var(--text-faint)]">rows</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-faint)] leading-snug">{hit ? hint : blurb}</div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between gap-2 pt-1">
            <button className="ui-btn ui-btn-ghost" onClick={() => setStep('model')}>
              <ArrowLeft className="h-3.5 w-3.5" /> Model
            </button>
            <button className="ui-btn ui-btn-primary" disabled={!canReview} onClick={() => setStep('review')}>
              Review {result?.counts.progress ? `${result.counts.progress} rows` : ''} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>
      )}

      {/* ---------------- step 3: review ---------------- */}
      {step === 'review' && bridgeMode && bridgeResult && (
        <BridgeReviewStep
          result={bridgeResult}
          preview={bridgePreview}
          issues={bridgeIssues}
          canCommit={canCommitBridge}
          blockedReason={bridgeBlocked}
          saving={saving}
          saveError={saveError}
          packageCode={activePackage?.code}
          onBack={() => setStep('workbooks')}
          onCommit={commitBridge}
        />
      )}

      {step === 'review' && !bridgeMode && result && (
        <section className="space-y-5 animate-slide-up">
          <div className={`glass-panel p-5 flex items-start gap-3 border-l-2 ${
            canCommit ? 'border-l-[var(--ok)]' : 'border-l-[var(--late)]'
          }`}>
            {canCommit
              ? <CheckCircle2 className="h-5 w-5 text-[var(--ok)] shrink-0 mt-0.5" />
              : <AlertCircle className="h-5 w-5 text-[var(--late)] shrink-0 mt-0.5" />}
            <div className="text-sm space-y-1">
              <div className="font-bold">
                {counts[LEVEL.ERROR] > 0
                  ? `${counts[LEVEL.ERROR]} error${counts[LEVEL.ERROR] === 1 ? '' : 's'} must be fixed before anything is written.`
                  : !activeProject ? 'Select or create a project before importing.'
                  : !activePackage ? 'This project has no package yet. Add one first — workbooks and models are imported into a package, not a project.'
                  : !canEdit ? `You have Viewer access to ${activeProject.name}, so this import cannot be saved.`
                  : `${result.counts.progress} progress rows across ${result.counts.chainages || '—'} chainages, ready to import.`}
              </div>
              {canCommit && (
                <div className="text-xs text-[var(--text-muted)]">
                  {preview
                    ? `${preview.report.counts.total - preview.report.counts.none} of ${preview.report.counts.total} rows will bind to model elements.`
                    : 'No model loaded, so rows will import unbound and bind automatically once one is added.'}
                </div>
              )}
            </div>
          </div>

          {allIssues.length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold mr-1">Validation</h3>
                {[LEVEL.ERROR, LEVEL.WARNING, LEVEL.INFO].map((level) => {
                  const { icon: Icon, tone, label } = LEVEL_STYLE[level];
                  const n = counts[level];
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
              <div className="rounded-[var(--radius-sm)] border border-[var(--line)] divide-y divide-[var(--line)] max-h-64 overflow-y-auto custom-scrollbar">
                {visibleIssues.map((issue, i) => {
                  const { icon: Icon } = LEVEL_STYLE[issue.level];
                  const colour = issue.level === LEVEL.ERROR ? 'var(--late)'
                    : issue.level === LEVEL.WARNING ? 'var(--active)' : 'var(--text-faint)';
                  return (
                    <div key={`${issue.code}-${i}`} className="flex items-start gap-2.5 p-2.5 text-[11px]">
                      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: colour }} />
                      <div className="min-w-0">
                        <span>{issue.message}</span>
                        <span className="ml-2 font-mono text-[10px] text-[var(--text-faint)]">
                          {issue.code}{issue.row ? ` · row ${issue.row}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {reconciled.length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-[var(--violet)]" />
                <h3 className="text-sm font-bold">Layers</h3>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {hasModel
                    ? `matched to the model by structural role — ${result.reconciliation.rolesMatched} of ${reconciled.length} bound`
                    : 'no model loaded, so thicknesses fall back to the catalogue'}
                </span>
              </div>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--line)]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[var(--surface-2)] text-[var(--text-faint)] uppercase text-[10px]">
                    <tr>
                      <th className="p-2.5">Sheet</th><th className="p-2.5">Layer</th>
                      <th className="p-2.5">Role</th><th className="p-2.5">Model</th>
                      <th className="p-2.5">Thickness</th><th className="p-2.5">Superseded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {reconciled.map(([code, m]) => (
                      <tr key={code}>
                        <td className="p-2.5 font-bold text-[var(--accent)]">{code}</td>
                        <td className="p-2.5 font-sans">{m.excelLayer.layerName}</td>
                        <td className="p-2.5 text-[var(--text-muted)]">{m.role}</td>
                        <td className="p-2.5">
                          {m.ifcLayer
                            ? <span className="text-[var(--violet)]">{m.ifcLayer.code} · {m.ifcLayer.name}</span>
                            : <span className="text-[var(--text-faint)]">—</span>}
                        </td>
                        <td className="p-2.5 tabular-nums font-bold">
                          {dash(m.thicknessMm, ' mm')}
                          {m.source && <span className="ui-chip ml-1.5" data-tone={SOURCE_TONE[m.source]}>{m.source}</span>}
                        </td>
                        <td className="p-2.5 text-[10px] text-[var(--text-faint)] tabular-nums">
                          {m.overridden.length ? m.overridden.map((o) => `${o.value} mm (${o.source})`).join(', ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview
            ? <div className="glass-panel p-5"><ReconciliationReport resolution={preview} /></div>
            : result.progress.length > 0 && (
              <Banner tone="active" icon={Link2}>
                No model is loaded, so these rows cannot be bound to elements yet. Import them now and add the
                model when it is ready — the binding runs and is saved automatically.
              </Banner>
            )}

          <div className="flex flex-wrap justify-between gap-2">
            <button className="ui-btn ui-btn-ghost" onClick={() => setStep('workbooks')}>
              <ArrowLeft className="h-3.5 w-3.5" /> Workbooks
            </button>
            <div className="flex items-center gap-2">
              {saveError && <span className="text-xs text-[var(--late)]">{saveError}</span>}
              <button className="ui-btn ui-btn-primary" disabled={!canCommit || saving} onClick={commit}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                {saving ? 'Saving…' : activePackage ? `Import into ${activePackage.code}` : 'Import'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ---------------- step 4: done ---------------- */}
      {step === 'done' && (
        <section className="glass-panel p-8 space-y-5 animate-slide-up text-center">
          <div className="inline-grid place-items-center w-14 h-14 rounded-full bg-[rgba(110,231,168,.12)] border border-[rgba(110,231,168,.35)] mx-auto">
            <CheckCircle2 className="h-7 w-7 text-[var(--ok)]" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-extrabold">Imported</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-lg mx-auto">
              {saveResult
                ? `Batch #${saveResult.batchId} — the dashboard, 3D view, plan map and analytics now read from the database.`
                : 'The dashboard, 3D view and analytics now use these figures.'}
            </p>
          </div>

          {saveResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
              <Stat label="inserted" value={saveResult.rowsInserted} tone="ok" />
              <Stat label="updated" value={saveResult.rowsUpdated} tone="active" />
              <Stat label="unchanged" value={saveResult.rowsUnchanged} />
              {bridgeMode
                ? <Stat label="retired" value={saveResult.rowsSuperseded} tone="violet" />
                : <Stat label="bindings" value={saveResult.bindingsWritten} tone="violet" />}
            </div>
          )}

          {/* What the register did to the model, read from the reloaded package — so this
              is the stored result, not the preview. */}
          {bridgeMode && bridgeResolution?.report?.colouring && (
            <p className="text-sm text-[var(--text-muted)]">
              On the model:{' '}
              <span className="font-bold" style={{ color: STATUS_COLORS.Completed }}>
                {bridgeResolution.report.colouring.green} approved
              </span>
              {' · '}
              <span className="font-bold" style={{ color: STATUS_COLORS.Delayed }}>
                {bridgeResolution.report.colouring.red} rejected
              </span>
              {' · '}
              {bridgeResolution.report.colouring.untouched} left as they are
            </p>
          )}

          {saveResult?.alreadyImported && (
            <Banner tone="active" icon={Info}>
              These exact workbooks had already been imported, so nothing was rewritten.
            </Banner>
          )}

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <button
              className="ui-btn ui-btn-primary"
              onClick={() => setActiveTab(bridgeMode ? '3D_BIM' : 'DASHBOARD')}
            >
              {bridgeMode ? 'See it on the model' : 'Open the dashboard'} <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button className="ui-btn" onClick={() => setActiveTab('GIS_MAP')}>
              <MapPin className="h-3.5 w-3.5" /> Plan map
            </button>
            <button className="ui-btn ui-btn-ghost" onClick={startOver}>
              <RotateCcw className="h-3.5 w-3.5" /> Import more
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function Header({
  activeProject, activePackage, hasModel, hasStoredData, persistence, bridgeMode, onToggleBridge, busy,
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-extrabold font-[Outfit] leading-tight">Project Data Import</h2>
        <p className="text-xs text-[var(--text-muted)] mt-1 max-w-2xl">
          The model and the workbooks can arrive in either order. Nothing is written until every row validates.
        </p>

        {/* Road packages take four workbooks; a bridge takes one register. Disabled while a
            file is being read or saved, so the form cannot change under an import. */}
        <button
          type="button"
          role="switch"
          aria-checked={bridgeMode}
          onClick={onToggleBridge}
          disabled={busy}
          className="ui-switch mt-3"
        >
          <span className="ui-switch-track" aria-hidden="true" />
          <span>
            Bridge package
            <span className="font-normal text-[var(--text-faint)]">
              {bridgeMode ? ' — one register workbook' : ' — off: four road workbooks'}
            </span>
          </span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {activeProject && <span className="ui-chip" data-tone="accent">{activeProject.name}</span>}
        {/* Which package this writes into. The wizard imports into one package, never a
            project — so naming it here is the difference between a correct import and a
            correct-looking one that landed under the wrong contract. */}
        {activePackage && <span className="ui-chip" data-tone="violet">{activePackage.code}</span>}
        {hasModel && <span className="ui-chip" data-tone="violet"><Boxes className="h-3 w-3" /> model loaded</span>}
        {hasStoredData && (
          <span className="ui-chip" data-tone="ok">
            <Database className="h-3 w-3" /> {persistence.progressCount} rows saved
          </span>
        )}
        {persistence?.bridgeItemCount > 0 && (
          <span className="ui-chip" data-tone="ok">
            <Database className="h-3 w-3" /> {persistence.bridgeItemCount} register rows saved
          </span>
        )}
      </div>
    </header>
  );
}

function StepHead({ title, body }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-extrabold font-[Outfit]">{title}</h3>
      <p className="text-xs text-[var(--text-muted)] max-w-2xl">{body}</p>
    </div>
  );
}

function Banner({ tone, icon: Icon, children }) {
  const colour = tone === 'late' ? 'var(--late)' : tone === 'active' ? 'var(--active)' : 'var(--accent)';
  return (
    <div
      className="flex items-start gap-2.5 p-3.5 rounded-[var(--radius-sm)] border text-xs"
      style={{ borderColor: `color-mix(in srgb, ${colour} 35%, transparent)`, background: `color-mix(in srgb, ${colour} 8%, transparent)`, color: colour }}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <span className="text-[var(--text)]">{children}</span>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === 'ok' ? 'var(--ok)' : tone === 'active' ? 'var(--active)'
    : tone === 'violet' ? 'var(--violet)' : 'var(--text-muted)';
  return (
    <div className="glass-card p-3">
      <div className="text-2xl font-extrabold font-mono tabular-nums" style={{ color: colour }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-bold">{label}</div>
    </div>
  );
}
