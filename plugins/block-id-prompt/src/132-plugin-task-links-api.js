// Public `api.taskLinks` v1: a prose `((` detector, indexed picker session,
// and the same guarded ID naming plan used by the editor picker.

function taskLinksSplitsSurrogatePair(text, offset) {
  if (offset <= 0 || offset >= text.length) {
    return false;
  }
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function taskLinksInlineCodeSpans(line) {
  const spans = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`" || taskWikilinkIsEscaped(line, index)) {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (line[runEnd] === "`") {
      runEnd += 1;
    }
    const runLength = runEnd - index;
    let close = runEnd;
    let found = false;
    while (close < line.length) {
      if (line[close] !== "`" || taskWikilinkIsEscaped(line, close)) {
        close += 1;
        continue;
      }
      let closeEnd = close + 1;
      while (line[closeEnd] === "`") {
        closeEnd += 1;
      }
      if (closeEnd - close === runLength) {
        spans.push({ start: index, end: closeEnd });
        index = closeEnd;
        found = true;
        break;
      }
      close = closeEnd;
    }
    if (!found) {
      spans.push({ start: index, end: line.length + 1 });
      break;
    }
  }
  return spans;
}

function taskWikilinkIsEscaped(text, offset) {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function taskLinksFieldAt(text, caret, options = {}) {
  const value = String(text === null || text === undefined ? "" : text);
  if (
    !Number.isInteger(caret) || caret < 0 || caret > value.length ||
    taskLinksSplitsSurrogatePair(value, caret)
  ) {
    return null;
  }
  const minOffset = Number.isInteger(options.minOffset) && options.minOffset >= 0
    ? options.minOffset
    : 0;
  const lineStart = value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  let lineEnd = value.indexOf("\n", lineStart);
  if (lineEnd === -1) {
    lineEnd = value.length;
  }
  let line = value.slice(lineStart, lineEnd);
  if (line.endsWith("\r")) {
    line = line.slice(0, -1);
  }
  const localCaret = caret - lineStart;
  if (localCaret < 0 || localCaret > line.length) {
    return null;
  }
  const token = findTaskWikilinkToken(line, localCaret);
  if (!token) {
    return null;
  }
  const start = lineStart + token.replaceStart;
  const end = lineStart + token.replaceEnd;
  if (
    start < minOffset ||
    (options.mode === "field" && start !== 0) ||
    taskLinksSplitsSurrogatePair(value, start) ||
    taskLinksSplitsSurrogatePair(value, end)
  ) {
    return null;
  }
  const opener = token.opener;
  if (
    taskWikilinkSpanCovers(taskLinksInlineCodeSpans(line), opener) ||
    taskWikilinkSpanCovers(taskWikilinkWikiLinkSpans(line), opener)
  ) {
    return null;
  }
  return {
    start,
    end,
    query: token.query,
    closed: token.closer !== null && token.closer !== undefined,
  };
}

function taskWikilinkNamingPlanForContent(plugin, content, task, newId, options = {}) {
  if (!BLOCK_ID_RE.test(String(newId || ""))) {
    return { ok: false, code: "invalid", task: null, plan: null };
  }
  if (blockTokenMatches(String(content || ""), newId).length > 0) {
    return { ok: false, code: "duplicate", task: null, plan: null };
  }
  const relocated = taskWikilinkLineForIdentity(content, task);
  if (!relocated) {
    return { ok: false, code: "moved", task: null, plan: null };
  }
  if (getTrailingBlockId(relocated.rawLine)) {
    return { ok: false, code: "identified", task: relocated, plan: null };
  }
  const nextTask = { ...task, line: relocated.line, rawLine: relocated.rawLine };
  const plan = planTargetTaskUpdate(content, relocated.line, {
    newBlockId: newId,
    activationEligible: options.activationEligible === true,
    now: plugin && typeof plugin.now === "function" ? plugin.now() : new Date(),
    stampLine: plugin && typeof plugin.getFreshnessStampLine === "function"
      ? plugin.getFreshnessStampLine()
      : undefined,
    freshDateText: plugin && typeof plugin.getFreshnessDateText === "function"
      ? plugin.getFreshnessDateText()
      : undefined,
  });
  return plan
    ? { ok: true, code: null, task: nextTask, plan }
    : { ok: false, code: "moved", task: null, plan: null };
}

// Shared editor application for target plans. The exact preimage check is
// repeated at the last possible moment, then discrete edits preserve the
// surrounding live document and its undo history.
function applyTaskPlanToEditor(plugin, editor, preimage, plan) {
  if (
    !editor || typeof editor.getValue !== "function" ||
    typeof editor.replaceRange !== "function" ||
    editor.getValue() !== preimage || !plan || !Array.isArray(plan.edits)
  ) {
    return false;
  }
  if (plugin && typeof plugin.suppressEditorScans === "function") {
    plugin.suppressEditorScans();
  }
  for (const edit of [...plan.edits].sort((left, right) => right.start - left.start)) {
    editor.replaceRange(
      edit.replacement,
      indexToEditorPosition(preimage, edit.start),
      indexToEditorPosition(preimage, edit.end),
    );
  }
  return true;
}

function taskLinksSubjectRows(subjects) {
  if (typeof subjects === "function") {
    try {
      subjects = subjects();
    } catch (_error) {
      subjects = [];
    }
  }
  return Array.isArray(subjects) ? subjects : [];
}

function taskLinksPublicGroup(row, sourcePath) {
  const group = groupForWikilinkTask(row, sourcePath);
  if (group === "in_this_note") return "this-note";
  if (group === "in_progress") return "in-progress";
  if (group === "completed") return "history";
  return group;
}

function taskLinksTitleParts(displayText, query) {
  const parts = [];
  for (const part of taskWikilinkHighlightedTitleParts(displayText, query)) {
    for (const span of part.spans) {
      if (!span.text) continue;
      parts.push({
        text: span.text,
        kind: span.hl ? "match" : part.type,
      });
    }
  }
  return parts;
}

function taskLinksStatus(row) {
  return taskWikilinkStatusClass(row.status);
}

function taskLinksTaskKind(row, settings) {
  const match = TASK_WIKILINK_LINE_RE.exec(String(row && row.rawLine || ""));
  if (!match || !settings || !settings.globalFilter) {
    return null;
  }
  const tokens = match[3].split(/\s+/).filter(Boolean);
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index] === settings.globalFilter && tokens[index + 1].toLowerCase() === "#ref") {
      return "ref";
    }
  }
  return null;
}

