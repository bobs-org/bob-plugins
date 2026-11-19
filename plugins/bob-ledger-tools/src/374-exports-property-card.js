// Test-facing exports for the shared property-card kit.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_OWNED_PROPERTY_CLASS,
      PROPERTY_CARD_HOST_REFRESH_MS,
      propertyCardScopeIsEmbed,
      propertyCardNativeContainer,
      propertyCardOwnKeys,
      propertyCardReleaseScope,
      propertyCardSlotOwn,
      propertyCardSlotRelease,
      propertyCardSlotReleaseAll,
      propertyCardReadingRoot,
      propertyCardReadingScope,
      propertyCardNodeBelongs,
      createPropertyCardHost,
      PROPERTY_CARD_BUILTIN_KINDS,
      propertyCardGateKinds,
    });
  }
} catch (_) {}
