// Project and hidden task-tag-mark helpers, exported beside the
// existing task-tag-mark surface in `350-exports.js`. Kept in its own
// fragment so `350-exports.js` stays at or below 1000 lines.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      PRJ_TASK_TAG_TEXT,
      PRJ_TASK_MARK_TOOLTIP,
      PRJ_TASK_MARK_LABEL,
      PRJ_TASK_MARK_CLASS,
      PRJ_TASK_HIDDEN_CLASS,
      HIDE_TAG_TEXT,
      HIDE_TAG_MARK_TOOLTIP,
      HIDE_TAG_MARK_LABEL,
      HIDE_TAG_MARK_CLASS,
      prjTaskPairEnd,
      hideTagTokenRanges,
      isPrjTagAnchor,
      isHideTagAnchor,
      prjTaskPairAnchor,
      hideTagMarkElementEligible,
      annotatePrjTaskMark,
      annotateHideTagMark,
      stripPrjTaskHidden,
      PrjTaskMarkWidget,
      HideTagMarkWidget,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
