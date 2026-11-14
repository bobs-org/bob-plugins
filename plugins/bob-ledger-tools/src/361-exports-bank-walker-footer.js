// Test helpers for the bank walker-footer panel (family `b`).
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bankWalkerFooterView,
      bankWalkerFooterMeterFromReport,
      bankWalkerFooterArm,
      bankWalkerFooterActivate,
      bankWalkerFooterRequest,
      bankWalkerFooterTakeMeter,
      walkerFooterPushBankAttention,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
