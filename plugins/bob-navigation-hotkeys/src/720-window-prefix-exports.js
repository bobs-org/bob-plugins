try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      WINDOW_PREFIX_CANCEL_KEYS,
      WINDOW_PREFIX_KEY_TABLE,
      normalizeWindowPrefixSnapshot,
      planWindowPrefixFocus,
      planWindowPrefixMove,
      planWindowPrefixSplit,
      planWindowPrefixKey,
      normalizeWindowPrefixKeydown,
      getWindowPrefixArmingVerdict,
      buildWindowPrefixViewModel,
      createWindowHintHost,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
