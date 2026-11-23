// Event Task target exports for tests (plan:202611/links_stage_event_tasks.md).
// New fragment so `700-exports.js` stays under its line cap.
try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      isRelationStageDailyNotePath,
      relationStageNoteDay,
      relationStageEventsSectionRange,
      relationStageEventTaskSpan,
      relationStageEventTaskName,
      relationStageDailyAdmission,
      relationStageCleanEventTitle,
    });
  }
} catch (_error) {}
