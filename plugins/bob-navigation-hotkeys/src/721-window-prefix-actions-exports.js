try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      inspectWindowPrefixLayoutApis,
      windowPrefixSelectedLeaf,
      readWindowPrefixHotkeyEntries,
      windowPrefixIsInRoot,
      windowPrefixLayoutGroups,
      windowPrefixIsSourceCollapsedLive,
      windowPrefixCollapseEmptySource,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
