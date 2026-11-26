// Test hooks for the shared Ref Card reading report service.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      REF_LIBRARY_REPORT_SCHEMA_VERSION,
      REF_LIBRARY_REPORT_REVALIDATE_DEBOUNCE_MS,
      REF_LIBRARY_REPORT_FRESH_MS,
      REF_LIBRARY_REPORT_OPEN_REFRESH_MS,
      REF_LIBRARY_REPORT_TIMEOUT_MS,
      REF_LIBRARY_REPORT_MAX_BUFFER,
      refLibraryReportArgs,
      refLibraryReportDecode,
      refLibraryReportNormalizeRow,
      BobLedgerToolsRefLibraryReportMixin,
    });
  }
} catch (_) {}
