// Test-facing exports for the pure schema arrangement model.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      createArrangement,
      compileAlbumArrangement,
      compileBankArrangement,
      simulateAlbumOps,
      simulateBankOps,
      arrangeGapHintLabels,
      arrangeFlipPlan,
    });
  }
} catch (_) {}
