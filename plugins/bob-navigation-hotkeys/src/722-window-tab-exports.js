try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      windowPrefixFocusTabFailureMessage,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
