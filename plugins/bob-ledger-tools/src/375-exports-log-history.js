try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      LOG_HISTORY_KINDS,
      LOG_HISTORY_REVALIDATE_MS,
      logHistoryNormalizeQuery,
      logHistoryDecodeReport,
      logHistoryMergeOverlay,
      logHistoryStampForOverlay,
    });
  }
} catch (_error) {}
