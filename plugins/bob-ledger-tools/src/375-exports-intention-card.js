// Test-facing exports for canonical intention-card models and display helpers.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      INTENTION_CARD_OWNED_KEYS,
      INTENTION_CARD_CHIPS,
      INTENTION_CARD_RECENT_CLOSED_DAYS,
      INTENTION_CARD_LINK_HINT,
      intentionCardDateParts,
      intentionCardDateOrdinal,
      intentionCardShiftDate,
      intentionCardWeeksInIsoYear,
      intentionCardSubjectForPath,
      intentionCardDigest,
      intentionCardReadFields,
      intentionCardParseFrontmatter,
      intentionCardFrontmatterEvidence,
      intentionCardLinkSubject,
      intentionCardIsNavigationLine,
      intentionCardIsChildLinksLine,
      intentionCardPlacement,
      intentionCardMissingBands,
      intentionCardModelFor,
      intentionCardBuildDom,
      intentionCardDomAnchor,
      intentionCardDomTargetExists,
      BobLedgerToolsIntentionCardMixin,
    });
  }
} catch (_) {}
