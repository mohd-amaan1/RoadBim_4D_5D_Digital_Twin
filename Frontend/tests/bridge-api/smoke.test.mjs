// Read-only checks of a running backend's tracker endpoints. Writes nothing, so it is safe
// against the real server:
//
//   npm run test:bridge:api                       http://localhost:5000, package 11
//   API_BASE=http://host:port PACKAGE_ID=11 npm run test:bridge:api
//   API_TOKEN=<jwt> …                             when sign-in is on
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const BASE = (process.env.API_BASE || 'http://localhost:5000').replace(/\/$/, '');
const PACKAGE_ID = process.env.PACKAGE_ID || '11';
const headers = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {};
const get = (path, extra = {}) => fetch(BASE + path, { headers: { ...headers, ...extra } });

const CONTENT_TYPE = {
  ifc: 'application/x-step',
  alignment: 'application/json',
  register: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ipc: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

let state;
test('the tracker package answers with its current files', async () => {
  const res = await get(`/api/packages/${PACKAGE_ID}/bridge-tracker`);
  assert.equal(res.status, 200, `GET bridge-tracker: ${res.status} — is the backend running at ${BASE}?`);
  state = await res.json();
  assert.equal(state.module, 'palashbari-tracker');
  for (const k of ['ifc', 'register', 'alignment']) assert.ok(state[k], `no current ${k}`);
  assert.ok(state.ipcs.length >= 1, 'no IPC uploaded');
  assert.ok(state.ipcs.some((f) => f.id === state.activeIpcFileId), 'the active IPC is not one of the package IPCs');
  // the API leaves null fields out of its JSON, so "not superseded" reads as absent
  for (const k of ['ifc', 'register', 'alignment']) assert.ok(state[k].supersededAt == null, `current ${k} is marked superseded`);
});

test('every current file downloads byte for byte, and caches', async () => {
  const active = state.ipcs.find((f) => f.id === state.activeIpcFileId);
  for (const f of [state.ifc, state.register, state.alignment, active]) {
    const res = await get(`/api/bridge-tracker/files/${f.id}/content`);
    assert.equal(res.status, 200, `${f.kind} ${f.fileName}`);
    assert.equal(res.headers.get('content-type'), CONTENT_TYPE[f.kind]);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, f.byteSize, `${f.fileName} size`);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), f.sha256, `${f.fileName} hash`);
    const again = await get(`/api/bridge-tracker/files/${f.id}/content`, { 'If-None-Match': res.headers.get('etag') });
    assert.equal(again.status, 304, `${f.fileName} is re-sent instead of cached`);
  }
});

test('road packages and missing files are refused', async () => {
  const pkg = await (await get(`/api/packages/${PACKAGE_ID}`)).json();
  const list = await (await get(`/api/projects/${pkg.projectCode}/packages`)).json();
  const road = list.find((p) => !p.module);
  if (road) assert.equal((await get(`/api/packages/${road.id}/bridge-tracker`)).status, 409, `road package ${road.code}`);
  assert.equal((await get('/api/bridge-tracker/files/999999999/content')).status, 404);
});
