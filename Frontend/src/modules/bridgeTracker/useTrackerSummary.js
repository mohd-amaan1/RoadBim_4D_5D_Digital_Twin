import { useEffect, useState } from 'react';
import { cachedTrackerSummary, onTrackerSummary } from './summaryStore';

/**
 * The Palashbari tracker's figures for a package, for screens outside the tracker.
 *
 * Shows what was last published at once — by the tracker itself if it has been open —
 * then checks the files and settings are still the ones it was computed from, and
 * recomputes in the background if not. `enabled` false (a road package) does nothing.
 */
export function useTrackerSummary(packageId, enabled = true) {
  const [summary, setSummary] = useState(() => (enabled ? cachedTrackerSummary(packageId)?.summary ?? null : null));
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled || !packageId) { setSummary(null); setStatus('idle'); return undefined; }
    let live = true;
    const cached = cachedTrackerSummary(packageId);
    setSummary(cached?.summary ?? null);
    setStatus(cached ? 'ready' : 'loading');
    setError(null);
    const off = onTrackerSummary((id) => {
      if (live && id === packageId) { setSummary(cachedTrackerSummary(id)?.summary ?? null); setStatus('ready'); }
    });
    import('./computeSummary')
      .then((m) => m.refreshTrackerSummary(packageId))
      .then((s) => { if (live) { setSummary(s); setStatus('ready'); } })
      .catch((err) => { if (live) { setError(err.message || 'The tracker figures could not be read.'); setStatus('error'); } });
    return () => { live = false; off(); };
  }, [packageId, enabled]);

  return { summary, status, error };
}
