import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildRoadBimScene, ROAD_LAYERS_CONFIG } from '../../utils/roadGenerator';
import { loadBimModelFile, disposeGroup } from '../../utils/ifcLoader';
import { useRoadData } from '../../context/RoadDataContext';
import { statusByExpressID } from '../../utils/ifcResolver';
import { buildIfcMetadata } from '../../utils/persistence';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Sliders,
  Upload,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Camera,
  Focus,
  Boxes,
  Trash2,
  Loader2,
  AlertTriangle,
  Maximize2,
  Minimize2,
  X
} from 'lucide-react';
import HotspotModal from './HotspotModal';
import BridgeRegisterDetail from './BridgeRegisterDetail';
import { registerRowsForElement, APPROVAL_LABEL } from '../../utils/bridgeImport';
import { statusColor } from '../../utils/roadTextures';

export default function RoadBIMViewer() {
  const mountRef = useRef(null);
  const {
    activeLayerFilter,
    setActiveLayerFilter,
    progressData,
    setSelectedKmSection,
    sliceKm,
    setSliceKm,
    customIfcLoaded,
    ifcFileName,
    ifcModel,
    applyIfcModel,
    clearIfcModel,
    dashboard,
    resolution,
    reloadProject,
    bridgeItems
  } = useRoadData();
  const { activeProject, activePackage, canEdit } = useAuth();

  const [activeHotspot, setActiveHotspot] = useState(null);
  const [hoveredKmInfo, setHoveredKmInfo] = useState(null);
  const [selectedBimObject, setSelectedBimObject] = useState(null);
  const [hiddenLayers, setHiddenLayers] = useState([]);
  const [isolatedLayer, setIsolatedLayer] = useState(null);
  const [isAutoRotate, setIsAutoRotate] = useState(false);
  const [ifcLoading, setIfcLoading] = useState(false);
  const [ifcProgress, setIfcProgress] = useState(0);
  const [ifcError, setIfcError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rootRef = useRef(null);

  // What the bridge register says about the clicked element, so the inspector shows the
  // Excel row behind the colour and not only what the IFC carries. Computed at render
  // rather than in the pointer handler: that handler is bound once on mount and would
  // read a register from before the last import. Null for road packages.
  const register = useMemo(() => {
    if (selectedBimObject?.mode !== 'IFC' || !bridgeItems?.length) return null;
    return registerRowsForElement({
      items: bridgeItems,
      resolution,
      expressID: selectedBimObject.expressID,
      globalId: selectedBimObject.globalId,
    });
  }, [selectedBimObject, bridgeItems, resolution]);

  // The row behind a hovered element, for a one-line preview before clicking.
  const hoveredRegisterRow = hoveredKmInfo?.mode === 'IFC' && resolution?.bridge
    ? resolution.byExpressID.get(hoveredKmInfo.expressID)?.row || null
    : null;

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const rendererRef = useRef(null);
  const gridRef = useRef(null);
  const selectionBoxRef = useRef(null);
  const contentGroupRef = useRef(null);
  const lastModeRef = useRef(null);
  const homeViewRef = useRef({ position: new THREE.Vector3(0, 32, 60), target: new THREE.Vector3(0, 0, 0) });

  // Kept in refs so the mount-once pointer handlers never read stale state
  const ifcModelRef = useRef(null);
  ifcModelRef.current = ifcModel;
  const isIfcMode = Boolean(ifcModel);
  const isIfcModeRef = useRef(false);
  isIfcModeRef.current = isIfcMode;

  // ----------------------------------------------------------------------
  // 1. Scene, renderer, camera, controls & render loop — created once on mount
  // ----------------------------------------------------------------------
  useEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const width = currentMount.clientWidth;
    const height = currentMount.clientHeight || 620;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const bgHex = 0x0B0F17;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, 0.005);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    cameraRef.current = camera;
    camera.position.set(0, 32, 60);

    // logarithmicDepthBuffer: civil models span kilometres while carrying centimetre
    // detail; a linear buffer cannot hold both and flat geometry z-fights away.
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    currentMount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 + 0.1;
    controls.target.set(0, 0, 0);

    // Studio specular lighting rig
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 1.4);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const mainSun = new THREE.DirectionalLight(0xffffff, 3.0);
    mainSun.position.set(45, 85, 45);
    mainSun.castShadow = true;
    scene.add(mainSun);

    const fillLight = new THREE.DirectionalLight(0x0284c7, 1.5);
    fillLight.position.set(-45, 30, -45);
    scene.add(fillLight);

    const gridHelper = new THREE.GridHelper(300, 60, 0x38BDF8, 0x1E293B);
    gridHelper.position.y = -0.05;
    gridRef.current = gridHelper;
    scene.add(gridHelper);

    // Raycaster picking — resolves against whichever content group is active
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const pick = (event) => {
      if (!contentGroupRef.current) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(contentGroupRef.current, true);
      return hits.length > 0 ? hits[0].object : null;
    };

    const handlePointerDown = (event) => {
      const selected = pick(event);
      if (!selected) return;

      if (isIfcModeRef.current && selected.userData?.isIfcElement) {
        const info = ifcModelRef.current?.getElementInfo(selected.userData.expressID, selected);
        setSelectedBimObject({ mode: 'IFC', ...info });
      } else if (selected.userData?.km !== undefined) {
        setSelectedBimObject({ mode: 'ROAD', ...selected.userData });
        setSelectedKmSection({
          km: selected.userData.km,
          kmLabel: selected.userData.kmLabel,
          status: selected.userData.status
        });
      } else {
        return;
      }

      if (selectionBoxRef.current) scene.remove(selectionBoxRef.current);
      const boxHelper = new THREE.BoxHelper(selected, 0x38BDF8);
      selectionBoxRef.current = boxHelper;
      scene.add(boxHelper);
    };

    const handlePointerMove = (event) => {
      const hovered = pick(event);
      if (!hovered) {
        setHoveredKmInfo(null);
        return;
      }
      if (isIfcModeRef.current && hovered.userData?.isIfcElement) {
        const info = ifcModelRef.current?.getElementInfo(hovered.userData.expressID, hovered);
        setHoveredKmInfo({ mode: 'IFC', ...info });
      } else if (hovered.userData?.km !== undefined) {
        setHoveredKmInfo({ mode: 'ROAD', ...hovered.userData });
      } else {
        setHoveredKmInfo(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Observe the container itself rather than the window: this also covers entering /
    // leaving fullscreen and the rem-based rescale, which resize the panel without a
    // window resize event.
    const resizeObserver = new ResizeObserver(() => {
      const w = currentMount.clientWidth;
      const h = currentMount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(currentMount);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      // Release the WebGL context — the uploaded IFC group is owned by the
      // context provider and is deliberately left intact for the next mount.
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [setSelectedKmSection]);

  // Rescales the reference grid to match whatever is currently on screen.
  // yOffset must scale with the model, or the grid coincides with flat geometry.
  const applyGrid = (scene, span, divisions, yOffset = -0.05) => {
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      gridRef.current.material.dispose();
    }
    const grid = new THREE.GridHelper(span, divisions, 0x38BDF8, 0x1E293B);
    grid.position.y = yOffset;
    gridRef.current = grid;
    scene.add(grid);
  };

  const clearSelectionBox = (scene) => {
    if (selectionBoxRef.current) {
      scene.remove(selectionBoxRef.current);
      selectionBoxRef.current = null;
    }
  };

  // ----------------------------------------------------------------------
  // 2a. Uploaded BIM model — takes over the viewport when present.
  //     Depends ONLY on ifcModel so road-side state (the 4D timeline driving
  //     sliceKm, layer filters…) can never re-frame the user's camera.
  // ----------------------------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls || !ifcModel) return;

    scene.add(ifcModel.group);
    contentGroupRef.current = ifcModel.group;
    lastModeRef.current = 'IFC';

    /*
     * Frame the model.
     *
     * Fitting is done against the bounding *sphere* and both field-of-view axes.
     * The previous maxDim-cube fit badly under-filled extreme proportions — a 37 km
     * x 4 km x 0 m road corridor was pushed 73 km back and rendered as a sliver.
     */
    const { x, y, z } = ifcModel.size;
    const maxDim = Math.max(x, y, z) || 10;
    const radius = Math.max(Math.hypot(x, y, z) / 2, 0.5);

    const fovV = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect || 1.6;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
    const distance = Math.max(radius / Math.tan(fovV / 2), radius / Math.tan(fovH / 2)) * 1.12;

    /*
     * Depth range. far/near was previously ~70,000:1, which left only ~20 m of depth
     * resolution at this scale — a flat model sitting on the grid plane z-fights itself
     * into invisibility. A logarithmic depth buffer (see the renderer) plus a far plane
     * bounded by the model keeps precision usable while still allowing close inspection.
     */
    camera.near = Math.max(0.05, radius / 5000);
    camera.far = (distance + radius) * 3;

    // Fixed ~28 deg elevation, so zero-height models are not viewed edge-on
    const dir = new THREE.Vector3(0.554, 0.462, 0.693).normalize();
    controls.target.set(0, y / 2, 0);
    camera.position.copy(controls.target).addScaledVector(dir, distance);
    camera.updateProjectionMatrix();
    controls.update();

    homeViewRef.current = { position: camera.position.clone(), target: controls.target.clone() };

    // Fog tied to the viewing distance, not raw model size
    scene.fog = new THREE.FogExp2(0x0B0F17, 0.45 / (distance + radius));

    /*
     * Keep the grid clear of the model. Cross-section exports are perfectly flat and sit
     * exactly on y=0, so a fixed -0.05 offset is far below the depth resolution at
     * kilometre scale and the grid punches through the road.
     */
    applyGrid(scene, Math.max(maxDim * 2.5, 10), 40, -Math.max(0.05, maxDim * 0.002));

    setSelectedBimObject(null);
    setHoveredKmInfo(null);

    return () => {
      scene.remove(ifcModel.group); // the group is owned by the context provider — never disposed here
      if (contentGroupRef.current === ifcModel.group) contentGroupRef.current = null;
      clearSelectionBox(scene);
    };
  }, [ifcModel]);

  // ----------------------------------------------------------------------
  // 2b. Procedural 100 KM road corridor — skipped entirely while an IFC model is loaded
  // ----------------------------------------------------------------------
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;
    if (ifcModel) return;

    const roadGroup = buildRoadBimScene(progressData, activeLayerFilter, sliceKm);

    roadGroup.children.forEach((mesh) => {
      const layerCode = mesh.userData?.layerCode;
      if (!layerCode) return;
      if (hiddenLayers.includes(layerCode)) mesh.visible = false;
      if (isolatedLayer && isolatedLayer !== layerCode) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0.12;
      }
    });

    scene.add(roadGroup);
    contentGroupRef.current = roadGroup;

    camera.near = 0.1;
    camera.far = 5000;
    camera.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2(0x0B0F17, 0.005);
    applyGrid(scene, 300, 60);

    homeViewRef.current = { position: new THREE.Vector3(0, 32, 60), target: new THREE.Vector3(0, 0, 0) };

    // Coming back from an uploaded model, the camera is framed for that model's
    // scale — snap it back to the corridor's home view.
    if (lastModeRef.current === 'IFC') {
      camera.position.copy(homeViewRef.current.position);
      controls.target.copy(homeViewRef.current.target);
      controls.update();
    }
    lastModeRef.current = 'ROAD';

    return () => {
      scene.remove(roadGroup);
      disposeGroup(roadGroup); // this group is built here, so it is disposed here
      if (contentGroupRef.current === roadGroup) contentGroupRef.current = null;
      clearSelectionBox(scene);
    };
  }, [ifcModel, progressData, activeLayerFilter, sliceKm, hiddenLayers, isolatedLayer]);

  // ----------------------------------------------------------------------
  // 3. Auto-rotate toggle (no scene rebuild)
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!controlsRef.current) return;
    controlsRef.current.autoRotate = isAutoRotate;
    controlsRef.current.autoRotateSpeed = 1.5;
  }, [isAutoRotate]);

  // ----------------------------------------------------------------------
  // 3b. Status tint on the pavement textures.
  //     Once the resolver has bound progress rows to individual elements, each
  //     element is tinted on its own — so a completed segment and a delayed one
  //     read differently even though they are the same layer. Without a resolution
  //     the best available is one colour per layer.
  //
  //     The tint multiplies the texture, so the asphalt/aggregate/soil detail
  //     stays visible underneath either way.
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!ifcModel) return;

    if (resolution?.byExpressID?.size && ifcModel.applyStatusByElement) {
      ifcModel.applyStatusByElement(statusByExpressID(resolution));
      return;
    }

    if (!ifcModel.applyStatusByCode) return;
    const statusByCode = {};
    for (const layer of dashboard?.layers || []) {
      if (layer.status) statusByCode[layer.code] = layer.status;
    }
    ifcModel.applyStatusByCode(statusByCode);
  }, [ifcModel, dashboard, resolution]);

  // ----------------------------------------------------------------------
  // 4. Fullscreen — keeps React in sync with Esc / F11 / browser-driven exits
  // ----------------------------------------------------------------------
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch (err) {
      console.warn('[Viewer] Fullscreen request rejected:', err);
    }
  };

  const handleZoom = (factor) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    // Dolly along the view axis so zoom works at any model scale
    const offset = camera.position.clone().sub(controls.target);
    offset.multiplyScalar(factor);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  const handleResetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.copy(homeViewRef.current.position);
    controls.target.copy(homeViewRef.current.target);
    controls.update();
  };

  const toggleLayerVisibility = (layerCode) => {
    if (hiddenLayers.includes(layerCode)) {
      setHiddenLayers(hiddenLayers.filter((code) => code !== layerCode));
    } else {
      setHiddenLayers([...hiddenLayers, layerCode]);
    }
  };

  const handleIfcFileUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-uploading the same file
    if (!file) return;

    setIfcError('');
    setIfcProgress(0);
    setIfcLoading(true);

    // Yield a frame so the loading overlay paints before the synchronous WASM parse
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const model = await loadBimModelFile(file, setIfcProgress);
      applyIfcModel(model, file.name);

      // Persist the model alongside the facts the resolver needs: element GlobalIds,
      // model groups, segmentation and material layer sets. The geometry itself is never
      // stored — the file is archived and re-parsed on load.
      // A model belongs to a PACKAGE, not a project — a project holds one active model per
      // package. Guarded on the id rather than the object so a package without one cannot
      // put "undefined" in the request path.
      if (activePackage?.id && canEdit && model.summary) {
        try {
          await api.uploadModel(activePackage.id, file, buildIfcMetadata(model.summary));
          await reloadProject();
        } catch (uploadErr) {
          console.warn('[IFC] Model loaded locally but could not be saved:', uploadErr);
          setIfcError('Model loaded, but saving it to the project failed: ' + uploadErr.message);
        }
      }
    } catch (err) {
      console.error('[IFC] Failed to load model:', err);
      setIfcError(err?.message || 'Could not read this file. Is it a valid IFC/glTF model?');
    } finally {
      setIfcLoading(false);
      setIfcProgress(0);
    }
  };

  const handleRemoveIfc = () => {
    setSelectedBimObject(null);
    setHoveredKmInfo(null);
    clearIfcModel();
  };

  return (
    <div
      ref={rootRef}
      className="bim-viewport viewport-panel relative w-full rounded-2xl overflow-hidden glass-panel border border-slate-800/90 shadow-2xl"
    >
      {/* 3D Canvas Viewport */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
        {isIfcMode ? (
          /* Uploaded model banner replaces the road layer pills */
          <div className="flex items-center space-x-3 bg-[#0D121F]/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-cyan-500/50 shadow-xl pointer-events-auto">
            <Boxes className="h-4.5 w-4.5 text-cyan-400 shrink-0" />
            <div className="leading-tight">
              <div className="text-xs font-extrabold text-white font-[Outfit] max-w-[16rem] truncate" title={ifcFileName}>
                {ifcFileName}
              </div>
              <div className="text-[11px] text-cyan-300 font-mono">
                {ifcModel.meshCount.toLocaleString()} elements • uploaded BIM model
              </div>
            </div>
            <button
              onClick={handleRemoveIfc}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500 hover:text-white text-xs font-bold transition-all"
              title="Remove model and return to the 100 KM procedural corridor"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remove</span>
            </button>
          </div>
        ) : (
          /* Layer Visibility Pills with Authentic Material Color Dots */
          <div className="flex flex-wrap items-center bg-[#0D121F]/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 shadow-xl pointer-events-auto">
            <button
              onClick={() => { setActiveLayerFilter('ALL'); setIsolatedLayer(null); setHiddenLayers([]); }}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                activeLayerFilter === 'ALL' && !isolatedLayer ? 'bg-cyan-500 text-slate-950 shadow font-extrabold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Show All
            </button>
            {ROAD_LAYERS_CONFIG.map((layer) => (
              <button
                key={layer.code}
                onClick={() => toggleLayerVisibility(layer.code)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                  hiddenLayers.includes(layer.code)
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 line-through'
                    : (isolatedLayer === layer.code ? 'bg-cyan-500 text-slate-950 shadow' : 'bg-slate-900 text-slate-200 border border-slate-800')
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: layer.defaultColor }} />
                <span>{layer.code}</span>
              </button>
            ))}
          </div>
        )}

        {/* Upload IFC Button */}
        <div className="flex items-center space-x-2 pointer-events-auto">
          <label
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-900/90 border text-xs font-bold transition-all shadow-xl ${
              ifcLoading
                ? 'border-slate-700 text-slate-400 cursor-wait'
                : 'border-cyan-500/40 text-cyan-400 hover:border-cyan-400 hover:bg-slate-800 cursor-pointer'
            }`}
          >
            {ifcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-cyan-400" />}
            <span>
              {ifcLoading
                ? `Parsing${ifcProgress ? ` ${ifcProgress}%` : ''}…`
                : (customIfcLoaded ? 'Replace .IFC File' : 'Upload .IFC File')}
            </span>
            <input
              type="file"
              accept=".ifc,.glb,.gltf"
              onChange={handleIfcFileUpload}
              disabled={ifcLoading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Right Toolbar Controls (Zoom, Rotate, Reset) */}
      <div className="absolute top-20 right-4 flex flex-col space-y-2 pointer-events-auto">
        <button
          onClick={() => handleZoom(0.8)}
          className="p-3 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 hover:border-cyan-500 text-slate-200 hover:text-white shadow-xl transition-all"
          title="Zoom In (+)"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={() => handleZoom(1.25)}
          className="p-3 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 hover:border-cyan-500 text-slate-200 hover:text-white shadow-xl transition-all"
          title="Zoom Out (-)"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={() => setIsAutoRotate(!isAutoRotate)}
          className={`p-3 rounded-xl border shadow-xl transition-all ${
            isAutoRotate ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-cyan-500/20' : 'bg-slate-900/90 border-slate-800 text-slate-200 hover:text-white'
          }`}
          title="Toggle 360° Auto Rotation"
        >
          <RotateCcw className={`h-4 w-4 ${isAutoRotate ? 'animate-spin-slow' : ''}`} />
        </button>
        <button
          onClick={handleResetCamera}
          className="p-3 rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 hover:border-cyan-500 text-slate-200 hover:text-white shadow-xl transition-all"
          title="Reset Camera View"
        >
          <Camera className="h-4 w-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          className={`p-3 rounded-xl border shadow-xl transition-all ${
            isFullscreen
              ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-cyan-500/20'
              : 'bg-slate-900/90 backdrop-blur-md border-slate-800 hover:border-cyan-500 text-slate-200 hover:text-white'
          }`}
          title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen Viewer'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Bottom Floating Section Cut Controls — road corridor only */}
      {!isIfcMode && (
        <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-md p-4 rounded-xl border border-slate-800 shadow-2xl flex items-center space-x-4 w-[26rem] max-w-[88%]">
          <Sliders className="h-5 w-5 text-cyan-400 shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="flex justify-between text-xs font-bold">
              <span className="text-slate-300">Interactive Section Cut (Clipping)</span>
              <span className="text-cyan-400 font-mono font-extrabold">{sliceKm !== null ? `KM ${sliceKm}` : 'Full View'}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={sliceKm !== null ? sliceKm : 100}
              onChange={(e) => setSliceKm(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>
          {sliceKm !== null && (
            <button
              onClick={() => setSliceKm(null)}
              className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-bold border border-slate-700"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {/* Parsing Overlay */}
      {ifcLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-md">
          <div className="flex flex-col items-center space-y-3 px-8 py-6 rounded-2xl bg-slate-900/95 border border-cyan-500/40 shadow-2xl">
            <Loader2 className="h-8 w-8 text-cyan-400 animate-spin" />
            <span className="text-sm font-extrabold text-white font-[Outfit]">Parsing BIM model…</span>
            <span className="text-xs text-slate-400 font-mono">
              {ifcProgress ? `${ifcProgress}% — building geometry` : 'Reading IFC entities'}
            </span>
          </div>
        </div>
      )}

      {/* Upload Error Banner */}
      {ifcError && (
        <div className="absolute bottom-4 left-4 right-4 z-40 flex items-start space-x-2.5 bg-rose-950/90 backdrop-blur-md p-3.5 rounded-xl border border-rose-500/50 shadow-2xl">
          <AlertTriangle className="h-4.5 w-4.5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-extrabold text-rose-200 font-[Outfit]">IFC upload failed</p>
            <p className="text-rose-300/90 mt-0.5">{ifcError}</p>
          </div>
          <button onClick={() => setIfcError('')} className="p-1 rounded bg-rose-500/20 text-rose-300 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* BIM Element Property Inspector Panel (Opened on Selection) */}
      {selectedBimObject && (
        // Wider when it carries a register row, and scrollable within the viewport: the
        // panel has a fixed height and clips, so a long row would otherwise be cut off
        // with no way to reach the approval at the bottom.
        <div className={`absolute top-20 left-4 z-30 bg-slate-900/95 backdrop-blur-2xl p-5 rounded-2xl border border-cyan-500/50 shadow-2xl space-y-3.5 ${register ? 'w-[26rem]' : 'w-80'} max-w-[88%] max-h-[calc(100%-6rem)] overflow-y-auto custom-scrollbar text-xs animate-slide-up`}>
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Focus className="h-4.5 w-4.5 text-cyan-400" />
              <span className="font-extrabold text-white font-[Outfit] text-sm">BIM Property Inspector</span>
            </div>
            <button onClick={() => setSelectedBimObject(null)} className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {selectedBimObject.mode === 'IFC' ? (
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-300">IFC Express ID:</span>
                <span className="font-mono text-cyan-400 font-bold">#{selectedBimObject.expressID}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">IFC Entity:</span>
                <span className="font-mono font-bold text-slate-100">{selectedBimObject.ifcType}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-300 shrink-0">Name:</span>
                <span className="font-bold text-white truncate" title={selectedBimObject.name}>{selectedBimObject.name}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-300 shrink-0">Object Type:</span>
                <span className="font-bold text-slate-100 truncate" title={selectedBimObject.objectType}>{selectedBimObject.objectType}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-300 shrink-0">Global Id:</span>
                <span className="font-mono text-[11px] text-slate-300 truncate" title={selectedBimObject.globalId}>{selectedBimObject.globalId}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-300">Element Ref:</span>
                <span className="font-mono text-cyan-400 font-bold">SEG_#{selectedBimObject.km * 5 + 102}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Section Station:</span>
                <span className="font-bold text-white">{selectedBimObject.kmLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Structural Layer:</span>
                <span className="font-bold text-slate-100">{selectedBimObject.layerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Thickness:</span>
                <span className="font-mono text-cyan-300 font-bold">{selectedBimObject.thicknessMm} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Status:</span>
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                  selectedBimObject.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                  selectedBimObject.status === 'Delayed' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>{selectedBimObject.status}</span>
              </div>
            </div>
          )}

          {selectedBimObject.mode === 'IFC' && register && (
            <BridgeRegisterDetail rows={register.rows} />
          )}

          {selectedBimObject.mode === 'ROAD' && (
            <div className="pt-2 border-t border-slate-800 flex space-x-2">
              <button
                onClick={() => setIsolatedLayer(isolatedLayer === selectedBimObject.layerCode ? null : selectedBimObject.layerCode)}
                className={`flex-1 py-2 rounded-xl font-bold text-xs transition-all ${
                  isolatedLayer === selectedBimObject.layerCode ? 'bg-rose-500 text-white shadow' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500 hover:text-slate-950'
                }`}
              >
                {isolatedLayer === selectedBimObject.layerCode ? 'Clear Isolation' : `Isolate ${selectedBimObject.layerCode}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hover Info Tooltip */}
      {hoveredKmInfo && !selectedBimObject && !ifcLoading && (
        <div className="absolute bottom-4 right-4 bg-slate-900/95 backdrop-blur-md p-4 rounded-xl border border-cyan-500/40 shadow-2xl space-y-1.5 text-xs max-w-xs pointer-events-none">
          {hoveredKmInfo.mode === 'IFC' ? (
            <>
              <div className="font-bold text-white text-xs flex items-center justify-between gap-2">
                <span className="truncate">{hoveredKmInfo.name}</span>
                <span className="px-2 py-0.5 text-[10px] rounded font-mono font-bold bg-cyan-500/20 text-cyan-300 shrink-0">
                  #{hoveredKmInfo.expressID}
                </span>
              </div>
              <p className="text-slate-200 text-xs font-mono">{hoveredKmInfo.ifcType}</p>
              {hoveredRegisterRow && (
                <p
                  className="text-xs font-bold text-slate-300"
                  style={hoveredRegisterRow.status ? { color: statusColor(hoveredRegisterRow.status) } : undefined}
                >
                  {hoveredRegisterRow.remarks || 'Register row'} · {APPROVAL_LABEL[hoveredRegisterRow.approval] || 'Pending'}
                </p>
              )}
              <p className="text-xs text-cyan-400 font-bold">
                {hoveredRegisterRow ? 'Click to see the register row' : 'Click to inspect IFC properties'}
              </p>
            </>
          ) : (
            <>
              <div className="font-bold text-white text-xs flex items-center justify-between">
                <span>{hoveredKmInfo.kmLabel}</span>
                <span className={`px-2 py-0.5 text-xs rounded font-bold ${
                  hoveredKmInfo.status === 'Completed' ? 'bg-emerald-500/20 text-emerald-400' :
                  hoveredKmInfo.status === 'Delayed' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                }`}>{hoveredKmInfo.status}</span>
              </div>
              <p className="text-slate-200 text-xs font-semibold">{hoveredKmInfo.layerName} ({hoveredKmInfo.thicknessMm} mm)</p>
              <p className="text-xs text-cyan-400 font-bold">Click to select & inspect BIM properties</p>
            </>
          )}
        </div>
      )}

      {/* Hotspot Lightbox Modal */}
      {activeHotspot && (
        <HotspotModal hotspot={activeHotspot} onClose={() => setActiveHotspot(null)} />
      )}
    </div>
  );
}
