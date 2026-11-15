// Test helpers for subscription chips (bob-cli-ls.7). Kept separate so
// every hand-edited fragment stays at or below 1000 lines.
try {
  if (
    typeof module !== "undefined" &&
    module.exports &&
    typeof module.exports === "function"
  ) {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      BANK_SUBSCRIPTION_ALIAS,
      BANK_SUBSCRIPTION_CANDIDATE_TOOLTIP,
      bankNormalizeSubscription,
      bankParseWikilinkSpan,
      bankSubscriptionLinkFromToken,
      bankSubscriptionChipModel,
      bankSubscriptionChipForQueueRow,
      bankSubscriptionChipKey,
      bankSubscriptionChipClass,
      buildBankSubscriptionChipElement,
      bankSubscriptionLinkWritePlan,
      bankSubscriptionWikilink,
      bankPayeeNamesRecord,
      bankJsonRowForToken,
      bankSubscriptionBindChip,
      bankMarkFindSubscriptionLink,
      bankMarkWrapSubscriptionAnchor,
      bankMarkAppendSubscriptionChip,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
