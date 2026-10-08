// Small shared helpers: DOM, dates, numbers, downloads.

// Lookups resolve inside the tracker's own element, not the whole page: it is mounted in
// the RoadBIM app beside other screens, and its ids (#app, #modal, #toast…) must not find
// theirs. Set once by mountTracker before anything renders.
let domRoot = typeof document === 'undefined' ? null : document;
export function setDomRoot(el) { domRoot = el; }
export const $ = (sel, root = domRoot) => root.querySelector(sel);
export const $$ = (sel, root = domRoot) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

export const pad2 = (n) => String(n).padStart(2, '0');

// ---- dates: stored as ISO "YYYY-MM-DD" strings, compared as day numbers ----
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

export function isoFromUTC(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function excelSerialToISO(n) {
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

const fullYear = (y) => (y < 100 ? 2000 + y : y);

export function parseDateToken(tok) {
  const s = String(tok).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{1,2})[-\s./]([A-Za-z]{3,5})[-\s./,]*(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    return isoFromUTC(fullYear(+m[3]), mon, +m[1]);
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoFromUTC(+m[1], +m[2] - 1, +m[3]);
  if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/))) return isoFromUTC(fullYear(+m[3]), +m[2] - 1, +m[1]);
  if ((m = s.match(/^\d{5}(\.\d+)?$/))) return excelSerialToISO(+s);
  return null;
}

export const dayNum = (iso) => (iso ? Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000) : NaN);
export const isoFromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const todayISO = () => new Date().toISOString().slice(0, 10);

export function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtNum(x, dp = 3) {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  const r = Math.round(x * 10 ** dp) / 10 ** dp;
  return r.toLocaleString('en-IN', { maximumFractionDigits: dp });
}

export function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function bytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// ---- base64 for binary files kept in text storage ----
export function bufToB64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBuf(b64) {
  const s = atob(b64.trim());
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8.buffer;
}

// Offer a generated file to the viewer as an ordinary download.
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'saved';
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Tiny event hub for app-wide state changes.
export function createHub() {
  const map = new Map();
  return {
    on(ev, fn) { if (!map.has(ev)) map.set(ev, new Set()); map.get(ev).add(fn); return () => map.get(ev).delete(fn); },
    emit(ev, payload) { (map.get(ev) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); },
  };
}
