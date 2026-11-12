// Test helpers for the read-only `n` walker-footer destination compass.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      linksWalkerFooterLabel,
      linksWalkerFooterView,
      linksWalkerFooterSource,
      linksWalkerFooterRequest,
      linksWalkerFooterInvalidate,
      linksWalkerFooterActivate,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
