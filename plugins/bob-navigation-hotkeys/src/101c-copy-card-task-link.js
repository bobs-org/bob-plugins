// Task Link targeting for the Copy card. Selection and line checks stay pure;
// the plugin mixin resolves note paths and reads any other-note buffer.

function copyCardPathPreviewParts(value) {
  const text = String(value ?? "");
  const slash = text.lastIndexOf("/");
  if (slash === -1) {
    return Object.freeze({ head: "", tail: text });
  }
  return Object.freeze({
    head: text.slice(0, slash + 1),
    tail: text.slice(slash + 1),
  });
}

function copyCardMiddleTruncate(text, limit) {
  const value = String(text ?? "");
  const max = Math.max(1, Math.floor(numericOrDefault(limit, COPY_CARD_NOTICE_VALUE_LIMIT)));
  if (value.length <= max) {
    return value;
  }
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

function formatCopiedNotice(value) {
  const display = copyCardPreviewText(value);
  return `Copied ${copyCardMiddleTruncate(display, COPY_CARD_NOTICE_VALUE_LIMIT)}`;
}

function copyCardAvailableValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value);
  return text === "" ? null : text;
}

function copyCardTemplateUsesBlockId(template) {
  const variables = Array.isArray(template && template.variables)
    ? template.variables
    : [];
  return variables.includes("block_id");
}

function isCopyableCopyCardRow(row) {
  return Boolean(row) && (row.state === "ready" || row.state === "collision");
}

function buildCopyCardRow(fields) {
  return freezeCopyCardValue({
    id: fields.id,
    group: fields.group,
    key: fields.key || null,
    label: fields.label,
    value: fields.value === undefined ? null : fields.value,
    preview: fields.preview,
    previewParts: fields.previewParts || null,
    state: fields.state,
    reason: fields.reason || null,
    isPath: fields.isPath === true,
    copyChip: fields.copyChip || null,
    chipScope:
      fields.chipScope === "task" || fields.chipScope === "cursor"
        ? fields.chipScope
        : null,
  });
}

function resolveCopyCardTaskLink(lines, selections) {
  const sourceLines = Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/);
  const list = Array.isArray(selections) ? selections : [];
  if (list.length !== 1) {
    return null;
  }
  const selection = list[0] && typeof list[0] === "object" ? list[0] : {};
  const head = copyCardSelectionPoint(selection.head || selection);
  const anchor = copyCardSelectionPoint(selection.anchor || selection.head || selection);
  if (!head || !anchor || head.line !== anchor.line) {
    return null;
  }
  const contexts = getMarkdownLineContextsForLines(sourceLines);
  if (
    (contexts[head.line] && contexts[head.line].inFrontmatter) ||
    copyCardLineIsInFence(sourceLines, head.line)
  ) {
    return null;
  }
  const link = parseLinkPickerTaskLink(sourceLines[head.line]);
  return link ? Object.freeze({ ...link, line: head.line }) : null;
}

function buildCopyCardLinkedTask({ link, path, content, error } = {}) {
  const target = link && typeof link === "object" ? link : {};
  const blockId = String(target.blockId || "");
  const displayTarget = `${String(target.target || "")}#^${blockId}`;
  const normalizedPath = path ? normalizeVaultRelativePath(path) : null;
  const unresolved = (reason) => freezeCopyCardValue({
    state: "unresolved",
    linked: true,
    path: normalizedPath,
    line: null,
    blockId: null,
    title: displayTarget,
    reason: String(reason),
  });
  if (error) {
    return unresolved(error);
  }
  const found = findUniqueLinkPickerTargetLine(content, blockId, { allowClosed: true });
  if (!found.valid) {
    const reason = found.error === "missing"
      ? `^${blockId} not found in ${normalizedPath}`
      : found.error === "duplicated"
        ? `^${blockId} is duplicated in ${normalizedPath}`
        : `^${blockId} in ${normalizedPath} is not a #task`;
    return unresolved(reason);
  }
  return freezeCopyCardValue({
    state: "ready",
    linked: true,
    path: normalizedPath,
    line: found.line,
    blockId,
    title: cleanTaskDisplayText(found.rawLine),
  });
}
