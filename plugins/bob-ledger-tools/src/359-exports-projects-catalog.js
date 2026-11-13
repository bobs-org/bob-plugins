// Projects catalog card helpers, exported beside the projects report/sync
// data surface. Kept in its own fragment so `350-exports.js` stays at or
// below 1000 lines.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      PROJECTS_CARD_CLOSED_STATES,
      PROJECTS_CLOSED_PEEK_COUNT,
      projectsCardStateOf,
      projectsCardIsClosed,
      projectsCardIsCountedBlocked,
      projectsCardMarker,
      projectsCardCalendarDate,
      projectsCardShortDate,
      projectsCardRelativeDay,
      projectsCardBlockedReason,
      projectsCardHost,
      projectsCardHostIdentity,
      projectsCardCopyText,
      projectsCardHostEntry,
      projectsCardChildEntries,
      projectsCardRowEntries,
      projectsCardPartition,
      projectsCardTally,
      projectsCardChips,
      projectsCardRowModel,
      projectsCardChildTooltip,
      projectsCardLookupByTarget,
      projectsCardHealthModel,
      projectsCardStatus,
      projectsCardSourceRegions,
      projectsCardAnchorLine,
      projectsCardClosedFoldKey,
      projectsCardChildFoldKey,
      projectsCardIsClosedFolded,
      projectsCardIsChildExpanded,
      projectsFindCallouts,
      projectsPaintCallout,
      projectsPaintStandalone,
      projectsCleanCatalogDom,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
