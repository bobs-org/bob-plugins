// Test-facing exports for the day and period card group rail (bob-cli-oj
// group-rail).
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      INTENTION_CARD_GROUP_UNITS,
      INTENTION_CARD_GROUP_CHANGED,
      intentionCardNavStop,
      intentionCardNavRailModel,
      intentionCardNavRailSignature,
      intentionCardHasAuthoredStepLink,
      intentionCardDerivedRailItems,
      intentionCardGroupRowSpec,
      intentionCardDomRail,
      BobLedgerToolsIntentionCardGroupRailMixin,
    });
  }
} catch (_) {}
