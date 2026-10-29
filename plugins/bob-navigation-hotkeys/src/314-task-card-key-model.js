function taskCardIntentForRow(row) {
  if (!row) {
    return Object.freeze({
      type: "unavailable",
      action: "open-row",
      reason: "No card action is selected",
    });
  }
  if (!row.enabled) {
    return Object.freeze({
      type: "unavailable",
      action: row.action || row.id,
      rowId: row.id,
      reason: row.unavailableReason || "This action is unavailable",
    });
  }
  return Object.freeze({
    type: "open-action",
    action: row.action,
    rowId: row.id,
    propertyName: row.propertyName || "",
    targetCount: row.targetCount || 0,
  });
}

function resolveTaskCardKey(model, event) {
  if (!model || model.kind !== "task-card" || !event) {
    return null;
  }
  if (
    event.isComposing === true ||
    event.keyCode === 229 ||
    model.inputActive === true ||
    event.inputActive === true ||
    event.inTextInput === true
  ) {
    return null;
  }
  const target = event.target;
  if (
    target &&
    (target.isContentEditable === true ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(String(target.tagName || "").toUpperCase()))
  ) {
    return null;
  }
  const key = String(event.key || "");
  const lower = key.toLowerCase();
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const shift = event.shiftKey === true;
  const alt = event.altKey === true;
  const modified = ctrl || meta || shift || alt;
  const repeatedAction = event.repeat === true;
  const quickRollKey =
    alt && !ctrl && !meta && !shift && event.code === "KeyP";
  const rows = Array.isArray(model.rows) ? model.rows : [];
  const selected = rows.find((row) => row.id === model.selectedRowId) || null;
  const rowById = (id) => rows.find((row) => row.id === id) || null;
  const unavailable = (action, reason) =>
    Object.freeze({ type: "unavailable", action, reason });
  const movement = (direction) =>
    Object.freeze({ type: "move-selection", direction, fromRowId: model.selectedRowId });
  const actionKey =
    (!modified && /^[0-9bflx]$/i.test(key)) ||
    (shift && !ctrl && !meta && !alt && (event.code === "KeyB" || event.code === "KeyL" || key === "B" || key === "L")) ||
    (ctrl && !meta && !shift && !alt && ["Enter", "r", "d"].includes(key)) ||
    (meta && !ctrl && !shift && !alt && key === "Enter") ||
    (alt && !ctrl && !meta && !shift && lower === "n") ||
    quickRollKey;
  if (repeatedAction && actionKey) {
    return Object.freeze({ type: "ignored", reason: "repeated-action-key" });
  }
  if (
    (!modified && key === "ArrowUp") ||
    (ctrl && !meta && !shift && !alt && lower === "p")
  ) {
    return movement("previous");
  }
  if (
    (!modified && key === "ArrowDown") ||
    (ctrl && !meta && !shift && !alt && lower === "n")
  ) {
    return movement("next");
  }
  if (quickRollKey || ((ctrl || meta) && !shift && !alt && key === "Enter")) {
    const recommendation = model.recommendation;
    if (!recommendation || !recommendation.available) {
      return unavailable(
        "apply-recommendation",
        recommendation?.unavailableReason || "No recommendation is available",
      );
    }
    return Object.freeze({
      type: "apply-recommendation",
      recommendation: recommendation.source,
      effects: recommendation.effects,
      targetCount: recommendation.targetCount,
    });
  }
  if (ctrl && !meta && !shift && !alt && lower === "r") {
    if (!model.priorityStrip || !model.priorityStrip.available) {
      return unavailable(
        "refresh-priority-previews",
        model.priorityStrip?.unavailableReason || "Priority is not configured",
      );
    }
    return Object.freeze({
      type: "refresh-previews",
      includeRecommendation: true,
      includePriorityStrip: true,
    });
  }
  if (alt && !ctrl && !meta && !shift && lower === "n") {
    return taskCardIntentForRow(rowById("lane"));
  }
  if (ctrl && !meta && !shift && !alt && lower === "d") {
    if (selected && selected.id === "links-to") {
      return Object.freeze({
        type: "clear-relations",
        rowId: selected.id,
        targetCount: model.session.targetCount,
      });
    }
    if (selected && selected.id === "linked-from") {
      return unavailable(
        "clear-relations",
        TASK_LINKED_FROM_LINE_NOTICE,
      );
    }
    if (!selected || selected.kind !== "property" || !selected.deletable) {
      return unavailable("delete-property", "Only a selected property can be deleted");
    }
    if (!selected.enabled) {
      return unavailable(
        "delete-property",
        selected.unavailableReason || "The selected property is unavailable",
      );
    }
    return Object.freeze({
      type: "delete-property",
      rowId: selected.id,
      propertyName: selected.propertyName,
      targetCount: selected.targetCount || model.session.targetCount,
    });
  }
  if (!modified && /^[1-9]$/.test(key)) {
    const level = model.priorityStrip?.levels?.find((item) => item.key === key);
    if (!level) {
      return unavailable("set-priority", "Priority level is not configured");
    }
    if (!level.available) {
      return unavailable("set-priority", level.unavailableReason || "Priority level is unavailable");
    }
    return Object.freeze({
      type: "set-priority",
      propertyName: model.priorityStrip.propertyName,
      levelIndex: level.index,
      levelLabel: level.label,
      value: level.value,
      key,
      previews: level.targetPreviews,
      targetCount: level.targetCount,
      mixed: level.mixed,
    });
  }
  if (!modified && key === "0") {
    if (!model.priorityStrip?.propertyName) {
      return unavailable("clear-priority", "Priority is not configured");
    }
    return Object.freeze({
      type: "clear-priority",
      propertyName: model.priorityStrip.propertyName,
      value: "",
      keepScheduled: true,
      targetCount: model.priorityStrip.targetCount,
    });
  }
  if (!modified && lower === "b") {
    return taskCardIntentForRow(rowById("depends-on"));
  }
  if (!modified && lower === "l") {
    return taskCardIntentForRow(rowById("links-to"));
  }
  if (
    shift &&
    !ctrl &&
    !meta &&
    !alt &&
    (event.code === "KeyB" || key === "B")
  ) {
    return taskCardIntentForRow(rowById("blocks"));
  }
  if (
    shift &&
    !ctrl &&
    !meta &&
    !alt &&
    (event.code === "KeyL" || key === "L")
  ) {
    return taskCardIntentForRow(rowById("linked-from"));
  }
  if (!modified && lower === "f") {
    return taskCardIntentForRow(rowById("review-every"));
  }
  if (!modified && lower === "x") {
    return taskCardIntentForRow(rowById("cancel"));
  }
  if (!modified && key === "Enter") {
    return taskCardIntentForRow(selected);
  }
  if (isTaskCardCloseKeydown(event)) {
    return Object.freeze({ type: "close-card" });
  }
  if (!modified && key === "Backspace") {
    return Object.freeze({ type: "back" });
  }
  return null;
}

const TASK_CARD_ROW_ORDER = Object.freeze([
  "schedule",
  "depends-on",
  "blocks",
  "links-to",
  "linked-from",
  "review-every",
  "lane",
  "theme",
  "cancel",
]);

const TASK_CARD_ROW_SHORTCUTS = Object.freeze({
  schedule: "Enter",
  theme: "t",
  "depends-on": "b",
  blocks: "⇧B",
  "links-to": "l",
  "linked-from": "⇧L",
  "review-every": "f",
  lane: "Alt+N",
  cancel: "x",
});

