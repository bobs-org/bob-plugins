// Projects report/sync service helpers, exported beside the album and
// notebook data surfaces. Kept in its own fragment so `350-exports.js`
// stays at or below 1000 lines.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      PROJECTS_REPORT_SCHEMA_VERSION,
      PROJECTS_LIST_TIMEOUT_MS,
      PROJECTS_LIST_MAX_BUFFER,
      PROJECTS_REVALIDATE_DEBOUNCE_MS,
      PROJECTS_SYNC_DEBOUNCE_MS,
      PROJECTS_ROLLOVER_INTERVAL_MS,
      projectsListArgs,
      projectsSyncArgs,
      projectsDecodeListReport,
      projectsDecodeSyncReport,
      projectsIndexReport,
      projectsReportPath,
      projectsTypeNames,
      projectsNormalizeParent,
      projectsNormalizeStatus,
      projectsLifecycleFingerprint,
      projectsFingerprint,
      projectsFingerprintNeedsSync,
      projectsRelevantPath,
      projectsLocalDate,
      projectsErrorModel,
      projectsEventPayload,
      projectsEntryShape,
      projectsListCatalogShape,
      projectsSyncCatalogShape,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
