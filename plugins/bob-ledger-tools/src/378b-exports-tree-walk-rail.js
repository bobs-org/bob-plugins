// Test-facing exports for the tree walk rail (bob-cli-ra rail).
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      PROPERTY_CARD_FLOOR_ATTR,
      PROPERTY_CARD_FLOOR_VALUE,
      propertyCardFloorOf,
      propertyCardFloorDock,
      propertyCardFloorAppend,
      propertyCardFloorRelease,
      TREE_WALK_RAIL_LABEL,
      TREE_WALK_RAIL_GROUP_LABEL,
      TREE_WALK_RAIL_CHANGED,
      treeWalkRailModel,
      treeWalkRailPlural,
      treeWalkRailCenterText,
      BobLedgerToolsTreeWalkRailMixin,
    });
  }
} catch (_) {}
