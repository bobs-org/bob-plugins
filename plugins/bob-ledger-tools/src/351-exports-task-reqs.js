// Task requirement recognizer helpers, exported beside the task-tag surface.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      TASK_REQ_MAX_DEPTH,
      TASK_REQ_GLOBAL_FILTER,
      TASK_REQ_TEACHING_COPY,
      taskReqListItem,
      taskReqParseCheckbox,
      taskReqCarriesGlobalFilter,
      taskReqForest,
      taskReqInfoAtLine,
    });
  }
} catch (error) {
  // Test exports are best-effort.
}
