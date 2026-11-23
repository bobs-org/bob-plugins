// Promotion seed exports for tests (bob-cli-on.12). New fragment so
// `700-exports.js` stays under its line cap.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      buildProjectSeedFromChildBulletsReqs,
      buildProjectSeedReqTaskLine,
      projectSeedPromotionCounts,
      getProjectPromotionReceiptText,
      PROJECT_PROMOTION_NO_REQS_NOTICE,
      removeProjectTasksPlaceholderLine,
      buildProjectPromotionNoticeWithReceipt,
    });
  }
} catch (_error) {}
