// Task drawer model and rendering helpers, exported after the plugin surface.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      taskDrawerOwnerState,
      taskDrawerDirectNoteCount,
      taskDrawerFencedLines,
      taskDrawerForest,
      taskDrawerForestForDoc,
      TASK_DRAWER_MARK_ATTRS,
      BobLedgerToolsTaskDrawerMarksMixin,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
