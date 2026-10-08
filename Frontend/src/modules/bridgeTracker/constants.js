// A package whose module is the tracker reads four uploads instead of road workbooks.
// Must match PackageModule.PalashbariTracker on the server.
export const TRACKER_MODULE = 'palashbari-tracker';

export const isTrackerPackage = (pkg) => pkg?.module === TRACKER_MODULE;

/**
 * Screens a tracker package does not show: it is the tracker and its dashboard only. The
 * road viewer and the road importer are replaced by the tracker's own 3D view and uploads;
 * the plan map, the RFI register, raising RFIs, site captures and EVM analytics are
 * switched off for it by request.
 */
export const TRACKER_HIDDEN_TABS = new Set([
  '3D_BIM', 'EXCEL_IMPORT', 'GIS_MAP', 'RFI', 'RFI_RAISE', 'MATTERPORT', 'ANALYTICS',
]);
