// Test-facing exports for the shared property-card kit (ownership phase).
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_OWNED_PROPERTY_CLASS,
      propertyCardScopeIsEmbed,
      propertyCardNativeContainer,
      propertyCardOwnKeys,
      propertyCardReleaseScope,
      propertyCardSlotOwn,
      propertyCardSlotRelease,
      propertyCardSlotReleaseAll,
      PROPERTY_CARD_BUILTIN_KINDS,
      propertyCardGateKinds,
    });
  }
} catch (_) {}
