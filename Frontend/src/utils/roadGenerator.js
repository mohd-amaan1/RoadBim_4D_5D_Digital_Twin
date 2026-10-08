import * as THREE from 'three';
import { createLayerMaterial, applyStatusTint } from './roadTextures.js';

// Layer Config Definitions
// Layer Config Definitions with authentic civil engineering material colors (Soil, Sand, Brick, Asphalt)
export const ROAD_LAYERS_CONFIG = [
  { id: 1, code: 'SUB', name: 'Subgrade Earthwork (Soil)', thicknessMm: 500, defaultColor: '#8B5A2B', layerColorHex: 0x8B5A2B, materialType: 'Natural Compacted Soil', yOffset: 0.0, height: 0.5 },
  { id: 2, code: 'GSB', name: 'Granular Sub-Base (Sand & Gravel)', thicknessMm: 200, defaultColor: '#D97706', layerColorHex: 0xD97706, materialType: 'Sand & Crushed Gravel', yOffset: 0.5, height: 0.2 },
  { id: 3, code: 'WMM', name: 'Wet Mix Macadam (Brick & Stone)', thicknessMm: 250, defaultColor: '#B91C1C', layerColorHex: 0xB91C1C, materialType: 'Bound Crushed Aggregate / Brick', yOffset: 0.7, height: 0.25 },
  { id: 4, code: 'DBM', name: 'Dense Bituminous Macadam (Asphalt Binder)', thicknessMm: 100, defaultColor: '#334155', layerColorHex: 0x334155, materialType: 'Dense Bituminous Asphalt', yOffset: 0.95, height: 0.1 },
  { id: 5, code: 'BC', name: 'Bituminous Concrete (Surface Course)', thicknessMm: 50, defaultColor: '#1E293B', layerColorHex: 0x1E293B, materialType: 'Asphalt Surface Wearing Course', yOffset: 1.05, height: 0.05 },
];

export const STATUS_COLORS = {
  'Completed': 0x10B981,   // Emerald Green
  'In-Progress': 0xF59E0B, // Amber Yellow
  'Delayed': 0xEF4444,     // Crimson Red
  'Not Started': 0x64748B  // Slate Gray
};

/** Creates 100 KM Highway 3D Parametric Meshes in Three.js
 * Renders top surface as Progress Status (Red for Delayed, Grey for Not Started, Yellow for In-Progress, Green for Completed)
 * Renders sub-surface layers as authentic material colors (Soil, Sand, Brick, Asphalt)
 */
export function buildRoadBimScene(progressData, activeLayerFilter, sliceKm) {
  const group = new THREE.Group();
  group.name = "100KM_ROAD_CORRIDOR";

  /*
   * Textured pavement materials, cached per (layer, status) pair. 100 km x 5 layers is
   * 500 meshes, so sharing materials keeps this to a handful of instances instead of 500.
   */
  const materialCache = new Map();
  const getLayerMaterial = (layer, status) => {
    const key = `${layer.code}|${status || 'none'}`;
    let material = materialCache.get(key);
    if (material) return material;

    material = createLayerMaterial(layer.code, layer.name);
    if (material) {
      applyStatusTint(material, status);
    } else {
      material = new THREE.MeshStandardMaterial({ color: layer.layerColorHex, roughness: 0.8, metalness: 0.05 });
    }
    materialCache.set(key, material);
    return material;
  };

  const totalKm = 100;
  const sectionWidth = 8.0; // 8 meters 2-lane dual carriageway width
  const sectionLength = 2.0; // Visual scale for 1 KM section

  for (let km = 0; km < totalKm; km++) {
    // If cut plane slice is active, skip sections past slice
    if (sliceKm && km > sliceKm) continue;

    // Slight curvature along Z axis for realistic highway corridor feel
    const curveZ = Math.sin(km * 0.05) * 15.0;

    // Calculate section-level top surface status (Red if any layer delayed, Grey if not started, Yellow if in-progress, Green if completed)
    const sectionOverallStatus = getOverallKmSectionStatus(progressData, km);

    ROAD_LAYERS_CONFIG.forEach(layer => {
      // Check layer filter
      if (activeLayerFilter && activeLayerFilter !== 'ALL' && activeLayerFilter !== layer.code) {
        return;
      }

      // Lookup progress status for this KM section and Layer
      const prog = getSegmentStatus(progressData, km, layer.code);

      // Check if this layer is the Top Surface Wearing Course (BC / Layer 5)
      const isTopLevel = layer.code === 'BC' || layer.id === 5;

      const geometry = new THREE.BoxGeometry(sectionLength, layer.height, sectionWidth);

      // Box UVs are 0..1 per face; scale them to the mesh's real size so the pavement
      // texture tiles at world scale instead of being stretched across each face.
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * sectionLength, uv.getY(i) * sectionWidth);
      }
      uv.needsUpdate = true;

      // The wearing course carries the section's status colour; the buried layers keep
      // their own material appearance so the stack still reads as a real cross-section.
      const material = getLayerMaterial(layer, isTopLevel ? sectionOverallStatus : prog.status);

      const mesh = new THREE.Mesh(geometry, material);
      
      // Position along Highway Alignment X axis
      mesh.position.set(
        (km - totalKm / 2) * (sectionLength + 0.1),
        layer.yOffset + layer.height / 2,
        curveZ
      );

      // Metadata properties attached to mesh for picking & tooltip inspection
      mesh.userData = {
        km: km,
        kmLabel: `KM ${String(km).padStart(3, '0')} - KM ${String(km + 1).padStart(3, '0')}`,
        layerCode: layer.code,
        layerName: layer.name,
        thicknessMm: layer.thicknessMm,
        status: prog.status,
        sectionOverallStatus: sectionOverallStatus,
        progressPercent: prog.progressPercent,
        costVariance: prog.costVariance,
        targetDate: prog.targetDate
      };

      group.add(mesh);
    });
  }

  // Add Highway Stationing Posts / Kilometer Markers every 10 KM
  for (let km = 0; km <= totalKm; km += 10) {
    const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xF8FAFC, metalness: 0.5 });
    const postMesh = new THREE.Mesh(postGeo, postMat);
    
    const curveZ = Math.sin(km * 0.05) * 15.0;
    postMesh.position.set((km - totalKm / 2) * 2.1, 1.25, curveZ - 5.0);
    group.add(postMesh);
  }

  return group;
}

