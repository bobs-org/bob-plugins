// Test-facing exports for the property-card identity badge.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_IDENTITY_CLASS,
      PROPERTY_CARD_IDENTITY_WORD_CLASS,
      propertyCardBuildIdentityBadge,
    });
  }
} catch (_) {}
