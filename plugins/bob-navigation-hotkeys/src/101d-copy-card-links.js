// Copy card link rows: Note link and Task link built from the shared
// canonical link-note rule (080-dependency-identity.js). Function
// declarations only: fragments share one script scope and a top-level const
// that reads another fragment at load time would break order independence.

function copyCardLinkNote(targetPath, blockIdOrPaths, maybePaths) {
  let blockId = "bob-copy-card-note-probe";
  let markdownPaths = null;
  if (Array.isArray(blockIdOrPaths) || blockIdOrPaths === null || blockIdOrPaths === undefined) {
    markdownPaths = blockIdOrPaths || null;
  } else if (typeof blockIdOrPaths === "string") {
    if (Array.isArray(maybePaths) || maybePaths === null || maybePaths === undefined) {
      blockId = blockIdOrPaths || "bob-copy-card-note-probe";
      markdownPaths = maybePaths || null;
    } else {
      blockId = blockIdOrPaths || "bob-copy-card-note-probe";
      markdownPaths = null;
    }
  } else {
    markdownPaths = maybePaths || null;
  }
  const normalized = normalizeVaultRelativePath(targetPath);
  return canonicalDependencyLink(
    { path: normalized, blockId },
    "",
    markdownPaths || [],
  );
}

function buildCopyCardNoteLinkRow(spec, relativePath, markdownPaths) {
  const normalized = normalizeVaultRelativePath(relativePath);
  if (!normalized) {
    const reason = "needs a note";
    return buildCopyCardRow({
      id: spec.id,
      group: "file",
      key: spec.key,
      label: spec.label,
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  const link = copyCardLinkNote(normalized, markdownPaths || []);
  const note = link && typeof link.note === "string" ? link.note : "";
  if (!note) {
    const reason = "needs a note";
    return buildCopyCardRow({
      id: spec.id,
      group: "file",
      key: spec.key,
      label: spec.label,
      value: null,
      preview: reason,
      state: "unavailable",
      reason,
      isPath: false,
    });
  }
  const value = `[[${note}]]`;
  return buildCopyCardRow({
    id: spec.id,
    group: "file",
    key: spec.key,
    label: spec.label,
    value,
    preview: copyCardPreviewText(value),
    state: "ready",
    reason: null,
    isPath: false,
  });
}

function buildCopyCardTaskLinkRow(spec, taskPath, blockId, markdownPaths) {
  const normalized = normalizeVaultRelativePath(taskPath);
  const id = copyCardAvailableValue(blockId);
  if (!normalized || !id) {
    return null;
  }
  const link = copyCardLinkNote(normalized, id, markdownPaths || []);
  const text = link && typeof link.text === "string" ? link.text : "";
  if (!text) {
    return null;
  }
  return buildCopyCardRow({
    id: spec.id,
    group: "task",
    key: spec.key,
    label: spec.label,
    value: text,
    preview: copyCardPreviewText(text),
    state: "ready",
    reason: null,
    isPath: false,
  });
}

function buildCopyCardBuiltinRowLists(args) {
  const input = args && typeof args === "object" ? args : {};
  const values = input.values && typeof input.values === "object" ? input.values : {};
  const relative = String(input.relative || "");
  const taskPath = String(input.taskPath || "");
  const task = input.task && typeof input.task === "object" ? input.task : {};
  const taskState = String(input.taskState || "none");
  const taskReason = input.taskReason || null;
  const markdownPaths = Array.isArray(input.markdownPaths) ? input.markdownPaths : null;
  const fileBuiltins = [];
  const taskBuiltins = [];
  let chipRow = null;
  for (const spec of COPY_CARD_BUILTIN_ROWS) {
    if (spec.id === "chip") {
      chipRow = buildCopyCardChipRow(spec, input.copyChip);
      continue;
    }
    if (spec.id === "note-link") {
      const row = buildCopyCardNoteLinkRow(spec, relative, markdownPaths);
      if (!row) {
        continue;
      }
      fileBuiltins.push(row);
      continue;
    }
    if (spec.id === "task-link") {
      if (taskState !== "ready") {
        continue;
      }
      const row = buildCopyCardTaskLinkRow(spec, taskPath, task.blockId, markdownPaths);
      if (!row) {
        continue;
      }
      taskBuiltins.push(row);
      continue;
    }
    const row = buildCopyCardBuiltinRow(spec, values, taskState, taskReason);
    if (!row) {
      continue;
    }
    if (spec.id === "block-id") {
      taskBuiltins.push(row);
    } else {
      fileBuiltins.push(row);
    }
  }
  return { fileBuiltins, taskBuiltins, chipRow };
}
