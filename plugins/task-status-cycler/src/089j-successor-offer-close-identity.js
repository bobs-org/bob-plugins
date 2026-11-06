function successorOfferCloseTaskIdFor(task, lineText) {
  try {
    const meta = parseTaskDependencyMetadata(String(lineText || ""));
    if (meta && meta.taskId) return String(meta.taskId);
  } catch (_error) {}
  if (task && task.taskId) return String(task.taskId);
  return "";
}

function successorOfferCloseClosedIdentities(planned) {
  const out = [];
  for (const row of planned) {
    const lineText = row.beforeLine || row.expected || "";
    const blockId = getTrailingBlockId(String(lineText)) || (row.task && row.task.blockId) || "";
    const taskId = successorOfferCloseTaskIdFor(row.task, lineText);
    out.push({
      path: String(row.path || ""),
      ...(blockId ? { blockId: String(blockId) } : {}),
      ...(taskId ? { taskId: String(taskId) } : {}),
      text: String(row.display || ""),
    });
  }
  return out;
}
