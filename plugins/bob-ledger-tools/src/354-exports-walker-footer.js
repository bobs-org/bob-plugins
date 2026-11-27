// Test helpers for the lane walker footer, kept separate from the crowded
// base export fragment so every hand-edited fragment stays below 1000 lines.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      laneWalkerFooterView,
      laneWalkerFooterGroups,
      laneWalkerFooterCapFor,
      laneWalkerFooterOverLanes,
      walkerFooterPushLaneAttention,
      laneWalkerFooterReadLatestWorkLog,
      laneWalkerFooterWorkLogLabel,
      laneWalkerFooterAgeLabel,
      walkerFooterClearView,
      walkerFooterReviewView,
      walkerFooterPushReviewAttention,
      walkerFooterReviewAttentionLabel,
      walkerFooterCabinetOverlayParts,
      walkerFooterOverlayPaintText,
      walkerFooterWalkMode,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
