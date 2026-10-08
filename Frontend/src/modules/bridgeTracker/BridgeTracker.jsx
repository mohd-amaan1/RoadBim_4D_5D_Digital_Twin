import React, { useEffect, useRef } from 'react';
import { BackendStore } from './backendStore';
import { mountTracker } from './app';
import './tracker.css';

/**
 * The Palashbari bridge RFI tracker, hosted as a screen of RoadBIM.
 *
 * The tracker owns its own DOM, viewer and state — React only gives it an element and
 * takes it back. Mounted per package: switching package tears it down and starts again
 * against the new package's uploads, so nothing from one package can leak into another.
 */
export default function BridgeTracker({ packageId }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !packageId) return undefined;
    const unmount = mountTracker(host, { store: new BackendStore(packageId) });
    return unmount;
  }, [packageId]);

  return (
    <div
      ref={hostRef}
      className="bt-root rounded-[14px] border border-[var(--line)]"
      style={{ height: 'calc(100vh - 3.5rem - 4rem)', minHeight: 520 }}
    />
  );
}
