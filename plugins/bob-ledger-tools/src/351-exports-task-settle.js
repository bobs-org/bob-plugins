// Test exports for the pure task-settle twin (bob-cli-q4.8.1.1 pure-twin).
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
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
