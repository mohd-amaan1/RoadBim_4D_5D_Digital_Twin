import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Loader2, AlertTriangle, UserPlus, Send, XCircle, Check,
  MapPin, Clock, CheckCircle2, Factory, Boxes, Layers, Ruler, ScanEye,
  Camera, ThumbsUp, ThumbsDown, ChevronLeft, ChevronRight, Crosshair, ImageOff,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useRoadData } from '../../context/RoadDataContext';
import InspectDialog from './InspectDialog';
import {
  RAIL, railState, STAGE_STYLE, SIDE_LABEL, formatDateTime, ago,
} from './rfiVocabulary';

/**
 * One request for inspection, in full.
 *
 * Four panels: the stage rail, the facts, a map of where the work is, and the timeline.
 * There is no transfer control — an RFI moves between engineers by being reassigned, which
 * is one field on the record rather than a workflow of its own.
 *
 * The BOQ reference is shown but drives nothing: it is a commercial fact, and what the map
 * draws is a physical one.
 */
export default function RfiDetail({ rfiId, onBack, onChanged }) {
  const { canEdit, packages } = useAuth();
  // Recording a verdict rewrites this package's progress rows, so the map, the 3D tint,
  // the heatmap and the KPIs all have to be re-read — reloading the package moves them
  // together rather than leaving the register ahead of the drawing.
  const { reloadProject } = useRoadData();

  const [inspections, setInspections] = useState([]);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [engineers, setEngineers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [record, visits] = await Promise.all([
        api.getRfi(rfiId),
        api.listInspections(rfiId),
      ]);
      setDetail(record);
      setInspections(visits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rfiId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const first = packages?.[0];
    if (!first?.id) return;
    let cancelled = false;
    api.getRfiFormOptions(first.id)
      .then((o) => { if (!cancelled) setEngineers(o.engineers || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [packages]);

  const act = async (name, fn) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Shell onBack={onBack}>
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (!detail) {
    return (
      <Shell onBack={onBack}>
        <p className="p-6 text-sm text-[var(--text-muted)]">{error || 'This request could not be loaded.'}</p>
      </Shell>
    );
  }

  const card = detail.header;
  const style = STAGE_STYLE[card.stageKey] || {};
  const allowed = new Set(detail.allowedActions || []);
  const { done, current } = railState(card);

  return (
    <Shell onBack={onBack}>
      <div className="space-y-4">
        {/* ---- header ---- */}
        <div className="glass-panel p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold px-2.5 py-1 rounded-md bg-[var(--surface-3)] border border-[var(--line-strong)]">
              {card.rfiNo}
            </span>
            <span className="ui-chip" data-tone={style.tone}>{card.statusLabel}</span>
            {card.assignedToName
              ? <span className="ui-chip"><ScanEye className="h-3 w-3" /> {card.assignedToName}</span>
              : <span className="ui-chip" data-tone="active">Unassigned</span>}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canEdit && allowed.has('assign') && (
                <button onClick={() => setAssignOpen((v) => !v)} className="ui-btn py-1.5 text-xs">
                  <UserPlus className="h-3.5 w-3.5" /> {card.assignedToName ? 'Reassign' : 'Assign'}
                </button>
              )}
              {canEdit && allowed.has('submit') && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => act('submit', () => api.submitRfi(card.id))}
                  className="ui-btn ui-btn-primary py-1.5 text-xs"
                >
                  {busy === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Raise and submit
                </button>
              )}
              {canEdit && allowed.has('inspect') && (
                <button onClick={() => setInspectOpen(true)} className="ui-btn ui-btn-primary py-1.5 text-xs">
                  <Camera className="h-3.5 w-3.5" /> Record inspection
                </button>
              )}
              {canEdit && allowed.has('approve') && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => act('approve', () => api.decideRfi(card.id, 'approve', null))}
                  className="ui-btn ui-btn-primary py-1.5 text-xs"
                >
                  {busy === 'approve'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ThumbsUp className="h-3.5 w-3.5" />}
                  Approve
                </button>
              )}
              {canEdit && allowed.has('reject') && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => act('reject', () => api.decideRfi(card.id, 'reject', null))}
                  className="ui-btn py-1.5 text-xs"
                >
                  <ThumbsDown className="h-3.5 w-3.5" /> Reject
                </button>
              )}
              {canEdit && allowed.has('cancel') && (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => act('cancel', () => api.cancelRfi(card.id, null))}
                  className="ui-btn ui-btn-ghost py-1.5 text-xs"
                >
                  <XCircle className="h-3.5 w-3.5" /> Cancel
                </button>
              )}
            </div>
          </div>

          <h2 className="text-lg font-bold font-[Outfit]">{card.title}</h2>
          {detail.description && (
            <p className="text-sm text-[var(--text-muted)]">{detail.description}</p>
          )}

          {assignOpen && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--line)]">
              <span className="ui-label">Assign to field engineer</span>
              <select
                defaultValue={card.assignedToUserId ?? ''}
                onChange={(e) => act('assign', () => api.assignRfi(
                  card.id, e.target.value === '' ? null : Number(e.target.value),
                )).then(() => setAssignOpen(false))}
                className="ui-select w-auto min-w-[16rem] py-1.5 text-xs"
              >
                <option value="">Nobody — leave unassigned</option>
                {engineers.map((e) => (
                  <option key={e.userId} value={e.userId}>
                    {e.displayName} · {e.role}
                    {e.openAssignedCount > 0 ? ` (${e.openAssignedCount} open)` : ''}
                  </option>
                ))}
              </select>
              {engineers.length === 0 && (
                <span className="text-[11px] text-[var(--active)]">
                  Nobody on this project is marked as a field engineer yet, so there is
                  nobody who could inspect it.
                </span>
              )}
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 text-xs font-semibold text-[var(--late)]" role="alert">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" /> {error}
            </p>
          )}
        </div>

        {/* ---- the four stages ---- */}
        <div className="glass-panel p-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--line)] rounded-lg overflow-hidden">
            {RAIL.map((stage) => {
              const isDone = done.has(stage.key);
              const isCurrent = current === stage.key && !isDone;
              return (
                <div
                  key={stage.key}
                  className="bg-[var(--surface-2)] p-3 space-y-1.5"
                  style={{ borderTop: `3px solid ${isDone ? 'var(--ok)' : isCurrent ? 'var(--accent)' : 'var(--line-strong)'}` }}
                >
                  <div className="flex items-center gap-1.5">
                    {isDone
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--ok)]" />
                      : <Clock className={`h-3.5 w-3.5 ${isCurrent ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`} />}
                    <span className={`text-xs font-bold ${isDone || isCurrent ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>
                      {stage.label}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[var(--text-muted)]">
                    {stageDetail(stage.key, card)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ---- facts ---- */}
          <div className="glass-panel p-4 space-y-3 lg:col-span-1">
            <h3 className="text-sm font-bold font-[Outfit]">Details</h3>
            <dl className="space-y-2.5">
              <Row icon={Boxes} label="Package" value={`${card.packageCode} · ${card.packageName}`} />
              <Row icon={Factory} label="Contractor" value={card.contractorName || '—'} />
              <Row icon={MapPin} label="Chainage" value={card.chainageLabel} mono />
              <Row icon={Layers} label="Layer"
                value={card.layerCode
                  ? `${card.layerCode}${card.layerName ? ` · ${card.layerName}` : ''}`
                  : 'Whole cross-section'} />
              {/* BOQ is a commercial reference and drives nothing here; shown so the
                  record is complete, not because anything reads it. */}
              <Row icon={Layers} label="BOQ ref"
                value={[card.componentRef, card.subComponentRef].filter(Boolean).join(' / ') || '—'} />
              <Row icon={Ruler} label="Quantity"
                value={card.quantity === null || card.quantity === undefined ? '—' : `${card.quantity} m`} />
              <Row icon={MapPin} label="Location" value={card.locationText || '—'} />
              <Row icon={MapPin} label="Side" value={SIDE_LABEL[card.side] || card.side} />
              <Row icon={ScanEye} label="Raised by" value={card.raisedByName || '—'} />
              <Row icon={Clock} label="Requested slot"
                value={detail.requiredInspectionAt ? formatDateTime(detail.requiredInspectionAt) : '—'} />
            </dl>
          </div>

          {/* ---- where ---- */}
          <div className="glass-panel p-4 lg:col-span-2 space-y-3">
            <h3 className="text-sm font-bold font-[Outfit]">Where</h3>
            <RfiMap latitude={detail.latitude} longitude={detail.longitude} label={card.chainageLabel} />
          </div>
        </div>

        {/* ---- visits ---- */}
        {inspections.length > 0 && (
          <div className="glass-panel p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold font-[Outfit]">Inspection visits</h3>
              <span className="ui-chip">{inspections.length}</span>
              {inspections.length > 1 && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  more than one means the work was re-offered
                </span>
              )}
            </div>
            {inspections.map((visit) => <Visit key={visit.id} visit={visit} />)}
          </div>
        )}

        {/* ---- timeline ---- */}
        <div className="glass-panel p-4 space-y-3">
          <h3 className="text-sm font-bold font-[Outfit]">History</h3>
          {(detail.events || []).length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">Nothing recorded yet.</p>
          )}
          <ol className="space-y-2.5">
            {(detail.events || []).map((e, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="mt-1 h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--text)]">
                    {eventLabel(e)}
                    {e.actorName && <span className="text-[var(--text-muted)] font-normal"> · {e.actorName}</span>}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--text-faint)]">
                    {formatDateTime(e.occurredAt)} · {ago(e.occurredAt)}
                  </div>
                  {e.comment && <p className="text-xs text-[var(--text-muted)] mt-0.5">{e.comment}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>

      </div>

      <InspectDialog
        rfi={card}
        open={inspectOpen}
        onClose={() => setInspectOpen(false)}
        onRecorded={async () => {
          await load();
          // The verdict has just rewritten this package's progress rows. Pulling them here
          // is what makes the map repaint in the same breath as the record changing.
          await reloadProject();
          onChanged?.();
        }}
      />
    </Shell>
  );
}

/* ------------------------------------------------------------------ visit */

/**
 * One visit, with its photos in a slider.
 *
 * The device coordinates sit beside the verdict rather than tucked away. They are the
 * evidence somebody was standing on the work — an inspection recorded from an office is a
 * different thing from one recorded on site, and the record should let you tell.
 */
function Visit({ visit }) {
  const [index, setIndex] = useState(0);
  const photos = visit.photos || [];
  const passed = visit.outcome === 'pass';

  return (
    <div className="rounded-lg border border-[var(--line)] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-3 bg-[var(--surface-2)]">
        <span className="ui-chip">Visit {visit.visitNo}</span>
        <span className="ui-chip" data-tone={passed ? 'ok' : 'late'}>
          {passed ? <Check className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {passed ? 'Pass' : 'Fail'}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{visit.inspectedByName}</span>
        <span className="ml-auto text-[11px] font-mono text-[var(--text-faint)]">
          {formatDateTime(visit.inspectedAt)}
        </span>
      </div>

      {visit.remarks && (
        <p className="px-3 py-2 text-xs text-[var(--text-muted)] border-b border-[var(--line)]">
          {visit.remarks}
        </p>
      )}

      {visit.deviceLatitude != null && (
        <p className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-[11px] font-mono text-[var(--text-faint)] border-b border-[var(--line)]">
          <Crosshair className="h-3 w-3 text-[var(--accent)]" />
          device at {visit.deviceLatitude.toFixed(6)}, {visit.deviceLongitude.toFixed(6)}
          {visit.locationAccuracyM != null && (
            <span className={visit.locationAccuracyM > 50 ? 'text-[var(--active)]' : ''}>
              ±{Math.round(visit.locationAccuracyM)} m
            </span>
          )}
        </p>
      )}

      {photos.length > 0 && (
        <div className="relative bg-black/40">
          <AuthedImage
            url={photos[index].url}
            alt={`Visit ${visit.visitNo}, photo ${index + 1}`}
          />
          {photos.length > 1 && (
            <>
              <button
                onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/70 text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIndex((i) => (i + 1) % photos.length)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/70 text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-mono">
                {index + 1} / {photos.length}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * An <img> for a photo that needs the bearer token.
 *
 * Inspection photos are project data behind the same membership check as everything else,
 * so the browser cannot simply be pointed at the URL — a plain tag sends no Authorization
 * header and gets a 401 back, which renders as a broken image with no clue why. Fetching
 * through the API client and handing the tag an object URL keeps the check intact.
 *
 * The object URL is revoked whenever the photo changes or the view closes; without that
 * every flick through the slider would leak the whole image.
 */
function AuthedImage({ url, alt }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    setSrc(null);
    setFailed(false);

    api.fetchPhoto(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex items-center justify-center gap-2 h-40 text-xs text-[var(--text-muted)]">
        <ImageOff className="h-4 w-4" /> This photo could not be loaded.
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-faint)]" />
      </div>
    );
  }

  return <img src={src} alt={alt} className="w-full max-h-80 object-contain" />;
}

/* -------------------------------------------------------------------- map */

/**
 * Leaflet is loaded globally by index.html, the same as the plan view. Pins where the
 * chainage says the work is — until phase 3 records where the engineer's phone actually
 * was, which is a different and better fact.
 */
function RfiMap({ latitude, longitude, label }) {
  const [container, setContainer] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const L = window.L;
    if (!L || !container || mapRef.current) return;
    if (latitude == null || longitude == null) return;

    const map = L.map(container, {
      center: [latitude, longitude],
      zoom: 17,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    mapRef.current = map;

    L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 21,
      attribution: '&copy; Google',
    }).addTo(map);

    L.circleMarker([latitude, longitude], {
      radius: 8, color: '#0B0F17', weight: 2, fillColor: '#38BDF8', fillOpacity: 1,
    }).bindTooltip(label || 'Work location', { direction: 'top', offset: [0, -8] }).addTo(map);

    // Leaflet measures its container once; this panel is inside a grid that has not
    // settled at that moment, which is what leaves the map cropped without this.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(container);
    const raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [container, latitude, longitude, label]);

  if (latitude == null || longitude == null) {
    return (
      <div className="h-64 rounded-lg border border-dashed border-[var(--line-strong)] flex items-center justify-center">
        <p className="text-xs text-[var(--text-muted)] text-center px-6">
          The chainages this request covers carry no coordinates, so there is nothing to pin.
          Import a Road_chainage workbook with latitude and longitude to place it.
        </p>
      </div>
    );
  }

  return <div ref={setContainer} className="h-64 rounded-lg overflow-hidden border border-[var(--line)]" />;
}

/* ----------------------------------------------------------------- chrome */

function Shell({ children, onBack }) {
  return (
    <div className="space-y-4 animate-slide-up">
      <button onClick={onBack} className="ui-btn ui-btn-ghost py-1.5 text-xs">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to register
      </button>
      {children}
    </div>
  );
}

function Row({ icon: Icon, label, value, mono }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--text-faint)]" />
      <div className="min-w-0 flex-1">
        <dt className="ui-label">{label}</dt>
        <dd className={`text-xs text-[var(--text-muted)] ${mono ? 'font-mono' : ''}`}>{value}</dd>
      </div>
    </div>
  );
}

function stageDetail(key, card) {
  switch (key) {
    case 'raised':
      return card.submittedAt ? formatDateTime(card.submittedAt) : 'Not raised';
    case 'due':
      if (!card.dueAt) return 'Pending';
      return card.isOverdue ? `Overdue · ${ago(card.dueAt)}` : formatDateTime(card.dueAt);
    case 'inspected':
      return card.inspectedAt ? formatDateTime(card.inspectedAt) : 'Pending';
    case 'approved':
      return card.approvedAt ? formatDateTime(card.approvedAt) : 'Pending';
    default:
      return '';
  }
}

function eventLabel(e) {
  switch (e.eventType) {
    case 'created': return 'Draft created';
    case 'submitted': return 'Raised for inspection';
    case 'assigned': return 'Engineer assigned';
    case 'unassigned': return 'Engineer removed';
    case 'inspected': return 'Inspection recorded';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'cancelled': return 'Cancelled';
    default: return e.eventType;
  }
}