/** Computes overall status for a 1 KM section top surface:
 * 1. Delayed if ANY layer is delayed -> RED
 * 2. In-Progress if active execution -> YELLOW
 * 3. Completed if all layers done -> GREEN
 * 4. Not Started if unbuilt -> GREY
 */
export function getOverallKmSectionStatus(progressData, km) {
  const layerCodes = ['SUB', 'GSB', 'WMM', 'DBM', 'BC'];
  const layerStatuses = layerCodes.map(code => getSegmentStatus(progressData, km, code));

  if (layerStatuses.some(l => l.status === 'Delayed')) {
    return 'Delayed';
  }
  if (layerStatuses.every(l => l.status === 'Completed')) {
    return 'Completed';
  }
  if (layerStatuses.every(l => l.status === 'Not Started')) {
    return 'Not Started';
  }
  if (layerStatuses.some(l => l.status === 'In-Progress')) {
    return 'In-Progress';
  }
  return 'Not Started';
}

export function getSegmentStatus(progressData, km, layerCode) {
  if (progressData && progressData.length > 0) {
    const targetKm = Number(km);
    const targetCode = String(layerCode || '').trim().toUpperCase();

    const match = progressData.find(p => 
      Number(p.km) === targetKm && 
      String(p.layerCode || '').trim().toUpperCase() === targetCode
    );

    if (match && match.status) {
      return match;
    }
  }

  // Realistic layer-wise progress breakdown across 100 KM
  const kmNum = Number(km);
  const code = String(layerCode || '').trim().toUpperCase();

  // KM 000 to KM 040: Fully Completed Pavement (All 5 Layers Done)
  if (kmNum < 40) {
    return { status: 'Completed', progressPercent: 100, costVariance: -500, targetDate: '2026-03-15' };
  }

  // KM 040 to KM 065: Subgrade & GSB Done (Green), WMM In-Progress (Yellow), DBM Delayed (Red), BC Not Started (Steel Gray)
  if (kmNum < 65) {
    if (code === 'SUB' || code === 'GSB') {
      return { status: 'Completed', progressPercent: 100, costVariance: 0, targetDate: '2026-04-10' };
    }
    if (code === 'WMM') {
      return { status: 'In-Progress', progressPercent: 75, costVariance: 200, targetDate: '2026-05-01' };
    }
    if (code === 'DBM') {
      return { status: kmNum % 3 === 0 ? 'Delayed' : 'In-Progress', progressPercent: 38, costVariance: 4500, targetDate: '2026-05-15' };
    }
    // BC Surface Not Started
    return { status: 'Not Started', progressPercent: 0, costVariance: 0, targetDate: '2026-07-01' };
  }

  // KM 065 to KM 085: Subgrade Done (Green), GSB & WMM In-Progress (Yellow), DBM & BC Not Started (Steel Gray)
  if (kmNum < 85) {
    if (code === 'SUB') {
      return { status: 'Completed', progressPercent: 100, costVariance: 0, targetDate: '2026-04-20' };
    }
    if (code === 'GSB') {
      return { status: 'In-Progress', progressPercent: 84, costVariance: 100, targetDate: '2026-05-10' };
    }
    if (code === 'WMM') {
      return { status: 'In-Progress', progressPercent: 62, costVariance: 250, targetDate: '2026-05-25' };
    }
    return { status: 'Not Started', progressPercent: 0, costVariance: 0, targetDate: '2026-07-01' };
  }

  // KM 085 to KM 100: Active Earthworks Section (Subgrade In-Progress Yellow, Upper Layers Not Started Steel Gray)
  if (code === 'SUB') {
    return { status: 'In-Progress', progressPercent: 45, costVariance: 0, targetDate: '2026-06-15' };
  }
  return { status: 'Not Started', progressPercent: 0, costVariance: 0, targetDate: '2026-08-01' };
}
