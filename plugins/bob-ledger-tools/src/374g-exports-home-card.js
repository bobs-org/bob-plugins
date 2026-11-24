// Test-facing exports for the local Area/Project card model and DOM builder.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      HOME_CARD_MAX_CRUMBS,
      HOME_CARD_CLASS,
      HOME_CARD_META_CLASS,
      homeCardPath,
      homeCardStem,
      homeCardPathExcluded,
      homeCardKindFromFrontmatter,
      homeCardEligible,
      homeCardCalendarDate,
      homeCardTitleModel,
      homeCardEligibleHeading,
      homeCardWalkAncestry,
      homeCardCollapseCrumbs,
      homeCardPrjTask,
      homeCardLifecycle,
      homeCardChips,
      homeCardReadyModel,
      homeCardWhereMarks,
      homeCardManagedMap,
      homeCardModel,
      homeCardBuildEl,
    });
  }
} catch (_) {}
