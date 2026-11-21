try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      linkFieldAt,
      linkReplacementText,
      linkCursorAfter,
      rankLinkNoteCandidates,
      rankLinkHeadingCandidates,
      rankLinkBlockCandidates,
      resolveLinkTarget,
      classifyLinkTier,
      linkCompareNormalized,
      linkIsExcludedNotePath,
      rankLinkNearbyNotes,
      createLinkIndex,
      LINK_RESULT_LIMIT,
      LINK_NEARBY_LIMIT,
    });
  }
} catch (_error) {}
