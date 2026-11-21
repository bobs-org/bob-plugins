// Test-facing exports for the property-card group row and the shared
// missing-target states (bob-cli-oj group-rail).
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_TARGET_STATES,
      PROPERTY_CARD_GROUP_TICK_LIMIT,
      PROPERTY_CARD_GHOST_NOTE,
      PROPERTY_CARD_GROUP_MARKS,
      propertyCardTargetState,
      propertyCardGroupMark,
      propertyCardBuildGroupRow,
    });
  }
} catch (_) {}
