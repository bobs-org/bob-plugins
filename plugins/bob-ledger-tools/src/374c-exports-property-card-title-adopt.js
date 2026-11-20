// Test-facing exports for the property-card adopter glue and the album
// card's title rule and card model.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_TITLE_HEADING_CLASS,
      propertyCardAdoptTitle,
      propertyCardAdoptedEntry,
      propertyCardAdoptRelease,
      propertyCardAdoptReleaseAll,
      propertyCardAdoptPatch,
      propertyCardReadingViewFor,
      propertyCardLiveCurrentPath,
      propertyCardDemoteTitleHeading,
      propertyCardPromoteTitleHeading,
      notebookHeaderNoteTitle,
      notebookHeaderHumanizeStem,
      albumHeaderIdentityModel,
      albumHeaderCardModel,
      albumHeaderCardSignature,
      albumHeaderFoldText,
      linksWalkerFooterAlbumRecord,
    });
  }
} catch (_) {}
