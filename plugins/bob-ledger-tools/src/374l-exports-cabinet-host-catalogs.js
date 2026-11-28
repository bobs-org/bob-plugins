// Test-facing exports for the owner-catalog cabinet providers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_HOST_CATALOG_KINDS,
      PROPERTY_CARD_HOST_CATALOG_HEADINGS,
      PROPERTY_CARD_NAVIGATION_HEADINGS,
      propertyCardCabinetHostSourceCounts,
      propertyCardCabinetHostReportTally,
      propertyCardCabinetHostApply,
      propertyCardCabinetHostDigest,
      propertyCardCabinetHostStableValue,
      propertyCardCabinetHostStatusParts,
      propertyCardCabinetHostPaintOptions,
      propertyCardCabinetHostBuildBody,
      propertyCardCabinetHostPaintKey,
      propertyCardCabinetHostMountClaim,
      propertyCardCabinetNavigationOutlineRoot,
      propertyCardCabinetNavigationClickTarget,
      propertyCardCabinetNavigationHeading,
      propertyCardCabinetNavigationMarkdownView,
      propertyCardCabinetHostRevealNavigation,
      propertyCardCabinetHostInstall,
      BobLedgerToolsCabinetHostCatalogsMixin,
    });
  }
} catch (_) {}
