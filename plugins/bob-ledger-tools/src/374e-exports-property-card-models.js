// Test-facing exports for the pure property-card models.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      propertyCardFormatCreatedStamp,
      propertyCardParseCreatedDate,
      propertyCardInventory,
      propertyCardScanFrontmatter,
      propertyCardInventoryTypedValue,
      PROSE_NOTE_CARD_KIND,
      PROSE_NOTE_CARD_SURFACE_CLASS,
      PROSE_NOTE_CARD_HOST_KIND,
      PROSE_NOTE_CARD_MOUNT_ATTR,
      PROSE_NOTE_CARD_FOOT_KIND,
      PROSE_NOTE_CARD_OUTLINE_SLOT,
      PROSE_NOTE_CARD_NUMBERING_COMMAND,
      proseNoteCardStem,
      proseNoteCardPath,
      proseNoteCardOneLine,
      proseNoteCardTitleParts,
      proseNoteCardInitial,
      proseNoteCardNumbering,
      proseNoteCardModel,
      proseNoteCardBuildEl,
      proseNoteCardNumberingNode,
      proseNoteCardFrontmatterFromText,
      proseNoteCardDefer,
      BobLedgerToolsProseNoteCardMixin,
    });
  }
} catch (_) {}
