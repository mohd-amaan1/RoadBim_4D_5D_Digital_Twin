/**
 * Thin client for the RoadBIM API.
 *
 * Every call carries the bearer token; a 401 clears it and notifies listeners so the
 * app can drop back to the sign-in screen rather than rendering half-loaded state.
 */

/**
 * Empty by default, so every call is same-origin and Vite proxies /api to the backend
 * (see vite.config.js). That keeps one URL for the whole app, which is what lets a single
 * ngrok tunnel serve both halves — and removes the cross-origin request entirely.
 *
 * Set VITE_API_BASE to talk to a backend on another host.
 */
const BASE = import.meta.env?.VITE_API_BASE ?? '';
const TOKEN_KEY = 'roadbim.token';
const USER_KEY = 'roadbim.user';

let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  getUser: () => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  setUser: (user) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Guards a path segment before it is interpolated into a URL.
 *
 * Without this a missing id becomes the literal string "undefined" in the path, and the
 * server answers 404 — which reads as "that package does not exist" when the truth is
 * "the client never had an id to send". Failing here names the actual fault instead of
 * sending a request that can only be misunderstood.
 */
function seg(value, what) {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    throw new ApiError(0, `No ${what} is selected. Choose one and try again.`);
  }
  return encodeURIComponent(String(value));
}

