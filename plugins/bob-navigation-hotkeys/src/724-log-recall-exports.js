try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      normalizeLogRecallQuery,
      rankLogRecall,
      logRecallReduce,
      logRecallInitialState,
      formatLogRecallAge,
      logRecallMergePhrases,
      logRecallOverlayStamp,
      attachLogRecall,
      LaneReleaseSummaryModal,
      getNavigationLogHistoryApi,
      getNavigationLogRecallApi,
    });
  }
} catch (_error) {}
