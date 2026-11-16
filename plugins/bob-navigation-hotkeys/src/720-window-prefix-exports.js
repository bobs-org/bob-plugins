try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      WINDOW_PREFIX_CANCEL_KEYS,
      WINDOW_PREFIX_HINT_DELAY_MS,
      WINDOW_PREFIX_KEY_TABLE,
      normalizeWindowPrefixSnapshot,
      planWindowPrefixFocus,
      planWindowPrefixMove,
      planWindowPrefixSplit,
      planWindowPrefixKey,
      buildWindowPrefixTabCatalog,
      windowPrefixDigitFromKeydown,
      windowPrefixCtrlWOwner,
      windowTabNumeralsVerdict,
      normalizeWindowPrefixKeydown,
      getWindowPrefixArmingVerdict,
      buildWindowPrefixViewModel,
      createWindowHintHost,
      windowPrefixOverlayFlags,
      windowPrefixTargetIsEditable,
      windowPrefixMoveReceiptText,
      windowPrefixNormalizeVimMode,
      WINDOW_PREFIX_PALETTE_COMMANDS,
      WINDOW_PREFIX_TAB_JUMP_COMMANDS,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
