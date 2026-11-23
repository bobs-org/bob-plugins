// Task requirement recognizer helpers, exported beside the task-tag surface.
try {
  if (module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      drawer_body_title,
      is_legacy_drawer_title,
      drawer_key,
      recognize_drawer_header,
      heading_for_drawer,
      drawer_for_heading,
      can_create_drawer,
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