async function request(path, { method = 'GET', body, formData, raw = false } = {}) {
  const headers = {
    // ngrok free tier answers unknown browser requests with an HTML interstitial. Without
    // this header the first API call returns that page instead of JSON, and every request
    // fails with a parse error that looks nothing like the actual cause.
    'ngrok-skip-browser-warning': 'true',
  };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  if (response.status === 401) {
    tokenStore.clear();
    onUnauthorized?.();
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }

  if (raw) {
    if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status})`);
    return response;
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message = parsed?.message || parsed?.title || `Request failed (${response.status})`;
    throw new ApiError(response.status, message, parsed);
  }

  return parsed;
}

export const api = {
  // ---------------------------------------------------------------- auth
  register: (email, password, displayName) =>
    request('/api/auth/register', { method: 'POST', body: { email, password, displayName } }),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/api/auth/me'),

  // ------------------------------------------------------------ projects
  listProjects: () => request('/api/projects'),
  getProject: (idOrCode) => request(`/api/projects/${idOrCode}`),
  createProject: (name, code, description) =>
    request('/api/projects', { method: 'POST', body: { name, code, description } }),
  updateProject: (idOrCode, patch) =>
    request(`/api/projects/${idOrCode}`, { method: 'PATCH', body: patch }),

  listMembers: (idOrCode) => request(`/api/projects/${idOrCode}/members`),
  addMember: (idOrCode, email, role) =>
    request(`/api/projects/${idOrCode}/members`, { method: 'POST', body: { email, role } }),

  // ------------------------------------------------------------- packages
  listPackages: (idOrCode) => request(`/api/projects/${seg(idOrCode, 'project')}/packages`),
  getPackage: (packageId) => request(`/api/packages/${seg(packageId, 'package')}`),
  createPackage: (idOrCode, fields) =>
    request(`/api/projects/${idOrCode}/packages`, { method: 'POST', body: fields }),
  updatePackage: (packageId, patch) =>
    request(`/api/packages/${seg(packageId, 'package')}`, { method: 'PATCH', body: patch }),
  deletePackage: (packageId) =>
    request(`/api/packages/${seg(packageId, 'package')}`, { method: 'DELETE', raw: true }),

  // ----------------------------------------------------------------- data
  //
  // Project-level reads return every package's rows, each tagged with `packageId`.
  // That is what draws the whole project on one map: one request, not one per package.
  getChainages: (idOrCode) => request(`/api/projects/${seg(idOrCode, 'project')}/chainages`),
  getLayers: (idOrCode) => request(`/api/projects/${seg(idOrCode, 'project')}/layers`),
  getProgress: (idOrCode) => request(`/api/projects/${seg(idOrCode, 'project')}/progress`),

  getPackageChainages: (packageId) => request(`/api/packages/${seg(packageId, 'package')}/chainages`),
  getPackageLayers: (packageId) => request(`/api/packages/${seg(packageId, 'package')}/layers`),
  getPackageProgress: (packageId) => request(`/api/packages/${seg(packageId, 'package')}/progress`),
  replaceBindings: (idOrCode, ifcModelId, bindings) =>
    request(`/api/projects/${seg(idOrCode, 'project')}/bindings`, { method: "PUT", body: { ifcModelId, bindings } }),

  getBindings: (idOrCode, ifcModelId) =>
    request(`/api/projects/${seg(idOrCode, 'project')}/bindings${ifcModelId ? `?ifcModelId=${ifcModelId}` : ''}`),

  // ------------------------------------------------------------ IFC models
  //
  // A model belongs to a package, and one per package is active at a time — so a project
  // read returns several, and the viewer loads all of them.
  listModels: (idOrCode) => request(`/api/projects/${seg(idOrCode, 'project')}/ifc-models`),
  listPackageModels: (packageId) => request(`/api/packages/${seg(packageId, 'package')}/ifc-models`),
  getModelFile: (modelId) => request(`/api/ifc-models/${modelId}/file`, { raw: true }),
  getModelLayers: (modelId) => request(`/api/ifc-models/${modelId}/layers`),

  uploadModel: (packageId, file, metadata) => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('metadata', JSON.stringify(metadata));
    return request(`/api/packages/${seg(packageId, 'package')}/ifc-models`, { method: 'POST', formData: form });
  },

  // ---------------------------------------------------------------- import
  createImport: (packageId, payload, files = [], force = false) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('force', String(force));
    for (const file of files) form.append('files', file, file.name);
    return request(`/api/packages/${seg(packageId, 'package')}/imports`, { method: 'POST', formData: form });
  },

  listImports: (idOrCode) => request(`/api/projects/${idOrCode}/imports`),
  listPackageImports: (packageId) => request(`/api/packages/${seg(packageId, 'package')}/imports`),
  getImport: (batchId) => request(`/api/imports/${batchId}`),
  getImportIssues: (batchId, level) =>
    request(`/api/imports/${batchId}/issues${level ? `?level=${level}` : ''}`),

  // ---------------------------------------------------------------- bridge
  //
  // A bridge package takes ONE register workbook instead of the four road sheets. Its
  // rows colour the model by IFC GUID and Approval.
  getPackageBridgeItems: (packageId) =>
    request(`/api/packages/${seg(packageId, 'package')}/bridge-items`),

  createBridgeImport: (packageId, payload, file, force = false) => {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('force', String(force));
    if (file) form.append('file', file, file.name);
    return request(`/api/packages/${seg(packageId, 'package')}/bridge-imports`, { method: 'POST', formData: form });
  },

  // ------------------------------------------------------- bridge tracker
  //
  // The Palashbari RFI tracker: four uploads (IFC, register, monthly IPC, alignment) and
  // a settings document. The server stores and serves the files; the browser parses them.
  getBridgeTracker: (packageId) =>
    request(`/api/packages/${seg(packageId, 'package')}/bridge-tracker`),

  uploadBridgeTrackerFile: (packageId, kind, file, { bill, period } = {}) => {
    const form = new FormData();
    form.append('kind', kind);
    if (bill) form.append('bill', bill);
    if (period) form.append('period', period);
    form.append('file', file, file.name);
    return request(`/api/packages/${seg(packageId, 'package')}/bridge-tracker/files`, { method: 'POST', formData: form });
  },

  /** The stored bytes, as a Response — the caller reads text, bytes or JSON by kind. */
  getBridgeTrackerFileContent: (fileId) =>
    request(`/api/bridge-tracker/files/${seg(fileId, 'file')}/content`, { raw: true }),

  saveBridgeTrackerConfig: (packageId, config) =>
    request(`/api/packages/${seg(packageId, 'package')}/bridge-tracker/config`, { method: 'PUT', body: config }),

  setBridgeTrackerActiveIpc: (packageId, fileId) =>
    request(`/api/packages/${seg(packageId, 'package')}/bridge-tracker/active-ipc`, {
      method: 'PUT', body: { fileId: Number(fileId) },
    }),

  // ------------------------------------------------------------------- RFI
  //
  // Requests for inspection. The register is project-scoped so every package's requests
  // sit in one list; raising is package-scoped because that is what an RFI belongs to.

  /** Chainage partitions, layer catalogue, engineers and the next number, in one call. */
  getRfiFormOptions: (packageId) =>
    request(`/api/packages/${seg(packageId, 'package')}/rfi-form-options`),

  raiseRfi: (packageId, fields) =>
    request(`/api/packages/${seg(packageId, 'package')}/rfis`, { method: 'POST', body: fields }),

  listRfis: (idOrCode, query = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '' || v === false) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return request(`/api/projects/${seg(idOrCode, 'project')}/rfis${qs ? `?${qs}` : ''}`);
  },

  getRfi: (rfiId) => request(`/api/rfis/${seg(rfiId, 'RFI')}`),

  submitRfi: (rfiId) =>
    request(`/api/rfis/${seg(rfiId, 'RFI')}/submit`, { method: 'POST', body: {} }),

  /** A null userId un-assigns — assignment is one field, not a workflow of its own. */
  assignRfi: (rfiId, userId, comment) =>
    request(`/api/rfis/${seg(rfiId, 'RFI')}/assign`, { method: 'POST', body: { userId, comment } }),

  cancelRfi: (rfiId, reason) =>
    request(`/api/rfis/${seg(rfiId, 'RFI')}/cancel`, { method: 'POST', body: { reason } }),

  // ------------------------------------------------------------ inspections
  //
  // The verdict and its photos travel in ONE request. Saving a pass and then failing to
  // upload its evidence is the state nobody wants to be left in.
  recordInspection: (rfiId, { outcome, remarks, deviceLatitude, deviceLongitude, locationAccuracyM, photos = [] }) => {
    const form = new FormData();
    form.append('outcome', outcome);
    if (remarks) form.append('remarks', remarks);
    if (deviceLatitude !== null && deviceLatitude !== undefined) form.append('deviceLatitude', String(deviceLatitude));
    if (deviceLongitude !== null && deviceLongitude !== undefined) form.append('deviceLongitude', String(deviceLongitude));
    if (locationAccuracyM !== null && locationAccuracyM !== undefined) form.append('locationAccuracyM', String(locationAccuracyM));
    for (const photo of photos) form.append('photos', photo, photo.name);
    return request(`/api/rfis/${seg(rfiId, 'RFI')}/inspections`, { method: 'POST', formData: form });
  },

  listInspections: (rfiId) => request(`/api/rfis/${seg(rfiId, 'RFI')}/inspections`),

  /**
   * Fetches a photo as a blob.
   *
   * Photos sit behind the same membership check as every other row, so the request needs
   * the bearer token — and an <img src> cannot carry one. Pointing the tag straight at the
   * URL is what made every photo render as a broken image: the browser asked anonymously
   * and the server answered 401.
   */
  fetchPhoto: async (url) => {
    const response = await request(url, { raw: true });
    return response.blob();
  },

  /** decision is 'approve' or 'reject'. The inspector cannot be the approver. */
  decideRfi: (rfiId, decision, remarks) =>
    request(`/api/rfis/${seg(rfiId, 'RFI')}/decide?decision=${encodeURIComponent(decision)}`,
      { method: 'POST', body: { remarks } }),
};

export { BASE as API_BASE };
