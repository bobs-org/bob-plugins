const createDependencyNavApiBeforeProse = createDependencyNavApi;
createDependencyNavApi = function createDependencyNavApiWithProseField(plugin) {
  const api = createDependencyNavApiBeforeProse(plugin);
  return Object.freeze({
    ...api,
    proseField: createProseFieldApi(plugin),
  });
};

try {
  if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    module.exports.helpers = Object.assign({}, module.exports.helpers || {}, {
      attachProseField,
      attachLogRecall,
      createDependencyNavApi,
      createProseFieldApi,
      proseFieldAt,
      proseAliasAt,
      proseApplyInsert,
      proseCompleteLinks,
      proseInputOpensBand,
      proseRankRows,
      proseWindowRows,
      proseUnresolvedMessages,
      proseQuietMessage,
      proseResultLink,
      proseIconForRow,
      proseNoteKind,
      proseBlockPreviewText,
      renderProseLinkBand,
      renderProseLinkHint,
      renderProseTaskBand,
      createProseTaskMode,
      createControllerTaskMode,
      proseTaskLinksApiFromApp,
      proseTaskSanitizeId,
      proseTaskValidateId,
      createProseTaskIdLine,
      proseTaskIdLineInsert,
      proseTaskIdLineBackspace,
      proseTaskIdLineDeleteWord,
      proseTaskIdLineSetSuggestion,
      proseTaskIdLineCycle,
      proseTaskPillFor,
      proseTaskGroupCapsule,
      proseTaskLocatorFor,
      proseTaskDetailFor,
      proseTaskNameDetailFor,
      proseTaskCrumb,
      proseTaskLeftoverMessage,
      proseTaskGroupRuns,
      PROSE_TASK_BLOCK_ID_RE,
      PROSE_LINK_SLOTS_ROOMY,
      PROSE_LINK_SLOTS_DENSE,
      PROSE_HINT_DEBOUNCE_MS,
    });
  }
} catch (_error) {}
