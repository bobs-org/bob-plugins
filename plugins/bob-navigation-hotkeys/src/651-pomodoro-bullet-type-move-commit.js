function pomodoroBulletMoveTypePreviewSignature(preview) {
  return JSON.stringify({
    candidates: preview && preview.candidates,
    unresolved: preview && preview.unresolved,
    error: preview && preview.error,
    records: (preview && Array.isArray(preview.records) ? preview.records : []).map((record) => ({
      path: record.path,
      content: record.content,
      line: record.line,
      rawLine: record.rawLine,
      blockId: record.blockId,
      field: record.field,
      effective: record.effective,
    })),
  });
}

function pomodoroBulletMoveCurrentDestinationName(row) {
  if (row && row.kind === "existing") {
    return String(getNormalizedPomodoroEntryName(row.entry) || "").trim();
  }
  return String(row && row.name || "").trim();
}

function pomodoroBulletMoveFieldWrite(api, record, plan) {
  if (!plan || !record || !api) {
    return null;
  }
  try {
    if (plan.kind === "set" && typeof api.setTaskTheme === "function") {
      return api.setTaskTheme(record.rawLine, plan.name);
    }
    if (plan.kind === "clear" && typeof api.clearTaskTheme === "function") {
      return api.clearTaskTheme(record.rawLine);
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function pomodoroBulletMoveTypePlanRows(api, preview, destinationName, options = {}) {
  const keepType = options.typeMode === "keepType";
  return (Array.isArray(preview && preview.records) ? preview.records : []).map((record) => {
    let plan = null;
    try {
      plan = api.planRetype({
        field: record.field,
        effective: record.effective,
        inherited: record.inherited,
        destination: destinationName,
        keepType,
        ...(options.tabPick && !keepType ? { tabPick: options.tabPick } : {}),
      });
    } catch (_error) {
      plan = null;
    }
    return Object.freeze({ record, plan });
  });
}

function pomodoroBulletMoveTaskWrites(api, plans, sourcePath) {
  const local = [];
  const byPath = new Map();
  for (const item of plans) {
    const { record, plan } = item;
    if (!plan || (plan.kind !== "set" && plan.kind !== "clear")) {
      continue;
    }
    const text = pomodoroBulletMoveFieldWrite(api, record, plan);
    if (typeof text !== "string") {
      return { valid: false, error: "Task type field could not be planned" };
    }
    if (text === record.rawLine) {
      continue;
    }
    const change = Object.freeze({ record, text });
    if (record.path === sourcePath) {
      local.push(change);
      continue;
    }
    let group = byPath.get(record.path);
    if (!group) {
      group = { path: record.path, file: record.file, before: record.content, changes: [] };
      byPath.set(record.path, group);
    }
    if (group.before !== record.content) {
      return { valid: false, error: "A linked note changed during preview" };
    }
    group.changes.push(change);
  }

  for (const group of byPath.values()) {
    const { lines, lineEnding } = splitMarkdownContent(group.before);
    for (const change of group.changes) {
      if (lines[change.record.line] !== change.record.rawLine) {
        return { valid: false, error: "A linked task changed during preview" };
      }
      lines[change.record.line] = change.text;
    }
    group.after = lines.join(lineEnding);
  }
  return { valid: true, local, groups: [...byPath.values()] };
}

function applyPomodoroBulletMoveLocalTaskWrites(content, changes) {
  let working = String(content || "");
  for (const change of changes) {
    const found = findUniqueLinkPickerTargetLine(
      working,
      change.record.blockId,
      { allowClosed: false },
    );
    if (!found.valid || found.rawLine !== change.record.rawLine) {
      return { valid: false, content: String(content || "") };
    }
    const source = splitMarkdownContent(working);
    source.lines[found.line] = change.text;
    working = source.lines.join(source.lineEnding);
  }
  return { valid: true, content: working };
}

function pomodoroBulletMoveTypeToast(plans, typeMode, destinationName) {
  const rows = Array.isArray(plans) ? plans : [];
  const records = rows.map((item) => item.record).filter(Boolean);
  if (records.length === 0) {
    return "";
  }
  if (typeMode === "keepType") {
    const names = [...new Set(records.map((record) => record.typeName).filter(Boolean))];
    return names.length === 1
      ? ` · keeps ${names[0]}`
      : " · keeps task types";
  }
  const changed = rows.filter((item) => item.plan && (item.plan.kind === "set" || item.plan.kind === "clear"));
  if (changed.length === 0) {
    const names = [...new Set(records.map((record) => record.typeName).filter(Boolean))];
    return names.length === 1
      ? ` · keeps ${names[0]}`
      : " · keeps task types";
  }
  const setPlans = changed.filter((item) => item.plan.kind === "set");
  const clearPlans = changed.filter((item) => item.plan.kind === "clear");
  const names = [...new Set(setPlans.map((item) => item.plan.name).filter(Boolean))];
  if (setPlans.length === changed.length && names.length === 1) {
    return ` · ${changed.length} task${changed.length === 1 ? "" : "s"} now ${names[0]}`;
  }
  if (clearPlans.length === changed.length && changed.length === 1) {
    return " · type cleared";
  }
  if (clearPlans.length === changed.length) {
    return ` · ${changed.length} task types cleared`;
  }
  return ` · ${changed.length} task types updated`;
}

function pomodoroBulletMoveFinalDestinationName(row, keepName) {
  const name = String(keepName || "").trim();
  return name || pomodoroBulletMoveCurrentDestinationName(row);
}

async function pomodoroBulletMoveApplyNoteGroups(plugin, groups) {
  let failed = 0;
  for (const group of groups) {
    if (group.after === group.before) {
      continue;
    }
    try {
      if (typeof plugin.writeLinkPickerNoteChange !== "function") {
        failed += 1;
        continue;
      }
      await plugin.writeLinkPickerNoteChange(
        group.path,
        group.file,
        group.before,
        group.after,
      );
    } catch (_error) {
      failed += 1;
    }
  }
  return failed;
}

async function commitPomodoroBulletMoveWithRetype(plugin, session, row, options = {}) {
  const split = Boolean(row && row.kind === "split");
  const activeView = plugin && typeof plugin.getActiveMarkdownView === "function"
    ? plugin.getActiveMarkdownView()
    : null;
  if (
    !session ||
    !session.editor ||
    typeof session.editor.getValue !== "function" ||
    !activeView ||
    !activeView.file ||
    activeView.file.path !== session.sourcePath ||
    activeView.editor !== session.editor ||
    String(session.editor.getValue() || "") !== session.sourceContent
  ) {
    new Notice(`Source note is no longer active; nothing was ${split ? "split" : "moved"}`);
    return false;
  }
  if (!row || (!split && row.kind !== "existing" && row.kind !== "new")) {
    return false;
  }
  if (options.typePreviewState && options.typePreviewState !== "ready") {
    new Notice(options.typePreviewState === "loading"
      ? "Task type preview is still loading; nothing was moved"
      : "Task type preview is unavailable; nothing was moved");
    return false;
  }
  if (options.typePreview && options.typePreview.error) {
    new Notice("Task type preview is unavailable; nothing was moved");
    return false;
  }

  const freshPreview = await resolvePomodoroBulletMoveTypePreview(plugin, session);
  if (freshPreview.error) {
    new Notice(`${freshPreview.error}; nothing was moved`);
    return false;
  }
  if (
    options.typePreview &&
    pomodoroBulletMoveTypePreviewSignature(options.typePreview) !==
      pomodoroBulletMoveTypePreviewSignature(freshPreview)
  ) {
    new Notice("A linked task changed after preview; reopen the picker");
    return false;
  }

  const api = freshPreview.api;
  const typeMode = options.typeMode === "keepType" ? "keepType" : "retype";
  const destinationName = pomodoroBulletMoveCurrentDestinationName(row);
  const merged = api && freshPreview.records.length > 0 && typeMode === "keepType"
    ? mergePomodoroBulletMoveTaskTypes(api, freshPreview.records, destinationName)
    : { name: destinationName, appended: [] };
  const finalDestinationName = pomodoroBulletMoveFinalDestinationName(row, merged.name);
  const typePlans = api
    ? pomodoroBulletMoveTypePlanRows(api, freshPreview, destinationName, options)
    : [];
  if (typePlans.some((item) => !item.plan)) {
    new Notice("Task type routing could not plan this move; nothing was moved");
    return false;
  }
  const writes = typeMode === "keepType"
    ? { valid: true, local: [], groups: [] }
    : pomodoroBulletMoveTaskWrites(api, typePlans, normalizeVaultRelativePath(session.sourcePath));
  if (!writes.valid) {
    new Notice(`${writes.error}; nothing was moved`);
    return false;
  }

  let plan;
  let destinationLabel;
  if (split) {
    const sourceLines = splitMarkdownContent(session.sourceContent).lines;
    plan = planPomodoroBulletSplit(session.sourceContent, {
      targets: session.discovery.targets,
      sourceEntryLine: session.discovery.entryLine,
      sourceRawLine: String(sourceLines[session.discovery.entryLine] || ""),
      splitName: finalDestinationName,
    });
    destinationLabel = finalDestinationName;
  } else {
    const destination = row.kind === "existing"
      ? { kind: "existing", entryLine: row.entry && row.entry.entryLine }
      : {
          kind: "new",
          name: finalDestinationName,
          preserveSpelling: row.preserveSpelling === true,
        };
    plan = planPomodoroBulletMove(session.sourceContent, {
      targets: session.discovery.targets,
      sourceEntryLine: session.discovery.entryLine,
      destination,
    });
    destinationLabel = row.kind === "existing"
      ? getPomodoroBulletMoveDestinationLabel(row.entry)
      : finalDestinationName;
    if (
      plan.valid &&
      row.kind === "existing" &&
      typeMode === "keepType" &&
      finalDestinationName !== destinationName
    ) {
      const lines = splitMarkdownContent(plan.after).lines;
      const rename = planPomodoroEntryRename(plan.after, {
        sourceEntryLine: plan.destinationEntryLine,
        sourceRawLine: String(lines[plan.destinationEntryLine] || ""),
        name: finalDestinationName,
        preserveSpelling: true,
      });
      if (!rename.valid) {
        new Notice(`${rename.error}; nothing was moved`);
        return false;
      }
      plan = Object.freeze({ ...plan, after: rename.after });
      destinationLabel = finalDestinationName;
    }
  }
  if (!plan.valid) {
    new Notice(`${plan.error}; nothing was ${split ? "split" : "moved"}`);
    return false;
  }

  let sourceAfter = plan.after;
  const localWrites = applyPomodoroBulletMoveLocalTaskWrites(sourceAfter, writes.local);
  if (!localWrites.valid) {
    new Notice("A linked task changed during the move; nothing was moved");
    return false;
  }
  sourceAfter = localWrites.content;

  const afterLines = splitMarkdownContent(sourceAfter).lines;
  const firstMovedLine = Math.min(
    Math.max(Number.isInteger(plan.firstMovedLine) ? plan.firstMovedLine : 0, 0),
    Math.max(afterLines.length - 1, 0),
  );
  const sourceCursor = normalizePosition(session.cursor) || {
    line: firstMovedLine,
    ch: 0,
  };
  const finalCursor = {
    line: firstMovedLine,
    ch: Math.min(sourceCursor.ch, String(afterLines[firstMovedLine] || "").length),
  };

  let applied = false;
  try {
    applied = applyEditorContentTransaction(
      session.editor,
      session.sourceContent,
      sourceAfter,
      finalCursor,
    );
  } catch (_error) {
    applied = String(session.editor.getValue() || "") === sourceAfter;
  }
  if (!applied || String(session.editor.getValue() || "") !== sourceAfter) {
    new Notice(`Pomodoro bullet ${split ? "split" : "move"} failed; nothing was moved`);
    return false;
  }

  plugin.restoreTaskMoveSourceContext(session);
  const failedGroups = await pomodoroBulletMoveApplyNoteGroups(plugin, writes.groups);
  const notice = split
    ? buildPomodoroBulletSplitNotice(plan, session.discovery)
    : buildPomodoroBulletMoveNotice(plan, session.discovery, destinationLabel);
  if (failedGroups > 0) {
    new Notice(`${notice} · task type update incomplete; check the type mismatch mark`);
    return true;
  }
  const typeSuffix = pomodoroBulletMoveTypeToast(
    typePlans,
    typeMode,
    finalDestinationName,
  );
  const typeWarningSuffix = !split && row.kind === "new"
    ? navigationPomodoroThemeUnconfiguredNames(api, finalDestinationName)
        .map((name) => ` · ${name} isn't one of your types`)
        .join("")
    : "";
  new Notice(notice + typeSuffix + typeWarningSuffix);
  return true;
}