function taskLinksIndexing(index) {
  if (!index || !index.progress || index.progress.ready) {
    return null;
  }
  return {
    done: Number(index.progress.scanned) || 0,
    total: Number(index.progress.total) || 0,
  };
}

function taskLinksEmptySession() {
  return Object.freeze({
    rank() { return { rows: [], total: 0, indexing: null }; },
    linkFor() { return null; },
    suggestions() { return Promise.resolve([]); },
    validate() {
      return { ok: false, short: "unavailable", message: "Task links are unavailable" };
    },
    name() {
      return Promise.resolve({ ok: false, message: "Task links are unavailable", stale: true });
    },
    onChange() { return () => {}; },
    close() {},
  });
}

function createTaskLinksApi(plugin) {
  return Object.freeze({
    version: 1,
    fieldAt(text, caret, options) {
      if (!plugin) return null;
      try {
        return taskLinksFieldAt(text, caret, options || {});
      } catch (_error) {
        return null;
      }
    },
    open(request = {}) {
      if (!plugin || !plugin.app) {
        return taskLinksEmptySession();
      }
      try {
        return createTaskLinksSession(plugin, request || {});
      } catch (_error) {
        return taskLinksEmptySession();
      }
    },
  });
}

function createTaskLinksSession(plugin, request) {
  const index = typeof plugin.ensureTaskWikilinkIndex === "function"
    ? plugin.ensureTaskWikilinkIndex()
    : plugin.taskWikilinkIndex;
  if (!index || typeof index.snapshot !== "function") {
    return taskLinksEmptySession();
  }
  const sourcePath = typeof request.sourcePath === "string" && request.sourcePath
    ? request.sourcePath
    : null;
  const subjects = request.subjects;
  const snapshot = index.snapshot({
    ownerPath: sourcePath,
    overlays: index.collectEditorOverlays(plugin.app),
    statOf: index.vaultStatOf(plugin.app),
  });
  let snapshotRows = snapshot.rows;
  let blockIdsByPath = new Map();
  let closed = false;
  const listeners = new Set();

  function refreshRows() {
    const overlays = index.collectEditorOverlays(plugin.app);
    snapshotRows = index.rowsForPicker({ ownerPath: sourcePath, overlays });
    blockIdsByPath = new Map();
    for (const path of index.notePaths()) {
      blockIdsByPath.set(path, new Set(index.blockIdsFor(path)));
    }
    for (const [path, content] of overlays) {
      blockIdsByPath.set(
        path,
        new Set(collectBlockTokenMatches(content).map((match) => match.id)),
      );
    }
  }
  refreshRows();

  function rowForPublic(row) {
    if (!row || typeof row !== "object" || typeof row.key !== "string") {
      return null;
    }
    const current = snapshotRows.find((candidate) => taskWikilinkRowKey(candidate) === row.key);
    if (
      !current || current.notePath !== row.notePath || current.line !== row.line ||
      (current.blockId || null) !== (row.blockId || null)
    ) {
      return null;
    }
    return current;
  }

  function guardFor(row) {
    return pickerDisabledReasonFor(row, {
      previousDailyPath: previousDailyNotePath(index.notePaths(), plugin.now()),
      subjects,
    });
  }

  function publicRow(row, query) {
    const reason = guardFor(row);
    const guard = taskWikilinkGuardPresentation(reason, row);
    return {
      key: taskWikilinkRowKey(row),
      notePath: row.notePath,
      line: row.line,
      blockId: row.blockId || null,
      needsId: !row.blockId,
      status: taskLinksStatus(row),
      glyph: taskWikilinkStatusGlyph(row.status),
      taskKind: taskLinksTaskKind(row, index.settings),
      titleParts: taskLinksTitleParts(row.displayText, query),
      section: row.section || null,
      group: taskLinksPublicGroup(row, sourcePath),
      hidden: Boolean(row.hidden),
      linkTarget: row.linkTarget,
      suggestedId: row.blockId
        ? null
        : taskWikilinkSuggestedBlockId(row, blockIdsByPath.get(row.notePath)),
      disabled: guard ? { short: guard.badge, full: guard.full } : null,
    };
  }

  function validateRawRow(row, id) {
    if (!row) {
      return { ok: false, short: "task changed", message: "That task moved or changed — pick it again", code: "stale" };
    }
    if (!BLOCK_ID_RE.test(String(id || ""))) {
      return { ok: false, short: "letters, digits, - only", message: "Use letters, numbers, and dashes", code: "invalid" };
    }
    const reason = guardFor(row);
    if (reason) {
      const guard = taskWikilinkGuardPresentation(reason, row);
      return { ok: false, short: guard.badge, message: guard.full, code: "disabled" };
    }
    if (row.blockId) {
      return { ok: false, short: "already has an ID", message: "The task already has a block ID", code: "identified" };
    }
    const reserved = blockIdsByPath.get(row.notePath);
    if (reserved && reserved.has(String(id))) {
      return {
        ok: false,
        short: `already in ${row.notePath}`,
        message: `^${id} already exists in ${row.notePath}`,
        code: "duplicate",
      };
    }
    return { ok: true };
  }

  function onIndexChange(progress) {
    if (closed) return;
    refreshRows();
    const event = {
      indexing: progress && progress.ready
        ? null
        : { done: Number(progress && progress.scanned) || 0, total: Number(progress && progress.total) || 0 },
    };
    for (const listener of [...listeners]) {
      try { listener(event); } catch (_error) { /* isolate API listeners */ }
    }
  }
  const unsubscribeIndex = snapshot.subscribe(onIndexChange);
  if (!plugin.activeTaskLinksSessions) plugin.activeTaskLinksSessions = new Set();

  const session = {
    rank(query) {
      if (closed) return { rows: [], total: 0, indexing: null };
      const ranked = orderForWikilinkPicker(snapshotRows, String(query || ""), sourcePath);
      return {
        rows: ranked.map((row) => publicRow(row, String(query || ""))),
        total: ranked.length,
        indexing: taskLinksIndexing(index),
      };
    },
    linkFor(row) {
      if (closed) return null;
      const raw = rowForPublic(row);
      if (!raw || !raw.blockId || guardFor(raw)) return null;
      let target = raw.linkTarget || taskWikilinkPathStem(raw.notePath);
      try {
        const resolver = plugin.app.metadataCache && plugin.app.metadataCache.getFirstLinkpathDest;
        const dest = typeof resolver === "function"
          ? resolver.call(plugin.app.metadataCache, target, sourcePath || "")
          : null;
        if (!dest || dest.path !== raw.notePath) target = taskWikilinkPathWithoutExtension(raw.notePath);
      } catch (_error) {
        target = taskWikilinkPathWithoutExtension(raw.notePath);
      }
      return `[[${target}#^${raw.blockId}]]`;
    },
    async suggestions(row) {
      if (closed) return [];
      const raw = rowForPublic(row);
      if (!raw || raw.blockId || guardFor(raw)) return [];
      const vault = plugin.app.vault;
      let file = null;
      try { file = vault.getAbstractFileByPath(raw.notePath); } catch (_error) { file = null; }
      if (!file) return [];
      const snapshot = await readAuthoritativePromptTargetContent(plugin, { sourcePath }, file);
      if (typeof snapshot.content !== "string") return [];
      const relocated = taskWikilinkLineForIdentity(snapshot.content, raw);
      if (!relocated || getTrailingBlockId(relocated.rawLine)) return [];
      const suggestion = suggestPromptBlockId(relocated.rawLine, snapshot.content, { reservedIds: new Set() });
      return suggestion ? [suggestion] : [];
    },
    validate(row, id) {
      if (closed) return { ok: false, short: "unavailable", message: "Task links are unavailable" };
      return validateRawRow(rowForPublic(row), id);
    },
    async name(row, id) {
      if (closed) return { ok: false, message: "Task links are unavailable", stale: true };
      const raw = rowForPublic(row);
      const valid = validateRawRow(raw, id);
      if (!valid.ok) {
        return { ok: false, message: valid.message, stale: valid.code === "stale" || valid.code === "identified" };
      }
      const vault = plugin.app.vault;
      let file = null;
      try { file = vault.getAbstractFileByPath(raw.notePath); } catch (_error) { file = null; }
      if (!file) {
        return { ok: false, message: "The task note could not be read", stale: true };
      }
      const authoritative = await readAuthoritativePromptTargetContent(plugin, { sourcePath }, file);
      if (typeof authoritative.content !== "string") {
        return {
          ok: false,
          message: authoritative.ambiguous
            ? "The note is open twice with different text"
            : "The task note could not be read",
          stale: true,
        };
      }
      const alreadyNamed = taskWikilinkAlreadyNamedLine(authoritative.content, raw);
      if (alreadyNamed) {
        index.refreshPaths([{ path: raw.notePath, content: authoritative.content, stat: file.stat }]);
        return { ok: false, message: "The task already has a block ID", stale: true };
      }
      const planned = taskWikilinkNamingPlanForContent(plugin, authoritative.content, raw, id, {
        activationEligible: false,
      });
      if (!planned.ok) {
        return {
          ok: false,
          message: planned.code === "identified"
            ? "The task already has a block ID"
            : planned.code === "duplicate"
              ? `^${id} already exists in ${raw.notePath}`
              : planned.code === "invalid"
                ? "Use letters, numbers, and dashes"
                : "That task moved or changed — pick it again",
          stale: true,
        };
      }

      let after = planned.plan.content;
      if (authoritative.editor) {
        if (!applyTaskPlanToEditor(plugin, authoritative.editor, authoritative.content, planned.plan)) {
          return { ok: false, message: "That task moved or changed — pick it again", stale: true };
        }
      } else {
        if (!vault || typeof vault.process !== "function") {
          return { ok: false, message: "The task note could not be modified", stale: true };
        }
        let outcome = null;
        let called = false;
        try {
          await vault.process(file, (current) => {
            called = true;
            const freshPlan = taskWikilinkNamingPlanForContent(plugin, String(current || ""), raw, id, {
              activationEligible: false,
            });
            outcome = freshPlan;
            if (!freshPlan.ok) return current;
            after = freshPlan.plan.content;
            return after;
          });
        } catch (_error) {
          return { ok: false, message: "The task note could not be modified", stale: true };
        }
        if (!called || !outcome || !outcome.ok) {
          return {
            ok: false,
            message: outcome && outcome.code === "identified"
              ? "The task already has a block ID"
              : outcome && outcome.code === "duplicate"
                ? `^${id} already exists in ${raw.notePath}`
                : outcome && outcome.code === "invalid"
                  ? "Use letters, numbers, and dashes"
                  : "That task moved or changed — pick it again",
            stale: true,
          };
        }
      }

      index.refreshPaths([{ path: raw.notePath, content: after, stat: file.stat }]);
      const blockTarget = raw.linkTarget || taskWikilinkPathStem(raw.notePath);
      let target = blockTarget;
      try {
        const resolver = plugin.app.metadataCache && plugin.app.metadataCache.getFirstLinkpathDest;
        const dest = typeof resolver === "function"
          ? resolver.call(plugin.app.metadataCache, blockTarget, sourcePath || "")
          : null;
        if (!dest || dest.path !== raw.notePath) target = taskWikilinkPathWithoutExtension(raw.notePath);
      } catch (_error) {
        target = taskWikilinkPathWithoutExtension(raw.notePath);
      }
      return { ok: true, link: `[[${target}#^${id}]]`, notePath: raw.notePath, id };
    },
    onChange(listener) {
      if (closed || typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      try { unsubscribeIndex(); } catch (_error) { /* best effort */ }
      listeners.clear();
      plugin.activeTaskLinksSessions.delete(session);
    },
  };
  plugin.activeTaskLinksSessions.add(session);
  void index.drainReparseQueue(plugin.app);
  return Object.freeze(session);
}

function taskWikilinkAlreadyNamedLine(content, task) {
  const lines = String(content || "").split("\n");
  const matches = [];
  for (let line = 0; line < lines.length; line += 1) {
    const rawLine = lines[line].endsWith("\r") ? lines[line].slice(0, -1) : lines[line];
    const id = getTrailingBlockId(rawLine);
    if (!id) continue;
    const withoutId = rawLine.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/, "");
    if (withoutId === task.rawLine) matches.push({ line, rawLine, id });
  }
  return matches.length === 1 ? matches[0] : null;
}
