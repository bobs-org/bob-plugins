// Test helpers for the read-only album record walk model.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      RECORD_WALK_CAPABILITY,
      recordWalkHasRail,
      recordWalkArm,
      recordWalkRailBuildEl,
      recordWalkSelectionTouches,
      recordWalkReadingParagraphMatches,
      recordWalkCompareCodePoints,
      recordWalkHumanizeStem,
      RECORD_WALK_CAPABILITY,
      RECORD_WALK_GROUP_CAPABILITY,
      recordWalkGroupingConfig,
      recordWalkGroupProjection,
      recordWalkGroupValue,
      recordWalkOrder,
      recordWalkLabel,
      recordWalkRenderLines,
      recordWalkClassify,
      recordWalkModel,
      recordWalkRequestSync,
      recordWalkClearSyncedEpisodes,
    });
  }
} catch (_) {
  // Test exports are best-effort.
}
