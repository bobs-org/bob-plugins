try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      inspectWindowPrefixLayoutApis,
      windowPrefixIsInRoot,
      windowPrefixLayoutGroups,
      windowPrefixIsSourceCollapsedLive,
      windowPrefixCollapseEmptySource,
    });
  }
} catch (_error) {
  // Test exports are best-effort.
}
