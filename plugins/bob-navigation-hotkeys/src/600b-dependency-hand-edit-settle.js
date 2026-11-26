// R9 half of the hand-edit mirror: drop linkless Depends-On lines and settle
// the complete guarded postimage before applying it as one annotated write.
async function navApplyDependencyHandEditClear(plugin, editor, parentPath, plan, options = {}) {
  const content = String(editor.getValue() || "");
  const { lines, lineEnding } = splitMarkdownContent(content);
  const owning = plan.owning;
  if (!Number.isInteger(owning) || owning < 0 || owning >= lines.length) {
    return Object.freeze({ mirrored: false });
  }
  if (isBlockquotedMarkdownLine(lines[owning])) {
    return Object.freeze({ mirrored: false });
  }
  const next = lines.slice();
  if (plan.kind === "clear-empty" && Array.isArray(plan.emptyLines)) {
    const dels = plan.emptyLines.filter((line) => line !== owning).sort((a, b) => b - a);
    for (const line of dels) {
      if (line >= 0 && line < next.length) next.splice(line, 1);
    }
  }
  let parentText = deleteBulletProperty(String(next[owning] || ""), "dependsOn").line;
  const registry = options.registry || (await readTasksStatusRegistry(plugin.app));
  const preview = next.slice();
  preview[owning] = parentText;
  const previewContent = preview.join(lineEnding);
  const recoveryToday = options.today || new Date();
  const clearNeedsSnapshot = getObsidianTaskCheckboxStatus(String(lines[owning] || "")) === "?";
  let recoverySnapshot = options.vaultContents !== undefined ? options.vaultContents : null;
  if (options.vaultContents === undefined && clearNeedsSnapshot &&
      typeof plugin.readDependencyRecoveryVaultContents === "function") {
    try {
      recoverySnapshot = await plugin.readDependencyRecoveryVaultContents(parentPath, previewContent);
    } catch (_snapshotError) {
      recoverySnapshot = null;
    }
  }
  const recoveryNotes = [];
  if (recoverySnapshot instanceof Map) {
    for (const [filePath, fileContent] of recoverySnapshot) {
      const normalized = normalizeVaultRelativePath(filePath);
      if (!normalized) continue;
      recoveryNotes.push({
        path: normalized,
        content: normalized === normalizeVaultRelativePath(parentPath) ? previewContent : String(fileContent || ""),
      });
    }
  } else if (recoverySnapshot && typeof recoverySnapshot === "object") {
    for (const filePath of Object.keys(recoverySnapshot)) {
      const normalized = normalizeVaultRelativePath(filePath);
      if (!normalized) continue;
      recoveryNotes.push({
        path: normalized,
        content: normalized === normalizeVaultRelativePath(parentPath) ? previewContent : String(recoverySnapshot[filePath] || ""),
      });
    }
  }
  if (!recoveryNotes.some((note) => normalizeVaultRelativePath(note.path) === normalizeVaultRelativePath(parentPath))) {
    recoveryNotes.push({ path: parentPath, content: previewContent });
  }
  const recoveryIndex = buildScheduledRecoveryIndex(recoveryNotes, registry, recoveryToday);
  const metadata = getScheduledRecoveryMetadata(recoveryIndex, parentPath, owning);
  parentText = reconcileBlockedScheduledTaskLine(parentText, metadata).line;
  next[owning] = parentText;
  const nextContent = next.join(lineEnding);
  if (nextContent === content) return Object.freeze({ mirrored: false });
  const cursor = getEditorCursor(editor);
  const committed = navApplySettledEditorPostimage(
    plugin,
    editor,
    parentPath,
    content,
    nextContent,
    {
      cursor: { line: cursor ? cursor.line : owning, ch: cursor ? cursor.ch : 0 },
      annotation: BLOCKS_MACHINE_WRITE_ANNOTATION,
      today: recoveryToday,
    },
  );
  if (!committed.ok) {
    new Notice("Could not mirror dependency edit");
    return Object.freeze({ mirrored: false });
  }
  return Object.freeze({ mirrored: true });
}
