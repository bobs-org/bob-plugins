// Test-facing exports for the property-card title-slot primitive.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_TITLE_SLOT_CLASS,
      PROPERTY_CARD_TITLE_SLOT_REINSERT_BUDGET,
      PROPERTY_CARD_TITLE_SLOT_REINSERT_WINDOW_MS,
      propertyCardTitleSlotFor,
      propertyCardMountInTitleSlot,
      propertyCardTitleSlotRelease,
      propertyCardTitleSlotReleaseAll,
      propertyCardTitleSlotMountedNode,
      propertyCardTitleSlotLiveCount,
      propertyCardTitleSlotStats,
      propertyCardTitleSlotRedrawCursor,
      propertyCardTitleSlotEditorExtension,
      propertyCardTitleSlotOnEditorUpdate,
    });
  }
} catch (_) {}
