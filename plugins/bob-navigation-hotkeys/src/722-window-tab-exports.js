try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      windowPrefixFocusTabFailureMessage,
      WINDOW_TAB_NUMBERS_ATTRIBUTE,
      WINDOW_TAB_NUMBERS_BODY_CLASS,
      WINDOW_TAB_NUMBERS_LIT_CLASS,
      WINDOW_TAB_NUMBERS_FLASH_CLASS,
      WINDOW_TAB_NUMBERS_FLASH_MS,
      WINDOW_TAB_NUMBERS_ARIA_DESCRIPTION,
      windowTabNumbersIsMacHost,
      windowTabNumbersIsPhoneHost,
      windowTabNumbersHeaderForLeaf,
      windowPrefixTabRangeLabel,
      windowPrefixTabRangeAriaLabel,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
