// Areas report and card helpers for focused regression coverage.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      AREAS_REPORT_SCHEMA_VERSION,
      AREAS_LIST_TIMEOUT_MS,
      AREAS_LIST_MAX_BUFFER,
      AREAS_REVALIDATE_DEBOUNCE_MS,
      AREAS_ROLLOVER_INTERVAL_MS,
      areasListArgs,
      areasSyncArgs,
      areasDecodeListReport,
      areasDecodeSyncReport,
      areasIndexReport,
      areasReportPath,
      areasTypeNames,
      areasRelevantPath,
      areasLocalDate,
      areasErrorModel,
      areasCardHost,
      areasCardHostEntry,
      areasCardHueSlot,
      areasCardHostHue,
      areasCardRowModel,
      areasCardRows,
      areasCardLookupByTarget,
      areasCardIssueHint,
      areasCardHealthModel,
      areasCardUnplacedModel,
      areasCardStatus,
      areasCardAnchorLine,
      areasCardHasCallout,
      areasFindCallouts,
      areasPaintCallout,
      areasPaintStandalone,
      areasCleanCatalogDom,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
