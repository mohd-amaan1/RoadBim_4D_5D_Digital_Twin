// The tracker's figures without the tracker open: the same files, settings and code path
// (plan.js, engine.js), only no scene. Loaded on demand — it carries the IFC reader.
import { BackendStore } from './backendStore.js';
import { parseIFC } from './ifc.js';
import { parseRegister } from './register.js';
import { parseIPC } from './ipc.js';
import { evaluate } from './engine.js';
import { planScene, mergeConfig } from './plan.js';
import { summarise, signatureOf } from './summary.js';
import { publishTrackerSummary, cachedTrackerSummary } from './summaryStore.js';

const inflight = new Map(); // packageId -> Promise

/**
 * Brings the package's figures up to date: re-reads which files and settings are current
 * (one small request) and recomputes only if they differ from what was last published.
 */
export function refreshTrackerSummary(packageId) {
  if (inflight.has(packageId)) return inflight.get(packageId);
  const p = (async () => {
    const store = new BackendStore(packageId);
    const state = await store.loadState();
    const config = mergeConfig(await store.loadConfig());
    const sig = signatureOf(state, config);
    const cached = cachedTrackerSummary(packageId);
    if (cached?.sig === sig) return cached.summary;

    const active = state.ipcs.find((x) => x.asset === state.activeIpc) || [...state.ipcs].sort((a, b) => b.at - a.at)[0] || null;
    const [ifcText, regBuf, ipcBuf] = await Promise.all([
      state.ifc ? store.getContent(state.ifc) : null,
      state.register ? store.getContent(state.register) : null,
      active ? store.getContent(active) : null,
    ]);
    const model = ifcText ? await parseIFC(ifcText, { fileName: state.ifc.name }) : null;
    const register = regBuf ? parseRegister(regBuf, state.register.name) : null;
    const ipc = ipcBuf ? await parseIPC(ipcBuf, { fileName: active.name }) : null;
    const plan = model ? planScene({ model, register, config }) : null;
    const ev = evaluate({ ipc, model, link: plan?.link || null, config });
    const place = plan ? { modules: plan.places, modelled: plan.modelled } : null;
    const summary = summarise({ state, ipc, ev, link: plan?.link || null, map: plan?.map || null, place, model });
    publishTrackerSummary(packageId, sig, summary);
    return summary;
  })();
  inflight.set(packageId, p);
  p.finally(() => inflight.delete(packageId)).catch(() => {});
  return p;
}
