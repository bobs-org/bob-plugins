// Test-facing exports for the props v1 client, guarded session, history, and overlays.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_UPDATE_SCHEMA_VERSION,
      PROPERTY_UPDATE_TIMEOUT_MS,
      PROPERTY_UPDATE_MAX_BUFFER,
      PROPERTY_UPDATE_PREVIEW_DEBOUNCE_MS,
      PROPERTY_HISTORY_LIMIT,
      PROPERTY_OVERLAY_TTL_MS,
      PROPERTY_CAPABILITY,
      propertyNotePath,
      propertyShowArgs,
      propertyUpdateArgs,
      propertyUpdateEnvelope,
      propertyUpdateEnvelopeText,
      propertyIsStaleUpdateCode,
      propertyHasCapability,
      propertyFingerprintOf,
      propertyShowAllowsWrite,
      propertyCloneJson,
      propertyIsUnsupportedOutput,
      propertyDecodeShowReport,
      propertyDecodeUpdateReport,
      propertyUpdateErrorModel,
      propertyOverlayFromReport,
      propertyOverlayPaintFrontmatter,
      propertyOverlayMatchesImage,
      propertyOverlayMatchesCache,
      propertyOverlayBeforeFromProperties,
      createPropertyHistory,
      createPropertyOverlayStore,
      createPropertyUpdateSession,
      propertyUpdateServiceDeps,
    });
  }
} catch (_) {}
