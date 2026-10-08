// Mapping register (Element_Register sheet) and the model <-> key link (section 3b).
import * as XLSX from 'xlsx';

export function parseRegister(buf, fileName = '') {
  const wb = XLSX.read(buf, { type: 'array', sheets: ['Element_Register'] });
  const ws = wb.Sheets['Element_Register'];
  if (!ws) throw new Error('This workbook has no sheet named “Element_Register”.');
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!raw.length) throw new Error('Element_Register is empty.');
  const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_]+/g, '_');
  const cols = Object.keys(raw[0]);
  const find = (name) => cols.find((c) => norm(c) === norm(name));
  const keyCol = find('Element_Key'), gidCol = find('IFC_GlobalId');
  if (!keyCol || !gidCol) throw new Error('Element_Register needs the columns Element_Key and IFC_GlobalId.');
  const optional = ['Element_Type', 'Pier', 'Unit_ID', 'Pier_Role', 'Module', 'Span', 'Arm', 'Seg_No', 'Lift_No', 'Cable_Segment', 'Revit_ElementId', 'Notes'];
  const optCols = Object.fromEntries(optional.map((o) => [o, find(o)]).filter(([, c]) => c));

  const byKey = new Map();
  const gidToKeys = new Map();
  for (const row of raw) {
    const key = String(row[keyCol] ?? '').trim();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { key, gids: [], meta: {} });
    const e = byKey.get(key);
    for (const [name, col] of Object.entries(optCols)) if (row[col] !== '' && e.meta[name] === undefined) e.meta[name] = row[col];
    const gids = String(row[gidCol] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
    for (const g of gids) {
      if (!e.gids.includes(g)) e.gids.push(g);
      if (!gidToKeys.has(g)) gidToKeys.set(g, new Set());
      gidToKeys.get(g).add(key);
    }
  }
  return { fileName, byKey, gidToKeys, rowCount: raw.length, parsedAt: Date.now() };
}

// Resolve every model element to a key. GlobalIds are compared case-sensitively:
// IFC GUIDs are base-64 and "…FMnO" and "…FMno" are different elements.
export function linkModel(model, register, settings) {
  const source = settings.keySource || 'both'; // register | property | both
  const pset = settings.psetName || 'RFI_Tracker', prop = settings.propName || 'RFI_Key';
  const keyToEls = new Map();
  const elToKey = new Map();
  const conflicts = [];
  if (!model) return { keyToEls, elToKey, conflicts, coverage: null };
  const gidSet = new Set(model.elements.map((e) => e.gid));
  for (const el of model.elements) {
    let key = null;
    if (register && source !== 'property') {
      const ks = register.gidToKeys.get(el.gid);
      if (ks) { key = [...ks][0]; if (ks.size > 1) conflicts.push({ gid: el.gid, keys: [...ks] }); }
    }
    if (!key && source !== 'register') {
      const v = model.propValue(el, pset, prop);
      if (v) key = String(v).trim();
    }
    if (!key) continue;
    elToKey.set(el.id, key);
    if (!keyToEls.has(key)) keyToEls.set(key, []);
    keyToEls.get(key).push(el);
  }
  const coverage = {
    keysNoModel: register ? [...register.byKey.values()].filter((e) => !keyToEls.has(e.key)).map((e) => e.key) : [],
    modelNoKey: model.elements.filter((e) => !elToKey.has(e.id)),
    gidsNotFound: register ? [...register.gidToKeys.keys()].filter((g) => !gidSet.has(g)).map((g) => ({ gid: g, keys: [...register.gidToKeys.get(g)] })) : [],
    conflicts,
  };
  return { keyToEls, elToKey, conflicts, coverage };
}
