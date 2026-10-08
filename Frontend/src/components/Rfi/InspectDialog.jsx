import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Loader2, X, AlertTriangle, Check, XCircle, Crosshair, Trash2, MapPin,
} from 'lucide-react';
import { api } from '../../api/client';

/**
 * Record an inspection visit.
 *
 * Four inputs and a verdict. The verdict is what repaints the map, so the dialog is built
 * around making it hard to record one carelessly:
 *
 *   * A photo is required — a verdict with no evidence is an opinion.
 *   * A refusal must say why, or the contractor has nothing to act on.
 *   * The GPS fix is shown with its accuracy BEFORE submitting, so a bad one is visible
 *     rather than silently attached to the record.
 */

export default function InspectDialog({ rfi, open, onClose, onRecorded }) {
  const [outcome, setOutcome] = useState('pass');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [gps, setGps] = useState({ status: 'idle' });
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setOutcome('pass');
    setRemarks('');
    setPhotos([]);
    setError(null);
    setGps({ status: 'idle' });
  }, [open, rfi?.id]);

  // Object URLs must be released, or every reopened dialog leaks the previews
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), [photos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setGps({ status: 'error', message: 'This browser cannot report a location.' });
      return;
    }
    setGps({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({
        status: 'found',
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => setGps({
        status: 'error',
        // The usual cause is not permission but the page being served over plain HTTP,
        // which silently disables geolocation everywhere except localhost.
        message: err.code === err.PERMISSION_DENIED
          ? 'Location was blocked. Allow it for this site, or record the visit without it.'
          : `Could not get a fix: ${err.message}. Geolocation needs HTTPS away from localhost.`,
      }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  // Asked for as soon as the dialog opens: the engineer is standing on the work now, and
  // a fix taken later in the office would be worse than none.
  useEffect(() => { if (open) locate(); }, [open, locate]);

  const addPhotos = (files) => {
    const incoming = [...files].filter((f) => f.type.startsWith('image/'));
    setPhotos((current) => [
      ...current,
      ...incoming.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
  };

  const removePhoto = (index) => setPhotos((current) => {
    URL.revokeObjectURL(current[index].preview);
    return current.filter((_, i) => i !== index);
  });

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (photos.length === 0) return setError('Attach at least one photo of the work.');
    if (outcome === 'fail' && !remarks.trim())
      return setError('Say why the work was refused — a failed inspection needs remarks.');

    setBusy(true);
    try {
      const result = await api.recordInspection(rfi.id, {
        outcome,
        remarks: remarks.trim() || null,
        deviceLatitude: gps.status === 'found' ? gps.latitude : null,
        deviceLongitude: gps.status === 'found' ? gps.longitude : null,
        locationAccuracyM: gps.status === 'found' ? gps.accuracy : null,
        photos: photos.map((p) => p.file),
      });
      onRecorded?.(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="ui-overlay flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record inspection"
        className="glass-panel w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 space-y-5"
      >
        <header className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-line)]">
            <Camera className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold font-[Outfit]">Record inspection</h2>
            <p className="text-xs text-[var(--text-muted)] font-mono truncate">
              {rfi?.rfiNo} · {rfi?.chainageLabel}
            </p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="ui-btn ui-btn-ghost shrink-0 !px-2">
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* ---- the verdict ---- */}
        <div className="space-y-1.5">
          <span className="ui-label">Outcome</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOutcome('pass')}
              className={`ui-btn justify-start ${outcome === 'pass' ? '!border-[var(--ok)] !text-[var(--ok)]' : ''}`}
            >
              <Check className="h-4 w-4" /> Pass — accept the work
            </button>
            <button
              onClick={() => setOutcome('fail')}
              className={`ui-btn justify-start ${outcome === 'fail' ? '!border-[var(--late)] !text-[var(--late)]' : ''}`}
            >
              <XCircle className="h-4 w-4" /> Fail — refuse it
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-faint)]">
            {outcome === 'pass'
              ? 'These chainages turn green on the map once this is approved.'
              : 'These chainages turn red immediately, and stay red until a later visit passes.'}
          </p>
        </div>

        {/* ---- remarks ---- */}
        <label className="block space-y-1.5">
          <span className="ui-label">
            Remarks{outcome === 'fail' && <span className="text-[var(--late)]"> *</span>}
          </span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            className="ui-input resize-y"
            placeholder={outcome === 'fail'
              ? 'What is wrong, and what has to change before it is re-offered?'
              : 'Anything worth recording about the work as found.'}
          />
        </label>

        {/* ---- photos ---- */}
        <div className="space-y-1.5">
          <span className="ui-label">Photos <span className="text-[var(--late)]">*</span></span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
          />
          <button onClick={() => fileRef.current?.click()} className="ui-btn w-full justify-center">
            <Camera className="h-4 w-4" /> Take or choose photos
          </button>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
              {photos.map((p, i) => (
                <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-[var(--line-strong)]">
                  <img src={p.preview} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 p-1 rounded-md bg-black/70 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- where the device is ---- */}
        <div className="space-y-1.5">
          <span className="ui-label">Location</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={locate} disabled={gps.status === 'locating'} className="ui-btn py-1.5 text-xs">
              {gps.status === 'locating'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Crosshair className="h-3.5 w-3.5" />}
              {gps.status === 'found' ? 'Refresh fix' : 'Get location'}
            </button>

            {gps.status === 'found' && (
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)]">
                <MapPin className="h-3.5 w-3.5 text-[var(--ok)]" />
                {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}
                <span className={gps.accuracy > 50 ? 'text-[var(--active)]' : 'text-[var(--text-faint)]'}>
                  ±{Math.round(gps.accuracy)} m
                </span>
              </span>
            )}
          </div>

          {gps.status === 'found' && gps.accuracy > 50 && (
            <p className="text-[11px] text-[var(--active)]">
              That fix is only accurate to {Math.round(gps.accuracy)} m. Worth refreshing outdoors
              before submitting — it is recorded as evidence of where you stood.
            </p>
          )}
          {gps.status === 'error' && (
            <p className="text-[11px] text-[var(--text-muted)]">{gps.message}</p>
          )}
        </div>

        {error && (
          <p className="flex items-start gap-2 text-xs font-semibold text-[var(--late)]" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" /> {error}
          </p>
        )}

        <footer className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--line)]">
          <span className="text-[11px] text-[var(--text-muted)] mr-auto">
            A visit cannot be edited once recorded.
          </span>
          <button onClick={onClose} disabled={busy} className="ui-btn">Cancel</button>
          <button onClick={submit} disabled={busy} className="ui-btn ui-btn-primary">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Record {outcome === 'pass' ? 'pass' : 'failure'}
          </button>
        </footer>
      </div>
    </div>
  );
}
