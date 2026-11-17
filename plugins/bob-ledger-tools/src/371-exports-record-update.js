// Test-facing exports for the record update service and session.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      RECORD_UPDATE_SCHEMA_VERSION,
      RECORD_UPDATE_TIMEOUT_MS,
      RECORD_UPDATE_MAX_BUFFER,
      RECORD_UPDATE_PREVIEW_DEBOUNCE_MS,
      recordShowArgs,
      recordUpdateArgs,
      recordUpdateEnvelope,
      recordUpdateEnvelopeText,
      recordIsStaleUpdateCode,
      recordDecodeShowReport,
      recordDecodeUpdateReport,
      recordUpdateErrorModel,
      recordOverlayFromReport,
      createRecordUpdateSession,
      recordUpdateServiceDeps,
    });
  }
} catch (_) {}
