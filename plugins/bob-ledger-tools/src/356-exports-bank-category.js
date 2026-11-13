// Test helpers for the pure Category card models (bank_weekly_category_walk
// card-model). Kept separate from the crowded base export fragment so every
// hand-edited fragment stays below 1000 lines.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bankNormalizeHotkey,
      bankNormalizeGroup,
      bankNormalizeSuggestion,
      BANK_CATEGORY_MONEY_GROUP,
      BANK_CATEGORY_LOCK_MS,
      BANK_CATEGORY_SESSION_IDLE_MS,
      bankCategoryVisible,
      bankCategoryKeyTable,
      bankCategorySections,
      bankCategoryHighlightKey,
      bankCategoryCardFooter,
      bankCategoryOldBob,
      bankCategoryMonthLabel,
      bankCategoryDayLabel,
      bankCategoryAnnounceText,
      bankCategoryCardModel,
      bankCategoryResolveCardKey,
      bankCategoryMoveHighlight,
      bankCategoryChordInit,
      bankCategoryChordKeyup,
      bankCategoryChordShouldSwallow,
      bankCategoryLockInit,
      bankCategoryLockActive,
      bankCategorySessionStart,
      bankCategorySessionRecord,
      bankCategorySessionProgress,
      bankCategorySessionIdleExpired,
      bankCategoryElapsedText,
      bankCategoryAccountLine,
      bankCategoryEndOfRunSummary,
      BANK_CATEGORY_WRITE_REFUSAL,
      bankCategoryCapture,
      bankCategoryCountCatFields,
      bankCategoryWritePlan,
      bankCategoryWaitingRows,
      bankCategoryNextWaiting,
      bankCategoryMatchJsonRow,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
