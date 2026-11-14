// Test helpers for the ledger-owned bank walk (api.bankWalk v1): pure
// model, snapshot builder, planners, and identity resolution. Kept in its
// own fragment so `350-exports.js` stays at or below 1000 lines.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      BANK_WALK_VERSION,
      bankWalkIsRow,
      bankWalkIsWaiting,
      bankWalkNormalizeRepeat,
      bankWalkTupleCompare,
      bankWalkShortDayLabel,
      bankWalkLongDayLabel,
      bankWalkMonthLabel,
      bankWalkDailyDateFromPath,
      bankWalkPayeeStart,
      bankWalkBuildEntries,
      bankWalkBuildSnapshotFromContents,
      bankWalkOtherMonthLine,
      bankWalkLocate,
      bankWalkPlan,
      bankWalkResolve,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
