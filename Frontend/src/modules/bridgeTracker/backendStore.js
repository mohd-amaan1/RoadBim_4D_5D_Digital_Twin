// Where uploads live: the RoadBIM backend, per package. Replaces the standalone tracker's
// store.js (the claude.ai artifact store / IndexedDB) behind the same interface, so app.js
// reads and writes exactly as it did.
//
// The server is the source of truth for what is current. It decides that an uploaded model
// supersedes the last one and that a new IPC becomes the one in view, so loadState() always
// reads back rather than trusting what the browser last wrote.
import { api } from '../../api/client';

export const emptyState = () => ({ ifc: null, register: null, context: null, ipcs: [], activeIpc: null });

// How each kind of file is handed back to the parsers.
const ENC = { ifc: 'text', register: 'binary', ipc: 'binary', alignment: 'json' };

const POLL_MS = 30000;

function toMeta(f) {
  if (!f) return null;
  return {
    asset: String(f.id),
    kind: f.kind,
    name: f.fileName,
    size: f.byteSize,
    enc: ENC[f.kind],
    at: Date.parse(f.uploadedAt),
    by: f.uploadedByUserId ?? null,
    byName: f.uploadedByName ?? null,
    bill: f.bill ?? undefined,
    period: f.period ?? undefined,
  };
}

// Enough to tell "someone else uploaded something" from "nothing changed".
const signature = (st) => [st.ifc?.asset, st.register?.asset, st.context?.asset, st.activeIpc, ...st.ipcs.map((x) => x.asset)].join('|');

export class BackendStore {
  constructor(packageId) {
    this.packageId = packageId;
    this.shared = true; // every viewer of the package sees the same uploads
    this.canWrite = false;
    this.me = null;
    this.userNames = {};
    this.lastConfig = null;
    this.contentCache = new Map(); // asset -> Promise<content>; files never change under an id
  }

  get where() { return 'shared'; }

  async init() {
    await this.fetchState();
    return this;
  }

  async fetchState() {
    const d = await api.getBridgeTracker(this.packageId);
    this.canWrite = !!d.canWrite;
    this.lastConfig = d.config && Object.keys(d.config).length ? d.config : null;
    const st = {
      ifc: toMeta(d.ifc),
      register: toMeta(d.register),
      context: toMeta(d.alignment),
      ipcs: (d.ipcs || []).map(toMeta),
      activeIpc: d.activeIpcFileId != null ? String(d.activeIpcFileId) : null,
    };
    for (const m of [st.ifc, st.register, st.context, ...st.ipcs]) if (m?.by && m.byName) this.userNames[m.by] = m.byName;
    this.state = st;
    return st;
  }

  async loadState() {
    return { ...emptyState(), ...(await this.fetchState()) };
  }

  // The only part of the state the browser decides is which IPC the team is looking at.
  async saveState(st) {
    if (st.activeIpc && st.activeIpc !== this.state?.activeIpc) {
      await api.setBridgeTrackerActiveIpc(this.packageId, st.activeIpc);
      if (this.state) this.state.activeIpc = st.activeIpc;
    }
  }

  // No push channel: re-read on return to the tab and every half minute while it is open.
  watchState(fn) {
    let last = this.state ? signature(this.state) : '';
    let busy = false;
    const check = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const st = await this.loadState();
        const sig = signature(st);
        if (sig !== last) { last = sig; fn(st); }
      } catch { /* offline for a moment; the next check tries again */ } finally { busy = false; }
    };
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }

  async loadConfig() {
    if (this.state === undefined) await this.fetchState();
    return this.lastConfig;
  }

  async saveConfig(cfg) {
    await api.saveBridgeTrackerConfig(this.packageId, JSON.parse(JSON.stringify(cfg)));
    this.lastConfig = cfg;
  }

  async putFile(file, kind, extra = {}) {
    if (!this.canWrite) throw new Error('You can view this tracker but not upload to it. Ask a project owner for contributor access.');
    const res = await api.uploadBridgeTrackerFile(this.packageId, kind, file, extra);
    return { meta: toMeta(res.file), alreadyStored: res.alreadyStored };
  }

  // The alignment is reduced to a compact JSON frame in the browser; only that is stored.
  async putJSON(obj, name) {
    if (!this.canWrite) throw new Error('You can view this tracker but not upload to it. Ask a project owner for contributor access.');
    const jsonName = /\.json$/i.test(name) ? name : name.replace(/\.(kmz|kml)$/i, '') + '.alignment.json';
    const file = new File([JSON.stringify(obj)], jsonName, { type: 'application/json' });
    const res = await api.uploadBridgeTrackerFile(this.packageId, 'alignment', file);
    return { meta: toMeta(res.file), alreadyStored: res.alreadyStored };
  }

  getContent(meta) {
    if (!this.contentCache.has(meta.asset)) {
      const p = (async () => {
        const res = await api.getBridgeTrackerFileContent(meta.asset);
        if (meta.enc === 'text') return res.text();
        if (meta.enc === 'json') return res.json();
        return res.arrayBuffer();
      })();
      p.catch(() => this.contentCache.delete(meta.asset));
      this.contentCache.set(meta.asset, p);
    }
    return this.contentCache.get(meta.asset);
  }

  async names(ids) {
    const out = {};
    for (const id of ids) if (id && this.userNames[id]) out[id] = this.userNames[id];
    return out;
  }
}
