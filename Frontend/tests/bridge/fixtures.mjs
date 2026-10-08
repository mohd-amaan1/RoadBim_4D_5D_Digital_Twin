// Shared fixtures for the bridge tracker tests: the real Palashbari files, parsed once per
// test process. They are the project's own data (IPC-34, the register, the KMZ and two
// Revit exports), so a passing suite means the tracker reads what the team uploads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '../fixtures/bridge');
const M = path.resolve(here, '../../src/modules/bridgeTracker');
const mod = (name) => import(new URL(`file:///${path.join(M, name).replace(/\\/g, '/')}`).href);

export const T = {
  keys: await mod('keys.js'),
  ipc: await mod('ipc.js'),
  register: await mod('register.js'),
  engine: await mod('engine.js'),
  ifc: await mod('ifc.js'),
  kml: await mod('kml.js'),
  automap: await mod('automap.js'),
  plan: await mod('plan.js'),
  summary: await mod('summary.js'),
  selftest: await mod('selftest.js'),
};

// The day the IPC-34 figures were confirmed. The future-date check (M3) compares RFI dates
// with "today", so the issue counts are pinned to a date rather than drifting with the clock.
export const AS_OF = '2026-10-08';

const read = (name) => fs.readFileSync(path.join(FIXTURES, name));
const once = (fn) => { let p; return () => (p ??= fn()); };

export const ipc34 = once(() => T.ipc.parseIPC(new Uint8Array(read('ipc34.xlsx')), { fileName: 'ipc34.xlsx' }));
export const register = once(async () => T.register.parseRegister(new Uint8Array(read('register.xlsx')), 'register.xlsx'));
export const module6 = once(() => T.ifc.parseIFC(read('module6-test.ifc').toString('latin1'), { fileName: 'module6-test.ifc' }));
export const plb2 = once(() => T.ifc.parseIFC(read('bridge-plb-2.ifc').toString('latin1'), { fileName: 'bridge-plb-2.ifc' }));
export const alignment = once(() => {
  const buf = read('alignment.kmz');
  return T.kml.parseAlignment({ name: 'alignment.kmz', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
});

/** The engine's view of an IPC as of AS_OF: the rules and the checks, as evaluate() runs them. */
export async function evaluated(link = null) {
  const ipc = await ipc34();
  const config = T.plan.mergeConfig(null);
  const modelKeys = new Set(link ? link.keyToEls.keys() : []);
  return {
    ipc, config,
    notRaised: T.engine.runRules(ipc, modelKeys, config),
    issues: T.engine.runChecks(ipc, config, AS_OF),
  };
}

export const ALIAS = { P12: 'P12(A)', P14: 'P14(N)' };
