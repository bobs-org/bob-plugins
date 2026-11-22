// Test-facing exports for the pure property-card models.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      propertyCardFormatCreatedStamp,
      propertyCardParseCreatedDate,
      propertyCardInventory,
      propertyCardScanFrontmatter,
      propertyCardInventoryTypedValue,
    });
  }
} catch (_) {}
