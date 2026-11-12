// Album report/sync service helpers, exported beside the existing
// notebook data surface in `350-exports.js`. Kept in its own fragment so
// `350-exports.js` stays at or below 1000 lines.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      ALBUM_REPORT_SCHEMA_VERSION,
      ALBUM_LIST_TIMEOUT_MS,
      ALBUM_LIST_MAX_BUFFER,
      ALBUM_REVALIDATE_DEBOUNCE_MS,
      ALBUM_SYNC_DEBOUNCE_MS,
      ALBUM_ROLLOVER_INTERVAL_MS,
      albumListArgs,
      albumSyncArgs,
      albumDecodeListReport,
      albumDecodeSyncReport,
      albumIndexReport,
      albumReportPath,
      albumDirname,
      albumTypeNames,
      albumNormalizeParent,
      albumNormalizeSummary,
      albumNormalizeText,
      albumNormalizeIndexFacets,
      albumStableStringify,
      albumFrontmatterFingerprint,
      albumFingerprintNeedsSync,
      albumIsMember,
      albumRelevantPath,
      albumLocalDate,
      albumErrorModel,
      albumLookupByTarget,
      albumHostCatalog,
      albumGroupTally,
      albumHealthModel,
      albumRowModel,
      albumCatalogStatus,
      albumSourceRegions,
      albumGroupJumpTarget,
      albumFindCallouts,
      albumPaintCallout,
      albumCleanCatalogDom,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
