// Test-facing exports for the shared panel close-key helpers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      bobCardCloseKey,
      bobCardTypesText,
      bobCardWireCloseKeys,
      bobCardUnwireCloseKeys,
    });
  }
} catch (_) {}
