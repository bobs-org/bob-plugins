// Test exports for the task-settle twin (pure-twin + editor-apply).
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      taskSettleFromStatusTypes,
      taskSettleNote,
      taskSettleTransform,
      taskSettleLocalSchedules,
      taskSettleGroupingEligible,
      taskSettleCanonicalDailyDate,
      taskSettleParseDayFileDate,
      taskSettleIsBadgeRow,
      taskSettleIsLegacyBadgeMarker,
      taskSettleLogicalLines,
      taskSettleTextValue,
      taskSettleDefaultStatusTypes,
      taskSettleDefaultTasksSettings,
      taskSettleNormalizeTasksSettings,
      taskSettleReadTasksSettings,
      taskSettleClassificationFromTasksSettings,
      taskSettleCaptureContext,
      taskSettleIsMarkdownView,
      taskSettleFindMarkdownViewForEditor,
      taskSettleGuardEditorPath,
      taskSettleSplitEditorText,
      taskSettleAlignEditorLines,
      taskSettlePlanEditorChanges,
      taskSettlePlanContentEdits,
      taskSettleIsWholeDocumentReplacement,
      taskSettleFindIdentityLine,
      taskSettleTaskBlockRange,
      taskSettlePlanCursor,
      taskSettleApplyToEditor,
      TASK_SETTLE_API_VERSION,
      BobLedgerToolsTaskSettleMixin,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
